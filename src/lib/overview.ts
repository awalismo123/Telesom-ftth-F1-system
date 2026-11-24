import type { Language } from '../types/database';
import type { Task } from '../types/database';
import { SLA_DAYS, type ActivityEvent } from './activity';
import type { LoadCrew, LoadUser } from './dispatchService';
import { formatNumber } from './format';

/**
 * The supervisor's command page.
 *
 * ## What this module is for
 *
 * `today.ts` answers *one* question with one sentence: what needs me now. That
 * was right when the landing screen was a headline and five tiles. It is not
 * enough for a page a supervisor keeps open all shift, because the numbers a
 * dispatcher actually works from are not totals — they are **which jobs, whose
 * they are, and how long they have been waiting**.
 *
 * So this module assembles the work itself: the attention counts, the load per
 * person, the queue in the order it should be attacked, and the day's movement.
 * All of it pure, so the ordering rules and the wording in both languages are
 * tested without rendering a screen — which is how the English-only
 * `field ready` survived three reviews.
 *
 * ## Three rules that shape everything here
 *
 * 1. **No ranking.** People are listed alphabetically, never by output. A
 *    supervisor needs to know who is free, not who is winning.
 * 2. **Oldest first, urgent ahead of it.** The order work is attacked in is a
 *    decision, and it is made once, here, rather than differently on each
 *    screen.
 * 3. **Nothing is silently dropped.** A job that matches no bucket is counted
 *    as unaccounted-for rather than vanishing; a person carrying work with no
 *    crew is still a person carrying work.
 */

/* -------------------------------------------------------------------------- */
/* The attention rail                                                         */
/* -------------------------------------------------------------------------- */

export type AttentionId = 'blocked' | 'overdue' | 'due' | 'unassigned' | 'urgent';

export type AttentionTone = 'urgent' | 'attention' | 'calm';

export interface AttentionItem {
  id: AttentionId;
  label: string;
  value: number;
  hint: string;
  tone: AttentionTone;
  /** Where a tap should go. `null` when the number is zero and there is nowhere useful to go. */
  tab: 'dispatch' | null;
}

export interface AttentionInput {
  blocked: number;
  over_sla: number;
  due_today: number;
  unassigned: number;
  urgent_open: number;
}

/**
 * The five numbers that mean somebody has to do something.
 *
 * Deliberately excludes "open" and "completed": those are totals, and a total is
 * not a task. Every item here has an action behind it — release a blocker,
 * chase an overdue job, catch one before it goes overdue, dispatch a queue, move
 * an urgent job to the front.
 */
export function attentionItems(input: AttentionInput, lang: Language): AttentionItem[] {
  const so = lang === 'so';
  const { blocked, over_sla, due_today, unassigned, urgent_open } = input;

  return [
    {
      id: 'blocked',
      label: so ? 'Xanniban' : 'Blocked',
      value: blocked,
      hint: blocked > 0 ? (so ? 'Sugaya go’aan' : 'Waiting on a decision') : so ? 'Midna ma xannibna' : 'Nothing stuck',
      tone: blocked > 0 ? 'urgent' : 'calm',
      tab: blocked > 0 ? 'dispatch' : null,
    },
    {
      id: 'overdue',
      label: so ? `Ka baxay ${SLA_DAYS}` : `Over ${SLA_DAYS} days`,
      value: over_sla,
      hint: over_sla > 0 ? (so ? 'Ballantii la jabiyay' : 'Promise already broken') : so ? 'Weli ballan taalla' : 'Within the promise',
      tone: over_sla > 0 ? 'urgent' : 'calm',
      tab: over_sla > 0 ? 'dispatch' : null,
    },
    {
      id: 'due',
      label: so ? 'Maanta dhammaanaya' : 'Due today',
      value: due_today,
      hint:
        due_today > 0
          ? so
            ? 'Hadda la qabto waa la badbaadinayaa'
            : 'Act now and the promise holds'
          : so
            ? 'Maanta midna ma gaarto'
            : 'Nothing reaches the deadline',
      tone: due_today > 0 ? 'attention' : 'calm',
      tab: due_today > 0 ? 'dispatch' : null,
    },
    {
      id: 'unassigned',
      label: so ? 'Aan la qorin' : 'Unassigned',
      value: unassigned,
      hint: unassigned > 0 ? (so ? 'Qaybsi maanta' : 'Needs a dispatcher') : so ? 'Dhammaan la qoray' : 'All assigned',
      tone: unassigned > 0 ? 'attention' : 'calm',
      tab: unassigned > 0 ? 'dispatch' : null,
    },
    {
      id: 'urgent',
      label: so ? 'Degdeg' : 'Urgent',
      value: urgent_open,
      hint: urgent_open > 0 ? (so ? 'Horay u qaad' : 'Move to the front') : so ? 'Mid degdeg ah ma jirto' : 'Nothing marked urgent',
      tone: urgent_open > 0 ? 'urgent' : 'calm',
      tab: urgent_open > 0 ? 'dispatch' : null,
    },
  ];
}

/** Total of everything that needs a decision. Used for the rail's own summary. */
export function attentionTotal(input: AttentionInput): number {
  // Blocked and overdue overlap with open work; this is a sum of *problems*,
  // not of jobs, and is only used to decide whether to draw the rail at all.
  return input.blocked + input.over_sla + input.due_today + input.unassigned + input.urgent_open;
}

/* -------------------------------------------------------------------------- */
/* The work list                                                              */
/* -------------------------------------------------------------------------- */

export interface WorkRow {
  id: string;
  line_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  xaafada: string | null;
  status: string;
  priority: string;
  reported_date: string | null;
  /** Whole days waiting, floored at 0. `null` when there is no date at all. */
  days: number | null;
  tone: 'urgent' | 'late' | 'due' | 'normal';
}

/**
 * Days a job has been waiting, from the day the customer reported it.
 *
 * `reported_date` is what the sheet says; `created_at` is when we read the sheet,
 * which can be a day later. The customer counts from the first one — the same
 * choice `agingBand` and `waiting_over_sla` already make.
 *
 * `null` rather than 0 when there is no usable date: a job with no date has not
 * "just arrived", it has an unknown age, and showing 0 would hide it at the
 * bottom of a list sorted by age.
 */
export function daysWaiting(
  task: Pick<Task, 'reported_date' | 'created_at'>,
  today: string,
): number | null {
  const from = task.reported_date ?? (task.created_at ? task.created_at.slice(0, 10) : null);
  if (!from) return null;

  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/**
 * Which badge a waiting job carries.
 *
 * Order matters: urgent outranks the clock because it is a decision somebody has
 * already made about this job, and a supervisor scanning a list needs to see it
 * before they see arithmetic.
 */
export function ageTone(days: number | null, priority: string): WorkRow['tone'] {
  if (priority === 'urgent') return 'urgent';
  if (days === null) return 'normal';
  if (days > SLA_DAYS) return 'late';
  if (days === SLA_DAYS) return 'due';
  return 'normal';
}

/**
 * The queue, in the order it should be attacked.
 *
 * Urgent first, then oldest. Within the same age the line number breaks the tie
 * so the list does not reshuffle between renders — two supervisors looking at
 * the same screen must see the same order, and a card that moves while being
 * read is a card that gets tapped by accident.
 */
export function workQueue(
  tasks: readonly Task[],
  today: string,
  limit = 8,
): WorkRow[] {
  const rows: WorkRow[] = tasks
    .filter((task) => task.status !== 'completed' && task.status !== 'cancelled')
    .map((task) => {
      const days = daysWaiting(task, today);
      return {
        id: task.id,
        line_number: task.line_number,
        customer_name: task.customer_name ?? null,
        customer_phone: task.customer_phone ?? null,
        xaafada: task.xaafada ?? null,
        status: task.status,
        priority: task.priority,
        reported_date: task.reported_date ?? null,
        days,
        tone: ageTone(days, task.priority),
      };
    });

  rows.sort((a, b) => {
    const urgent = Number(b.priority === 'urgent') - Number(a.priority === 'urgent');
    if (urgent !== 0) return urgent;

    // Unknown age sorts after known age: it is not "newest", it is unknown, and
    // putting it first would push a genuinely old job off the list.
    const aDays = a.days ?? -1;
    const bDays = b.days ?? -1;
    if (aDays !== bDays) return bDays - aDays;

    return a.line_number.localeCompare(b.line_number);
  });

  return rows.slice(0, Math.max(0, limit));
}

/** How many jobs are waiting behind the visible queue. */
export function queueRemainder(total: number, shown: number): number {
  return Math.max(0, total - shown);
}

/* -------------------------------------------------------------------------- */
/* The load board                                                             */
/* -------------------------------------------------------------------------- */

export type LoadKind = 'crew' | 'person';

export interface LoadRow {
  key: string;
  kind: LoadKind;
  name: string;
  /** Crew vehicle tag, or a person's role line. */
  subtitle: string | null;
  open: number;
  active: number;
  urgent: number;
  done_today: number;
  /** Crew members; empty for a person. */
  members: string[];
  /** A crew row with nobody in it: cannot be dispatched to. */
  stranded: boolean;
}

/**
 * Who is carrying what.
 *
 * Crews and unaccompanied people are both shown, because a job can be assigned
 * to either and a supervisor looking at a name needs to know which. A crew with
 * no members is shown **and flagged** rather than hidden: assigning work to it
 * sends the job nowhere while looking like it was sent.
 *
 * Alphabetical, never by workload. A list ordered by open jobs is a leaderboard
 * with a different title, and the point of this panel is "who is free".
 */
export function loadRows(load: { users: LoadUser[]; crews: LoadCrew[] }): LoadRow[] {
  const crews: LoadRow[] = load.crews.map((crew) => ({
    key: `crew:${crew.id}`,
    kind: 'crew' as const,
    name: crew.name,
    subtitle: crew.vehicle_tag ?? crew.zone_focus ?? null,
    open: crew.open_jobs,
    active: crew.active_jobs,
    urgent: crew.urgent_jobs,
    done_today: crew.done_today,
    members: (crew.members ?? []).map((member) => member.full_name),
    stranded: (crew.members ?? []).length === 0,
  }));

  /**
   * Only people who are not already represented by a crew lane.
   *
   * A technician in a two-person vehicle appears twice otherwise — once alone
   * and once inside the crew — and their numbers are split between the two,
   * which reads as half a technician in each place.
   */
  const inCrew = new Set(
    load.crews.flatMap((crew) => (crew.members ?? []).map((member) => member.id)),
  );

  const people: LoadRow[] = load.users
    .filter((user) => !inCrew.has(user.id))
    .map((user) => ({
      key: `user:${user.id}`,
      kind: 'person' as const,
      name: user.full_name,
      subtitle: user.phone ? user.phone : null,
      open: user.open_jobs,
      active: user.active_jobs,
      urgent: user.urgent_jobs,
      done_today: user.done_today,
      members: [],
      stranded: false,
    }));

  return [...crews, ...people].sort(
    (a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
  );
}

/** Everybody carrying nothing — the people a new job should go to first. */
export function idleRows(rows: readonly LoadRow[]): LoadRow[] {
  return rows.filter((row) => !row.stranded && row.open === 0);
}

/** Crews that cannot be dispatched to. Surfaced, never silent. */
export function strandedRows(rows: readonly LoadRow[]): LoadRow[] {
  return rows.filter((row) => row.stranded);
}

/**
 * The sentence under the load board.
 *
 * Says how many people are free *and*, when it applies, that some crews cannot
 * take work at all — because "0 of 2 crews available" with no explanation looks
 * like a quiet afternoon rather than a roster fault.
 */
export function loadSummary(rows: readonly LoadRow[], lang: Language): string {
  const so = lang === 'so';
  const idle = idleRows(rows).length;
  const stranded = strandedRows(rows).length;
  const usable = rows.length - stranded;

  const base = so
    ? `${formatNumber(idle)} ka mid ah ${formatNumber(usable)} cid madhan`
    : `${formatNumber(idle)} of ${formatNumber(usable)} carrying nothing`;

  if (stranded === 0) return base;

  return (
    base +
    (so
      ? ` · ${formatNumber(stranded)} kooxood oo xubno la’aan ah`
      : ` · ${formatNumber(stranded)} ${stranded === 1 ? 'crew has' : 'crews have'} no members`)
  );
}

/* -------------------------------------------------------------------------- */
/* The day's movement                                                         */
/* -------------------------------------------------------------------------- */

export interface DayPoint {
  date: string;
  label: string;
  arrived: number;
  closed: number;
}

/**
 * Arrived vs closed, per day, oldest first.
 *
 * Two lines rather than one net figure: "+4 net" is equally true of a day where
 * twelve arrived and eight closed and of a day where four arrived and none did,
 * and those are very different days for the people standing in the street.
 *
 * Built by walking the calendar rather than the events, so a day with nothing on
 * it appears as a gap instead of being skipped — a sparkline that omits empty
 * days compresses a quiet week into a busy-looking line.
 */
export function movementSeries(
  events: readonly ActivityEvent[],
  today: string,
  days = 7,
  lang: Language = 'en',
): DayPoint[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(end)) return [];

  const counts = new Map<string, { arrived: number; closed: number }>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = new Date(end - i * 86_400_000).toISOString().slice(0, 10);
    counts.set(key, { arrived: 0, closed: 0 });
  }

  for (const event of events) {
    const day = String(event.at ?? '').slice(0, 10);
    const bucket = counts.get(day);
    if (!bucket) continue;

    // `imported` and `manual_created` are work arriving; `completed` is work
    // leaving. Everything else (assigned, started, blocked) is movement inside
    // the pipeline and would double-count the same job several times a day.
    if (event.kind === 'imported' || event.kind === 'manual_created') bucket.arrived += 1;
    if (event.kind === 'completed') bucket.closed += 1;
  }

  return [...counts.entries()].map(([date, value]) => ({
    date,
    label: weekdayLabel(date, lang),
    ...value,
  }));
}

const WEEKDAYS = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  so: ['Axd', 'Isn', 'Tal', 'Arb', 'Kha', 'Jim', 'Sab'],
} as const;

function weekdayLabel(date: string, lang: Language): string {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return date;
  return WEEKDAYS[lang === 'so' ? 'so' : 'en'][new Date(parsed).getUTCDay()];
}

/** The tallest column in the series, floored at 1 so a bar is never division by zero. */
export function seriesPeak(series: readonly DayPoint[]): number {
  return Math.max(1, ...series.map((point) => Math.max(point.arrived, point.closed)));
}

/**
 * The most recent day anything happened, or null.
 *
 * Used only when the seven-day window is silent: "no movement this week" is
 * true but it does not tell a supervisor whether the department is quiet or the
 * system is broken. Naming the last busy day distinguishes the two.
 */
export function lastActivityDay(events: readonly ActivityEvent[]): string | null {
  let newest: string | null = null;
  for (const event of events) {
    const day = String(event.at ?? '').slice(0, 10);
    if (!day) continue;
    if (newest === null || day > newest) newest = day;
  }
  return newest;
}

/**
 * The week in one line.
 *
 * Net movement is stated as words when the backlog grew, because a supervisor
 * scanning the page should not have to subtract two numbers to learn that the
 * department fell behind.
 */
export function movementSummary(
  series: readonly DayPoint[],
  lang: Language,
  lastActivity: string | null = null,
): string {
  const so = lang === 'so';
  const arrived = series.reduce((sum, point) => sum + point.arrived, 0);
  const closed = series.reduce((sum, point) => sum + point.closed, 0);
  const net = arrived - closed;

  if (arrived === 0 && closed === 0) {
    // Silence has two very different causes — a quiet week and a broken feed —
    // and the last busy day is what tells them apart.
    if (lastActivity) {
      return so
        ? `Toddobaadkan wax dhaqaaq ah ma jiro. Markii ugu dambaysay ee wax dhacaan: ${lastActivity}.`
        : `No movement in the last seven days. Last activity was on ${lastActivity}.`;
    }
    return so ? 'Toddobaadkan wax dhaqaaq ah ma jiro.' : 'No movement in the last seven days.';
  }

  if (net > 0) {
    return so
      ? `${formatNumber(arrived)} yimid, ${formatNumber(closed)} la dhammeeyay — ${formatNumber(net)} ayaa ku soo biiray safka.`
      : `${formatNumber(arrived)} arrived, ${formatNumber(closed)} closed — the backlog grew by ${formatNumber(net)}.`;
  }

  if (net === 0) {
    return so
      ? `${formatNumber(arrived)} yimid, ${formatNumber(closed)} la dhammeeyay — isku dheelitiran.`
      : `${formatNumber(arrived)} arrived, ${formatNumber(closed)} closed — level.`;
  }

  return so
    ? `${formatNumber(arrived)} yimid, ${formatNumber(closed)} la dhammeeyay — ${formatNumber(-net)} ayaa ka baxay safka.`
    : `${formatNumber(arrived)} arrived, ${formatNumber(closed)} closed — the backlog fell by ${formatNumber(-net)}.`;
}

/* -------------------------------------------------------------------------- */
/* The live feed                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The last few things that happened, newest first.
 *
 * Deliberately *not* filtered to problems: a feed that only shows bad news
 * trains a supervisor to ignore it. A completion is the most useful thing on
 * this page — it means a crew is moving.
 */
export function recentEvents(
  events: readonly ActivityEvent[],
  limit = 6,
): ActivityEvent[] {
  return [...events]
    .filter((event) => Boolean(event.at))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, Math.max(0, limit));
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                       */
/* -------------------------------------------------------------------------- */

/** The greeting. Uses the local hour the caller passes in, never the server's. */
export function greeting(hour: number, lang: Language): string {
  const so = lang === 'so';
  if (hour < 12) return so ? 'Subax wanaagsan' : 'Good morning';
  if (hour < 17) return so ? 'Galab wanaagsan' : 'Good afternoon';
  return so ? 'Habeen wanaagsan' : 'Good evening';
}

/** How stale the page is. Reads as a fact, not an alarm, until it is old. */
export function updatedLabel(seconds: number | null, lang: Language): string {
  const so = lang === 'so';
  if (seconds === null) return so ? 'Weli lama cusboonaysiin' : 'Not refreshed yet';
  if (seconds < 15) return so ? 'Hadda la cusboonaysiiyay' : 'Updated just now';
  if (seconds < 60) return so ? `${seconds} ilbiriqsi ka hor` : `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return so ? `${minutes} daqiiqo ka hor` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return so ? `${hours} saacadood ka hor` : `${hours}h ago`;
}

export const OVERVIEW_NOTE = {
  en: 'Counts cover every open job in the group, not only today. People are listed alphabetically and never ranked.',
  so: 'Tirooyinku waxay daboolaan shaqo kasta oo furan oo kooxda, ma aha oo kaliya maanta. Shaqaalaha waxaa lagu taxaa xarfaha, weligood lama kala dhig-dhigo.',
} as const;

export const WORK_NOTE = {
  en: 'Oldest first, urgent ahead of it. Days counted from the day the customer reported, which is what they measure.',
  so: 'Midda ugu horeysa hore, degdegga ka hor. Maalmaha waxaa laga tiriyaa maalinta macmiilku soo sheegay, taas oo ay iyagu cabbiraan.',
} as const;
