import { useState } from 'react';
import type { Company } from '../../../../shared/contracts';
import { Button, Dialog, TextField } from '../ui';
import { useWorkspace } from '../../state/WorkspaceContext';

export function CreateCompanyModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (company: Company) => void;
}): React.JSX.Element | null {
  const { command, notify } = useWorkspace();
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [location, setLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Company name is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const company = await command('company.create', {
        name: name.trim(),
        website: website.trim() || null,
        location: location.trim() || null,
      });
      notify({ tone: 'success', title: 'Company created', detail: company.name });
      setName('');
      setWebsite('');
      setLocation('');
      onCreated?.(company);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create company');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New company"
      description="Create a company record for job applications."
      footer={
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <Button type="button" tone="quiet" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="create-company-form" tone="primary" loading={submitting}>
            Create company
          </Button>
        </div>
      }
    >
      <form id="create-company-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {error ? (
          <div role="alert" style={{ color: '#991b1b', backgroundColor: '#fef2f2', padding: '0.5rem', borderRadius: '0.375rem', fontSize: '0.875rem' }}>
            {error}
          </div>
        ) : null}
        <TextField
          label="Company name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Acme Corp"
        />
        <TextField
          label="Website"
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://acme.com"
        />
        <TextField
          label="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. San Francisco, CA"
        />
      </form>
    </Dialog>
  );
}
