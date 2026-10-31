import React from 'react';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Clock,
  Flag,
  MapPin,
  PauseCircle,
  Phone,
  Play,
  RotateCcw,
  Signal,
} from 'lucide-react';
import type { RouteTask } from '../../lib/execution';
import {
  blockerById,
  elapsedSeconds,
  formatClock,
  taskWarnings,
} from '../../lib/execution';
import { formatPhoneE164, formatPhoneLocal } from '../../lib/dispatch';

interface Props {
  task: RouteTask;
  lang: 'so' | 'en';
  /** server-corrected "now" in ms */
  nowMs: number;
  onOpen: (task: RouteTask) => void;
  onQuickStart: (task: RouteTask) => void;
  onQuickResume: (task: RouteTask) => void;
}

export function RouteCard({ task, lang, nowMs, onOpen, onQuickStart, onQuickResume }: Props) {
  const so = lang === 'so';
  const running = task.status === 'in_progress';
  const blocked = task.status === 'blocked';
  const done = task.status === 'completed';
  const urgent = task.priority === 'urgent';
  const elapsed = elapsedSeconds(task, nowMs);
  const warnings = taskWarnings(task).slice(0, 2);
  const blocker = blockerById(task.blocker_reason);
  const phone = formatPhoneLocal(task.customer_phone);
  const tel = formatPhoneE164(task.customer_phone);

  return (
    <div
      className={`rounded-2xl border bg-white overflow-hidden transition ${
        running
          ? 'border-emerald-400 ring-2 ring-emerald-200'
          : blocked
            ? 'border-rose-200'
            : done
              ? 'border-slate-200 opacity-75'
              : 'border-slate-200'
      }`}
    >
      {/* status strip */}
      {running && (
        <div className="bg-emerald-600 text-white px-3 py-1.5 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            {so ? 'Socda' : 'Running'}
          </span>
          <span className="font-mono text-sm font-extrabold tabular-nums">{formatClock(elapsed)}</span>
        </div>
      )}
      {blocked && (
        <div className="bg-rose-50 text-rose-800 px-3 py-1.5 flex items-center gap-1.5 text-[11px] font-bold border-b border-rose-100">
          <PauseCircle className="w-3.5 h-3.5" />
          {blocker ? (so ? blocker.labelSo : blocker.labelEn) : so ? 'Caqabad' : 'Blocked'}
          {elapsed > 0 && <span className="ml-auto font-mono opacity-70">{formatClock(elapsed)}</span>}
        </div>
      )}
      {done && (
        <div className="bg-emerald-50 text-emerald-800 px-3 py-1.5 flex items-center gap-1.5 text-[11px] font-bold border-b border-emerald-100">
          <Check className="w-3.5 h-3.5" />
          {so ? 'Dhammaaday' : 'Completed'}
          <span className="ml-auto font-mono">{formatClock(elapsed)}</span>
          {task.optical_dbm !== null && (
            <span className="font-mono opacity-80">· {Number(task.optical_dbm).toFixed(1)} dBm</span>
          )}
        </div>
      )}

      <div className="p-3.5 space-y-2.5">
        {/* headline */}
        <button
          type="button"
          onClick={() => onOpen(task)}
          className="w-full text-left cursor-pointer"
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[11px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
              {task.line_number}
            </span>
            {urgent && !done && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-extrabold">
                <AlertTriangle className="w-2.5 h-2.5" />
                {so ? 'DEGDEG' : 'URGENT'}
              </span>
            )}
            {task.task_type === 'installation' ? (
              <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 text-[10px] font-bold">
                {so ? 'Galinta' : 'Install'}
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 text-[10px] font-bold">
                {so ? 'Cilada' : 'Fault'}
              </span>
            )}
            <ChevronRight className="w-3.5 h-3.5 text-slate-500 ml-auto" aria-hidden="true" />
          </div>

          <div className="mt-1 text-[15px] font-extrabold text-slate-900 leading-tight">
            {task.customer_name || '—'}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {task.cablebox_code_raw || task.xaafada || '—'}
              {task.port_number !== null && task.port_number !== undefined && (
                <span className="font-mono text-slate-500">· port {task.port_number}</span>
              )}
            </span>
            {task.speed_plan && (
              <span className="inline-flex items-center gap-1">
                <Signal className="w-3 h-3" />
                {task.speed_plan}
              </span>
            )}
            {!running && !done && elapsed > 0 && (
              <span className="inline-flex items-center gap-1 font-mono">
                <Clock className="w-3 h-3" />
                {formatClock(elapsed)}
              </span>
            )}
          </div>
        </button>

        {/* warnings */}
        {warnings.length > 0 && (
          <div className="space-y-1">
            {warnings.map((warning) => (
              <div
                key={warning.key}
                className={`flex items-start gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold ${
                  warning.tone === 'rose'
                    ? 'bg-rose-50 text-rose-800'
                    : warning.tone === 'amber'
                      ? 'bg-amber-50 text-amber-900'
                      : 'bg-sky-50 text-sky-800'
                }`}
              >
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>{so ? warning.textSo : warning.textEn}</span>
              </div>
            ))}
          </div>
        )}

        {/* actions */}
        <div className="flex items-center gap-2 pt-0.5">
          {phone && (
            <a
              href={tel ? `tel:${tel}` : undefined}
              className="inline-flex items-center justify-center gap-1.5 h-10 px-3 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-extrabold active:scale-95 transition"
            >
              <Phone className="w-4 h-4" />
              {phone}
            </a>
          )}

          {!done && !running && !blocked && (
            <button
              type="button"
              onClick={() => onQuickStart(task)}
              className="ml-auto inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-xl bg-emerald-700 text-white text-xs font-extrabold active:scale-95 transition cursor-pointer"
            >
              <Play className="w-4 h-4" />
              {so ? 'Bilow' : 'Start'}
            </button>
          )}

          {blocked && (
            <button
              type="button"
              onClick={() => onQuickResume(task)}
              className="ml-auto inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-xl bg-amber-600 text-white text-xs font-extrabold active:scale-95 transition cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              {so ? 'Sii wad' : 'Resume'}
            </button>
          )}

          {running && (
            <button
              type="button"
              onClick={() => onOpen(task)}
              className="ml-auto inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-xl bg-slate-900 text-white text-xs font-extrabold active:scale-95 transition cursor-pointer"
            >
              <Flag className="w-4 h-4" />
              {so ? 'Dhammee' : 'Finish'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
