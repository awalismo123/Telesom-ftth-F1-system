import type { Language } from '../types/database';
import { formatNumber } from './format';

/**
 * What a list is not telling you.
 *
 * `list_open_tasks` returns at most 600 rows. The dispatch board renders
 * whatever it gets and prints `pool.length` in its header, so on the day a group
 * has more than 600 open jobs the board shows "600" as though that were the
 * count. A supervisor reads that as the size of the backlog and plans a day
 * around it.
 *
 * The cap itself is reasonable — a board with 4,000 cards is unusable and the
 * real fix is a filter, not a longer list. The bug is the silence. A list that
 * stops short must say so, and say what to do about it.
 *
 * This is deliberately a sentence rather than a spinner: there is nothing more
 * to wait for. The number on screen is not the number they asked for.
 */

/** The row cap baked into `list_open_tasks` (migration 011, line ~344). */
export const OPEN_TASK_CAP = 600;

/**
 * Returns null while the list is complete, so a screen can render this
 * unconditionally and show nothing in the normal case.
 */
export function truncatedNotice(loaded: number, cap: number, lang: Language): string | null {
  if (loaded < cap) return null;

  if (lang === 'so') {
    return `Liiskan waxa uu muujinayaa ${formatNumber(cap)} shaqo oo keliya — waxaa laga yaabaa in ka badan jiraan. Isticmaal shaandhaynta si aad u aragto inta kale.`;
  }

  return `This list stops at ${formatNumber(cap)} jobs — there may be more. Narrow it with a filter to see the rest.`;
}

/**
 * "Showing 42 of 118" — for a list that is filtered on the client, where both
 * numbers are known. Returns null when nothing is being hidden.
 */
export function showingLabel(shown: number, total: number, lang: Language): string | null {
  if (shown >= total) return null;

  return lang === 'so'
    ? `${formatNumber(shown)} ka mid ah ${formatNumber(total)} ayaa la muujiyay`
    : `Showing ${formatNumber(shown)} of ${formatNumber(total)}`;
}
