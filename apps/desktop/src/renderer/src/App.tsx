import { Navigate, Route, Routes, useNavigate } from './lib/router';
import { AppShell } from './components/AppShell';
import { ErrorScreen, LoadingScreen } from './components/ui';
import { useWorkspace } from './state/WorkspaceContext';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { InboxPage } from './pages/InboxPage';
import { SettingsPage } from './pages/SettingsPage';
import { WorkspaceSetupPage } from './pages/WorkspaceSetupPage';
import './styles/job-setup.css';

export function App(): React.JSX.Element {
  const { data, loading, error, refreshing, refresh } = useWorkspace();
  const navigate = useNavigate();

  if (loading) return <LoadingScreen />;
  if (error || !data)
    return (
      <ErrorScreen
        message={error ?? 'No workspace was returned.'}
        retrying={refreshing}
        retry={() => void refresh()}
      />
    );
  if (!data.workspaceProfile) return <WorkspaceSetupPage />;

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/applications" replace />} />
        <Route
          path="/applications"
          element={
            <ApplicationsPage
              onNavigateThread={(threadId, provider, accountEmail, subject) =>
                navigate(
                  `/inbox?thread=${encodeURIComponent(threadId)}&provider=${provider}&account=${encodeURIComponent(accountEmail)}&subject=${encodeURIComponent(subject ?? '')}`,
                )
              }
            />
          }
        />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/settings/*" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/applications" replace />} />
      </Routes>
    </AppShell>
  );
}
