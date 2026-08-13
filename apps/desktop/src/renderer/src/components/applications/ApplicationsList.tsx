import { useCallback, useEffect, useState } from 'react';
import type { ApplicationSummary, ApplicationTask, CommandMap } from '../../../../shared/contracts';
import { Button, EmptyState, formatDate, SearchField, Skeleton } from '../ui';
import { useWorkspace } from '../../state/WorkspaceContext';

export function ApplicationsList({
  selectedId,
  onSelect,
  query,
  setQuery,
  stageFilter,
  setStageFilter,
  companyFilter,
  setCompanyFilter,
  taskStatusFilter,
  setTaskStatusFilter,
  onOpenCreate,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
  setQuery: (q: string) => void;
  stageFilter: string;
  setStageFilter: (s: string) => void;
  companyFilter: string;
  setCompanyFilter: (c: string) => void;
  taskStatusFilter: ApplicationTask['status'] | 'all';
  setTaskStatusFilter: (st: ApplicationTask['status'] | 'all') => void;
  onOpenCreate: () => void;
}): React.JSX.Element {
  const { data, command } = useWorkspace();
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stages = data?.applicationStages ?? [];
  const companies = data?.companies ?? [];

  const loadApplications = useCallback(
    async (reset = true, cursorToUse?: string | null): Promise<void> => {
      if (reset) setLoading(true);
      else setLoadingMore(true);
      setError(null);

      try {
        const payload: CommandMap['application.list'] = { limit: 20 };
        const q = query.trim();
        if (q) payload.query = q;
        if (stageFilter) payload.stageIds = [stageFilter];
        if (companyFilter) payload.companyId = companyFilter;
        if (taskStatusFilter !== 'all') payload.taskStatus = taskStatusFilter;
        if (!reset && cursorToUse) payload.cursor = cursorToUse;

        const res = await command('application.list', payload);

        if (reset) {
          setApplications(res.applications);
        } else {
          setApplications((prev) => [...prev, ...res.applications]);
        }
        setNextCursor(res.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load applications');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [command, companyFilter, query, stageFilter, taskStatusFilter],
  );

  useEffect(() => {
    void loadApplications(true);
  }, [loadApplications, data?.applications]);

  const handleLoadMore = (): void => {
    if (nextCursor && !loadingMore) {
      void loadApplications(false, nextCursor);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Filter Bar */}
      <div className="applications-filter-bar">
        <div className="applications-filter-bar__search">
          <SearchField
            label="Search applications"
            placeholder="Filter by company or role title..."
            value={query}
            onChange={setQuery}
          />
        </div>

        <div className="applications-filter-bar__selects">
          <select
            className="filter-select"
            aria-label="Filter by stage"
            value={stageFilter}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStageFilter(e.target.value)}
          >
            <option value="">All stages</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <select
            className="filter-select"
            aria-label="Filter by company"
            value={companyFilter}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCompanyFilter(e.target.value)}
          >
            <option value="">All companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <div className="task-filter-chips" role="group" aria-label="Filter by task status">
            {(['all', 'open', 'done', 'dismissed'] as const).map((status) => (
              <button
                key={status}
                type="button"
                className="chip-btn"
                aria-pressed={taskStatusFilter === status}
                onClick={() => setTaskStatusFilter(status)}
              >
                Tasks: {status}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error state */}
      {error ? (
        <div
          role="alert"
          style={{
            color: '#991b1b',
            backgroundColor: '#fef2f2',
            padding: '1rem',
            borderRadius: '0.5rem',
          }}
        >
          {error}
        </div>
      ) : null}

      {/* Loading state */}
      {loading ? (
        <div
          className="applications-table-wrapper"
          style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
        >
          <div style={{ height: '3rem', width: '100%' }}>
            <Skeleton />
          </div>
          <div style={{ height: '3rem', width: '100%' }}>
            <Skeleton />
          </div>
          <div style={{ height: '3rem', width: '100%' }}>
            <Skeleton />
          </div>
        </div>
      ) : applications.length === 0 ? (
        <EmptyState
          title="No applications found"
          detail={
            query || stageFilter || companyFilter
              ? 'Try clearing filters or search term.'
              : 'Get started by tracking your first job application.'
          }
          action={
            <Button tone="primary" onClick={onOpenCreate}>
              New application
            </Button>
          }
        />
      ) : (
        <div className="applications-table-wrapper">
          <table className="applications-table" aria-label="Job applications">
            <thead>
              <tr>
                <th>Role &amp; Company</th>
                <th>Stage</th>
                <th>Applied Date</th>
                <th>Next Event</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((app) => {
                const isSelected = app.id === selectedId;
                return (
                  <tr
                    key={app.id}
                    className={isSelected ? 'is-selected' : ''}
                    onClick={() => onSelect(app.id)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelect(app.id);
                      }
                    }}
                  >
                    <td>
                      <div className="table-app-title">
                        <span>{app.role}</span>
                        <span className="company-sub">{app.companyName}</span>
                      </div>
                    </td>
                    <td>
                      <span className="stage-badge stage-badge--active">{app.stageName}</span>
                    </td>
                    <td>{app.appliedAt ? formatDate(app.appliedAt) : 'Not specified'}</td>
                    <td>
                      {app.nextEventAt ? formatDate(app.nextEventAt, true) : 'None scheduled'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Button
                        tone="quiet"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(app.id);
                        }}
                      >
                        View details
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {nextCursor ? (
            <div className="load-more-container">
              <Button tone="secondary" loading={loadingMore} onClick={handleLoadMore}>
                Load more applications
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
