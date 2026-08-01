import { Navigate, Route, Routes } from 'react-router-dom';

import AppShell from './components/AppShell.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import DonorRegistryPage from './pages/DonorRegistryPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import MatchingConsolePage from './pages/MatchingConsolePage.jsx';
import OfferWorkflowPage from './pages/OfferWorkflowPage.jsx';
import Phase0SmokePage from './pages/Phase0SmokePage.jsx';
import RecipientWaitlistPage from './pages/RecipientWaitlistPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import TransportPage from './pages/TransportPage.jsx';

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />

      {/* Protected — wrapped in AppShell layout */}
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/donors" element={<DonorRegistryPage />} />
        <Route path="/recipients" element={<RecipientWaitlistPage />} />
        <Route path="/matching" element={<MatchingConsolePage />} />
        <Route path="/offers" element={<OfferWorkflowPage />} />
        <Route path="/transport" element={<TransportPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/__phase0-smoke" element={<Phase0SmokePage />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
