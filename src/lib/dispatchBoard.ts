import type { Task } from '../types/database';
import { SLA_DAYS, agingBand, waitingDays } from './activity';
import { compareTasks } from './dispatch';
import { formatNumber } from './format';

/**
 * The dispatch pool, ordered and explained.
 *
 * ## Why this exists
 *
 * `DispatchBoard` showed the pool in whatever order the server returned and let
 * the browser re-filter it. `list_open_tasks` does order by report date, so the
 * list was not random — but the screen never *said* what the order was, and the
 * one control that changed it was a two-tab filter that had to be tapped before
 * an urgent job would appear at the top.
 *
 * Meanwhile `compareTasks` already existed and was already tested: urgent first,
 * then carried-over jobs, then the report date, then the line number. It was
 * used to order the **WhatsApp message** and nowhere else. So the message a crew
 * received was in a better order than the board the supervisor dispatched from.
 * Both now use the same comparison, which is a property a test can hold.
 *
 * ## What this module does not do
 *
 * It does not change `clusterTasks` or `autoPlan`. Those decide *where* work
 * goes, are tested, and work. This module decides only what the supervisor sees
 * before that decision, and in what order.
 */

/* -------------------------------------------------------------------------- */
/* The order                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Sort the pool for the board.
 *
 * Reuses `compareTasks` deliberately rather than reimplementing a sort beside
 * it: two orderings of the same work is how a supervisor ticks job 3 on the
 * board and quotes job 5 on the phone.
 */
export function orderPool(tasks: readonly Task[]): Task[] {
  return [...tasks].sort(compareTasks);
}

/**
 * Why a job is near the top, as a short word.
 *
 * `null` for the majority: a badge on every card is noise, and the point of a
 * badge is that it is rare enough to read.
 */
export type PoolReason = 'urgent' | 'carried' | 'late' | 'due';

export function poolReason(task: Task, now: Date = new Date()): PoolReason | null {
  if (task.priority === 'urgent') return 'urgent';
  if ((task.carryover_count ?? 0) > 0) return 'carried';
  const band = agingBand(waitingDays(task, now), SLA_DAYS);
  if (band === 'late') return 'late';
  if (band === 'due') return 'due';
  return null;
}

export const POOL_REASON_LABEL: Record<PoolReason, { en: string; so: string }> = {
  urgent: { en: 'Urgent', so: 'Degdeg' },
  carried: { en: 'Carried over', so: 'Harsan' },
  late: { en: `Past ${SLA_DAYS} days`, so: `Ka baxay ${SLA_DAYS} maalmood` },
  due: { en: 'Due today', so: 'Maanta dhammaanaya' },
};

/* -------------------------------------------------------------------------- */
/* Triage                                                                     */
/* -------------------------------------------------------------------------- */

export interface PoolTriage {
  total: number;
  urgent: number;
  carried: number;
  late: number;
  due: number;
  /** Jobs with neither a box nor an area: clustering cannot place them. */
  unroutable: number;
  /** Jobs with a box or area, and so something a route can be built around. */
  routable: number;
}

export function triagePool(tasks: readonly Task[], now: Date = new Date()): PoolTriage {
  let urgent = 0;
  let carried = 0;
  let late = 0;
  let due = 0;
  let unroutable = 0;

  for (const task of tasks) {
    const reason = poolReason(task, now);
    if (reason === 'urgent') urgent += 1;
    else if (reason === 'carried') carried += 1;
    else if (reason === 'late') late += 1;
    else if (reason === 'due') due += 1;

    if (!hasRoute(task)) unroutable += 1;
  }

  return {
    total: tasks.length,
    urgent,
    carried,
    late,
    due,
    unroutable,
    routable: tasks.length - unroutable,
  };
}

/**
 * Can a route be planned around this job?
 *
 * `clusterTasks` groups by box, then by neighbourhood. A job with neither ends
 * up in a single bucket with every other such job, which means "auto-cluster"
 * will happily assign one crew seventeen jobs spread across the city and call it
 * a route. The board has to say so before the supervisor trusts the plan.
 */
export function hasRoute(task: Pick<Task, 'cablebox_code_raw' | 'xaafada'>): boolean {
  const box = (task.cablebox_code_raw ?? '').trim();
  const area = (task.xaafada ?? '').trim();
  return Boolean(box || area);
}

/** The unroutable jobs themselves, so the banner can name them. */
export function unroutableJobs(tasks: readonly Task[]): Task[] {
  return orderPool(tasks.filter((task) => !hasRoute(task)));
}

/**
 * A normalised place name.
 *
 * The sheet writes `Jigjigayar`, `JIGJIGAYAR` and `Jigjigayar ` for the same
 * neighbourhood, and the seeder produced exactly that spread. Counting distinct
 * strings would report five areas where there are three.
 */
export function placeKey(raw: string | null | undefined): string {
  return (raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export interface AreaGroup {
  key: string;
  label: string;
  count: number;
  urgent: number;
}

/**
 * Work by neighbourhood, biggest first, so a supervisor can see where the queue
 * physically is. Jobs with no area are excluded — they are the banner's problem,
 * not a group.
 */
export function areaGroups(tasks: readonly Task[]): AreaGroup[] {
  const groups = new Map<string, AreaGroup>();

  for (const task of tasks) {
    const key = placeKey(task.xaafada);
    if (!key) continue;

    const group = groups.get(key) ?? {
      // Display the first spelling seen, trimmed; group by the normalised key.
      key,
      label: (task.xaafada ?? '').trim(),
      count: 0,
      urgent: 0,
    };

    group.count += 1;
    if (task.priority === 'urgent') group.urgent += 1;
    groups.set(key, group);
  }

  return [...groups.values()].sort(
    (a, b) => b.urgent - a.urgent || b.count - a.count || a.label.localeCompare(b.label),
  );
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The sentence above the pool.
 *
 * Ordered by what a dispatcher must act on, and — unlike a row of totals — it
 * says what to *do* about the most pressing one. When everything is fine it says
 * that too, in the same number of words rather than with an empty panel.
 */
export function triageSentence(triage: PoolTriage, lang: 'en' | 'so'): string {
  const so = lang === 'so';
  const { total, urgent, carried, late, due, unroutable } = triage;

  if (total === 0) {
    return so
      ? 'Shaqo aan la qaybin ma jirto. Safka waa madhan yahay.'
      : 'Nothing is waiting to be dispatched. The pool is clear.';
  }

  /**
   * When *nothing* in the pool can be routed, that leads.
   *
   * Being late is a symptom the supervisor already understands; having no area
   * or box is the obstacle in front of them right now. Leading with "all 19 are
   * past the promise" would name an action the board cannot offer, because
   * auto-cluster has no geometry to work with.
   *
   * When only *some* jobs are unroutable, urgency still leads — the rest of the
   * pool is still dispatchable — and the banner underneath carries the caveat.
   */
  const blocked = unroutable === total && total > 0;
  if (blocked) {
    return so
      ? `${formatNumber(total)} shaqo oo furan, laakiin midkoodna ma laha xaafad ama sanduuq — lama jihayn karo.`
      : `${formatNumber(total)} open, but not one has an area or a box — there is no route to plan.`;
  }

  if (urgent > 0) {
    return so
      ? `${formatNumber(urgent)} degdeg ah oo ku jira ${formatNumber(total)} — kuwaas ayaa hore loo qaadaa.`
      : `${formatNumber(urgent)} urgent in a pool of ${formatNumber(total)} — those go first.`;
  }

  if (carried > 0) {
    return so
      ? `${formatNumber(carried)} shaqo ayaa harsan — maanta waa in la dhammeeyaa.`
      : `${formatNumber(carried)} ${carried === 1 ? 'job was' : 'jobs were'} carried over — today they finish.`;
  }

  if (late > 0) {
    return so
      ? `${formatNumber(late)} ka mid ah ${formatNumber(total)} ayaa ka baxay ballanta ${SLA_DAYS} maalmood.`
      : `${formatNumber(late)} of ${formatNumber(total)} ${late === 1 ? 'is' : 'are'} past the ${SLA_DAYS}-day promise.`;
  }

  if (due > 0) {
    return so
      ? `${formatNumber(due)} ayaa maanta gaaraya ballanta — qabso maanta.`
      : `${formatNumber(due)} reach the promise today — catch ${due === 1 ? 'it' : 'them'} now.`;
  }

  if (unroutable > 0) {
    return so
      ? `${formatNumber(total)} shaqo oo furan, laakiin ${formatNumber(unroutable)} ayaan xaafad ama sanduuq lahayn.`
      : `${formatNumber(total)} open, but ${formatNumber(unroutable)} ${unroutable === 1 ? 'has' : 'have'} no area or box.`;
  }

  return so
    ? `${formatNumber(total)} shaqo oo furan, midna weli kama bixin ballanta.`
    : `${formatNumber(total)} open, none past the promise.`;
}

/**
 * The unroutable banner.
 *
 * Not a warning for its own sake: it names the count, the lines, and the one
 * action that fixes it. A supervisor looking at a plan that groups two urgent
 * jobs in two different parts of the city under one "no area" heading needs to
 * know why before they send it.
 */
export function unroutableNotice(
  jobs: readonly Task[],
  lang: 'en' | 'so',
): { title: string; body: string } | null {
  if (jobs.length === 0) return null;
  const so = lang === 'so';
  const urgent = jobs.filter((job) => job.priority === 'urgent').length;
  const lines = jobs.slice(0, 6).map((job) => job.line_number).join(', ');
  const more = jobs.length > 6 ? (so ? ` iyo ${jobs.length - 6} kale` : ` and ${jobs.length - 6} more`) : '';

  return {
    title: so
      ? `${formatNumber(jobs.length)} shaqo ayaan xaafad ama sanduuq lahayn`
      : `${formatNumber(jobs.length)} ${jobs.length === 1 ? 'job has' : 'jobs have'} no area or box`,
    body:
      (so
        ? `${lines}${more}. Isticmaalka “isku-xidh otomaatig ah” waxay ku biiri doonaan hal saf oo aan jihada la garanayn.`
        : `${lines}${more}. Auto-cluster will fold them into one directionless batch.`) +
      (urgent > 0
        ? so
          ? ` ${formatNumber(urgent)} ka mid ah waa degdeg.`
          : ` ${formatNumber(urgent)} of them ${urgent === 1 ? 'is' : 'are'} urgent.`
        : '') +
      (so
        ? ' Fur shaqada oo ku dar xaafadda ama sanduuqa, ka dib qaybso.'
        : ' Open a job, add the area or box, then dispatch.'),
  };
}

export const POOL_ORDER_NOTE = {
  en: `Ordered urgent first, then carried-over jobs, then oldest. The same order the crew sees in the message.`,
  so: `Degdegga hore, ka dib shaqooyinka harsan, ka dib kuwii ugu horeeyay. Isla nidaamkaas oo kale ayaa kooxdu ku aragtaa fariinta.`,
} as const;

/**
 * What the board can actually do right now.
 *
 * A board with jobs and no dispatchable people is not "empty" — it is blocked,
 * and the difference matters: an empty board needs new sheets, a blocked one
 * needs somebody added to a crew. The two must not look alike.
 */
export type BoardState = 'ready' | 'no-jobs' | 'no-targets' | 'no-jobs-no-targets';

export function boardState(jobs: number, targets: number): BoardState {
  if (jobs === 0 && targets === 0) return 'no-jobs-no-targets';
  if (targets === 0) return 'no-targets';
  if (jobs === 0) return 'no-jobs';
  return 'ready';
}
