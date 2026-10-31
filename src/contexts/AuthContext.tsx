import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { AuthSession, Group, Language } from '../types/database';
import { useLanguage } from '../lib/i18n';
import { SESSION_EXPIRED_EVENT } from '../lib/rpc';

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  /** set when the server rejected the token mid-use */
  sessionNotice: string | null;
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

const SESSION_TOKEN_KEY = 'telesom_f1_session_token';
const ACTIVE_GROUP_KEY = 'telesom_f1_active_group_id';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [availableGroups, setAvailableGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(() =>
    localStorage.getItem(ACTIVE_GROUP_KEY)
  );
  const { setLang } = useLanguage();

  const refreshGroups = useCallback(async () => {
    const { data } = await supabase
      .from('groups')
      .select('*')
      .order('code', { ascending: true });
    if (data) {
      setAvailableGroups(data as Group[]);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    const savedToken = localStorage.getItem(SESSION_TOKEN_KEY);
    if (!savedToken) {
      setSession(null);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.rpc('verify_session', {
      p_token: savedToken,
    });

    if (error || !data) {
      localStorage.removeItem(SESSION_TOKEN_KEY);
      setSession(null);
    } else {
      const parsed = data as AuthSession;
      setSession(parsed);
      if (parsed.user?.preferred_lang) {
        setLang(parsed.user.preferred_lang as Language);
      }
    }
    setLoading(false);
  }, [setLang]);

  useEffect(() => {
    void refreshGroups();
    void refreshSession();
  }, [refreshGroups, refreshSession]);

  /**
   * Any RPC can discover that the token died. Instead of each screen showing a
   * raw Postgres error, the shell drops to the login screen with a reason.
   */
  useEffect(() => {
    const onExpired = () => {
      localStorage.removeItem(SESSION_TOKEN_KEY);
      setSession(null);
      setSessionNotice('expired');
    };

    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const clearSessionNotice = useCallback(() => setSessionNotice(null), []);

  const signInWithPin = async (identifier: string, pin: string) => {
    const { data, error } = await supabase.rpc('authenticate_pin', {
      p_identifier: identifier.trim(),
      p_pin: pin.trim(),
    });

    if (error || !data) {
      throw new Error(error?.message || 'Invalid username/phone or PIN');
    }

    const parsed = data as AuthSession;
    localStorage.setItem(SESSION_TOKEN_KEY, parsed.token);
    setSessionNotice(null);
    setSession(parsed);
    if (parsed.user?.preferred_lang) {
      setLang(parsed.user.preferred_lang);
    }
    await refreshGroups();
  };

  const signOut = async () => {
    const savedToken = localStorage.getItem(SESSION_TOKEN_KEY);
    if (savedToken) {
      await supabase.rpc('logout_session', { p_token: savedToken });
    }
    localStorage.removeItem(SESSION_TOKEN_KEY);
    setSession(null);
  };

  const changeOwnPin = async (currentPin: string, newPin: string) => {
    if (!session?.token) throw new Error('Not signed in');
    const { error } = await supabase.rpc('change_own_pin', {
      p_token: session.token,
      p_current_pin: currentPin,
      p_new_pin: newPin,
    });
    if (error) throw new Error(error.message);
  };

  const setActiveGroupById = (groupId: string) => {
    setSelectedGroupId(groupId);
    localStorage.setItem(ACTIVE_GROUP_KEY, groupId);
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
