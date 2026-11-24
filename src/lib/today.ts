import type { Language } from '../types/database';
import { SLA_DAYS } from './activity';
import { formatNumber } from './format';

/**
 * What the supervisor's landing screen says.
 *
 * It used to be a build-progress roadmap: five green ticks reading "Phase 1
 * Live", "Phase 2 Live". Every word true, and useless to somebody standing up a
 * dispatch at 07:30 with three crews waiting for work. The largest space on the
 * first screen was spent telling the department what had already been built,
 * while the question in the room was "what is still open, what is blocked, and
 * who is out?"
 *
 * The numbers come from `today_summary` (migration 022). This module turns them
 * into one sentence and a short list — deliberately pure, so the wording in both
 * languages can be tested without rendering a screen, which is where the
 * English-only `field ready` survived three batches of review.
 */

export interface TodaySummary {
  /** The local day these counts describe, `YYYY-MM-DD`. */
  day: string;
  open_now: number;
  unassigned: number;
  assigned: number;
  in_progress: number;
  blocked: number;
  over_sla: number;
  /**
   * Open jobs that reach the three-day promise today — the one group a
   * supervisor can still save, and until this page existed no screen read it.
   */
  due_today: number;
  created_today: number;
  completed_today: number;
  crews_out: number;
  /** Active crews that have at least one member — the ones that can go out. */
  crews_total: number;
  /** Active crews with nobody in them. Cannot be dispatched; a roster problem. */
  crews_empty: number;
  people_out: number;
  /**
   * The backlog split by kind (migration 033).
   *
   * Optional because a manager's saved payloads and older responses predate it;
   * every screen that uses them falls back to counting the loaded list and says
   * when that list may be short.
   */
  open_faults?: number;
  open_installs?: number;
  late_faults?: number;
  late_installs?: number;
  /** Open faults with no fault type recorded. `null` on a fault means exactly this. */
  faults_untyped?: number;
  /**
   * The last day anything was recorded, `YYYY-MM-DD`, or null when the feed
   * holds no events at all.
   *
   * Not returned by the server: the command page computes it from the activity
   * it already loads, so the headline can tell a quiet week from a dead feed.
   */
  last_activity?: string | null;
}

export type TodayTone = 'calm' | 'attention' | 'urgent';

export interface TodayItem {
  id: 'blocked' | 'overdue' | 'unassigned' | 'out' | 'closed';
  label: string;
  value: string;
  hint: string;
  tone: TodayTone;
  /** Where a tap should go; `null` means the item is information only. */
  tab: 'dispatch' | 'team' | 'insights' | null;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** `1 job` / `4 shaqo` — Somali takes the plain noun after a numeral. */
export function jobCount(n: number, lang: Language): string {
  return lang === 'so' ? `${formatNumber(n)} shaqo` : `${formatNumber(n)} ${plural(n, 'job', 'jobs')}`;
}

/**
 * The one sentence at the top.
 *
 * Ordered by what a supervisor must act on, not by what is largest. A blocked
 * job is somebody standing still waiting for a decision; a job past the promise
 * is a customer the department has failed; unassigned work is a queue they can
 * still get ahead of. Saying all three at once says nothing.
 */
export function todayHeadline(summary: TodaySummary, lang: Language): string {
  const { blocked, over_sla, unassigned, open_now, crews_out } = summary;
  const so = lang === 'so';

  if (blocked > 0) {
    return so
      ? `${jobCount(blocked, 'so')} waa xanniban yihiin — qof ayaa sugaya go'aan.`
      : `${jobCount(blocked, 'en')} ${plural(blocked, 'is', 'are')} blocked — someone is waiting on a decision.`;
  }

  if (over_sla > 0) {
    return so
      ? `${jobCount(over_sla, 'so')} ayaa ka baxay ballanta ${SLA_DAYS} maalmood.`
      : `${jobCount(over_sla, 'en')} ${plural(over_sla, 'is', 'are')} past the ${SLA_DAYS}-day promise.`;
  }

  if (unassigned > 0) {
    return so
      ? `${jobCount(unassigned, 'so')} ayaa weli aan la qorin cid u socota.`
      : `${jobCount(unassigned, 'en')} ${plural(unassigned, 'is', 'are')} still unassigned.`;
  }

  if (open_now === 0) {
    return so
      ? `Ma jiro shaqo furan. ${crews_out > 0 ? `${formatNumber(crews_out)} crew ayaa duurka ku jira.` : 'Cidna duurka ma jirto.'}`
      : `No open jobs. ${crews_out > 0 ? `${formatNumber(crews_out)} ${plural(crews_out, 'crew is', 'crews are')} out.` : 'Nobody is out.'}`;
  }

  if (summary.last_activity) {
    // Nothing is blocked, nothing is late, nothing is unassigned, but the queue
    // is not moving. Saying "19 open, none past the promise" here would be
    // reassuring and false: they are all past it, the day is just wrong.
    return so
      ? `${jobCount(open_now, 'so')} oo furan. Dhaqaaqkii ugu dambaysay: ${summary.last_activity}.`
      : `${jobCount(open_now, 'en')} open. Last movement was ${summary.last_activity}.`;
  }

  return so
    ? `${jobCount(open_now, 'so')} oo furan, midna weli kama bixin ballanta.`
    : `${jobCount(open_now, 'en')} open, none past the promise.`;
}

/** Colour for the headline: urgent only when something is actually stuck. */
export function headlineTone(summary: TodaySummary): TodayTone {
  if (summary.blocked > 0) return 'urgent';
  if (summary.over_sla > 0) return 'urgent';
  if (summary.unassigned > 0) return 'attention';
  return 'calm';
}

/**
 * The list under the headline.
 *
 * Six items, each answering a question a supervisor asks out loud. Nothing here
 * is a total for its own sake: `open_now` is deliberately broken into what is
 * blocked and what is unassigned, because those two need different actions.
 */
export function todayItems(summary: TodaySummary, lang: Language): TodayItem[] {
  const so = lang === 'so';
  const {
    blocked,
    over_sla,
    unassigned,
    crews_out,
    crews_total,
    crews_empty,
    people_out,
    completed_today,
    in_progress,
  } = summary;

  return [
    {
      id: 'blocked',
      label: so ? 'Xanniban' : 'Blocked',
      value: formatNumber(blocked),
      hint: blocked > 0 ? (so ? 'U baahan go’aan' : 'Needs a decision') : so ? 'Midna ma xannibna' : 'Nothing stuck',
      tone: blocked > 0 ? 'urgent' : 'calm',
      tab: blocked > 0 ? 'dispatch' : null,
    },
    {
      id: 'overdue',
      label: so ? `Ka baxay ${SLA_DAYS} maalmood` : `Over ${SLA_DAYS} days`,
      value: formatNumber(over_sla),
      hint: over_sla > 0 ? (so ? 'Macmiil sugaya' : 'Customer waiting') : so ? 'Weli wakhti leh' : 'Within the promise',
      tone: over_sla > 0 ? 'urgent' : 'calm',
      tab: over_sla > 0 ? 'dispatch' : null,
    },
    {
      id: 'unassigned',
      label: so ? 'Aan la qorin' : 'Unassigned',
      value: formatNumber(unassigned),
      hint: unassigned > 0 ? (so ? 'Qaybsi maanta' : 'Dispatch today') : so ? 'Dhammaan la qoray' : 'All assigned',
      tone: unassigned > 0 ? 'attention' : 'calm',
      tab: unassigned > 0 ? 'dispatch' : null,
    },
    {
      id: 'out',
      label: so ? 'Duurka' : 'Crews out',
      value: `${formatNumber(crews_out)}/${formatNumber(crews_total)}`,
      hint: (() => {
        // An empty crew is not capacity. Saying "0/0" without explanation reads
        // like nothing is wrong; naming the stranded crews is the difference
        // between a blank screen and a task.
        const stranded =
          crews_empty > 0
            ? so
              ? ` · ${formatNumber(crews_empty)} kooxood oo cidlo ah`
              : ` · ${formatNumber(crews_empty)} ${plural(crews_empty, 'crew has', 'crews have')} no members`
            : '';

        if (crews_out > 0) {
          return (
            (so
              ? `${formatNumber(people_out)} qof, ${formatNumber(in_progress)} shaqo socda`
              : `${formatNumber(people_out)} ${plural(people_out, 'person', 'people')}, ${formatNumber(in_progress)} running`) +
            stranded
          );
        }
        return (so ? 'Cidna duurka ma jirto' : 'Nobody is out') + stranded;
      })(),
      tone: 'calm',
      tab: crews_total > 0 ? 'team' : null,
    },
    {
      id: 'closed',
      label: so ? 'Maanta la dhammeeyay' : 'Closed today',
      value: formatNumber(completed_today),
      hint: so ? 'Laga bilaabo 00:00' : 'Since midnight',
      tone: 'calm',
      tab: null,
    },
  ];
}
