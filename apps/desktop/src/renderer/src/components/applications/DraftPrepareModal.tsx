import { useState } from 'react';
import type {
  ApplicationThreadLink,
  ConnectorProvider,
  Contact,
  DraftMessage,
} from '../../../../shared/contracts';
import { Button, Dialog, TextField } from '../ui';
import { useWorkspace } from '../../state/WorkspaceContext';

export function DraftPrepareModal({
  open,
  onClose,
  applicationId,
  applicationRole,
  companyName,
  contacts,
  threads,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  applicationId: string;
  applicationRole: string;
  companyName: string;
  contacts: Array<Contact & { relationship: string; primary: boolean }>;
  threads: ApplicationThreadLink[];
  onCreated?: (draft: DraftMessage) => void;
}): React.JSX.Element | null {
  const { data, command } = useWorkspace();

  // Filter contacts with email
  const validContacts = contacts.filter((c) => Boolean(c.primaryEmail));
  const primaryContact = validContacts.find((c) => c.primary) ?? validContacts[0];

  // Connected emails from connectors
  const connectedAccounts = (data?.connectors ?? [])
    .filter((connector) => connector.state === 'connected' && Boolean(connector.accountEmail))
    .map((c) => ({ provider: c.provider, email: c.accountEmail! }));

  const defaultEmail = connectedAccounts[0]?.email ?? data?.workspaceProfile?.primaryEmail ?? '';

  const [contactId, setContactId] = useState(primaryContact?.id ?? '');
  const [provider, setProvider] = useState<ConnectorProvider>(
    connectedAccounts[0]?.provider ?? 'google',
  );
  const [accountEmail, setAccountEmail] = useState(defaultEmail);
  const [kind, setKind] = useState<'initial' | 'reply'>(threads.length > 0 ? 'reply' : 'initial');
  const [subject, setSubject] = useState(
    threads[0]?.subjectSnapshot
      ? `Re: ${threads[0].subjectSnapshot.replace(/^Re:\s*/i, '')}`
      : `Application: ${applicationRole} at ${companyName}`,
  );
  const [bodyText, setBodyText] = useState('');
  const [threadId, setThreadId] = useState(threads[0]?.providerThreadId ?? '');
  const [replyToMessageId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!contactId) {
      setError('Please select a linked contact with a valid email.');
      return;
    }
    if (!accountEmail.trim()) {
      setError('Account email is required. Please select or enter a connected sender email.');
      return;
    }
    if (
      connectedAccounts.length > 0 &&
      !connectedAccounts.some(
        (account) => account.provider === provider && account.email === accountEmail,
      )
    ) {
      setError('Select a sender account connected to the chosen provider.');
      return;
    }
    if (!subject.trim()) {
      setError('Subject line is required.');
      return;
    }
    if (!bodyText.trim()) {
      setError('Message body is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        applicationId,
        contactId,
        accountEmail: accountEmail.trim(),
        provider,
        kind,
        subject: subject.trim(),
        bodyText: bodyText.trim(),
        threadId: threadId.trim() || null,
        replyToMessageId: replyToMessageId.trim() || null,
      };
      const draft = await command(
        'draft.create',
        payload as unknown as Parameters<typeof command<'draft.create'>>[1],
      );
      setBodyText('');
      onCreated?.(draft);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to prepare draft');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Prepare reply"
      description={`Prepare email for ${applicationRole} at ${companyName}. Drafts require explicit review and approval before sending.`}
      footer={
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <Button type="button" tone="quiet" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="draft-prepare-form" tone="primary" loading={submitting}>
            Prepare reply
          </Button>
        </div>
      }
    >
      <form
        id="draft-prepare-form"
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      >
        {error ? (
          <div
            role="alert"
            style={{
              color: '#991b1b',
              backgroundColor: '#fef2f2',
              padding: '0.5rem',
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
            }}
          >
            {error}
          </div>
        ) : null}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.875rem', fontWeight: 600, color: '#334155' }}>
            Recipient Contact <span style={{ color: '#dc2626' }}>*</span>
          </label>
          {validContacts.length === 0 ? (
            <div
              style={{
                fontSize: '0.8125rem',
                color: '#991b1b',
                backgroundColor: '#fef2f2',
                padding: '0.5rem',
                borderRadius: '0.375rem',
              }}
            >
              No linked contacts have an email address. Link a contact with an email address first.
            </div>
          ) : (
            <select
              className="filter-select"
              required
              aria-label="Select recipient contact"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
            >
              {validContacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.title ? `(${c.title})` : ''} - {c.primaryEmail}
                </option>
              ))}
            </select>
          )}
        </div>

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div
            style={{ flex: '1 1 180px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}
          >
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: '#334155' }}>
              Provider
            </label>
            <select
              className="filter-select"
              aria-label="Provider"
              value={provider}
              onChange={(e) => {
                const nextProvider = e.target.value as ConnectorProvider;
                setProvider(nextProvider);
                setAccountEmail(
                  connectedAccounts.find((account) => account.provider === nextProvider)?.email ??
                    '',
                );
              }}
            >
              <option value="google">Google Workspace</option>
              <option value="microsoft">Microsoft 365</option>
            </select>
          </div>

          <div
            style={{ flex: '1 1 180px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}
          >
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: '#334155' }}>
              Draft Kind
            </label>
            <select
              className="filter-select"
              value={kind}
              onChange={(e) => setKind(e.target.value as 'initial' | 'reply')}
            >
              <option value="reply">Reply</option>
              <option value="initial">Initial message</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.875rem', fontWeight: 600, color: '#334155' }}>
            Sender Account Email <span style={{ color: '#dc2626' }}>*</span>
          </label>
          {connectedAccounts.length > 0 ? (
            <select
              className="filter-select"
              aria-label="Select sender account email"
              value={`${provider}:${accountEmail}`}
              onChange={(e) => {
                const account = connectedAccounts.find(
                  (candidate) => `${candidate.provider}:${candidate.email}` === e.target.value,
                );
                if (!account) return;
                setProvider(account.provider);
                setAccountEmail(account.email);
              }}
            >
              {connectedAccounts.map((acc) => (
                <option key={`${acc.provider}:${acc.email}`} value={`${acc.provider}:${acc.email}`}>
                  {acc.provider.toUpperCase()}: {acc.email}
                </option>
              ))}
            </select>
          ) : (
            <TextField
              label="Sender Email"
              type="email"
              required
              value={accountEmail}
              onChange={(e) => setAccountEmail(e.target.value)}
              placeholder="you@company.com"
            />
          )}
        </div>

        <TextField
          label="Subject"
          required
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.875rem', fontWeight: 600, color: '#334155' }}>
            Message body <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <textarea
            aria-label="Message body"
            required
            rows={5}
            style={{
              padding: '0.5rem 0.75rem',
              borderRadius: '0.5rem',
              border: '1px solid #cbd5e1',
              fontSize: '0.875rem',
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            placeholder="Type your message here..."
          />
        </div>

        {threads.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: '#334155' }}>
              Linked Thread
            </label>
            <select
              className="filter-select"
              value={threadId}
              onChange={(e) => setThreadId(e.target.value)}
            >
              <option value="">No linked thread</option>
              {threads.map((t) => (
                <option key={t.providerThreadId} value={t.providerThreadId}>
                  {t.subjectSnapshot || t.providerThreadId} ({t.provider})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <TextField
            label="Provider thread ID (optional)"
            value={threadId}
            onChange={(e) => setThreadId(e.target.value)}
            placeholder="Optional thread ID"
          />
        )}
      </form>
    </Dialog>
  );
}
