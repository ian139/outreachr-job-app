import type { ApplicationSummary, ApplicationTask } from '../../../../shared/contracts';
import { Badge, Button, EmptyState, formatDate } from '../ui';
import { useWorkspace } from '../../state/WorkspaceContext';

export function ApplicationsPipeline({
  selectedId,
  onSelect,
  query,
  companyFilter,
  taskStatusFilter,
  onOpenCreate,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
  companyFilter: string;
  taskStatusFilter: ApplicationTask['status'] | 'all';
  onOpenCreate: () => void;
}): React.JSX.Element {
  const { data, command, notify } = useWorkspace();

  const stages = data?.applicationStages ?? [];
  const allApps = data?.applications ?? [];

  // Filter application items
  const filteredApps = allApps.filter((app) => {
    if (query) {
      const q = query.toLowerCase();
      const matchCompany = app.companyName.toLowerCase().includes(q);
      const matchRole = app.role.toLowerCase().includes(q);
      if (!matchCompany && !matchRole) return false;
    }
    if (companyFilter && app.companyId !== companyFilter) return false;
    return true;
  });

  const moveStage = async (appId: string, toStageId: string): Promise<void> => {
    try {
      await command('application.transition', { id: appId, toStageId });
      notify({ tone: 'success', title: 'Application stage updated' });
    } catch (err) {
      notify({ tone: 'error', title: 'Stage transition failed', detail: err instanceof Error ? err.message : undefined });
    }
  };

  if (stages.length === 0) {
    return (
      <EmptyState
        title="No application stages configured"
        detail="Workspace stage configuration is required to view the pipeline."
      />
    );
  }

  return (
    <div className="pipeline-board" aria-label="Applications pipeline board">
      {stages.map((stage) => {
        const stageApps = filteredApps.filter((app) => app.stageId === stage.id);
        return (
          <div key={stage.id} className="pipeline-column">
            <div className="pipeline-column__header">
              <span className="pipeline-column__title">
                {stage.name}
              </span>
              <span className="pipeline-column__count">{stageApps.length}</span>
            </div>

            <div className="pipeline-column__cards">
              {stageApps.length === 0 ? (
                <div style={{ fontSize: '0.8125rem', color: '#94a3b8', textAlign: 'center', padding: '1rem 0' }}>
                  No applications
                </div>
              ) : (
                stageApps.map((app) => {
                  const isSelected = app.id === selectedId;
                  return (
                    <article
                      key={app.id}
                      className="app-card"
                      style={{
                        borderColor: isSelected ? '#0d9488' : undefined,
                        backgroundColor: isSelected ? '#f0fdf4' : '#ffffff',
                      }}
                      tabIndex={0}
                      onClick={() => onSelect(app.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelect(app.id);
                        }
                      }}
                    >
                      <div className="app-card__company">{app.companyName}</div>
                      <div className="app-card__role">{app.role}</div>

                      <div className="app-card__meta">
                        <span>{app.appliedAt ? formatDate(app.appliedAt) : 'Draft'}</span>
                        {app.nextEventAt ? (
                          <span style={{ color: '#0d9488', fontWeight: 600 }}>
                            Next: {formatDate(app.nextEventAt)}
                          </span>
                        ) : null}
                      </div>

                      <div
                        style={{ marginTop: '0.25rem' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <select
                          className="filter-select"
                          aria-label={`Change stage for ${app.role} at ${app.companyName}`}
                          style={{ minHeight: '36px', fontSize: '0.75rem', padding: '0.25rem 0.5rem', width: '100%' }}
                          value={app.stageId}
                          onChange={(e) => moveStage(app.id, e.target.value)}
                        >
                          {stages.map((s) => (
                            <option key={s.id} value={s.id}>
                              Move to: {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
