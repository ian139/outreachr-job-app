import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import type {
  ConnectorProvider,
  ConnectorStatus,
  MailThreadPage,
  MailThreadSummary,
} from '../../../shared/contracts';
import { Badge, Button, EmptyState, SearchField } from '../components/ui';
import { htmlToPlainText, sanitizeHtml } from '../lib/sanitizer';
import { useWorkspace } from '../state/WorkspaceContext';
import '../styles/inbox.css';

interface ConnectorOption {
  provider: ConnectorProvider;
  accountEmail: string;
}

export function InboxPage(): React.JSX.Element {
  const { data } = useWorkspace();

  // Find all connected mail accounts
  const connectedAccounts = useMemo<ConnectorOption[]>(() => {
    if (!data?.connectors) return [];
    return data.connectors
      .filter(
        (c): c is ConnectorStatus & { accountEmail: string } =>
          (c.provider === 'google' || c.provider === 'microsoft') &&
          c.state === 'connected' &&
          Boolean(c.accountEmail),
      )
      .map((c) => ({
        provider: c.provider,
        accountEmail: c.accountEmail,
      }));
  }, [data?.connectors]);

  const [selectedAccount, setSelectedAccount] = useState<ConnectorOption | null>(null);

  // Set default selected account
  useEffect(() => {
    if (connectedAccounts.length > 0) {
      if (
        !selectedAccount ||
        !connectedAccounts.some(
          (a) =>
            a.provider === selectedAccount.provider &&
            a.accountEmail === selectedAccount.accountEmail,
        )
      ) {
        setSelectedAccount(connectedAccounts[0]);
      }
    } else {
      setSelectedAccount(null);
    }
  }, [connectedAccounts, selectedAccount]);

  // Thread list states
  const [threads, setThreads] = useState<MailThreadSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Thread detail states
  const [selectedThreadSummary, setSelectedThreadSummary] = useState<MailThreadSummary | null>(
    null,
  );
  const [threadDetail, setThreadDetail] = useState<MailThreadPage | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'rich' | 'plain'>('rich');

  // Mobile navigation state
  const [showMobileDetail, setShowMobileDetail] = useState(false);

  // Request ID trackers for cancellation & race condition protection
  const activeListRequestIdRef = useRef<string | null>(null);
  const activeDetailRequestIdRef = useRef<string | null>(null);

  // Unmount cleanup to abort active requests
  useEffect(() => {
    return () => {
      if (activeListRequestIdRef.current) {
        window.outreachr?.cancelMailRequest(activeListRequestIdRef.current).catch(() => {});
        activeListRequestIdRef.current = null;
      }
      if (activeDetailRequestIdRef.current) {
        window.outreachr?.cancelMailRequest(activeDetailRequestIdRef.current).catch(() => {});
        activeDetailRequestIdRef.current = null;
      }
    };
  }, []);

  // Load thread list
  const loadThreads = useCallback(
    async (cursor?: string) => {
      if (!selectedAccount || !window.outreachr?.listMailThreads) {
        setThreads([]);
        setNextCursor(null);
        return;
      }

      // Cancel prior list request if in flight
      if (activeListRequestIdRef.current) {
        window.outreachr.cancelMailRequest(activeListRequestIdRef.current).catch(() => {});
      }

      const requestId = `req_list_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      activeListRequestIdRef.current = requestId;

      setLoadingList(true);
      setListError(null);

      try {
        const res = await window.outreachr.listMailThreads({
          requestId,
          provider: selectedAccount.provider,
          accountEmail: selectedAccount.accountEmail,
          query: searchQuery.trim() || undefined,
          limit: 20,
          cursor,
        });

        // Stale check
        if (activeListRequestIdRef.current !== requestId) return;

        setThreads((prev) => (cursor ? [...prev, ...res.threads] : res.threads));
        setNextCursor(res.nextCursor);
      } catch (err) {
        if (activeListRequestIdRef.current !== requestId) return;
        setListError(err instanceof Error ? err.message : 'Failed to fetch thread list.');
      } finally {
        if (activeListRequestIdRef.current === requestId) {
          setLoadingList(false);
        }
      }
    },
    [selectedAccount, searchQuery],
  );

  // Trigger load when account changes or search changes, with request abort cleanup
  useEffect(() => {
    setThreads([]);
    setNextCursor(null);
    setSelectedThreadSummary(null);
    setThreadDetail(null);
    void loadThreads();

    return () => {
      if (activeListRequestIdRef.current) {
        window.outreachr?.cancelMailRequest(activeListRequestIdRef.current).catch(() => {});
        activeListRequestIdRef.current = null;
      }
      if (activeDetailRequestIdRef.current) {
        window.outreachr?.cancelMailRequest(activeDetailRequestIdRef.current).catch(() => {});
        activeDetailRequestIdRef.current = null;
      }
    };
  }, [selectedAccount, searchQuery, loadThreads]);

  // Select thread and load detail
  const selectThread = useCallback(
    async (summary: MailThreadSummary) => {
      setSelectedThreadSummary(summary);
      setThreadDetail(null);
      setShowMobileDetail(true);

      const provider = summary.provider || selectedAccount?.provider;
      const accountEmail = summary.accountEmail || selectedAccount?.accountEmail;

      if (!provider || !accountEmail || !window.outreachr?.getMailThread) {
        return;
      }

      // Cancel prior detail request if in flight
      if (activeDetailRequestIdRef.current) {
        window.outreachr.cancelMailRequest(activeDetailRequestIdRef.current).catch(() => {});
      }

      const requestId = `req_detail_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      activeDetailRequestIdRef.current = requestId;

      setLoadingDetail(true);
      setDetailError(null);

      try {
        const detail = await window.outreachr.getMailThread({
          requestId,
          provider,
          accountEmail,
          threadId: summary.threadId,
          limit: 50,
        });

        // Stale check: ignore response if requestId mismatch
        if (activeDetailRequestIdRef.current !== requestId) return;

        setThreadDetail(detail);
      } catch (err) {
        if (activeDetailRequestIdRef.current !== requestId) return;
        setDetailError(err instanceof Error ? err.message : 'Failed to fetch thread detail.');
      } finally {
        if (activeDetailRequestIdRef.current === requestId) {
          setLoadingDetail(false);
        }
      }
    },
    [selectedAccount],
  );

  // Detail cursor pagination: load additional pages of messages in thread detail
  const loadMoreMessages = useCallback(async () => {
    if (
      !selectedThreadSummary ||
      !threadDetail?.nextCursor ||
      loadingDetail ||
      !window.outreachr?.getMailThread
    ) {
      return;
    }

    const provider = selectedThreadSummary.provider || selectedAccount?.provider;
    const accountEmail = selectedThreadSummary.accountEmail || selectedAccount?.accountEmail;
    if (!provider || !accountEmail) return;

    if (activeDetailRequestIdRef.current) {
      window.outreachr.cancelMailRequest(activeDetailRequestIdRef.current).catch(() => {});
    }

    const requestId = `req_detail_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    activeDetailRequestIdRef.current = requestId;

    setLoadingDetail(true);
    setDetailError(null);

    try {
      const res = await window.outreachr.getMailThread({
        requestId,
        provider,
        accountEmail,
        threadId: selectedThreadSummary.threadId,
        limit: 50,
        cursor: threadDetail.nextCursor,
      });

      if (activeDetailRequestIdRef.current !== requestId) return;

      setThreadDetail((prev) => {
        if (!prev) return res;
        const existingIds = new Set(prev.messages.map((m) => m.messageId));
        const newMessages = res.messages.filter((m) => !existingIds.has(m.messageId));
        return {
          ...res,
          messages: [...prev.messages, ...newMessages],
          nextCursor: res.nextCursor,
        };
      });
    } catch (err) {
      if (activeDetailRequestIdRef.current !== requestId) return;
      setDetailError(
        err instanceof Error ? err.message : 'Failed to fetch additional messages.',
      );
    } finally {
      if (activeDetailRequestIdRef.current === requestId) {
        setLoadingDetail(false);
      }
    }
  }, [selectedThreadSummary, threadDetail, selectedAccount, loadingDetail]);

  // Filter loaded rows client-side in addition to server query
  const displayedThreads = useMemo(() => {
    if (!searchQuery.trim()) return threads;
    const q = searchQuery.toLowerCase().trim();
    return threads.filter(
      (t) =>
        t.subject.toLowerCase().includes(q) ||
        (t.snippet && t.snippet.toLowerCase().includes(q)) ||
        t.participants.some((p) => p.toLowerCase().includes(q)) ||
        t.accountEmail.toLowerCase().includes(q),
    );
  }, [threads, searchQuery]);

  // Handle external link clicks in rich HTML
  const handleRichLinkClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');
    if (anchor) {
      const href = anchor.getAttribute('href');
      if (href && href.toLowerCase().startsWith('https://')) {
        e.preventDefault();
        window.outreachr?.openExternal(href).catch(() => {});
      }
    }
  };

  const openSourceUrl = (url: string | null) => {
    if (url && window.outreachr?.openExternal) {
      window.outreachr.openExternal(url).catch(() => {});
    }
  };

  return (
    <div className="inbox-page">
      <header className="inbox-header">
        <div className="inbox-header__titles">
          <h1>Inbox</h1>
          <p>Read email conversations and sync job-application communications.</p>
        </div>

        {connectedAccounts.length > 0 ? (
          <div className="inbox-account-selector">
            <label htmlFor="inbox-account-select">Account:</label>
            <select
              id="inbox-account-select"
              value={
                selectedAccount
                  ? `${selectedAccount.provider}:${selectedAccount.accountEmail}`
                  : ''
              }
              onChange={(e) => {
                const [prov, email] = e.target.value.split(':');
                const acc = connectedAccounts.find(
                  (a) => a.provider === prov && a.accountEmail === email,
                );
                if (acc) setSelectedAccount(acc);
              }}
            >
              {connectedAccounts.map((acc) => (
                <option
                  key={`${acc.provider}:${acc.accountEmail}`}
                  value={`${acc.provider}:${acc.accountEmail}`}
                >
                  {acc.accountEmail} ({acc.provider})
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </header>

      <div
        className={`inbox-layout ${showMobileDetail ? 'inbox-layout--show-detail' : ''}`}
      >
        {/* Thread List Pane */}
        <aside className="inbox-list-pane" aria-label="Mail threads">
          <div className="inbox-list-toolbar">
            <div className="inbox-search-container">
              <SearchField
                label="Search mail"
                placeholder="Search mail..."
                value={searchQuery}
                onChange={setSearchQuery}
              />
            </div>
          </div>

          <div className="inbox-thread-list" role="list">
            {connectedAccounts.length === 0 ? (
              <EmptyState
                title="No connected accounts"
                detail="Connect a Google or Microsoft account in Settings to sync mail."
              />
            ) : listError ? (
              <div className="inbox-truncated-alert" role="alert">
                <AlertTriangle className="inbox-icon-warning" aria-hidden="true" />
                <span>{listError}</span>
                <Button
                  tone="quiet"
                  size="small"
                  onClick={() => void loadThreads()}
                  icon={<RefreshCw aria-hidden="true" />}
                >
                  Retry
                </Button>
              </div>
            ) : loadingList && threads.length === 0 ? (
              <div
                style={{ padding: '2rem', textAlign: 'center' }}
                aria-label="Loading threads"
                aria-busy="true"
              >
                <LoaderCircle className="spin" aria-hidden="true" />
                <p
                  style={{
                    marginTop: '0.5rem',
                    fontSize: '0.875rem',
                    color: 'var(--text-muted)',
                  }}
                >
                  Loading conversations...
                </p>
              </div>
            ) : displayedThreads.length === 0 ? (
              <EmptyState
                title="No mail threads"
                detail={
                  searchQuery
                    ? 'No conversations match your search filter.'
                    : 'No email threads found for this account.'
                }
              />
            ) : (
              displayedThreads.map((thread) => {
                const isSelected = selectedThreadSummary?.threadId === thread.threadId;
                const formattedDate = new Date(thread.latestAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                });

                return (
                  <button
                    key={thread.threadId}
                    type="button"
                    className={`inbox-thread-card ${
                      isSelected ? 'inbox-thread-card--selected' : ''
                    }`}
                    onClick={() => void selectThread(thread)}
                  >
                    <div className="inbox-thread-card__header">
                      <span className="inbox-thread-card__subject">
                        {thread.subject || '(No subject)'}
                      </span>
                      <span className="inbox-thread-card__date">{formattedDate}</span>
                    </div>

                    <div className="inbox-thread-card__participants">
                      {thread.participants.join(', ')}
                    </div>

                    {thread.snippet ? (
                      <div className="inbox-thread-card__snippet">{thread.snippet}</div>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>

          {nextCursor ? (
            <div className="inbox-list-footer">
              <button
                type="button"
                className="inbox-button"
                disabled={loadingList}
                onClick={() => void loadThreads(nextCursor)}
              >
                {loadingList ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
                <span>Load more threads</span>
              </button>
            </div>
          ) : null}
        </aside>

        {/* Thread Detail Pane */}
        <main className="inbox-detail-pane" aria-label="Thread content">
          {selectedThreadSummary ? (
            <>
              <header className="inbox-detail-header">
                <div className="inbox-detail-header__top">
                  <button
                    type="button"
                    className="inbox-back-button"
                    onClick={() => setShowMobileDetail(false)}
                  >
                    <ArrowLeft aria-hidden="true" />
                    <span>Back to inbox</span>
                  </button>

                  <h2 className="inbox-detail-header__subject">
                    {selectedThreadSummary.subject || '(No subject)'}
                  </h2>

                  <div className="inbox-detail-header__controls">
                    <div
                      className="inbox-view-toggle"
                      role="group"
                      aria-label="Content view mode"
                    >
                      <button
                        type="button"
                        className={viewMode === 'rich' ? 'active' : ''}
                        onClick={() => setViewMode('rich')}
                      >
                        View rich content
                      </button>
                      <button
                        type="button"
                        className={viewMode === 'plain' ? 'active' : ''}
                        onClick={() => setViewMode('plain')}
                      >
                        View plain text
                      </button>
                    </div>
                  </div>
                </div>

                <div className="inbox-detail-header__meta">
                  <Badge tone="neutral">{selectedThreadSummary.provider}</Badge>
                  <span>{selectedThreadSummary.accountEmail}</span>
                  <span>{selectedThreadSummary.messageCount} messages</span>
                  {selectedThreadSummary.sourceUrl ? (
                    <button
                      type="button"
                      className="inbox-source-link"
                      onClick={() => openSourceUrl(selectedThreadSummary.sourceUrl)}
                    >
                      <ExternalLink aria-hidden="true" size={14} />
                      <span>View in provider</span>
                    </button>
                  ) : null}
                </div>
              </header>

              <div className="inbox-messages-feed">
                {detailError ? (
                  <div className="inbox-truncated-alert" role="alert">
                    <AlertTriangle className="inbox-icon-warning" aria-hidden="true" />
                    <span>{detailError}</span>
                  </div>
                ) : loadingDetail && !threadDetail ? (
                  <div
                    style={{ padding: '3rem', textAlign: 'center' }}
                    aria-label="Loading thread messages"
                    aria-busy="true"
                  >
                    <LoaderCircle className="spin" aria-hidden="true" />
                    <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)' }}>
                      Fetching thread messages...
                    </p>
                  </div>
                ) : threadDetail?.messages && threadDetail.messages.length > 0 ? (
                  <>
                    {threadDetail.messages.map((message) => {
                      const plainTextContent =
                        message.bodyText?.trim() ||
                        htmlToPlainText(message.bodyHtml || '') ||
                        '(No text content)';

                      return (
                        <article key={message.messageId} className="inbox-message-card">
                          <div className="inbox-message-card__header">
                            <div>
                              <div className="inbox-message-card__sender">
                                {message.from.name
                                  ? `${message.from.name} <${message.from.email}>`
                                  : message.from.email}
                              </div>
                              <div className="inbox-message-card__recipients">
                                To: {message.to.map((t) => t.email).join(', ')}
                                {message.cc?.length > 0
                                  ? ` | CC: ${message.cc.map((c) => c.email).join(', ')}`
                                  : ''}
                              </div>
                            </div>

                            <div className="inbox-message-card__meta">
                              <span>
                                {new Date(message.occurredAt).toLocaleString(undefined, {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                })}
                              </span>
                              {message.direction ? (
                                <Badge
                                  tone={
                                    message.direction === 'inbound' ? 'info' : 'neutral'
                                  }
                                >
                                  {message.direction}
                                </Badge>
                              ) : null}
                              {message.sourceUrl ? (
                                <button
                                  type="button"
                                  className="inbox-source-link"
                                  onClick={() => openSourceUrl(message.sourceUrl)}
                                >
                                  <ExternalLink aria-hidden="true" size={12} />
                                  <span>Source</span>
                                </button>
                              ) : null}
                            </div>
                          </div>

                          {message.providerTruncated ? (
                            <div className="inbox-truncated-alert" role="alert">
                              <AlertTriangle
                                className="inbox-icon-warning"
                                aria-hidden="true"
                              />
                              <span>
                                Message content truncated by provider.
                                {message.truncationReason
                                  ? ` Reason: ${message.truncationReason}`
                                  : ''}
                              </span>
                            </div>
                          ) : null}

                          <div className="inbox-message-card__body">
                            {viewMode === 'rich' && message.bodyHtml ? (
                              <div
                                className="inbox-rich-content"
                                dangerouslySetInnerHTML={{
                                  __html: sanitizeHtml(message.bodyHtml),
                                }}
                                onClick={handleRichLinkClick}
                              />
                            ) : (
                              <pre className="inbox-plain-content">{plainTextContent}</pre>
                            )}
                          </div>
                        </article>
                      );
                    })}

                    {threadDetail.nextCursor ? (
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'center',
                          padding: '1rem 0',
                        }}
                      >
                        <button
                          type="button"
                          className="inbox-button"
                          disabled={loadingDetail}
                          onClick={() => void loadMoreMessages()}
                        >
                          {loadingDetail ? (
                            <LoaderCircle className="spin" aria-hidden="true" />
                          ) : null}
                          <span>Load more messages</span>
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <EmptyState
                    title="No messages found"
                    detail="This thread does not contain any readable message bodies."
                  />
                )}
              </div>
            </>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
              }}
            >
              <EmptyState
                title="Select a conversation"
                detail="Choose a mail thread from the list to view message history and content."
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
