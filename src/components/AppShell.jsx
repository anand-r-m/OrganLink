import { Menu } from '@mantine/core';
import {
  IconChartBar,
  IconClipboardCheck,
  IconDna,
  IconHeartbeat,
  IconLayoutDashboard,
  IconLogout,
  IconSettings,
  IconTruck,
  IconUserPlus,
} from '@tabler/icons-react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../context/AuthContext.jsx';

/* Sidebar entries and icons — ui_mastercontext.md Section 3.2 */
export const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', icon: IconLayoutDashboard },
  { path: '/donors', label: 'Donor Registry', icon: IconUserPlus },
  { path: '/recipients', label: 'Recipient Waitlist', icon: IconHeartbeat },
  { path: '/matching', label: 'Matching Console', icon: IconDna },
  { path: '/offers', label: 'Offer Workflow', icon: IconClipboardCheck },
  { path: '/transport', label: 'Transport', icon: IconTruck },
  { path: '/reports', label: 'Reports', icon: IconChartBar },
];

export const SETTINGS_ITEM = { path: '/settings', label: 'Settings', icon: IconSettings };

/* Breadcrumb labels — ui_mastercontext.md Section 5 */
export const BREADCRUMBS = {
  '/dashboard': 'Dashboard',
  '/donors': 'Donor Registry',
  '/recipients': 'Recipient Waitlist',
  '/matching': 'Matching Console',
  '/offers': 'Offer Workflow',
  '/transport': 'Logistics & Viability Tracking',
  '/reports': 'Analytics & Compliance',
  '/settings': 'System Configuration',
};

function SidebarLink({ item }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path}
      className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
      aria-label={item.label}
    >
      <Icon size={20} stroke={1.8} aria-hidden="true" />
      <span>{item.label}</span>
    </NavLink>
  );
}

export default function AppShell() {
  const { isAuthenticated, logout } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const breadcrumb = BREADCRUMBS[location.pathname] ?? '';

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-sidebar__logo">OrganLink</div>
        <nav className="app-nav" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <SidebarLink key={item.path} item={item} />
          ))}
          <div className="app-nav__divider" role="presentation" />
          <SidebarLink item={SETTINGS_ITEM} />
        </nav>
      </aside>

      <div className="app-main">
        <header className="app-header">
          <nav className="app-breadcrumb" aria-label="Breadcrumb">
            {breadcrumb}
          </nav>

          <Menu position="bottom-end" shadow="md" width={180}>
            <Menu.Target>
              <button type="button" className="app-user" aria-label="Account menu">
                <span className="app-avatar" aria-hidden="true">
                  A
                </span>
                <span>Admin</span>
              </button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconLogout size={16} aria-hidden="true" />}
                onClick={logout}
                aria-label="Log out"
              >
                Log out
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </header>

        <main className="app-content page-fade-in" key={location.pathname}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
