import { useState } from 'react';
import type { ApplicationDetail } from '../../../../shared/contracts';
import { Button, Dialog, TextField } from '../ui';
import { useWorkspace } from '../../state/WorkspaceContext';
import { CreateCompanyModal } from './CreateCompanyModal';

export function CreateApplicationModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (app: ApplicationDetail) => void;
}): React.JSX.Element | null {
  const { data, command, notify } = useWorkspace();
  const [companyId, setCompanyId] = useState('');
  const [role, setRole] = useState('');
  const [stageId, setStageId] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [appliedAt, setAppliedAt] = useState('');
  const [nextEventAt, setNextEventAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCompanyModal, setShowCompanyModal] = useState(false);

  const stages = data?.applicationStages ?? [];
  const companies = data?.companies ?? [];

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!companyId) {
      setError('Please select or create a company.');
      return;
    }
    if (!role.trim()) {
      setError('Role title is required.');
      return;
    }
    const effectiveStageId = stageId || stages[0]?.id;
    if (!effectiveStageId) {
      setError('No application stages available in workspace.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const created = await command('application.create', {
        companyId,
        role: role.trim(),
        stageId: effectiveStageId,
        sourceUrl: sourceUrl.trim() || null,
        appliedAt: appliedAt ? new Date(appliedAt).toISOString() : null,
        nextEventAt: nextEventAt ? new Date(nextEventAt).toISOString() : null,
      });
      notify({
        tone: 'success',
        title: 'Application created',
        detail: `${created.role} at ${created.companyName}`,
      });
      setRole('');
      setSourceUrl('');
      setAppliedAt('');
      setNextEventAt('');
      onCreated?.(created);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create application');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title="New application"
        description="Track a job application record."
        footer={
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button type="button" tone="quiet" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" form="create-app-form" tone="primary" loading={submitting}>
              New application
            </Button>
          </div>
        }
      >
        <form
          id="create-app-form"
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
                Company <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <Button
                type="button"
                tone="quiet"
                size="small"
                onClick={() => setShowCompanyModal(true)}
              >
                + New company
              </Button>
            </div>
            <select
              className="filter-select"
              required
              aria-label="Select company"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
            >
              <option value="">Select a company...</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <TextField
            label="Role title"
            required
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Senior Software Engineer"
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: '#334155' }}>Stage</label>
            <select
              className="filter-select"
              aria-label="Select stage"
              value={stageId || (stages[0]?.id ?? '')}
              onChange={(e) => setStageId(e.target.value)}
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <TextField
            label="Source URL (job listing)"
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://careers.company.com/job/123"
          />

          <TextField
            label="Applied date"
            type="date"
            value={appliedAt}
            onChange={(e) => setAppliedAt(e.target.value)}
          />

          <TextField
            label="Next event date"
            type="datetime-local"
            value={nextEventAt}
            onChange={(e) => setNextEventAt(e.target.value)}
          />
        </form>
      </Dialog>

      <CreateCompanyModal
        open={showCompanyModal}
        onClose={() => setShowCompanyModal(false)}
        onCreated={(c) => setCompanyId(c.id)}
      />
    </>
  );
}
