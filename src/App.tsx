import React from 'react';
import { LanguageProvider } from './lib/i18n';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginScreen } from './components/LoginScreen';
import { HeaderBar } from './components/HeaderBar';
import { SupervisorShell } from './components/supervisor/SupervisorShell';
import { TechnicianShell } from './components/technician/TechnicianShell';
import { ToastProvider } from './components/ui/Toast';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { OfflineBanner } from './components/ui/OfflineBanner';
import { Splash } from './components/ui/Splash';

function AppRouter() {
  const { session, loading } = useAuth();

  if (loading) {
    return <Splash />;
  }

  if (!session) {
    return <LoginScreen />;
  }

  const supervisor = session.user.role === 'supervisor';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <ErrorBoundary label="Header">
        <HeaderBar />
      </ErrorBoundary>
      <OfflineBanner />
      <main className="flex-1">
        <ErrorBoundary label={supervisor ? 'Supervisor' : 'My route'}>
          {supervisor ? <SupervisorShell /> : <TechnicianShell />}
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary label="Telesom FTTH">
      <ToastProvider>
        <LanguageProvider>
          <AuthProvider>
            <AppRouter />
          </AuthProvider>
        </LanguageProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
