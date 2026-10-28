import React from 'react';
import { AlertTriangle, Clock, MapPin, Phone, Repeat, Undo2, User } from 'lucide-react';
import type { Task } from '../../../types/database';
import { formatPhoneE164, formatPhoneLocal, taskPlace } from '../../../lib/dispatch';

interface Props {
  task: Task;
  lang: 'so' | 'en';
  selected?: boolean;
  onSelect?: (id: string) => void;
  /** compact = the dense card used inside a technician / crew lane */
  compact?: boolean;
  statusLabel?: string;
  onUnassign?: () => void;
  unassignLabel?: string;
}

const URGENT_LABEL = { en: 'URGENT', so: 'DEGDEG' } as const;
const CARRY_LABEL = { en: 'carried over', so: 'harsan' } as const;

export function TaskCard({
  task,
  lang,
  selected,
  onSelect,
  compact,
  statusLabel,
  onUnassign,
  unassignLabel,
}: Props) {
  const phone = formatPhoneLocal(task.customer_phone);
  const tel = formatPhoneE164(task.customer_phone);
  const place = taskPlace(task);
  const urgent = task.priority === 'urgent';
  const carry = (task.carryover_count ?? 0) > 0;

  return (
    <div
      className={`group rounded-xl border transition ${
        selected
          ? 'border-emerald-500 bg-emerald-50/60 ring-1 ring-emerald-400'
          : 'border-slate-200 bg-white hover:border-emerald-300'
      } ${compact ? 'p-2.5' : 'p-3'}`}
    >
      <div className="flex items-start gap-2.5">
        {onSelect && (
          <button
            type="button"
            onClick={() => onSelect(task.id)}
            aria-pressed={selected}
            className={`mt-0.5 w-5 h-5 shrink-0 rounded-md border-2 flex items-center justify-center transition cursor-pointer ${
              selected
                ? 'bg-emerald-600 border-emerald-600 text-white'
                : 'bg-white border-slate-300 hover:border-emerald-500'
            }`}
          >
            {selected && (
              <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.4}>
                <path d="M2 6.2 4.6 9 10 3.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[11px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
              {task.line_number}
            </span>
            {urgent && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-extrabold">
                <AlertTriangle className="w-2.5 h-2.5" />
                {URGENT_LABEL[lang]}
              </span>
            )}
            {carry && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                <Repeat className="w-2.5 h-2.5" />
                {CARRY_LABEL[lang]}
              </span>
            )}
            {statusLabel && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 text-[10px] font-bold">
                <Clock className="w-2.5 h-2.5" />
                {statusLabel}
              </span>
            )}
          </div>

          <div className={`mt-1 font-bold text-slate-900 leading-snug ${compact ? 'text-xs' : 'text-[13px]'}`}>
            {task.customer_name || '—'}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1 min-w-0">
              <MapPin className="w-3 h-3 shrink-0" />
              <span className="truncate">{place}</span>
              {task.port_number !== null && task.port_number !== undefined && (
                <span className="font-mono text-slate-400">·{task.port_number}</span>
              )}
            </span>

            {phone && (
              <a
                href={tel ? `tel:${tel}` : undefined}
                className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-900 font-semibold"
              >
                <Phone className="w-3 h-3" />
                {phone}
              </a>
            )}

            {task.task_type === 'installation' && (
              <span className="inline-flex items-center gap-1 text-slate-400">
                <User className="w-3 h-3" />
                {task.service_type || 'Fiber'}
              </span>
            )}
          </div>
        </div>

        {onUnassign && (
          <button
            type="button"
            onClick={onUnassign}
            title={unassignLabel}
            className="shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
