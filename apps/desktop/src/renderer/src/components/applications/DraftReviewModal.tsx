import { useState } from 'react';
import type { DraftMessage } from '../../../../shared/contracts';
import { Badge, Button, Dialog, formatDate } from '../ui';
import { useWorkspace } from '../../state/WorkspaceContext';

export function DraftReviewModal({
  open,
  onClose,
  draft,
  applicationRole,
  companyName,
  onUpdated,
}: {
  open: boolean;
  onClose: () => void;
  draft: DraftMessage | null;
  applicationRole?: string;
  companyName?: string;
  onUpdated?: (updated: DraftMessage) => void;
}): React.JSX.Element | null {
  const { data, command, notify } = useWorkspace();
  const [approving, setApproving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!draft) return null;

  const appCtx = (data?.applications ?? []).find(
    (application) => application.id === draft.applicationId,
  );
  const roleContext = applicationRole || appCtx?.role || 'Job Application';
  const companyContext = companyName || appCtx?.companyName || 'Target Company';

  const handleApprove = async (): Promise<void> => {
    setApproving(true);
    setError(null);
    try {
      const updated = await command('draft.approve', {
        id: draft.id,
        expectedContentHash: draft.contentHash,
      });
      notify({ tone: 'success', title: 'Draft approved for delivery' });
      onUpdated?.(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve draft');
    } finally {
      setApproving(false);
    }
  };

  const handleSend = async (): Promise<void> => {
    setSending(true);
    setError(null);
    try {
      const updated = await command('draft.send', {
        id: draft.id,
        expectedContentHash: draft.contentHash,
      });
      notify({ tone: 'success', title: 'Draft dispatch submitted' });
      onUpdated?.(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send draft');
    } finally {
      setSending(false);
    }
  };

  const stateTone =
    draft.approvalState === 'approved'
      ? 'success'
      : draft.approvalState === 'sent'
        ? 'info'
        : draft.approvalState === 'blocked' || draft.approvalState === 'failed'
          ? 'danger'
          : draft.approvalState === 'ambiguous'
            ? 'warning'
            : 'neutral';

  const blockReasons = [
    ...(draft.blockReason ? [draft.blockReason] : []),
    ...(draft.approvalBlockReasons ?? []),
    ...(draft.sendBlockReasons ?? []),
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Review draft"
      description="Review exact delivery metadata, application context, and body content before approving or sending."
      footer={
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', width: '100%' }}>
          <Button type="button" tone="quiet" onClick={onClose} disabled={approving || sending}>
            Close
          </Button>

          {draft.approvalState === 'draft' ? (
            <Button
              type="button"
              tone="primary"
              loading={approving}
              disabled={!draft.canApprove}
              onClick={handleApprove}
            >
              Approve draft
            </Button>
          ) : null}

          {draft.approvalState === 'approved' ? (
            <Button
              type="button"
              tone="primary"
              loading={sending}
              disabled={!draft.canSend}
              onClick={handleSend}
            >
              Send draft
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="draft-review-card">
        {error ? (
          <div role="alert" className="draft-block-alert">
            <strong>Error:</strong> {error}
          </div>
        ) : null}

        <div className="draft-review-card__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Badge tone={stateTone}>{draft.approvalState.toUpperCase()}</Badge>
            <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>Kind: {draft.kind}</span>
          </div>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
            Content Hash: {draft.contentHash.slice(0, 12)}...
          </span>
        </div>

        {/* Application Context Banner */}
        <div
          style={{
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '0.5rem',
            padding: '0.75rem',
            fontSize: '0.875rem',
          }}
        >
          <div
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: '#166534',
              textTransform: 'uppercase',
            }}
          >
            Application Context
          </div>
          <div style={{ fontWeight: 700, color: '#0f172a', marginTop: '0.125rem' }}>
            {roleContext} at {companyContext}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#15803d', marginTop: '0.125rem' }}>
            Application ID: {draft.applicationId}
          </div>
        </div>

        {blockReasons.length > 0 ? (
          <div role="alert" className="draft-block-alert">
            <strong>Delivery checks blocked:</strong>
            <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0 }}>
              {blockReasons.map((reason, idx) => (
                <li key={idx}>{reason}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="draft-meta-grid">
          <div className="draft-meta-item">
            <span className="draft-meta-item__label">Provider</span>
            <span className="draft-meta-item__value">{draft.provider.toUpperCase()}</span>
          </div>
          <div className="draft-meta-item">
            <span className="draft-meta-item__label">Account / Sender</span>
            <span className="draft-meta-item__value">{draft.accountEmail}</span>
          </div>
          <div className="draft-meta-item">
            <span className="draft-meta-item__label">Recipient</span>
            <span className="draft-meta-item__value">
              {draft.recipientName} &lt;{draft.recipientEmail}&gt;
            </span>
          </div>
          {draft.threadId ? (
            <div className="draft-meta-item">
              <span className="draft-meta-item__label">Linked Thread ID</span>
              <span className="draft-meta-item__value">{draft.threadId}</span>
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: '#64748b',
              textTransform: 'uppercase',
            }}
          >
            Subject
          </span>
          <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: '#0f172a' }}>
            {draft.subject}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: '#64748b',
              textTransform: 'uppercase',
            }}
          >
            Message Body
          </span>
          <div className="draft-body-preview">{draft.bodyText}</div>
        </div>

        <div style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', gap: '1rem' }}>
          {draft.approvedAt ? <span>Approved at: {formatDate(draft.approvedAt, true)}</span> : null}
          {draft.sentAt ? <span>Sent at: {formatDate(draft.sentAt, true)}</span> : null}
        </div>
      </div>
    </Dialog>
  );
}
