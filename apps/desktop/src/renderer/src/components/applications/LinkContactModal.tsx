import { useRef, useState } from 'react';
import type { ApplicationDetail } from '../../../../shared/contracts';
import { Button, Dialog, TextField } from '../ui';
import { useWorkspace } from '../../state/WorkspaceContext';
import { CreateContactModal } from './CreateContactModal';

export function LinkContactModal({
  open,
  onClose,
  applicationId,
  companyId = null,
  onLinked,
}: {
  open: boolean;
  onClose: () => void;
  applicationId: string;
  companyId?: string | null;
  onLinked?: (app: ApplicationDetail) => void;
}): React.JSX.Element | null {
  const { data, command, notify } = useWorkspace();
  const [contactId, setContactId] = useState('');
  const [relationship, setRelationship] = useState('Recruiter');
  const [primary, setPrimary] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateContact, setShowCreateContact] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const contacts = data?.contacts ?? [];

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!contactId) {
      setError('Please select a contact to link.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const updatedApp = await command('application.contact.link', {
        applicationId,
        contactId,
        relationship: relationship.trim() || 'Contact',
        primary,
      });
      notify({ tone: 'success', title: 'Contact linked' });
      setContactId('');
      setRelationship('Recruiter');
      setPrimary(false);
      onLinked?.(updatedApp);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link contact');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title="Link contact"
        description="Link a recruiter, hiring manager, or interviewer to this application."
        footer={
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button type="button" tone="quiet" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="button"
              tone="primary"
              loading={submitting}
              onClick={() => formRef.current?.requestSubmit()}
            >
              Link contact
            </Button>
          </div>
        }
      >
        <form
          ref={formRef}
          id="link-contact-form"
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 600, color: '#334155' }}>
                Contact <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <Button
                type="button"
                tone="quiet"
                size="small"
                onClick={() => setShowCreateContact(true)}
              >
                + New contact
              </Button>
            </div>
            <select
              className="filter-select"
              required
              aria-label="Select contact"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
            >
              <option value="">Select a contact...</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.title ? `(${c.title})` : ''}{' '}
                  {c.primaryEmail ? `- ${c.primaryEmail}` : ''}
                </option>
              ))}
            </select>
          </div>

          <TextField
            label="Relationship"
            required
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            placeholder="e.g. Recruiter, Hiring Manager, Interviewer"
          />

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.875rem',
              color: '#334155',
              cursor: 'pointer',
              minHeight: '44px',
            }}
          >
            <input
              type="checkbox"
              style={{ width: '1.25rem', height: '1.25rem', accentColor: '#0d9488' }}
              checked={primary}
              onChange={(e) => setPrimary(e.target.checked)}
            />
            Primary point of contact for this application
          </label>
        </form>
      </Dialog>

      <CreateContactModal
        open={showCreateContact}
        companyId={companyId}
        onClose={() => setShowCreateContact(false)}
        onCreated={(newContact) => setContactId(newContact.id)}
      />
    </>
  );
}
