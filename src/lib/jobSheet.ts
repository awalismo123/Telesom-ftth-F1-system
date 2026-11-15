/**
 * The paper a technician carries into a building.
 *
 * ## Why this is assembled here and not in the component
 *
 * The rule that matters is **"omit what is empty"**. A printed sheet that says
 * `Port: —` teaches the person holding it that the dashes are noise, and then a
 * genuinely missing port number looks like everything else. So a field with no
 * value is not rendered at all, and this module decides that in one place where
 * it can be tested.
 *
 * ## What the dBm line can and cannot claim
 *
 * There is no per-job numeric target in the database — nobody recorded one. What
 * the app does have is the healthy window it uses everywhere (`dbmBand`: −27 …
 * −8 dBm). The sheet prints the reading, the window, and whether it falls
 * inside. It does **not** print a "target" it invented.
 */

import type { RouteTask } from './execution';
import { dbmBand, formatDbm } from './registry';

export interface SheetField {
  label: string;
  value: string;
  /** Rendered wider — notes and addresses need the room. */
  wide?: boolean;
}

export type Lang = 'en' | 'so';

/** The window the rest of the app treats as healthy. Not a per-job target. */
export const HEALTHY_WINDOW = { from: -27, to: -8 } as const;

/** Trimmed string, or `null` for anything that would print as a blank or a dash. */
function clean(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function dateTime(iso: string | null | undefined, lang: Lang): string | null {
  const value = clean(iso);
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const date = parsed.toISOString().slice(0, 10);
  const time = parsed.toISOString().slice(11, 16);
  return `${date} ${time}${lang === 'so' ? '' : ' UTC'}`;
}

function duration(seconds: number | null | undefined, lang: Lang): string | null {
  if (!seconds || seconds <= 0) return null;
  const total = Math.floor(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0) return lang === 'so' ? `${h} saac ${m} daq` : `${h}h ${m}m`;
  return lang === 'so' ? `${m} daqiiqo` : `${m} min`;
}

/** `cilada` → "Fault". Unknown types are printed as-is rather than guessed. */
export function typeLabel(taskType: string, lang: Lang): string {
  if (taskType === 'cilada') return lang === 'so' ? 'Cilad' : 'Fault';
  if (taskType === 'installation') return lang === 'so' ? 'Rakid' : 'Installation';
  return taskType;
}

/**
 * The reading, the window, and whether it is inside.
 *
 * Returns `null` when nothing was measured — the sheet then simply has no dBm
 * line, rather than a row of dashes that looks like a failed measurement.
 */
export function dbmAssessment(
  task: Pick<RouteTask, 'optical_dbm'>,
  lang: Lang,
): string | null {
  const reading = task.optical_dbm;
  if (reading === null || reading === undefined) return null;
  const band = dbmBand(reading);
  const state =
    band === 'healthy'
      ? lang === 'so'
        ? 'gudaha xadka caafimaadka'
        : 'inside the healthy range'
      : band === 'weak'
        ? lang === 'so'
          ? 'aad u liita'
          : 'too weak'
        : band === 'strong'
          ? lang === 'so'
            ? 'aad u xoog badan'
            : 'too strong'
          : '';
  const window =
    lang === 'so'
      ? `xadka ${HEALTHY_WINDOW.from} … ${HEALTHY_WINDOW.to} dBm`
      : `healthy ${HEALTHY_WINDOW.from} … ${HEALTHY_WINDOW.to} dBm`;
  return `${formatDbm(reading)} — ${state}, ${window}`;
}

/**
 * Everything that will be printed, in reading order.
 *
 * Empty fields never appear. The order is the order somebody at a door works
 * through: who, where, what, then the history and the clock.
 */
export function sheetFields(
  task: RouteTask,
  lang: Lang,
  assignee?: string | null,
): SheetField[] {
  const so = lang === 'so';
  const fields: SheetField[] = [];

  const push = (label: string, value: string | null, wide = false) => {
    if (value) fields.push({ label, value, ...(wide ? { wide: true } : {}) });
  };

  // who and where
  push(so ? 'Lambarka line' : 'Line number', clean(task.line_number));
  push(so ? 'Macmiilka' : 'Customer', clean(task.customer_name));
  push(so ? 'Taleefanka' : 'Phone', clean(task.customer_phone));
  push(so ? 'Xaafada' : 'Area', clean(task.xaafada));
  push(so ? 'Sanduuqa' : 'Cable box', clean(task.cablebox_code_raw));

  // port is a number; 0 is not a port
  push(
    so ? 'Port' : 'Port',
    task.port_number !== null && task.port_number !== undefined && task.port_number > 0
      ? String(task.port_number)
      : null,
  );

  // what
  push(so ? 'Nooca shaqada' : 'Job type', typeLabel(task.task_type, lang));
  push(so ? 'Prioritetka' : 'Priority', task.priority === 'urgent' ? (so ? 'Degdeg' : 'Urgent') : null);
  push(so ? 'Shaqaalaha' : 'Technician', clean(assignee));

  // when
  push(so ? 'La soo sheegay' : 'Reported', clean(task.reported_date));
  push(so ? 'La bilaabay' : 'Started', dateTime(task.active_started_at, lang));
  push(so ? 'La dhammeeyay' : 'Completed', dateTime(task.completed_at, lang));
  push(so ? 'Waqtiga la qaatay' : 'Time on job', duration(task.accumulated_seconds, lang));

  // result
  push(so ? 'Akhriska dBm' : 'dBm reading', dbmAssessment(task, lang));
  push(so ? 'Caqabad' : 'Blocker', clean(task.blocker_reason));
  push(so ? 'Qoraallo' : 'Notes', clean(task.completion_notes), true);

  return fields;
}

/**
 * How many fields actually carry a value.
 *
 * Used by a test to prove that a job with nothing recorded produces an almost
 * empty sheet rather than a page of dashes.
 */
export function filledCount(fields: readonly SheetField[]): number {
  return fields.filter((field) => field.value.trim() !== '').length;
}

export const SHEET_NOTE = {
  en: 'Printed from the Telesom F1 field system. Times are server times and count only the minutes a job was marked running — a blocker pauses the clock.',
  so: 'Waxaa laga daabacay nidaamka Telesom F1. Waqtiyadu waa waqtiga server-ka oo kaliya waxay tiriyaan daqiiqadaha shaqadu "socda" ku qornayd — caqabaddu way joojisaa saacadda.',
} as const;

/** A reference a supervisor can quote on the phone: the job id, shortened. */
export function jobReference(taskId: string): string {
  return `#${String(taskId).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}
