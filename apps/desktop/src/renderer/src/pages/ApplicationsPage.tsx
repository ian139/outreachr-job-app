import { useState } from 'react';
import type { ApplicationTask, ConnectorProvider } from '../../../shared/contracts';
import { Button } from '../components/ui';
import { useWorkspace } from '../state/WorkspaceContext';
import { ApplicationsList } from '../components/applications/ApplicationsList';
import { ApplicationsPipeline } from '../components/applications/ApplicationsPipeline';
import { ApplicationDetail } from '../components/applications/ApplicationDetail';
import { CreateApplicationModal } from '../components/applications/CreateApplicationModal';
import '../styles/applications.css';

export function ApplicationsPage({
  onNavigateThread,
}: {
  onNavigateThread?: (
    threadId: string,
    provider: ConnectorProvider,
    accountEmail: string,
    subject: string | null,
  ) => void;
} = {}): React.JSX.Element {
  const { data } = useWorkspace();
  const [viewMode, setViewMode] = useState<'records' | 'pipeline'>('records');
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [taskStatusFilter, setTaskStatusFilter] = useState<ApplicationTask['status'] | 'all'>('all');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  if (!data) return <></>;

  return (
    <div className="page page--wide applications-page">
      {/* Top Header */}
      <header className="applications-header">
        <div className="applications-header__title-group">
          <h1>Job Applications</h1>
          <p>Track applications, stage transitions, contacts, tasks, and replies.</p>
        </div>

        <div className="applications-header__actions">
          <div className="view-mode-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              className="view-mode-toggle__btn"
              aria-pressed={viewMode === 'records'}
              onClick={() => setViewMode('records')}
            >
              Records
            </button>
            <button
              type="button"
              className="view-mode-toggle__btn"
              aria-pressed={viewMode === 'pipeline'}
              onClick={() => setViewMode('pipeline')}
            >
              Pipeline
            </button>
          </div>

          <Button
            tone="primary"
            style={{ minHeight: '44px' }}
            onClick={() => setShowCreateModal(true)}
          >
            New application
          </Button>
        </div>
      </header>

      {/* Main Content Layout */}
      <div className={`applications-main-layout ${selectedId ? 'applications-main-layout--split' : ''}`}>
        {/* Left / Primary Pane */}
        <div className="applications-primary-pane">
          {viewMode === 'records' ? (
            <ApplicationsList
              selectedId={selectedId}
              onSelect={(id) => setSelectedId(id)}
              query={query}
              setQuery={setQuery}
              stageFilter={stageFilter}
              setStageFilter={setStageFilter}
              companyFilter={companyFilter}
              setCompanyFilter={setCompanyFilter}
              taskStatusFilter={taskStatusFilter}
              setTaskStatusFilter={setTaskStatusFilter}
              onOpenCreate={() => setShowCreateModal(true)}
            />
          ) : (
            <ApplicationsPipeline
              selectedId={selectedId}
              onSelect={(id) => setSelectedId(id)}
              query={query}
              companyFilter={companyFilter}
              taskStatusFilter={taskStatusFilter}
              onOpenCreate={() => setShowCreateModal(true)}
            />
          )}
        </div>

        {/* Right / Detail Pane */}
        {selectedId ? (
          <aside className="applications-detail-pane" aria-label="Application details">
            <ApplicationDetail
              applicationId={selectedId}
              onBack={() => setSelectedId(null)}
              onNavigateThread={onNavigateThread}
            />
          </aside>
        ) : null}
      </div>

      {/* Create Application Modal */}
      <CreateApplicationModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={(app) => setSelectedId(app.id)}
      />
    </div>
  );
}
