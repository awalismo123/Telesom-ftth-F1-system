/**
 * The saved login, and the rules that stop one person's session from opening
 * another person's screen.
 *
 * History: the app used to store a bare token under `telesom_f1_session_token`
 * and trust whatever `verify_session` returned. On a shared field phone that
 * means the last person to sign in anywhere in the browser owns the app — a
 * technician could open the supervisor dashboard because a supervisor had
 * signed in on that device an hour earlier.
 *
 * Now the record carries *who* it belongs to:
 *
 *   { token, userId, role, username, savedAt }
 *
 * and a restored session is only accepted when the server confirms the same
 * user id and the same role. Anything else is discarded and the person has to
 * sign in — a 4-digit PIN, not an investigation.
 *
 * This module is pure: no storage, no React, no Supabase. The provider wires
 * it to `localStorage`.
 */

export const SESSION_STORAGE_KEY = 'telesom_f1_session_v2';
/** Pre-v2 key. Removed on boot: an unowned token can never be trusted. */
export const LEGACY_SESSION_TOKEN_KEY = 'telesom_f1_session_token';
export const ACTIVE_GROUP_STORAGE_KEY = 'telesom_f1_active_group_id';

export type SessionRole = 'supervisor' | 'technician';

export interface StoredSession {
  token: string;
  userId: string;
  role: SessionRole;
  username: string;
  /** epoch ms — lets the UI show "signed in 3 h ago" and expire very old records */
  savedAt: number;
}

/** A saved record older than this is not restored; a PIN is faster than a stale ghost. */
export const MAX_SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isSessionRole(value: unknown): value is SessionRole {
  return value === 'supervisor' || value === 'technician';
}

/** Build the record that goes into storage after a successful PIN login. */
export function createStoredSession(input: {
  token: string;
  userId: string;
  role: SessionRole;
  username: string;
  savedAt?: number;
}): StoredSession {
  return {
    token: input.token,
    userId: input.userId,
    role: input.role,
    username: input.username,
    savedAt: input.savedAt ?? Date.now(),
  };
}

export function serializeSession(session: StoredSession): string {
  return JSON.stringify(session);
}

/**
 * Parse a stored record. Returns null for anything that cannot be trusted —
 * corrupt JSON, a bare legacy token, a record missing its owner.
 */
export function parseStoredSession(raw: string | null | undefined): StoredSession | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const record = parsed as Record<string, unknown>;
  if (!isUuid(record.token)) return null;
  if (!isUuid(record.userId)) return null;
  if (!isSessionRole(record.role)) return null;

  const savedAt = typeof record.savedAt === 'number' && Number.isFinite(record.savedAt)
    ? record.savedAt
    : 0;

  return {
    token: record.token,
    userId: record.userId,
    role: record.role,
    username: typeof record.username === 'string' ? record.username : '',
    savedAt,
  };
}

export type SessionMismatch = 'none' | 'unknown-user' | 'different-user' | 'role-changed' | 'inactive' | 'expired';

export interface VerifiedIdentity {
  user?: { id?: string | null; role?: string | null; is_active?: boolean | null } | null;
  token?: string | null;
}

/**
 * Compare what was saved with what the server just told us.
 *
 * The server remains the authority on the role; a record whose role no longer
 * matches is *not* silently upgraded — the person signs in again, so a PIN is
 * always behind the screen they are looking at.
 */
export function diffSession(
  stored: StoredSession,
  verified: VerifiedIdentity | null,
  now: number = Date.now(),
): SessionMismatch {
  if (!verified || !verified.user || !verified.user.id) return 'unknown-user';
  if (stored.savedAt && now - stored.savedAt > MAX_SESSION_AGE_MS) return 'expired';
  if (verified.user.id !== stored.userId) return 'different-user';
  if (verified.user.is_active === false) return 'inactive';
  if (verified.user.role && verified.user.role !== stored.role) return 'role-changed';
  return 'none';
}

/** Which screen a session opens. One function, so no screen can disagree. */
export function portalForRole(role: string | null | undefined): 'supervisor' | 'technician' {
  return role === 'supervisor' ? 'supervisor' : 'technician';
}

/** `Cabdiraxmaan Xasan` → `CX`, for the avatar in the header. */
export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return '?';
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
}
