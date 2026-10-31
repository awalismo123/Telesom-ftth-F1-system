/**
 * A thin, honest wrapper around every Supabase RPC.
 *
 * It gives us one place to:
 *   • time the call out instead of hanging on a dead connection,
 *   • turn Postgres/network noise into a readable sentence,
 *   • notice that the session died and tell the app shell about it.
 */

import { supabase } from './supabase';
import { isAuthFailure, toAppError, type AppErrorInfo, type ErrorKind } from './errors';

export const SESSION_EXPIRED_EVENT = 'telesom:session-expired';

export class RpcError extends Error {
  readonly kind: ErrorKind;
  readonly detail: string;

  constructor(info: AppErrorInfo) {
    super(info.message);
    this.name = 'RpcError';
    this.kind = info.kind;
    this.detail = info.detail;
  }
}

let lastExpirySignal = 0;

function signalSessionExpired(detail: string) {
  // Several calls can fail at once when a token dies; only shout once.
  const now = Date.now();
  if (now - lastExpirySignal < 5000) return;
  lastExpirySignal = now;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail }));
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;

interface RpcOptions {
  timeoutMs?: number;
  /** silence the global session-expired broadcast (used by login itself) */
  quiet?: boolean;
}

export async function rpc<T = unknown>(
  name: string,
  params: Record<string, unknown> = {},
  options: RpcOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Request timeout after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    const call = supabase.rpc(name, params) as unknown as PromiseLike<{
      data: T | null;
      error: { message: string; details?: string | null; hint?: string | null } | null;
    }>;

    const { data, error } = await Promise.race([Promise.resolve(call), timeout]);

    if (error) {
      const detail = [error.message, error.details, error.hint].filter(Boolean).join(' · ');
      if (!options.quiet && isAuthFailure(detail)) signalSessionExpired(detail);
      throw new RpcError(toAppError(new Error(detail)));
    }

    return data as T;
  } catch (error) {
    if (error instanceof RpcError) throw error;

    const detail = error instanceof Error ? error.message : String(error);
    if (!options.quiet && isAuthFailure(detail)) signalSessionExpired(detail);
    throw new RpcError(toAppError(new Error(detail)));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Read-only calls can be retried once — they are safe to repeat. */
export async function rpcRead<T = unknown>(
  name: string,
  params: Record<string, unknown> = {},
  options: RpcOptions = {},
): Promise<T> {
  try {
    return await rpc<T>(name, params, options);
  } catch (error) {
    const kind = error instanceof RpcError ? error.kind : 'unknown';
    const retryable = kind === 'network' || kind === 'unknown';
    if (!retryable) throw error;

    await new Promise((resolve) => setTimeout(resolve, 600));
    return rpc<T>(name, params, options);
  }
}
