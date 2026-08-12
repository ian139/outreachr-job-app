import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import {
  BriefcaseBusiness,
  Database,
  Inbox,
  Menu,
  PanelLeftClose,
  Search,
  Settings,
} from 'lucide-react';
import { NavLink, useLocation, useNavigate } from '../lib/router';
import { useWorkspace } from '../state/WorkspaceContext';
import { CommandPalette } from './CommandPalette';
import { IconButton, StateDot, ToastRegion } from './ui';

const primaryNavigation = [
  { to: '/applications', label: 'Applications', icon: BriefcaseBusiness },
  { to: '/inbox', label: 'Inbox', icon: Inbox },
];

function NavigationItem({
  to,
  label,
  icon: Icon,
}: (typeof primaryNavigation)[number]): React.JSX.Element {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      aria-label={label}
      className={({ isActive }) => (isActive ? 'nav-item nav-item--active' : 'nav-item')}
    >
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  );
}

export function AppShell({ children }: PropsWithChildren): React.JSX.Element {
  const { refreshing, toasts, dismissToast } = useWorkspace();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const previousPathRef = useRef(location.pathname);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => setPaletteOpen(false), [location.pathname]);

  useEffect(() => {
    const pageName =
      [...primaryNavigation, { to: '/settings', label: 'Settings' }]
        .sort((left, right) => right.to.length - left.to.length)
        .find(
          (item) =>
            location.pathname === item.to ||
            location.pathname.startsWith(`${item.to}/`),
        )?.label ?? 'Workspace';
    document.title = `${pageName} · Outreachr Job Applications`;

    if (previousPathRef.current === location.pathname) return;
    previousPathRef.current = location.pathname;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('main-content')?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);


  return (
    <div className={sidebarCollapsed ? 'app-shell app-shell--collapsed' : 'app-shell'}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Workspace sidebar">
        <div className="sidebar__brand">
          <button
            className="brand-button"
            onClick={() => navigate('/applications')}
            aria-label="Open job applications"
          >
            <span className="brand-mark" aria-hidden="true">
              O
            </span>
            <span className="brand-word">Outreachr Jobs</span>
          </button>
          <IconButton
            label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            {sidebarCollapsed ? <Menu aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          </IconButton>
        </div>


        <button
          className="command-trigger"
          onClick={() => setPaletteOpen(true)}
          aria-label="Search applications"
        >
          <Search aria-hidden="true" />
          <span>Search applications</span>
          <kbd>{navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'} K</kbd>
        </button>

        <nav className="sidebar__nav" aria-label="Primary navigation">
          <div className="nav-group">
            {primaryNavigation.map((item) => (
              <NavigationItem key={item.to} {...item} />
            ))}
          </div>
        </nav>

        <div className="sidebar__footer">
          <NavLink
            to="/settings"
            aria-label="Settings"
            className={({ isActive }) => (isActive ? 'nav-item nav-item--active' : 'nav-item')}
          >
            <Settings aria-hidden="true" />
            <span>Settings</span>
          </NavLink>
          <div className="vault-status">
            <Database aria-hidden="true" />
            <span>
              <strong>Local vault</strong>
              <small>SQLite · encrypted secrets</small>
            </span>
            <StateDot tone="success" label="Ready" />
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="workspace-bar">
          <div className="workspace-bar__status" role="status" aria-live="polite">
            <span className="sync-pulse" aria-hidden="true" />
            <span>{refreshing ? 'Updating local view…' : 'Saved locally'}</span>
          </div>
          <div className="workspace-bar__actions">
            <button
              className="founder-avatar"
              onClick={() => navigate('/settings')}
              aria-label="Open workspace settings"
            >
              J
            </button>
          </div>
        </header>
        <main id="main-content" className="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ToastRegion toasts={toasts} dismiss={dismissToast} />
    </div>
  );
}
