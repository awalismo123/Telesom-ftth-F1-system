/**
 * Never lose typed work.
 *
 * A technician filling in the completion form (dBm, port, what they did) can
 * lose the screen to a dead battery, a dropped session or a wrong tap. The
 * draft is written to device storage on every keystroke and offered back the
 * next time the job is opened.
 */

const PREFIX = 'telesom_f1_draft_';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CompletionDraft {
  dbm: string;
  notes: string;
  port: string;
  savedAt: number;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function saveCompletionDraft(taskId: string, draft: Omit<CompletionDraft, 'savedAt'>): void {
  if (!taskId) return;
  const hasContent = Boolean(draft.dbm || draft.notes.trim() || draft.port.trim());
  const store = storage();
  if (!store) return;
  try {
    if (!hasContent) {
      store.removeItem(PREFIX + taskId);
      return;
    }
    store.setItem(
      PREFIX + taskId,
      JSON.stringify({ ...draft, savedAt: Date.now() } satisfies CompletionDraft),
    );
  } catch {
    /* storage full or blocked — drafting is a nicety, never a blocker */
  }
}

export function readCompletionDraft(taskId: string): CompletionDraft | null {
  const store = storage();
  if (!store || !taskId) return null;
  try {
    const raw = store.getItem(PREFIX + taskId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CompletionDraft;
    if (!parsed || typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > TTL_MS) {
      store.removeItem(PREFIX + taskId);
      return null;
    }
    if (!parsed.dbm && !parsed.notes && !parsed.port) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearCompletionDraft(taskId: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(PREFIX + taskId);
  } catch {
    /* ignore */
  }
}

/** Rough "3m ago" label for the restore banner. */
export function draftAge(ms: number, lang: 'so' | 'en'): string {
  const minutes = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (minutes < 1) return lang === 'so' ? 'hadda' : 'just now';
  if (minutes < 60) return lang === 'so' ? `${minutes} daq ka hor` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return lang === 'so' ? `${hours} saac ka hor` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return lang === 'so' ? `${days} maalmood ka hor` : `${days}d ago`;
}
