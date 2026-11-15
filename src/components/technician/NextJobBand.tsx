import React from 'react';
import { AlertTriangle, ArrowRight, Flag, MapPin, Phone, Play, RotateCcw, Zap } from 'lucide-react';
import type { NextJob } from '../../lib/execution';
import { formatClock, elapsedSeconds } from '../../lib/execution';
import { formatPhoneE164, formatPhoneLocal } from '../../lib/dispatch';

/**
 * "Go here next."
 *
 * A technician's route is grouped by cablebox, because that is how the day is
 * planned and how a vehicle is loaded. It is not, however, the question someone
 * asks when they open the app at 07:30: they ask *which job is next*, and a
 * grouped list makes them answer that themselves by reading every card.
 *
 * So this band answers it, once, using the same order the list below already
 * uses — one primary action on the screen, not two.
 *
 * It is deliberately not a summary of the day. The three tiles underneath
 * already carry the counts; a number without an action is trivia.
 */
export interface NextJobBandProps {
  next: NextJob;
  lang: 'so' | 'en';
  nowMs: number;
  onStart: () => void;
  onOpen: () => void;
}

export function NextJobBand({ next, lang, nowMs, onStart, onOpen }: NextJobBandProps) {
  const so = lang === 'so';
  const { task, reason } = next;
  const phone = formatPhoneLocal(task.customer_phone);
  const tel = formatPhoneE164(task.customer_phone);
  const blockedFor = elapsedSeconds(task, nowMs);

  const heading = so ? 'Shaqada xigta' : 'Next job';
  const place = task.cablebox_code_raw || task.xaafada || '';

  /**
   * The reason drives the colour and the verb, because the three cases need
   * three different actions: a blocked job needs a decision, an urgent one
   * needs speed, a routine one needs nothing but a start.
   */
  const tone =
    reason === 'blocked'
      ? {
          shell: 'bg-amber-50 border-amber-300',
          chip: 'bg-amber-600 text-white',
          label: so ? 'Caqabad' : 'Blocked',
          icon: <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />,
        }
      : reason === 'urgent'
        ? {
            shell: 'bg-rose-50 border-rose-300',
            chip: 'bg-rose-600 text-white',
            label: so ? 'Degdeg' : 'Urgent',
            icon: <Zap className="w-3.5 h-3.5" aria-hidden="true" />,
          }
        : {
            shell: 'bg-brand-50 border-brand-300',
            chip: 'bg-brand-700 text-white',
            label: so ? 'Caadi' : 'Routine',
            icon: <MapPin className="w-3.5 h-3.5" aria-hidden="true" />,
          };

  return (
    <section
      aria-labelledby="next-job-heading"
      className={`rounded-2xl border ${tone.shell} overflow-hidden`}
    >
      <div className="px-3.5 pt-3 pb-2">
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wide ${tone.chip}`}
          >
            {tone.icon}
            {tone.label}
          </span>
          <span
            id="next-job-heading"
            className="text-[10px] font-extrabold uppercase tracking-wide text-slate-600"
          >
            {heading}
          </span>
        </div>

        <button
          type="button"
          onClick={onOpen}
          className="mt-1.5 w-full text-left cursor-pointer group"
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[11px] font-bold text-slate-700 bg-white/80 border border-slate-200 px-1.5 py-0.5 rounded">
              {task.line_number}
            </span>
            {task.task_type === 'installation' ? (
              <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 text-[10px] font-bold">
                {so ? 'Galinta' : 'Install'}
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 text-[10px] font-bold">
                {so ? 'Cilada' : 'Fault'}
              </span>
            )}
          </div>

          <div className="mt-1 text-[16px] font-extrabold text-slate-900 leading-tight group-hover:underline">
            {task.customer_name || '—'}
          </div>

          {place && (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-600">
              <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{place}</span>
              {task.port_number !== null && task.port_number !== undefined && (
                <span className="font-mono text-slate-500 shrink-0">· port {task.port_number}</span>
              )}
            </div>
          )}
        </button>

        {reason === 'blocked' && blockedFor > 0 && (
          <div className="mt-1.5 text-[11px] font-semibold text-amber-900">
            {so
              ? `Wuu xannibnaa ${formatClock(blockedFor)} — taabo Sii wad markaad diyaar tahay.`
              : `Blocked for ${formatClock(blockedFor)} — tap Resume when you can carry on.`}
          </div>
        )}
      </div>

      <div className="flex items-stretch border-t border-black/5">
        {phone ? (
          <a
            href={tel ? `tel:${tel}` : undefined}
            className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-11 text-xs font-extrabold text-slate-800 bg-white/70 hover:bg-white active:bg-white border-r border-black/5 transition"
          >
            <Phone className="w-4 h-4" aria-hidden="true" />
            {phone}
          </a>
        ) : null}

        <button
          type="button"
          onClick={onStart}
          className={`${
            phone ? 'shrink-0 px-4' : 'flex-1'
          } inline-flex items-center justify-center gap-1.5 min-h-11 text-xs font-extrabold text-white transition active:scale-[0.99] cursor-pointer ${
            reason === 'blocked'
              ? 'bg-amber-600 hover:bg-amber-700'
              : reason === 'urgent'
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-brand-700 hover:bg-brand-800'
          }`}
        >
          {reason === 'blocked' ? (
            <>
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              {so ? 'Sii wad' : 'Resume'}
            </>
          ) : (
            <>
              <Play className="w-4 h-4" aria-hidden="true" />
              {so ? 'Bilow' : 'Start'}
            </>
          )}
        </button>
      </div>
    </section>
  );
}
