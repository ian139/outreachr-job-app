import { useState } from 'react';
import type { ApplicationDetail, ConnectorProvider } from '../../../../shared/contracts';
import { Button, Dialog, TextField } from '../ui';
import { useWorkspace } from '../../state/WorkspaceContext';

export function LinkThreadModal({
  open,
  onClose,
  applicationId,
  onLinked,
}: {
  open: boolean;
  onClose: () => void;
  applicationId: string;
  onLinked?: (app: ApplicationDetail) => void;
}): React.JSX.Element | null {
  const { command, notify } = useWorkspace();
  const [provider, setProvider] = useState<ConnectorProvider>('google');
  const [accountEmail, setAccountEmail] = useState('');
  const [providerThreadId, setProviderThreadId] = useState('');
  const [subjectSnapshot, setSubjectSnapshot] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!accountEmail.trim()) {
      setError('Account email is required.');
      return;
    }
    if (!providerThreadId.trim()) {
      setError('Provider thread ID is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const updatedApp = await command('application.thread.link', {
        applicationId,
        provider,
        accountEmail: accountEmail.trim(),
        providerThreadId: providerThreadId.trim(),
        subjectSnapshot: subjectSnapshot.trim() || null,
      });
      notify({ tone: 'success', title: 'Thread linked to application' });
      setAccountEmail('');
      setProviderThreadId('');
      setSubjectSnapshot('');
      onLinked?.(updatedApp);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link thread');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Link thread"
      description="Link an email conversation thread from Google or Microsoft to this application."
      footer={
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <Button type="button" tone="quiet" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="link-thread-form" tone="primary" loading={submitting}>
            Link thread
          </Button>
        </div>
      }
    >
      <form
        id="link-thread-form"
        onSubmit={handleSubmit}
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
            Provider <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <select
            className="filter-select"
            value={provider}
            onChange={(e) => setProvider(e.target.value as ConnectorProvider)}
          >
            <option value="google">Google Workspace / Gmail</option>
            <option value="microsoft">Microsoft 365 / Outlook</option>
          </select>
        </div>

        <TextField
          label="Account email"
          type="email"
          required
          value={accountEmail}
          onChange={(e) => setAccountEmail(e.target.value)}
          placeholder="you@company.com"
        />

        <TextField
          label="Provider thread ID"
          required
          value={providerThreadId}
          onChange={(e) => setProviderThreadId(e.target.value)}
          placeholder="e.g. 189abf237c94ef01"
        />

        <TextField
          label="Subject snapshot"
          value={subjectSnapshot}
          onChange={(e) => setSubjectSnapshot(e.target.value)}
          placeholder="e.g. Interview scheduled - Senior Engineer"
        />
      </form>
    </Dialog>
  );
}
