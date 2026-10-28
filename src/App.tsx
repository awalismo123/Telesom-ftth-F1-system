import React from 'react';
import { LanguageProvider } from './lib/i18n';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginScreen } from './components/LoginScreen';
import { HeaderBar } from './components/HeaderBar';
import { SupervisorShell } from './components/supervisor/SupervisorShell';
import { TechnicianShell } from './components/technician/TechnicianShell';

function AppRouter() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-emerald-950 flex items-center justify-center text-emerald-200 text-sm font-semibold">
        Loading Telesom FTTH System...
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <HeaderBar />
      <main className="flex-1">
        {session.user.role === 'supervisor' ? <SupervisorShell /> : <TechnicianShell />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </LanguageProvider>
  );
}
