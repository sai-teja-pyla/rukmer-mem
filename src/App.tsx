import React, { Suspense, lazy, useState, useEffect, useLayoutEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'; 
import { auth } from './firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';

import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';
import OAuthConsentPage from './pages/OAuthConsentPage';
import { initAnalytics } from './hooks/analytics';
import { UserProfile } from './types';
import { useUserSettings, UserSettingsProvider } from './hooks/useUserSettings';
import { safeNext } from './services/safeNext';

const LandingPage = lazy(() => import('./components/LandingPage'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const HelpPage = lazy(() => import('./pages/HelpPage'));
const DocsPage = lazy(() => import('./pages/DocsPage'));
const SubscriptionPage = lazy(() => import('./pages/SubscriptionPage'));
const ConsoleLayout = lazy(() => import('./components/console/ConsoleLayout'));
const OverviewPage = lazy(() => import('./pages/console/OverviewPage'));
const PlaygroundPage = lazy(() => import('./pages/console/PlaygroundPage'));
const ContainerTagsPage = lazy(() => import('./pages/console/ContainerTagsPage'));
const MemoryGraphPage = lazy(() => import('./pages/console/MemoryGraphPage'));
const ConnectorsPage = lazy(() => import('./pages/console/ConnectorsPage'));
const ImportPage = lazy(() => import('./pages/console/ImportPage'));
const ApiKeysPage = lazy(() => import('./pages/console/ApiKeysPage'));
const AgentsMcpPage = lazy(() => import('./pages/console/AgentsMcpPage'));
const RequestsPage = lazy(() => import('./pages/console/RequestsPage'));
const UserInsightsPage = lazy(() => import('./pages/console/UserInsightsPage'));
const GeneralSettingsPage = lazy(() => import('./pages/console/settingsPages').then((m) => ({ default: m.GeneralSettingsPage })));
const TeamSettingsPage = lazy(() => import('./pages/console/settingsPages').then((m) => ({ default: m.TeamSettingsPage })));
const BillingSettingsPage = lazy(() => import('./pages/console/settingsPages').then((m) => ({ default: m.BillingSettingsPage })));
const UsageSettingsPage = lazy(() => import('./pages/console/settingsPages').then((m) => ({ default: m.UsageSettingsPage })));
const AdvancedSettingsPage = lazy(() => import('./pages/console/settingsPages').then((m) => ({ default: m.AdvancedSettingsPage })));
const AccountSettingsPage = lazy(() => import('./pages/console/settingsPages').then((m) => ({ default: m.AccountSettingsPage })));

function ToLogin() {
  const location = useLocation();
  const next = `${location.pathname}${location.search}`;
  return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
}

export default function App() {
  // 2. DEFINE STATE WITH TYPES
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isPro, setIsPro] = useState(false);
  
  const { settings } = useUserSettings();

  useEffect(() => {
    initAnalytics('G-1XG5ZEVHB4');
  }, []);

  // Theme Sync
  useLayoutEffect(() => {
    const targetTheme = settings?.theme || localStorage.getItem('appTheme') || 'light';
    if (targetTheme === 'dark') {
      document.body.classList.add('dark-mode');
      document.body.classList.remove('light-mode');
      document.body.style.backgroundColor = '#0f0f0f'; 
    } else {
      document.body.classList.add('light-mode');
      document.body.classList.remove('dark-mode');
      document.body.style.backgroundColor = '#f8fafc'; 
    }
  }, [settings?.theme]);

  // Auth & Subscription Listener
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser: FirebaseUser | null) => {
      if (currentUser) {
        setUser({
          uid: currentUser.uid,
          email: currentUser.email || '',
          name: currentUser.displayName || (currentUser.email?.split('@')[0]) || 'Guest User',
          photo: currentUser.photoURL || undefined
        });
        setIsPro(true);
      } else {
        setUser(null);
        setIsPro(false);
      }
      setAuthLoading(false);
    });

    return () => unsubscribeAuth();
  }, []);

  if (authLoading) {
    const isDark = localStorage.getItem('appTheme') === 'dark';
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-[#0f0f0f]' : 'bg-slate-50'}`}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#7c3aed]"></div>
      </div>
    );
  }

  const handleLoginSuccess = () => {
    // User state is already updated via Firebase auth listener
    // Navigate happens automatically through route based on user state
  };

  return (
    <UserSettingsProvider>
    <BrowserRouter>
      <Suspense fallback={<div className="min-h-screen bg-[#0a0a0b]" />}>
      <Routes>
        <Route path="/" element={<Navigate to={user ? '/overview' : '/login'} replace />} />
        <Route path="/welcome" element={!user ? <LandingPage onLoginSuccess={handleLoginSuccess} /> : <Navigate to="/overview" replace />} />
        <Route
          path="/login"
          element={
            !user ? (
              <LoginPage />
            ) : (
              <Navigate
                to={safeNext(new URLSearchParams(window.location.search).get('next'))}
                replace
              />
            )
          }
        />
        <Route path="/connect/oauth" element={user ? <OAuthConsentPage /> : <Navigate to={`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`} replace />} />
        <Route path="/signup" element={!user ? <SignupPage /> : <Navigate to="/overview" replace />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />

        <Route element={user ? <ConsoleLayout user={user} /> : <ToLogin />}>
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/playground" element={<PlaygroundPage />} />
          <Route path="/container-tags" element={<ContainerTagsPage />} />
          <Route path="/memory-graph" element={<MemoryGraphPage />} />
          <Route path="/connectors" element={<ConnectorsPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/api-keys" element={<ApiKeysPage />} />
          <Route path="/agents-mcp" element={<AgentsMcpPage />} />
          <Route path="/requests" element={<RequestsPage />} />
          <Route path="/insights" element={<UserInsightsPage />} />
          <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
          <Route path="/settings/general" element={<GeneralSettingsPage />} />
          <Route path="/settings/team" element={<TeamSettingsPage />} />
          <Route path="/settings/billing" element={<BillingSettingsPage />} />
          <Route path="/settings/usage" element={<UsageSettingsPage />} />
          <Route path="/settings/advanced" element={<AdvancedSettingsPage />} />
          <Route path="/settings/account" element={<AccountSettingsPage />} />
        </Route>

        <Route path="/dashboard" element={<Navigate to="/overview" replace />} />
        <Route
          path="/dashboard/:chatId"
          element={user ? <Dashboard user={user} isPro={isPro} /> : <ToLogin />}
        />
        <Route path="/help" element={user ? <HelpPage /> : <ToLogin />} />
        <Route path="/docs" element={user ? <DocsPage /> : <ToLogin />} />
        <Route
          path="/subscription"
          element={user ? <SubscriptionPage user={user} isPro={isPro} /> : <ToLogin />}
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
    </UserSettingsProvider>
  );
}