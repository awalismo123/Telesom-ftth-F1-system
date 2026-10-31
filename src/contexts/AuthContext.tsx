import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { rpc, RpcError, SESSION_EXPIRED_EVENT } from '../lib/rpc';
import type { AuthSession, Group, Language } from '../types/database';
import { useLanguage } from '../lib/i18n';
import {
  ACTIVE_GROUP_STORAGE_KEY,
  LEGACY_SESSION_TOKEN_KEY,
  SESSION_STORAGE_KEY,
  createStoredSession,
  diffSession,
  isSessionRole,
  parseStoredSession,
  portalForRole,
  serializeSession,
  type StoredSession,
} from '../lib/session';

/**
 * Who is signed in — and, just as important, who is *not*.
 *
 * A field phone is shared. The rules that keep it honest:
 *
 *  • the saved record names its owner (user id + role + username);
 *  • a restored session is only accepted when the server confirms that owner;
 *  • every login/sign-out bumps a generation counter, so a slow restore can
 *    never land on top of a fresh sign-in;
 *  • a session document changed in another tab signs this tab out instead of
 *    silently turning a technician's phone into the supervisor console.
 */

export type SessionNotice = 'expired' | 'switched' | 'unavailable';

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  /** which app the current session opens; null while signed out */
  portal: 'supervisor' | 'technician' | null;
  /** set when a session ended without the person asking */
  sessionNotice: SessionNotice | null;
  clearSessionNotice: () => void;
  activeGroup: { id: string; code: string; name: string } | null;
  availableGroups: Group[];
  setActiveGroupById: (groupId: string) => void;
  refreshGroups: () => Promise<void>;
  refreshSession: () => Promise<void>;
  signInWithPin: (identifier: string, pin: string) => Promise<void>;
  signOut: () => Promise<void>;
  changeOwnPin: (currentPin: string, newPin: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readStoredSession(): StoredSession | null {
  const storage = readStorage();
  if (!storage) return null;
  return parseStoredSession(storage.getItem(SESSION_STORAGE_KEY));
}

function writeStoredSession(session: StoredSession): void {
  const storage = readStorage();
  if (!storage) return;
  storage.setItem(SESSION_STORAGE_KEY, serializeSession(session));
}

function clearStoredSession(): void {
  const storage = readStorage();
  if (!storage) return;
  storage.removeItem(SESSION_STORAGE_KEY);
  // Tokens written by older builds carry no owner — never trust or migrate them.
  storage.removeItem(LEGACY_SESSION_TOKEN_KEY);
}

/** Best-effort server-side revocation; the local session is cleared regardless. */
function revokeToken(token: string): void {
  void supabase.rpc('logout_session', { p_token: token }).then(
    () => undefined,
    () => undefined,
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [sessionNotice, setSessionNotice] = useState<SessionNotice | null>(null);
  const [availableGroups, setAvailableGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(() => {
    const storage = readStorage();
    return storage ? storage.getItem(ACTIVE_GROUP_STORAGE_KEY) : null;
  });
  const { setLang } = useLanguage();

  /** Bumped by every login, sign-out and expiry. Stale async work compares it. */
  const generation = useRef(0);
  const sessionRef = useRef<AuthSession | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const adoptSession = useCallback(
    (parsed: AuthSession) => {
      if (!parsed?.token || !parsed.user?.id || !isSessionRole(parsed.user.role)) {
        throw new Error('The server returned an unexpected login response.');
      }
      writeStoredSession(
        createStoredSession({
          token: parsed.token,
          userId: parsed.user.id,
          role: parsed.user.role,
          username: parsed.user.username,
        }),
      );
      setSession(parsed);
      if (parsed.user.preferred_lang) {
        setLang(parsed.user.preferred_lang as Language);
      }
    },
    [setLang],
  );

  const refreshGroups = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('groups')
        .select('*')
        .order('code', { ascending: true });
      if (!error && data) {
        setAvailableGroups(data as Group[]);
      }
    } catch {
      // A group list that cannot load is not worth blocking the app for: the
      // session's own group stays active and the switcher simply stays empty.
    }
  }, []);

  const refreshSession = useCallback(async () => {
    const epoch = generation.current;
    const stored = readStoredSession();

    if (!stored) {
      clearStoredSession();
      if (generation.current === epoch) {
        setSession(null);
        setLoading(false);
      }
      return;
    }

    let verified: AuthSession;
    try {
      verified = await rpc<AuthSession>('verify_session', { p_token: stored.token }, { quiet: true });
    } catch (error) {
      // A fresh sign-in happened while we were waiting: it owns the screen.
      if (generation.current !== epoch) return;

      const kind = error instanceof RpcError ? error.kind : 'unknown';
      if (kind === 'auth' || kind === 'forbidden' || kind === 'config') {
        clearStoredSession();
        setSession(null);
      } else {
        // Network trouble: keep the record so a later reload can still restore,
        // but do not pretend to be signed in.
        setSession(null);
        setSessionNotice('unavailable');
      }
      setLoading(false);
      return;
    }

    if (generation.current !== epoch) return;

    const mismatch = diffSession(stored, verified);
    if (mismatch !== 'none') {
      // The token belongs to someone else, or the account changed role. Drop it
      // rather than opening a screen this person did not sign in for.
      revokeToken(stored.token);
      clearStoredSession();
      setSession(null);
      setSessionNotice(mismatch === 'expired' ? 'expired' : 'switched');
      setLoading(false);
      return;
    }

    setSession(verified);
    setLoading(false);
    if (verified.user?.preferred_lang) {
      setLang(verified.user.preferred_lang as Language);
    }
  }, [setLang]);

  const bootstrapped = useRef(false);

  useEffect(() => {
    void refreshGroups();
    // Restore exactly once per mount: the callbacks change identity when the
    // language toggles, and a re-restore would race the fresh session.
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void refreshSession();
  }, [refreshGroups, refreshSession]);

  /**
   * Any RPC can discover that the token died. Instead of each screen showing a
   * raw Postgres error, the shell drops to the login screen with a reason.
   */
  useEffect(() => {
    const onExpired = () => {
      generation.current += 1;
      clearStoredSession();
      setSession(null);
      setSessionNotice('expired');
    };

    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  /**
   * Another tab replaced the saved login. If it is a different person, this tab
   * must not keep showing the previous owner's screen.
   */
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== SESSION_STORAGE_KEY) return;

      const incoming = readStoredSession();
      const current = sessionRef.current;

      if (!incoming) {
        if (current) {
          generation.current += 1;
          setSession(null);
          setSessionNotice('switched');
        }
        return;
      }

      if (!current) return; // signed out here; stay on the login screen
      if (incoming.userId === current.user.id) return; // same person, another tab

      generation.current += 1;
      setSession(null);
      setSessionNotice('switched');
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const clearSessionNotice = useCallback(() => setSessionNotice(null), []);

  const signInWithPin = async (identifier: string, pin: string) => {
    // Own the screen from the first keystroke: a restore that is still in
    // flight must not be able to decide who is signed in after this.
    const epoch = (generation.current += 1);
    const previous = readStoredSession();

    if (previous) revokeToken(previous.token);
    clearStoredSession();
    setSession(null);
    setLoading(false);
    setSessionNotice(null);

    const parsed = await rpc<AuthSession>(
      'authenticate_pin',
      { p_identifier: identifier.trim(), p_pin: pin.trim() },
      { quiet: true },
    );

    if (generation.current !== epoch) return; // superseded by a newer attempt
    if (!parsed) throw new Error('Invalid username/phone or PIN');

    adoptSession(parsed);
    await refreshGroups();
  };

  const signOut = async () => {
    generation.current += 1;
    const stored = readStoredSession();

    // Clear locally first: leaving the screen must not depend on the network.
    clearStoredSession();
    setSession(null);
    setSessionNotice(null);
    const storage = readStorage();
    storage?.removeItem(ACTIVE_GROUP_STORAGE_KEY);
    setSelectedGroupId(null);

    if (stored) revokeToken(stored.token);
  };

  const changeOwnPin = async (currentPin: string, newPin: string) => {
    if (!session?.token) throw new Error('Not signed in');
    await rpc('change_own_pin', {
      p_token: session.token,
      p_current_pin: currentPin,
      p_new_pin: newPin,
    });
  };

  const setActiveGroupById = (groupId: string) => {
    setSelectedGroupId(groupId);
    readStorage()?.setItem(ACTIVE_GROUP_STORAGE_KEY, groupId);
  };

  const activeGroup = React.useMemo(() => {
    if (!session) return null;
    if (session.user.role === 'supervisor' && selectedGroupId) {
      const found = availableGroups.find((g) => g.id === selectedGroupId);
      if (found) return { id: found.id, code: found.code, name: found.name };
    }
    return session.group;
  }, [session, selectedGroupId, availableGroups]);

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        portal: session ? portalForRole(session.user.role) : null,
        sessionNotice,
        clearSessionNotice,
        activeGroup,
        availableGroups,
        setActiveGroupById,
        refreshGroups,
        refreshSession,
        signInWithPin,
        signOut,
        changeOwnPin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
