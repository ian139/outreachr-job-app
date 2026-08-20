import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  GetMailThreadRequest,
  ListMailThreadsRequest,
  MailMessageBody,
  MailThreadListPage,
  MailThreadPage,
  MailThreadSummary,
} from '../../src/shared/contracts';
import { InboxPage } from '../../src/renderer/src/pages/InboxPage';
import { WorkspaceProvider } from '../../src/renderer/src/state/WorkspaceContext';
import { bootstrapFixture, installBridge } from './fixtures';

const mockThreadSummary1: MailThreadSummary = {
  provider: 'google',
  accountEmail: 'founder@example.com',
  threadId: 'thread_1',
  subject: 'Job Application Followup',
  snippet: 'Thanks for submitting your application. We would love to schedule a interview.',
  participants: ['recruiter@company.com', 'founder@example.com'],
  latestAt: new Date('2026-08-10T14:30:00Z').toISOString(),
  messageCount: 2,
  sourceUrl: 'https://mail.google.com/mail/u/0/#inbox/thread_1',
};

const mockThreadSummary2: MailThreadSummary = {
  provider: 'google',
  accountEmail: 'founder@example.com',
  threadId: 'thread_2',
  subject: 'Software Engineer Application Status',
  snippet: 'Status update regarding your recent application.',
  participants: ['hr@techcorp.com', 'founder@example.com'],
  latestAt: new Date('2026-08-09T10:00:00Z').toISOString(),
  messageCount: 1,
  sourceUrl: null,
};

const mockMessage1: MailMessageBody = {
  provider: 'google',
  accountEmail: 'founder@example.com',
  threadId: 'thread_1',
  messageId: 'msg_1',
  internetMessageId: '<msg1@company.com>',
  subject: 'Job Application Followup',
  from: { email: 'recruiter@company.com', name: 'Recruiter' },
  to: [{ email: 'founder@example.com', name: 'Applicant' }],
  cc: [],
  occurredAt: new Date('2026-08-10T14:30:00Z').toISOString(),
  labels: ['INBOX'],
  direction: 'inbound',
  bodyText: 'Thanks for submitting your application. We would love to schedule an interview.',
  bodyHtml: `
    <p>Thanks for submitting your application. We would love to schedule an interview.</p>
    <p>Schedule here: <a href="https://cal.example.com/interview">Interview Portal</a></p>
    <script>alert("hacked")</script>
  `,
  providerTruncated: false,
  truncationReason: null,
  sourceUrl: 'https://mail.google.com/mail/u/0/#inbox/msg_1',
  fetchedAt: new Date().toISOString(),
};

const mockMessageHtmlOnly: MailMessageBody = {
  provider: 'google',
  accountEmail: 'founder@example.com',
  threadId: 'thread_1',
  messageId: 'msg_html_only',
  internetMessageId: '<msg2@company.com>',
  subject: 'Re: Job Application Followup',
  from: { email: 'recruiter@company.com', name: 'Recruiter' },
  to: [{ email: 'founder@example.com', name: 'Applicant' }],
  cc: [],
  occurredAt: new Date('2026-08-10T15:00:00Z').toISOString(),
  labels: ['INBOX'],
  direction: 'inbound',
  bodyText: null, // HTML-only message with null bodyText
  bodyHtml: '<p>HTML only message body with <strong>bold detail</strong>.</p>',
  providerTruncated: false,
  truncationReason: null,
  sourceUrl: null,
  fetchedAt: new Date().toISOString(),
};

const mockMessage2Truncated: MailMessageBody = {
  provider: 'google',
  accountEmail: 'founder@example.com',
  threadId: 'thread_1',
  messageId: 'msg_2',
  internetMessageId: '<msg3@company.com>',
  subject: 'Re: Job Application Followup',
  from: { email: 'founder@example.com', name: 'Applicant' },
  to: [{ email: 'recruiter@company.com', name: 'Recruiter' }],
  cc: [],
  occurredAt: new Date('2026-08-10T15:30:00Z').toISOString(),
  labels: ['SENT'],
  direction: 'outbound',
  bodyText: 'Sounds great! Tuesday works best for me.',
  bodyHtml: '<p>Sounds great! Tuesday works best for me.</p>',
  providerTruncated: true,
  truncationReason: 'Body exceeds maximum connector size limit',
  sourceUrl: null,
  fetchedAt: new Date().toISOString(),
};

const markdownOnlyBody = [
  '# Next steps',
  '',
  '1. Review the **role brief**',
  '2. Visit [the secure portal](https://jobs.example.com/interview)',
  '',
  '> Please bring questions.',
  '',
  '```ts',
  'const confirmed = true;',
  '```',
  '',
  '<img src="https://tracking.example.com/pixel" onerror="alert(1)">',
].join('\n');

const mockMessageMarkdownOnly: MailMessageBody = {
  ...mockMessageHtmlOnly,
  messageId: 'msg_markdown_only',
  internetMessageId: '<msg-markdown@company.com>',
  bodyText: markdownOnlyBody,
  bodyHtml: null,
};

function setupInboxFixture() {
  const fixture = bootstrapFixture();
  fixture.connectors = [
    {
      provider: 'google',
      state: 'connected',
      accountEmail: 'founder@example.com',
      scopes: [
        'openid',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/calendar.events.owned',
        'https://www.googleapis.com/auth/calendar.events.freebusy',
        'https://www.googleapis.com/auth/gmail.readonly',
      ],
      scopeProfile: 'relationship-sync',
      capabilities: {
        canReadInbox: true,
        canSyncRelationships: true,
        canDraft: true,
        canSend: true,
        canReadCalendar: true,
        canWriteCalendar: true,
      },
      lastSyncAt: new Date().toISOString(),
      error: null,
      encryptionAvailable: true,
    },
  ];

  // The mock stands in for the connector, which is the authoritative search
  // filter: each whitespace token must match somewhere across the metadata
  // fields (subject, snippet, participants, account), and tokens may match
  // different fields. The renderer must not narrow this result any further.
  const listMailThreads = vi.fn(
    async (req: ListMailThreadsRequest): Promise<MailThreadListPage> => {
      const all = [mockThreadSummary1, mockThreadSummary2];
      const query = req.query?.trim();
      if (!query) return { threads: all, nextCursor: 'cursor_page_2' };
      const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
      const filtered = all.filter((t) => {
        const haystack = [t.subject, t.snippet ?? '', ...t.participants, t.accountEmail]
          .join(' ')
          .toLowerCase();
        return tokens.every((token) => haystack.includes(token));
      });
      return { threads: filtered, nextCursor: 'cursor_page_2' };
    },
  );

  const getMailThread = vi.fn(async (req: GetMailThreadRequest): Promise<MailThreadPage> => {
    if (req.cursor === 'detail_cursor_2') {
      return {
        thread: mockThreadSummary1,
        messages: [mockMessageHtmlOnly],
        nextCursor: null,
      };
    }
    return {
      thread: mockThreadSummary1,
      messages: [mockMessage1, mockMessage2Truncated],
      nextCursor: 'detail_cursor_2',
    };
  });

  const cancelMailRequest = vi.fn(async (): Promise<void> => {});
  const openExternal = vi.fn(async (): Promise<void> => {});

  const bridge = installBridge(fixture);
  bridge.listMailThreads = listMailThreads;
  bridge.getMailThread = getMailThread;
  bridge.cancelMailRequest = cancelMailRequest;
  bridge.openExternal = openExternal;

  return { bridge, listMailThreads, getMailThread, cancelMailRequest, openExternal };
}

function renderInboxPage() {
  return render(
    <WorkspaceProvider>
      <InboxPage />
    </WorkspaceProvider>,
  );
}

describe('InboxPage component & messaging behavior', () => {
  it('renders thread list, filters threads, and displays updated copy', async () => {
    const { listMailThreads } = setupInboxFixture();
    renderInboxPage();

    // Check header copy for job-application communications
    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    expect(
      screen.getByText(/Read email conversations and sync job-application communications/i),
    ).toBeInTheDocument();

    // Verify threads rendered
    expect(await screen.findByText('Job Application Followup')).toBeInTheDocument();
    expect(screen.getByText('Software Engineer Application Status')).toBeInTheDocument();

    // Verify pagination button for list
    const loadMoreButton = screen.getByRole('button', { name: /load more threads/i });
    expect(loadMoreButton).toBeInTheDocument();

    fireEvent.click(loadMoreButton);
    expect(listMailThreads).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: 'cursor_page_2',
        accountEmail: 'founder@example.com',
      }),
    );

    // Verify loaded-row search input
    const searchInput = screen.getByPlaceholderText('Search mail...');
    fireEvent.change(searchInput, { target: { value: 'Followup' } });

    expect(await screen.findByText('Job Application Followup')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('Software Engineer Application Status')).not.toBeInTheDocument(),
    );
  });

  it('keeps connector-valid cross-field multi-token matches visible (interview acme)', async () => {
    const fixture = bootstrapFixture();
    fixture.connectors = [
      {
        provider: 'microsoft',
        state: 'connected',
        accountEmail: 'founder@example.com',
        scopes: ['https://graph.microsoft.com/Mail.ReadBasic'],
        scopeProfile: 'relationship-sync',
        capabilities: {
          canReadInbox: true,
          canSyncRelationships: true,
          canDraft: true,
          canSend: true,
          canReadCalendar: true,
          canWriteCalendar: true,
        },
        lastSyncAt: new Date().toISOString(),
        error: null,
        encryptionAvailable: true,
      },
    ];

    // Connector-valid for the query `interview acme`: `interview` matches the
    // subject while `acme` matches only the sender field. The two tokens are
    // NOT contiguous in any single field, so a second-stage client-side
    // substring filter would wrongly hide this thread.
    const crossFieldThread: MailThreadSummary = {
      provider: 'microsoft',
      accountEmail: 'founder@example.com',
      threadId: 'ms-thread-acme',
      subject: 'Interview invitation',
      snippet: 'We would like to schedule a conversation',
      participants: ['Acme Recruiter <recruiter@acme.com>', 'founder@example.com'],
      latestAt: new Date('2026-08-11T09:00:00Z').toISOString(),
      messageCount: 1,
      sourceUrl: null,
    };

    // Server-side (connector) contract: every whitespace token must match
    // somewhere across the metadata fields, and tokens may match different
    // fields. The renderer must render exactly what the connector returns.
    const listMailThreads = vi.fn(
      async (req: ListMailThreadsRequest): Promise<MailThreadListPage> => {
        const query = req.query?.trim();
        if (!query) return { threads: [crossFieldThread], nextCursor: null };
        const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
        const haystack = [
          crossFieldThread.subject,
          crossFieldThread.snippet ?? '',
          ...crossFieldThread.participants,
          crossFieldThread.accountEmail,
        ]
          .join(' ')
          .toLowerCase();
        return {
          threads: tokens.every((token) => haystack.includes(token)) ? [crossFieldThread] : [],
          nextCursor: null,
        };
      },
    );

    const bridge = installBridge(fixture);
    bridge.listMailThreads = listMailThreads;
    bridge.cancelMailRequest = vi.fn(async () => {});
    renderInboxPage();

    expect(await screen.findByText('Interview invitation')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText('Search mail...');
    fireEvent.change(searchInput, { target: { value: 'interview acme' } });

    await waitFor(() =>
      expect(listMailThreads).toHaveBeenLastCalledWith(
        expect.objectContaining({ provider: 'microsoft', query: 'interview acme' }),
      ),
    );

    // The cross-field connector match stays visible after the server refetch.
    expect(await screen.findByText('Interview invitation')).toBeInTheDocument();
    expect(screen.queryByText(/No conversations match/i)).not.toBeInTheDocument();
  });

  it('lists inbox threads for a read-only connected account', async () => {
    const fixture = bootstrapFixture();
    fixture.connectors = [
      {
        provider: 'google',
        state: 'connected',
        accountEmail: 'founder@example.com',
        scopes: [
          'openid',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/gmail.readonly',
        ],
        scopeProfile: 'read-only',
        capabilities: {
          canReadInbox: true,
          canSyncRelationships: false,
          canDraft: false,
          canSend: false,
          canReadCalendar: false,
          canWriteCalendar: false,
        },
        lastSyncAt: null,
        error: null,
        encryptionAvailable: true,
      },
    ];
    const listMailThreads = vi.fn(async (): Promise<MailThreadListPage> => ({
      threads: [mockThreadSummary1],
      nextCursor: null,
    }));
    const bridge = installBridge(fixture);
    bridge.listMailThreads = listMailThreads;
    bridge.cancelMailRequest = vi.fn(async () => {});

    renderInboxPage();

    expect(await screen.findByText('Job Application Followup')).toBeInTheDocument();
    expect(listMailThreads).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'google',
        accountEmail: 'founder@example.com',
      }),
    );
  });

  it('selects a thread, loads messages, and handles detail cursor pagination', async () => {
    const { getMailThread, cancelMailRequest } = setupInboxFixture();
    renderInboxPage();

    const thread1Card = await screen.findByText('Job Application Followup');
    fireEvent.click(thread1Card);

    await waitFor(() => {
      expect(getMailThread).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 'thread_1',
          accountEmail: 'founder@example.com',
        }),
      );
    });

    // Detail pagination button should be present
    const loadMoreMessagesBtn = await screen.findByRole('button', {
      name: /load more messages/i,
    });
    expect(loadMoreMessagesBtn).toBeInTheDocument();

    fireEvent.click(loadMoreMessagesBtn);

    await waitFor(() => {
      expect(getMailThread).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 'thread_1',
          cursor: 'detail_cursor_2',
        }),
      );
    });

    // Verify newly appended message from page 2 appears
    expect(await screen.findByText(/HTML only message body with/i)).toBeInTheDocument();

    // Rapid selection of second thread to test cancellation call
    const thread2Card = screen.getByText('Software Engineer Application Status');
    fireEvent.click(thread2Card);

    expect(cancelMailRequest).toHaveBeenCalled();
  });

  it('provides plain text fallback extracted from HTML for HTML-only messages', async () => {
    setupInboxFixture();
    renderInboxPage();

    const thread1Card = await screen.findByText('Job Application Followup');
    fireEvent.click(thread1Card);

    // Load detail page 2 which has HTML-only message
    const loadMoreMessagesBtn = await screen.findByRole('button', {
      name: /load more messages/i,
    });
    fireEvent.click(loadMoreMessagesBtn);

    // Switch to plain text view
    const plainButton = await screen.findByRole('button', { name: 'View plain text' });
    fireEvent.click(plainButton);

    // Verify HTML-only message plain text fallback works without displaying '(No text content)'
    expect(await screen.findByText('HTML only message body with bold detail.')).toBeInTheDocument();
    expect(screen.queryByText('(No text content)')).not.toBeInTheDocument();
  });

  it('ignores stale thread detail response if requestId is mismatched', async () => {
    const fixture = bootstrapFixture();
    fixture.connectors = [
      {
        provider: 'google',
        state: 'connected',
        accountEmail: 'founder@example.com',
        scopes: [
          'openid',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/gmail.readonly',
        ],
        scopeProfile: 'read-only',
        capabilities: {
          canReadInbox: true,
          canSyncRelationships: false,
          canDraft: false,
          canSend: false,
          canReadCalendar: false,
          canWriteCalendar: false,
        },
        lastSyncAt: null,
        error: null,
        encryptionAvailable: true,
      },
    ];

    const { promise: delayedPromise, resolve: delayedResolve } =
      Promise.withResolvers<MailThreadPage>();
    const getMailThread = vi.fn(() => delayedPromise);

    const bridge = installBridge(fixture);
    bridge.listMailThreads = vi.fn(async () => ({
      threads: [mockThreadSummary1, mockThreadSummary2],
      nextCursor: null,
    }));
    bridge.getMailThread = getMailThread;
    bridge.cancelMailRequest = vi.fn(async () => {});

    renderInboxPage();

    const thread1Card = await screen.findByText('Job Application Followup');
    fireEvent.click(thread1Card);

    // While request 1 is pending, click thread 2
    const thread2Card = screen.getByText('Software Engineer Application Status');
    fireEvent.click(thread2Card);

    // Resolve the first delayed promise now (stale response)
    delayedResolve({
      thread: mockThreadSummary1,
      messages: [mockMessage1],
      nextCursor: null,
    });

    // Thread 1's subject should NOT be active detail heading if request was stale
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: 'Job Application Followup' }),
      ).not.toBeInTheDocument();
    });
  });

  it('toggles plain vs rich text view and intercepts rich link clicks without console errors', async () => {
    const { openExternal } = setupInboxFixture();
    renderInboxPage();

    const thread1Card = await screen.findByText('Job Application Followup');
    fireEvent.click(thread1Card);

    // Rich view is default
    const richButton = await screen.findByRole('button', { name: 'View rich content' });
    const plainButton = screen.getByRole('button', { name: 'View plain text' });

    expect(richButton).toHaveClass('active');
    expect(richButton).toHaveAttribute('aria-pressed', 'true');
    expect(plainButton).toHaveAttribute('aria-pressed', 'false');

    // Rich view sanitized HTML check (script stripped, link present)
    const link = await screen.findByRole('link', { name: 'Interview Portal' });
    expect(link).toHaveAttribute('href', 'https://cal.example.com/interview');
    expect(screen.queryByText(/alert\("hacked"\)/)).not.toBeInTheDocument();

    // Click link -> openExternal intercept
    fireEvent.click(link);
    expect(openExternal).toHaveBeenCalledWith('https://cal.example.com/interview');

    // Switch to plain text view
    fireEvent.click(plainButton);
    expect(plainButton).toHaveClass('active');
    expect(plainButton).toHaveAttribute('aria-pressed', 'true');
    expect(richButton).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByText(
        'Thanks for submitting your application. We would love to schedule an interview.',
      ),
    ).toBeInTheDocument();
  });

  it('renders Markdown-like plain text semantically in rich mode while preserving exact plain mode', async () => {
    const { getMailThread, openExternal } = setupInboxFixture();
    getMailThread.mockResolvedValue({
      thread: mockThreadSummary1,
      messages: [mockMessageMarkdownOnly],
      nextCursor: null,
    });
    renderInboxPage();

    fireEvent.click(await screen.findByText('Job Application Followup'));

    expect(await screen.findByRole('heading', { name: 'Next steps' })).toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getByRole('blockquote')).toHaveTextContent('Please bring questions.');
    expect(screen.getByText('const confirmed = true;', { selector: 'code' })).toBeInTheDocument();
    const securePortal = screen.getByRole('link', { name: 'the secure portal' });
    expect(securePortal).toHaveAttribute('href', 'https://jobs.example.com/interview');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    fireEvent.click(securePortal);
    expect(openExternal).toHaveBeenCalledWith('https://jobs.example.com/interview');

    fireEvent.click(screen.getByRole('button', { name: 'View plain text' }));
    expect(
      screen.getByText(
        (_, element) => element?.tagName === 'PRE' && element.textContent === markdownOnlyBody,
      ),
    ).toBeInTheDocument();
  });

  it('displays provider-truncated alert and source links', async () => {
    const { openExternal } = setupInboxFixture();
    renderInboxPage();

    const thread1Card = await screen.findByText('Job Application Followup');
    fireEvent.click(thread1Card);

    // Truncated alert banner
    expect(await screen.findByText(/Message content truncated by provider/i)).toBeInTheDocument();
    expect(screen.getByText(/Body exceeds maximum connector size limit/i)).toBeInTheDocument();

    // Source link
    const sourceButtons = screen.getAllByRole('button', { name: /view in provider|source/i });
    expect(sourceButtons.length).toBeGreaterThan(0);

    fireEvent.click(sourceButtons[0]);
    expect(openExternal).toHaveBeenCalledWith('https://mail.google.com/mail/u/0/#inbox/thread_1');
  });

  it('defaults to the job-relevant mail view and shows the active mode', async () => {
    const { listMailThreads } = setupInboxFixture();
    renderInboxPage();

    await screen.findByText('Job Application Followup');

    const modeGroup = screen.getByRole('group', { name: /mail view/i });
    expect(modeGroup).toBeInTheDocument();
    const jobButton = screen.getByRole('button', { name: 'Job relevant' });
    const allButton = screen.getByRole('button', { name: 'All mail' });
    expect(jobButton).toHaveAttribute('aria-pressed', 'true');
    expect(allButton).toHaveAttribute('aria-pressed', 'false');

    expect(listMailThreads).toHaveBeenCalledWith(
      expect.objectContaining({ mailViewMode: 'job-relevant' }),
    );
    expect(screen.getByText(/Showing job-relevant mail/i)).toBeInTheDocument();
  });

  it('switching to All mail refetches unfiltered and preserves the search query', async () => {
    const { listMailThreads } = setupInboxFixture();
    renderInboxPage();

    await screen.findByText('Job Application Followup');

    const searchInput = screen.getByPlaceholderText('Search mail...');
    fireEvent.change(searchInput, { target: { value: 'offer' } });
    await waitFor(() =>
      expect(listMailThreads).toHaveBeenLastCalledWith(
        expect.objectContaining({ mailViewMode: 'job-relevant', query: 'offer' }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'All mail' }));

    await waitFor(() =>
      expect(listMailThreads).toHaveBeenLastCalledWith(
        expect.objectContaining({ mailViewMode: 'all', query: 'offer' }),
      ),
    );
    expect(screen.getByRole('button', { name: 'All mail' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Job relevant' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByText(/Showing all mail \(unfiltered\)/i)).toBeInTheDocument();
  });

  it('exposes All mail as the transparent raw unfiltered escape hatch', async () => {
    const { listMailThreads } = setupInboxFixture();
    renderInboxPage();

    await screen.findByText('Job Application Followup');
    const allButton = screen.getByRole('button', { name: 'All mail' });
    expect(allButton).toHaveAttribute('title');
    fireEvent.click(allButton);

    await waitFor(() =>
      expect(listMailThreads).toHaveBeenLastCalledWith(
        expect.objectContaining({ mailViewMode: 'all' }),
      ),
    );
    // All mail requests must not be constrained to the job-relevant window.
    const allCalls = listMailThreads.mock.calls.filter(
      (call) => (call[0] as { mailViewMode?: string }).mailViewMode === 'all',
    );
    expect(allCalls.length).toBeGreaterThan(0);
    for (const call of allCalls) {
      expect(call[0]).not.toHaveProperty('jobRelevantOnly');
    }
  });

  it('handles mobile Back to inbox button navigation and unmount cleanup', async () => {
    const { cancelMailRequest } = setupInboxFixture();
    const { unmount } = renderInboxPage();

    const thread1Card = await screen.findByText('Job Application Followup');
    fireEvent.click(thread1Card);

    const backButton = await screen.findByRole('button', { name: /back to inbox/i });
    expect(backButton).toBeInTheDocument();

    fireEvent.click(backButton);
    // Detail pane hidden in mobile mode
    expect(
      screen.queryByRole('heading', { name: 'Job Application Followup' }),
    ).not.toBeInTheDocument();

    unmount();
    expect(cancelMailRequest).toHaveBeenCalled();
  });
});
