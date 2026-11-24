import type { Task } from '../types/database';

/**
 * Faults are not late installations.
 *
 * ## The rule, and where it comes from
 *
 * An installation is a **booking**: the customer asked for a line, a date was
 * agreed, and three days is the promise. A fault is a **customer who is already
 * paying and whose service has stopped**. The business consequence of a fault
 * sitting is not a disappointed new customer — it is a paying one deciding the
 * service is unreliable, and it compounds every hour.
 *
 * So the two kinds carry different clocks:
 *
 * | kind          | promised |
 * |---------------|----------|
 * | fault (cilada)| 2 days   |
 * | installation  | 3 days   |
 *
 * ## One definition, two places
 *
 * The clock lives in the database as `task_sla_days(task_type)` and here as
 * `slaDays`. Two copies is a smell, so a test reads the migration file and
 * asserts the two agree — the alternative (trusting them to stay in step) is the
 * class of bug the last two phases existed to remove.
 */

/** The promised window, in days, for a task type. Mirrors `task_sla_days`. */
export const FAULT_SLA_DAYS = 2;
export const INSTALL_SLA_DAYS = 3;

export type TaskKind = 'fault' | 'install';

/** Which of the two systems this job belongs to. */
export function taskKind(task: Pick<Task, 'task_type'>): TaskKind {
  return task.task_type === 'cilada' ? 'fault' : 'install';
}

/** The promised window for a job, in days. */
export function slaDays(task: Pick<Task, 'task_type'>): number {
  return taskKind(task) === 'fault' ? FAULT_SLA_DAYS : INSTALL_SLA_DAYS;
}

export const KIND_LABEL: Record<TaskKind, { en: string; so: string }> = {
  fault: { en: 'Fault', so: 'Cilada' },
  install: { en: 'Installation', so: 'Rakid' },
};

export const KIND_PLURAL: Record<TaskKind, { en: string; so: string }> = {
  fault: { en: 'Faults', so: 'Cilado' },
  install: { en: 'Installations', so: 'Rakid' },
};

/* -------------------------------------------------------------------------- */
/* The fault type                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The fixed list. Mirrors the CHECK constraint in migration 033.
 *
 * Deliberately small and physical: it is what a technician can tell apart at the
 * cabinet, not a taxonomy. Each entry says what it *means*, because "slow speed"
 * and "no signal" are easy to confuse on a phone call.
 */
export const FAULT_TYPES = [
  'no_signal',
  'slow_speed',
  'cut_cable',
  'faulty_box',
  'damaged_port',
  'loose_connector',
  'power',
  'other',
] as const;

export type FaultType = (typeof FAULT_TYPES)[number];

export const FAULT_TYPE_LABEL: Record<FaultType, { en: string; so: string; hint: { en: string; so: string } }> = {
  no_signal: {
    en: 'No signal',
    so: 'Calaamad ma jirto',
    hint: { en: 'Nothing at all — no light, no internet', so: 'Waxba ma jiro — iftiin ma leh, internet ma leh' },
  },
  slow_speed: {
    en: 'Slow speed',
    so: 'Xawaare gaabis ah',
    hint: { en: 'Connected but far below the plan', so: 'Wuu xiran yahay laakiin aad uga hooseeya qorshaha' },
  },
  cut_cable: {
    en: 'Cut cable',
    so: 'Xadhig go’ay',
    hint: { en: 'Physical break — a dig, a vehicle, a builder', so: 'Jabid jirka ah — qodid, gaadiid, dhise' },
  },
  faulty_box: {
    en: 'Box fault',
    so: 'Sanduuq xun',
    hint: { en: 'The cabinet or splitter itself', so: 'Sanduuqa ama kala-qaybiyaha laftiisa' },
  },
  damaged_port: {
    en: 'Damaged port',
    so: 'Deegaan xun',
    hint: { en: 'One port, the rest of the box is fine', so: 'Hal deegaan, sanduuqa intiisa kale waa fiican yahay' },
  },
  loose_connector: {
    en: 'Loose connector',
    so: 'Isku-xirid dabacsan',
    hint: { en: 'Re-seat it and test', so: 'Dib u dhig oo tijaabi' },
  },
  power: {
    en: 'No power',
    so: 'Koronto ma jirto',
    hint: { en: 'The customer side has no electricity', so: 'Dhinaca macmiilka koronto ma hayso' },
  },
  other: {
    en: 'Other',
    so: 'Kale',
    hint: { en: 'Not on this list — say what it is in the notes', so: 'Liiskan kuma jiro — ku qor faahfaahin' },
  },
};

export function faultTypeLabel(type: string | null | undefined, lang: 'en' | 'so'): string | null {
  if (!type) return null;
  const known = FAULT_TYPE_LABEL[type as FaultType];
  if (!known) return type.replace(/_/g, ' ');
  return known[lang];
}

/** Only a real value from the list is accepted; anything else reads as absent. */
export function asFaultType(value: unknown): FaultType | null {
  return typeof value === 'string' && (FAULT_TYPES as readonly string[]).includes(value)
    ? (value as FaultType)
    : null;
}

/* -------------------------------------------------------------------------- */
/* The fault queue                                                            */
/* -------------------------------------------------------------------------- */

export type FaultUrgency = 'breach' | 'due' | 'soon' | 'fresh';

/**
 * Whether a job says where it is.
 *
 * Deliberately the same test `hasRoute` in `dispatchBoard` uses, and written the
 * same way — an area or a box, trimming whitespace that a pasted sheet leaves
 * behind. It is duplicated rather than imported so `faults.ts` stays free of the
 * board's dependencies; `tests/faults.test.ts` asserts the two agree.
 */
export function hasPlace(task: Task): boolean {
  return Boolean(task.xaafada?.trim() || task.cablebox_code_raw?.trim());
}

export interface FaultRow {
  task: Task;
  /** Whole days since the customer reported it. `null` when there is no date. */
  days: number | null;
  urgency: FaultUrgency;
  type: FaultType | null;
  /**
   * Whether the job can be put on a route at all.
   *
   * The same test `clusterTasks` uses — an area or a box, nothing more. On
   * 24/11 thirteen of fifteen open faults failed it, which is why it is on the
   * row rather than left to the board to recompute: the count and the rows it
   * refers to must not be able to disagree.
   */
  place: boolean;
}

/**
 * Days a job has been open.
 *
 * Counted from the report date because that is what the customer measures from,
 * and floored at zero so a clock skew cannot produce a negative age that sorts
 * a brand-new job below an ancient one.
 */
export function faultAgeDays(task: Pick<Task, 'reported_date' | 'created_at'>, today: string): number | null {
  const from = task.reported_date ?? (task.created_at ? task.created_at.slice(0, 10) : null);
  if (!from) return null;

  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/**
 * How urgent a fault is, by its own clock.
 *
 * `breach` is past the two days — the promise is already broken and the customer
 * has noticed. `due` is the last day it can still be kept. The distinction
 * matters because one is an apology and the other is just work.
 */
export function faultUrgency(task: Pick<Task, 'task_type' | 'reported_date' | 'created_at'>, today: string): FaultUrgency {
  const days = faultAgeDays(task, today);
  if (days === null) return 'fresh';
  if (days > slaDays(task)) return 'breach';
  if (days === slaDays(task)) return 'due';
  if (days === slaDays(task) - 1) return 'soon';
  return 'fresh';
}

export const URGENCY_LABEL: Record<FaultUrgency, { en: string; so: string }> = {
  breach: { en: 'Promise broken', so: 'Ballan jabtay' },
  due: { en: 'Last day', so: 'Maalinta ugu dambaysa' },
  soon: { en: 'Due tomorrow', so: 'Berri ayay gaaraysaa' },
  fresh: { en: 'New', so: 'Cusub' },
};

/**
 * Faults in the order they should be worked.
 *
 * Broken promise first, then the oldest, then urgent-by-flag. Line number breaks
 * the final tie so the list never reshuffles between renders.
 *
 * Note the deliberate ordering choice: **age before the urgent flag**, which is
 * the opposite of the installation pool. A fault flagged urgent yesterday and a
 * fault that breached its promise four days ago are both urgent; the four-day-old
 * one is the customer who has already told three neighbours.
 */
export function faultQueue(tasks: readonly Task[], today: string): FaultRow[] {
  const rank: Record<FaultUrgency, number> = { breach: 0, due: 1, soon: 2, fresh: 3 };

  return tasks
    .filter((task) => taskKind(task) === 'fault')
    .filter((task) => task.status !== 'completed' && task.status !== 'cancelled')
    .map((task) => ({
      task,
      days: faultAgeDays(task, today),
      urgency: faultUrgency(task, today),
      type: asFaultType(task.fault_type),
      place: hasPlace(task),
    }))
    .sort((a, b) => {
      if (rank[a.urgency] !== rank[b.urgency]) return rank[a.urgency] - rank[b.urgency];
      const urgentFlag = Number(b.task.priority === 'urgent') - Number(a.task.priority === 'urgent');
      if (urgentFlag !== 0) return urgentFlag;
      // Unknown age last: unknown is not new.
      const aDays = a.days ?? -1;
      const bDays = b.days ?? -1;
      if (aDays !== bDays) return bDays - aDays;
      return a.task.line_number.localeCompare(b.task.line_number);
    });
}

export interface FaultSummary {
  open: number;
  breached: number;
  due: number;
  untyped: number;
  /** Faults with no area and no box: cannot be routed even if a crew were free. */
  unplaceable: number;
}

export function summariseFaults(rows: readonly FaultRow[]): FaultSummary {
  let breached = 0;
  let due = 0;
  let untyped = 0;
  let unplaceable = 0;

  for (const row of rows) {
    if (row.urgency === 'breach') breached += 1;
    if (row.urgency === 'due') due += 1;
    if (row.type === null) untyped += 1;
    // Reads the row's own verdict rather than re-deriving it: the button that
    // selects these rows filters on `row.place`, so a second test here could
    // count something the button does not select.
    if (!row.place) unplaceable += 1;
  }

  return { open: rows.length, breached, due, untyped, unplaceable };
}

/**
 * The sentence at the top of the fault list.
 *
 * Leads with the broken promise because that is the number that costs money, and
 * names the untracked ones separately because "we do not know what these are" is
 * a different problem from "we know and have not fixed them".
 */
export function faultSentence(summary: FaultSummary, lang: 'en' | 'so'): string {
  const so = lang === 'so';
  const { open, breached, due, untyped, unplaceable } = summary;

  if (open === 0) {
    return so ? 'Ma jiro cilado furan. Waxba ma jabin.' : 'No open faults. Nothing is broken.';
  }

  const parts: string[] = [];

  if (breached > 0) {
    parts.push(
      so
        ? `${breached} ka mid ah ${open} ayaa ballantii jabtay`
        : `${breached} of ${open} ${breached === 1 ? 'has' : 'have'} broken the promise`,
    );
  } else if (due > 0) {
    parts.push(
      so ? `${due} ayaa maanta gaaraya ballanta` : `${due} reach the promise today`,
    );
  } else {
    parts.push(so ? `${open} cilado oo furan, midna weli kama bixin` : `${open} open, none past it yet`);
  }

  if (untyped > 0) {
    parts.push(so ? `${untyped} aan nooca la qorin` : `${untyped} with no fault type`);
  }

  if (unplaceable > 0) {
    parts.push(so ? `${unplaceable} aan xaafad lahayn` : `${unplaceable} with no area`);
  }

  return `${parts.join(so ? ' · ' : ' · ')}.`;
}

/** Why a fault cannot be deleted, or null when it can. Mirrors `delete_task`. */
export function whyNoDelete(task: Task, logCount: number): { en: string; so: string } | null {
  /**
   * `logCount` is **work** logs, not provenance.
   *
   * The importer writes an `imported` row for every job it creates. Counting
   * those would make every freshly imported job undeletable, which is the exact
   * situation delete exists for — a bad import. Callers pass the number of
   * non-`imported` rows; the server applies the same filter.
   */
  if (task.status === 'completed' || task.completed_at) {
    return {
      en: 'A completed job can never be deleted. It is the record of work somebody did.',
      so: 'Shaqo dhammaatay weligeed lama tirtiri karo. Waa diiwaanka shaqo qof sameeyay.',
    };
  }
  /**
   * A job in flight is being worked on by definition.
   *
   * The column checks below catch this in practice — `in_progress` implies a
   * running timer — but a row whose status and timers disagree would otherwise
   * be deletable. The status is the plain statement of intent, so it is checked
   * first, and the server checks it too.
   */
  if (task.status === 'in_progress' || task.status === 'blocked') {
    return {
      en: 'This job has been started. Cancel it instead — the history is evidence.',
      so: 'Shaqadan waa la bilaabay. Tirtir halkii, jooji — taariikhdu waa caddayn.',
    };
  }
  if (
    task.assigned_user_id ||
    task.assigned_crew_id ||
    task.assigned_at ||
    task.active_started_at ||
    (task.accumulated_seconds ?? 0) > 0 ||
    task.blocked_at ||
    task.proof_photo_id ||
    logCount > 0
  ) {
    return {
      en: 'This job has been worked on. Cancel it instead — the history is evidence.',
      so: 'Shaqadan waa laga shaqeeyay. Tirtir halkii, jooji — taariikhdu waa caddayn.',
    };
  }
  return null;
}

/**
 * How a bulk delete of `tasks` would actually go.
 *
 * The sheet used to compute this inline, which meant the count a supervisor
 * reads ("3 can go, 5 will be kept") existed only inside a JSX expression and
 * could not be tested without a browser. Splitting it out makes the promise
 * checkable and keeps the sheet a renderer.
 *
 * The server is still the authority — this mirrors `delete_task`'s guards so the
 * button is not pressed in vain, and the sheet reports refusals anyway.
 */
export interface BulkDeletePlan {
  /** Jobs the server will accept a delete for. */
  deletable: Task[];
  /** Jobs that must be cancelled instead, with the reason already localised. */
  kept: Task[];
}

export function bulkDeletePlan(tasks: readonly Task[]): BulkDeletePlan {
  const deletable: Task[] = [];
  const kept: Task[] = [];

  for (const task of tasks) {
    // The second argument is the count of children; a bulk selection never
    // carries child rows, so the server's child guard is the one that catches
    // those. Passing 0 here means "we did not see any children".
    if (whyNoDelete(task, 0) === null) deletable.push(task);
    else kept.push(task);
  }

  return { deletable, kept };
}
