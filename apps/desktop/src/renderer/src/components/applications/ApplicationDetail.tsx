import { useEffect, useState } from 'react';
import type { ApplicationDetail as ApplicationDetailType, ApplicationTask, ConnectorProvider, DraftMessage } from '../../../../shared/contracts';
import { Badge, Button, formatDate, Skeleton, TextField } from '../ui';
import { useWorkspace } from '../../state/WorkspaceContext';
import { LinkContactModal } from './LinkContactModal';
import { LinkThreadModal } from './LinkThreadModal';
import { DraftPrepareModal } from './DraftPrepareModal';
import { DraftReviewModal } from './DraftReviewModal';

export function ApplicationDetail({
  applicationId,
  onBack,
  onNavigateThread,
}: {
  applicationId: string;
  onBack?: () => void;
  onNavigateThread?: (
    threadId: string,
    provider: ConnectorProvider,
    accountEmail: string,
    subject: string | null,
  ) => void;
}): React.JSX.Element {
  const { data, command, notify } = useWorkspace();
  const [app, setApp] = useState<ApplicationDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals & Controls state
  const [showLinkContact, setShowLinkContact] = useState(false);
  const [showLinkThread, setShowLinkThread] = useState(false);
  const [showPrepareDraft, setShowPrepareDraft] = useState(false);
  const [activeDraftReview, setActiveDraftReview] = useState<DraftMessage | null>(null);

  // Transition stage inline state
  const [showTransition, setShowTransition] = useState(false);
  const [targetStageId, setTargetStageId] = useState('');
  const [transitionNote, setTransitionNote] = useState('');
  const [transitioning, setTransitioning] = useState(false);

  // Note inline form state
  const [showAddNote, setShowAddNote] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Task inline form & filter state
  const [showAddTask, setShowAddTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskNotes, setTaskNotes] = useState('');
  const [taskDueAt, setTaskDueAt] = useState('');
  const [savingTask, setSavingTask] = useState(false);
  const [taskFilter, setTaskFilter] = useState<ApplicationTask['status'] | 'all'>('all');

  const stages = data?.applicationStages ?? [];
  const stageMap = new Map(stages.map((s) => [s.id, s.name]));

  const fetchDetail = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const detail = await command('application.get', { id: applicationId });
      setApp(detail);

      // Set default target stage to first available stage that isn't current stage
      const available = stages.filter((s) => s.id !== detail.stageId);
      if (available[0]) {
        setTargetStageId(available[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load application details');
    } finally {
      setLoading(false);
    }
  };

  // Prevent refetch loop: depend ONLY on applicationId
  useEffect(() => {
    if (applicationId) {
      fetchDetail();
    }
  }, [applicationId]);

  // Stage Transition Handler
  const handleTransition = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!targetStageId) return;
    setTransitioning(true);
    try {
      const updated = await command('application.transition', {
        id: applicationId,
        toStageId: targetStageId,
        note: transitionNote.trim() || null,
      });
      setApp(updated);
      setShowTransition(false);
      setTransitionNote('');
      notify({ tone: 'success', title: 'Stage updated', detail: updated.stageName });
      await fetchDetail();
    } catch (err) {
      notify({ tone: 'error', title: 'Transition failed', detail: err instanceof Error ? err.message : undefined });
    } finally {
      setTransitioning(false);
    }
  };

  // Add Note Handler
  const handleAddNote = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!noteBody.trim()) return;
    setSavingNote(true);
    try {
      await command('application.note.create', {
        applicationId,
        body: noteBody.trim(),
      });
      setNoteBody('');
      setShowAddNote(false);
      notify({ tone: 'success', title: 'Note added' });
      await fetchDetail();
    } catch (err) {
      notify({ tone: 'error', title: 'Failed to add note', detail: err instanceof Error ? err.message : undefined });
    } finally {
      setSavingNote(false);
    }
  };

  // Add Task Handler
  const handleAddTask = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    setSavingTask(true);
    try {
      await command('application.task.create', {
        applicationId,
        title: taskTitle.trim(),
        notes: taskNotes.trim() || null,
        dueAt: taskDueAt ? new Date(taskDueAt).toISOString() : null,
        status: 'open',
      });
      setTaskTitle('');
      setTaskNotes('');
      setTaskDueAt('');
      setShowAddTask(false);
      notify({ tone: 'success', title: 'Task created' });
      await fetchDetail();
    } catch (err) {
      notify({ tone: 'error', title: 'Failed to create task', detail: err instanceof Error ? err.message : undefined });
    } finally {
      setSavingTask(false);
    }
  };

  // Toggle Task Status
  const handleToggleTaskStatus = async (task: ApplicationTask): Promise<void> => {
    const nextStatus: ApplicationTask['status'] = task.status === 'done' ? 'open' : 'done';
    try {
      await command('application.task.update', {
        id: task.id,
        status: nextStatus,
      });
      await fetchDetail();
    } catch (err) {
      notify({ tone: 'error', title: 'Failed to update task status' });
    }
  };

  // Unlink Contact
  const handleUnlinkContact = async (contactId: string): Promise<void> => {
    try {
      const updated = await command('application.contact.unlink', { applicationId, contactId });
      setApp(updated);
      notify({ tone: 'info', title: 'Contact unlinked' });
      await fetchDetail();
    } catch (err) {
      notify({ tone: 'error', title: 'Failed to unlink contact' });
    }
  };

  // Unlink Thread
  const handleUnlinkThread = async (thread: { provider: ConnectorProvider; accountEmail: string; providerThreadId: string }): Promise<void> => {
    try {
      const updated = await command('application.thread.unlink', {
        applicationId,
        provider: thread.provider,
        accountEmail: thread.accountEmail,
        providerThreadId: thread.providerThreadId,
      });
      setApp(updated);
      notify({ tone: 'info', title: 'Thread unlinked' });
      await fetchDetail();
    } catch (err) {
      notify({ tone: 'error', title: 'Failed to unlink thread' });
    }
  };

  if (loading) {
    return (
      <div className="application-detail-card">
        <Skeleton style={{ height: '2rem', width: '60%' }} />
        <Skeleton style={{ height: '1.5rem', width: '40%' }} />
        <Skeleton style={{ height: '10rem', width: '100%' }} />
      </div>
    );
  }

  if (error || !app) {
    return (
      <div className="application-detail-card" role="alert">
        {onBack ? (
          <button type="button" className="back-to-applications-btn" onClick={onBack}>
            &larr; Back to applications
          </button>
        ) : null}
        <div style={{ color: '#991b1b', padding: '1rem', backgroundColor: '#fef2f2', borderRadius: '0.5rem' }}>
          {error ?? 'Application not found.'}
        </div>
      </div>
    );
  }

  // Filter available stages to exclude current stage
  const availableStages = stages.filter((s) => s.id !== app.stageId);

  // Filter tasks based on taskFilter
  const filteredTasks = app.tasks.filter((t) => {
    if (taskFilter === 'all') return true;
    return t.status === taskFilter;
  });

  // Filter drafts relevant to this application or contact (cleanly typed)
  const appContactIds = new Set(app.contacts.map((c) => c.id));
  const relevantDrafts = (data?.drafts ?? []).filter((d: DraftMessage) => {
    const raw = d as unknown as Record<string, unknown>;
    if (raw.applicationId === app.id) return true;
    if (d.personId && appContactIds.has(d.personId)) return true;
    if (typeof raw.contactId === 'string' && appContactIds.has(raw.contactId)) return true;
    return false;
  });

  return (
    <div className="application-detail-card">
      {/* Header & Back Button */}
      <div className="application-detail-header">
        {onBack ? (
          <button type="button" className="back-to-applications-btn" onClick={onBack}>
            &larr; Back to applications
          </button>
        ) : null}

        <div className="application-detail-title-group">
          <div>
            <h2>{app.role}</h2>
            <p>{app.companyName}</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.375rem' }}>
            <span className="stage-badge stage-badge--active">{app.stageName}</span>
            {availableStages.length > 0 ? (
              <Button
                tone="quiet"
                size="small"
                style={{ minHeight: '44px' }}
                onClick={() => setShowTransition(!showTransition)}
              >
                Change stage
              </Button>
            ) : null}
          </div>
        </div>

        {/* Change Stage Form */}
        {showTransition && availableStages.length > 0 ? (
          <form
            onSubmit={handleTransition}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              backgroundColor: '#f8fafc',
              padding: '0.875rem',
              borderRadius: '0.5rem',
              border: '1px solid #e2e8f0',
            }}
          >
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <select
                className="filter-select"
                aria-label="Target stage"
                value={targetStageId}
                onChange={(e) => setTargetStageId(e.target.value)}
              >
                {availableStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <TextField
              label="Transition note (optional)"
              placeholder="e.g. Completed initial recruiter screen"
              value={transitionNote}
              onChange={(e) => setTransitionNote(e.target.value)}
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <Button type="button" tone="quiet" size="small" style={{ minHeight: '44px' }} onClick={() => setShowTransition(false)}>
                Cancel
              </Button>
              <Button type="submit" tone="primary" size="small" style={{ minHeight: '44px' }} loading={transitioning}>
                Confirm stage change
              </Button>
            </div>
          </form>
        ) : null}
      </div>

      {/* Company Info */}
      <div className="detail-section">
        <div className="detail-section__header">
          <span className="detail-section__title">Company Info</span>
        </div>
        <div style={{ fontSize: '0.875rem', color: '#334155', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div><strong>Name:</strong> {app.company?.name ?? app.companyName}</div>
          {app.company?.location ? <div><strong>Location:</strong> {app.company.location}</div> : null}
          {app.company?.website ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <strong>Website:</strong>
              <Button
                tone="quiet"
                size="small"
                style={{ minHeight: '44px' }}
                onClick={() => {
                  if (window.outreachr?.openExternal && app.company?.website) {
                    window.outreachr.openExternal(app.company.website);
                  }
                }}
              >
                Open website
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Stage History */}
      <div className="detail-section">
        <div className="detail-section__header">
          <span className="detail-section__title">Stage History</span>
        </div>
        {app.stageHistory.length === 0 ? (
          <p style={{ fontSize: '0.8125rem', color: '#94a3b8', margin: 0 }}>No transition history recorded.</p>
        ) : (
          <ul className="timeline-list">
            {app.stageHistory.map((item) => {
              const fromName = item.fromStageId ? (stageMap.get(item.fromStageId) ?? 'Initial') : 'Created';
              const toName = stageMap.get(item.toStageId) ?? item.toStageId;
              return (
                <li key={item.id} className="timeline-item">
                  <div className="timeline-item__meta">
                    <span className="timeline-item__change">{fromName} &rarr; {toName}</span>
                    <span>{formatDate(item.changedAt, true)}</span>
                  </div>
                  {item.note ? <div className="timeline-item__note">&ldquo;{item.note}&rdquo;</div> : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Contacts Section */}
      <div className="detail-section">
        <div className="detail-section__header">
          <span className="detail-section__title">Linked Contacts</span>
          <Button tone="quiet" size="small" style={{ minHeight: '44px' }} onClick={() => setShowLinkContact(true)}>
            + Link contact
          </Button>
        </div>
        {app.contacts.length === 0 ? (
          <p style={{ fontSize: '0.8125rem', color: '#94a3b8', margin: 0 }}>No contacts linked to this application.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {app.contacts.map((contact) => (
              <div key={contact.id} className="contact-card">
                <div className="contact-card__info">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    <span className="contact-card__name">{contact.name}</span>
                    {contact.primary ? <span className="badge-primary">PRIMARY</span> : null}
                    <Badge tone="neutral">{contact.relationship}</Badge>
                  </div>
                  {contact.title ? <span className="contact-card__title">{contact.title}</span> : null}
                  {contact.primaryEmail ? <span className="contact-card__email">{contact.primaryEmail}</span> : null}
                </div>
                <Button tone="quiet" size="small" style={{ minHeight: '44px' }} onClick={() => handleUnlinkContact(contact.id)}>
                  Unlink
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Linked Threads Section */}
      <div className="detail-section">
        <div className="detail-section__header">
          <span className="detail-section__title">Linked Email Threads</span>
          <Button tone="quiet" size="small" style={{ minHeight: '44px' }} onClick={() => setShowLinkThread(true)}>
            + Link thread
          </Button>
        </div>
        {app.threads.length === 0 ? (
          <p style={{ fontSize: '0.8125rem', color: '#94a3b8', margin: 0 }}>No mail threads linked to this application.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {app.threads.map((thread) => (
              <div key={thread.providerThreadId} className="thread-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div className="thread-card__subject">{thread.subjectSnapshot || 'Untitled thread'}</div>
                  <div style={{ display: 'flex', gap: '0.375rem' }}>
                    {onNavigateThread ? (
                      <Button
                        tone="quiet"
                        size="small"
                        style={{ minHeight: '44px' }}
                        onClick={() =>
                          onNavigateThread(
                            thread.providerThreadId,
                            thread.provider,
                            thread.accountEmail,
                            thread.subjectSnapshot,
                          )
                        }
                      >
                        View related thread
                      </Button>
                    ) : null}
                    <Button tone="quiet" size="small" style={{ minHeight: '44px' }} onClick={() => handleUnlinkThread(thread)}>
                      Unlink
                    </Button>
                  </div>
                </div>
                <div className="thread-card__meta">
                  <span>{thread.provider.toUpperCase()} &bull; {thread.accountEmail}</span>
                  <span>Linked: {formatDate(thread.linkedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notes Section */}
      <div className="detail-section">
        <div className="detail-section__header">
          <span className="detail-section__title">Application Notes</span>
          <Button tone="quiet" size="small" style={{ minHeight: '44px' }} onClick={() => setShowAddNote(!showAddNote)}>
            + Add note
          </Button>
        </div>

        {showAddNote ? (
          <form onSubmit={handleAddNote} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <textarea
              aria-label="Note body"
              required
              rows={3}
              style={{
                padding: '0.5rem',
                borderRadius: '0.375rem',
                border: '1px solid #cbd5e1',
                fontSize: '0.875rem',
                fontFamily: 'inherit',
              }}
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder="Enter note details..."
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <Button type="button" tone="quiet" size="small" style={{ minHeight: '44px' }} onClick={() => setShowAddNote(false)}>
                Cancel
              </Button>
              <Button type="submit" tone="primary" size="small" style={{ minHeight: '44px' }} loading={savingNote}>
                Add note
              </Button>
            </div>
          </form>
        ) : null}

        {app.notes.length === 0 ? (
          <p style={{ fontSize: '0.8125rem', color: '#94a3b8', margin: 0 }}>No notes added yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {app.notes.map((note) => (
              <div key={note.id} style={{ backgroundColor: '#ffffff', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.875rem', color: '#1e293b', whiteSpace: 'pre-wrap' }}>{note.body}</div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.375rem' }}>
                  {formatDate(note.createdAt, true)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tasks Section */}
      <div className="detail-section">
        <div className="detail-section__header">
          <span className="detail-section__title">Tasks</span>
          <Button tone="quiet" size="small" style={{ minHeight: '44px' }} onClick={() => setShowAddTask(!showAddTask)}>
            + Add task
          </Button>
        </div>

        {/* Task Filter Chips */}
        <div className="task-filter-chips" role="group" aria-label="Task status filter">
          {(['all', 'open', 'done', 'dismissed'] as const).map((status) => (
            <button
              key={status}
              type="button"
              className="chip-btn"
              aria-pressed={taskFilter === status}
              onClick={() => setTaskFilter(status)}
            >
              {status}
            </button>
          ))}
        </div>

        {showAddTask ? (
          <form onSubmit={handleAddTask} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <TextField
              label="Task title"
              required
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="e.g. Follow up with recruiter"
            />
            <TextField
              label="Notes (optional)"
              value={taskNotes}
              onChange={(e) => setTaskNotes(e.target.value)}
              placeholder="Additional task context..."
            />
            <TextField
              label="Due date (optional)"
              type="date"
              value={taskDueAt}
              onChange={(e) => setTaskDueAt(e.target.value)}
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <Button type="button" tone="quiet" size="small" style={{ minHeight: '44px' }} onClick={() => setShowAddTask(false)}>
                Cancel
              </Button>
              <Button type="submit" tone="primary" size="small" style={{ minHeight: '44px' }} loading={savingTask}>
                Add task
              </Button>
            </div>
          </form>
        ) : null}

        {filteredTasks.length === 0 ? (
          <p style={{ fontSize: '0.8125rem', color: '#94a3b8', margin: 0 }}>No tasks matching filter.</p>
        ) : (
          <div className="task-list">
            {filteredTasks.map((task) => (
              <div key={task.id} className={`task-row ${task.status === 'done' ? 'is-done' : ''}`}>
                <div className="task-row__left">
                  <input
                    type="checkbox"
                    className="task-row__checkbox"
                    checked={task.status === 'done'}
                    aria-label={`Mark ${task.title} as ${task.status === 'done' ? 'open' : 'done'}`}
                    onChange={() => handleToggleTaskStatus(task)}
                  />
                  <div>
                    <div className="task-row__title">{task.title}</div>
                    {task.notes ? <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{task.notes}</div> : null}
                  </div>
                </div>
                {task.dueAt ? (
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Due: {formatDate(task.dueAt)}</span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Drafts & Reply Preparation */}
      <div className="detail-section">
        <div className="detail-section__header">
          <span className="detail-section__title">Drafts &amp; Prepared Replies</span>
          <Button tone="quiet" size="small" style={{ minHeight: '44px' }} onClick={() => setShowPrepareDraft(true)}>
            Prepare reply
          </Button>
        </div>

        {relevantDrafts.length === 0 ? (
          <p style={{ fontSize: '0.8125rem', color: '#94a3b8', margin: 0 }}>No drafts prepared for this application.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {relevantDrafts.map((d: DraftMessage) => (
              <div key={d.id} className="thread-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="thread-card__subject">{d.subject}</span>
                  <Button tone="quiet" size="small" style={{ minHeight: '44px' }} onClick={() => setActiveDraftReview(d)}>
                    Review draft
                  </Button>
                </div>
                <div className="thread-card__meta">
                  <span>State: {d.approvalState.toUpperCase()} &bull; Recipient: {d.recipientEmail}</span>
                  <span>{d.provider.toUpperCase()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      <LinkContactModal
        open={showLinkContact}
        applicationId={app.id}
        companyId={app.companyId}
        onClose={() => setShowLinkContact(false)}
        onLinked={() => fetchDetail()}
      />

      <LinkThreadModal
        open={showLinkThread}
        applicationId={app.id}
        onClose={() => setShowLinkThread(false)}
        onLinked={() => fetchDetail()}
      />

      <DraftPrepareModal
        open={showPrepareDraft}
        applicationId={app.id}
        applicationRole={app.role}
        companyName={app.companyName}
        contacts={app.contacts}
        threads={app.threads}
        onClose={() => setShowPrepareDraft(false)}
        onCreated={() => fetchDetail()}
      />

      <DraftReviewModal
        open={Boolean(activeDraftReview)}
        draft={activeDraftReview}
        applicationRole={app.role}
        companyName={app.companyName}
        onClose={() => setActiveDraftReview(null)}
        onUpdated={() => fetchDetail()}
      />
    </div>
  );
}
