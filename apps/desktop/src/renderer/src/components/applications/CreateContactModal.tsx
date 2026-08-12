import { useState } from 'react';
import type { Contact } from '../../../../shared/contracts';
import { Button, Dialog, TextField } from '../ui';
import { useWorkspace } from '../../state/WorkspaceContext';

export function CreateContactModal({
  open,
  onClose,
  companyId = null,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  companyId?: string | null;
  onCreated?: (contact: Contact) => void;
}): React.JSX.Element | null {
  const { data, command, notify } = useWorkspace();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(companyId ?? '');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [primaryEmail, setPrimaryEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Contact name is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const contact = await command('contact.create', {
        companyId: selectedCompanyId || null,
        name: name.trim(),
        title: title.trim() || null,
        primaryEmail: primaryEmail.trim() || null,
      });
      notify({ tone: 'success', title: 'Contact created', detail: contact.name });
      setName('');
      setTitle('');
      setPrimaryEmail('');
      onCreated?.(contact);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create contact');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New contact"
      description="Create a recruiter, hiring manager, or team contact."
      footer={
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <Button type="button" tone="quiet" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="create-contact-form" tone="primary" loading={submitting}>
            Create contact
          </Button>
        </div>
      }
    >
      <form id="create-contact-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {error ? (
          <div role="alert" style={{ color: '#991b1b', backgroundColor: '#fef2f2', padding: '0.5rem', borderRadius: '0.375rem', fontSize: '0.875rem' }}>
            {error}
          </div>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.875rem', fontWeight: 600, color: '#334155' }}>
            Company (optional)
          </label>
          <select
            className="filter-select"
            value={selectedCompanyId}
            onChange={(e) => setSelectedCompanyId(e.target.value)}
          >
            <option value="">No company assigned</option>
            {(data?.companies ?? []).map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </div>
        <TextField
          label="Contact name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Jane Doe"
        />
        <TextField
          label="Title / Role"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Technical Recruiter"
        />
        <TextField
          label="Email address"
          type="email"
          value={primaryEmail}
          onChange={(e) => setPrimaryEmail(e.target.value)}
          placeholder="jane@example.com"
        />
      </form>
    </Dialog>
  );
}
