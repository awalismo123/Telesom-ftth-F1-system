import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, Phone, Wrench } from 'lucide-react';
import { useLanguage } from '../../../lib/i18n';
import { todayKey } from '../../../lib/format';
import type { Task } from '../../../types/database';
import {
  FAULT_TYPE_LABEL,
  URGENCY_LABEL,
  faultQueue,
  faultSentence,
  faultTypeLabel,
  summariseFaults,
  type FaultRow,
  type FaultUrgency,
} from '../../../lib/faults';
import { cx } from '../../ui/cx';

/**
 * The fault board.
 *
 * ## Why a separate tab and not a filter
 *
 * A fault is a customer who is already paying and whose service has stopped. An
 * installation is a customer who has not paid yet. One has a 48-hour promise and
 * a business consequence that compounds hourly; the other is a booking.
 *
 * Mixing them in one pool means the fault competes with a job whose only
 * pressure is a calendar, and the person under pressure is the one holding the
 * phone. So they are two screens with two clocks, and this is the fault one.
 *
 * ## What it shows that the pool did not
 *
 * * **Its own clock** — 2 days, not 3, and the age before the urgent flag.
 * * **The fault type** — "cut cable" tells a dispatcher to route a splicer;
 *   "no signal" tells them to send somebody who can check the box.
 * * **How many have no type at all**, which is a task somebody can finish today
 *   with a bulk edit rather than a mystery to ignore.
 */

const URGENCY_STYLE: Record<FaultUrgency, { chip: string; row: string }> = {
  breach: { chip: 'bg-rose-100 text-rose-800', row: 'border-rose-200' },
  due: { chip: 'bg-amber-100 text-amber-900', row: 'border-amber-200' },
  soon: { chip: 'bg-amber-50 text-amber-800', row: 'border-slate-200' },
  fresh: { chip: 'bg-slate-100 text-slate-600', row: 'border-slate-200' },
};

export function FaultBoard({
  tasks,
  totalOpenFaults,
  lateFaults,
  untypedFaults,
  onOpenTask,
  onSelectMany,
}: {
  tasks: readonly Task[];
  totalOpenFaults: number | null;
  lateFaults: number | null;
  untypedFaults: number | null;
  onOpenTask: (taskId: string) => void;
  /** Opens the bulk editor with these jobs ticked. */
  onSelectMany: (taskIds: string[]) => void;
}) {
  const { lang } = useLanguage();
  const so = lang === 'so';
  const today = todayKey();

  const rows = useMemo(() => faultQueue(tasks, today), [tasks, today]);
  const summary = useMemo(() => summariseFaults(rows), [rows]);

  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const visible = typeFilter ? rows.filter((row) => row.type === typeFilter) : rows;

  /**
   * The header takes its counts from `today_summary` where available.
   *
   * The loaded list is capped at 600 rows while the summary counts every job in
   * the group, so a fault sitting behind the cap would be invisible here but
   * counted there. Preferring the server's number and saying when the list is
   * showing fewer is the same rule the dispatch board follows.
   */
  const openCount = totalOpenFaults ?? summary.open;
  const breachedCount = lateFaults ?? summary.breached;
  const untypedCount = untypedFaults ?? summary.untyped;
  const listIsPartial = openCount > rows.length;

  return (
    <section aria-labelledby="fault-heading" className="space-y-3">
      {/* Header */}
      <div className="rounded-2xl bg-slate-900 text-white p-3.5 sm:p-4">
        <div className="flex items-start gap-2">
          <span className="w-8 h-8 rounded-lg bg-rose-500/20 flex items-center justify-center shrink-0">
            <Wrench className="w-4 h-4 text-rose-300" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="fault-heading" className="text-sm font-extrabold leading-tight">
              {so ? 'Ciladaha' : 'Faults'}
            </h2>
            <p className="text-[10px] text-slate-200 mt-0.5 leading-snug">
              {so
                ? 'Ballanta cilada waa 2 maalmood — macmiilku wuu bixinayaa oo adeeggiisii joogsaday.'
                : 'A fault is promised in 2 days — the customer is already paying and their service has stopped.'}
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <FaultStat label={so ? 'Furan' : 'Open'} value={openCount} />
          <FaultStat
            label={so ? 'Ballan jabtay' : 'Past promise'}
            value={breachedCount}
            tone={breachedCount > 0 ? 'rose' : 'plain'}
          />
          <FaultStat
            label={so ? 'Nooc ma leh' : 'No type'}
            value={untypedCount}
            tone={untypedCount > 0 ? 'amber' : 'plain'}
          />
        </div>

        <p className="mt-2.5 text-[11px] font-semibold text-slate-200 leading-snug">
          {faultSentence(
            { ...summary, open: openCount, breached: breachedCount, untyped: untypedCount },
            lang,
          )}
        </p>

        {untypedCount > 0 && (
          <button
            type="button"
            onClick={() => onSelectMany(rows.filter((row) => row.type === null).map((row) => row.task.id))}
            className="mt-2 w-full min-h-11 rounded-xl bg-white/10 hover:bg-white/20 text-[11px] font-bold text-white transition cursor-pointer"
          >
            {so
              ? `Ku dar nooca ${untypedCount} cilado`
              : `Give ${untypedCount} ${untypedCount === 1 ? 'fault' : 'faults'} a type`}
          </button>
        )}
      </div>

      {listIsPartial && (
        <p className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
          {so
            ? `Liiskan wuxuu muujinayaa ${rows.length} oo keliya — waxaa jira ${openCount} cilado furan.`
            : `This list shows ${rows.length} of ${openCount} open faults.`}
        </p>
      )}

      {/* Type filter */}
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <TypeChip
            active={typeFilter === null}
            label={so ? 'Dhammaan' : 'All'}
            count={rows.length}
            onClick={() => setTypeFilter(null)}
          />
          {Object.entries(FAULT_TYPE_LABEL)
            .map(([key, meta]) => ({
              key,
              label: meta[lang === 'so' ? 'so' : 'en'],
              count: rows.filter((row) => row.type === key).length,
            }))
            .filter((entry) => entry.count > 0)
            .map((entry) => (
              <TypeChip
                key={entry.key}
                active={typeFilter === entry.key}
                label={entry.label}
                count={entry.count}
                onClick={() => setTypeFilter(entry.key)}
              />
            ))}
          {rows.some((row) => row.type === null) && (
            <TypeChip
              active={typeFilter === '__none'}
              label={so ? 'Nooc ma leh' : 'No type'}
              count={rows.filter((row) => row.type === null).length}
              onClick={() => setTypeFilter('__none')}
              tone="amber"
            />
          )}
        </div>
      )}

      {/* The queue */}
      {visible.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-4 text-[12px] font-semibold text-slate-500">
          {rows.length === 0
            ? so
              ? 'Ma jiro cilado furan.'
              : 'No open faults.'
            : so
              ? 'Noocan cilado kuma jiraan.'
              : 'No faults of that type.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((row) => (
            <FaultCard key={row.task.id} row={row} onOpen={() => onOpenTask(row.task.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FaultStat({
  label,
  value,
  tone = 'plain',
}: {
  label: string;
  value: number;
  tone?: 'plain' | 'rose' | 'amber';
}) {
  return (
    <div className="rounded-xl bg-white/10 p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-200 font-bold truncate">{label}</div>
      <div
        className={cx(
          'text-xl font-extrabold tabular',
          tone === 'rose' ? 'text-rose-300' : tone === 'amber' ? 'text-amber-300' : 'text-white',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function TypeChip({
  active,
  label,
  count,
  onClick,
  tone = 'plain',
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
  tone?: 'plain' | 'amber';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'min-h-11 px-2.5 rounded-xl border text-[11px] font-bold transition cursor-pointer',
        active
          ? 'bg-brand-700 border-brand-700 text-white'
          : tone === 'amber'
            ? 'bg-amber-50 border-amber-200 text-amber-900 hover:border-amber-300'
            : 'bg-white border-slate-200 text-slate-700 hover:border-brand-300',
      )}
    >
      {label}
      <span className={cx('ml-1.5 tabular', active ? 'text-brand-100' : 'text-slate-500')}>{count}</span>
    </button>
  );
}

function FaultCard({ row, onOpen }: { row: FaultRow; onOpen: () => void }) {
  const { lang } = useLanguage();
  const so = lang === 'so';
  const style = URGENCY_STYLE[row.urgency];
  const { task } = row;
  const place = task.cablebox_code_raw?.trim() || task.xaafada?.trim() || null;
  const phone = (task.customer_phone ?? '').replace(/[^\d+]/g, '');

  return (
    <li
      className={cx(
        'rounded-2xl border bg-white p-2.5 flex items-stretch gap-1.5',
        style.row,
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 text-left rounded-lg px-1 -mx-1 hover:bg-slate-50 transition cursor-pointer"
      >
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="font-mono text-[11px] font-extrabold text-slate-900">{task.line_number}</span>
          <span className="text-[11px] font-bold text-slate-800 truncate">
            {task.customer_name || '—'}
          </span>
          <span className={cx('text-[10px] font-extrabold px-1.5 py-0.5 rounded', style.chip)}>
            {URGENCY_LABEL[row.urgency][lang]}
          </span>
          {task.priority === 'urgent' && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-rose-600 text-white">
              <AlertTriangle className="w-2.5 h-2.5" aria-hidden="true" />
              {so ? 'DEGDEG' : 'URGENT'}
            </span>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-slate-600">
          {/* The fault type is the one field that changes who gets sent. */}
          <span
            className={cx(
              'font-bold',
              row.type === null ? 'text-amber-800' : 'text-slate-800',
            )}
          >
            {faultTypeLabel(row.type, lang) ?? (so ? 'Nooc lama qorin' : 'No type recorded')}
          </span>
          {place && <span className="truncate">{place}</span>}
          <span className="ml-auto font-semibold text-slate-500 shrink-0">
            {row.days === null
              ? so
                ? 'maalin lama garanayo'
                : 'age unknown'
              : row.days === 0
                ? so
                  ? 'maanta'
                  : 'today'
                : so
                  ? `${row.days} maalmood`
                  : `${row.days} ${row.days === 1 ? 'day' : 'days'}`}
          </span>
        </div>
      </button>

      {phone && (
        <a
          href={`tel:${phone}`}
          aria-label={`${so ? 'Wac' : 'Call'} ${task.customer_name ?? task.line_number}`}
          className="self-center shrink-0 inline-flex items-center justify-center w-11 min-h-11 rounded-xl text-brand-700 hover:bg-brand-50 transition"
        >
          <Phone className="w-4 h-4" aria-hidden="true" />
        </a>
      )}

      <button
        type="button"
        onClick={onOpen}
        aria-label={so ? 'Fur cilada' : 'Open fault'}
        className="self-center shrink-0 inline-flex items-center justify-center w-11 min-h-11 rounded-xl text-slate-500 hover:bg-slate-100 transition cursor-pointer"
      >
        <ChevronRight className="w-4 h-4" aria-hidden="true" />
      </button>
    </li>
  );
}
