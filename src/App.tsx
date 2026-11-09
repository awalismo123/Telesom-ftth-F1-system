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
import { ConfigGate } from './components/ui/ConfigGate';
import { NavigationProvider } from './lib/navigation';
import { ForcePinChange } from './components/ui/ForcePinChange';

function AppRouter() {
  const { session, loading, portal } = useAuth();

  if (loading) {
    return <Splash />;
  }

  if (!session) {
    return <LoginScreen />;
  }

  // An account still on the department's PIN gets exactly one screen until it
  // chooses its own. There is no skip: a shared PIN makes the work log a record
  // of "somebody" rather than of a person.
  if (session.user.must_change_pin) {
    return <ForcePinChange />;
  }

  // Which shell opens is decided by the saved session's own role — never by
  // what a previous person on this device last looked at.
  const supervisor = portal === 'supervisor';

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
      <LanguageProvider>
        <ToastProvider>
          <ConfigGate>
            <AuthProvider>
              <NavigationProvider>
                <AppRouter />
              </NavigationProvider>
            </AuthProvider>
          </ConfigGate>
        </ToastProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}
