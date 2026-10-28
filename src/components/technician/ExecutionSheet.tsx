import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Clock,
  Loader2,
  MapPin,
  PauseCircle,
  Phone,
  Play,
  RotateCcw,
  Signal,
  User,
  X,
} from 'lucide-react';
import type { BlockerReason } from '../../types/database';
import type { RouteTask } from '../../lib/execution';
import {
  BLOCKERS,
  DBM_PRESETS,
  blockerById,
  dbmTone,
  elapsedSeconds,
  formatClock,
  parseDbm,
  taskWarnings,
} from '../../lib/execution';
import type { CompleteResult, WorkLogRow } from '../../lib/executionService';
import {
  blockTask,
  completeTask,
  fetchWorkLog,
  resumeTask,
  startTask,
} from '../../lib/executionService';
import { formatPhoneE164, formatPhoneLocal } from '../../lib/dispatch';
import { BoxSheet } from '../registry/BoxSheet';

type Mode = 'idle' | 'blocker' | 'complete' | 'confirm-start';

interface Props {
  task: RouteTask;
  token: string;
  lang: 'so' | 'en';
  nowMs: number;
  onClose: () => void;
  /** refresh the route after a successful action */
  onChanged: () => Promise<void> | void;
}

const ACTION_LABEL: Record<string, { en: string; so: string }> = {
  imported: { en: 'Imported', so: 'La soo geliyay' },
  assigned: { en: 'Assigned', so: 'La qaybiyay' },
  started: { en: 'Started', so: 'La bilaabay' },
  blocked: { en: 'Blocked', so: 'Caqabad' },
  resumed: { en: 'Resumed', so: 'La sii waday' },
  completed: { en: 'Completed', so: 'La dhammeeyay' },
  reopened: { en: 'Reopened', so: 'La furay' },
  unassigned: { en: 'Returned', so: 'La celiyay' },
};

function timeAgo(iso: string, lang: 'so' | 'en'): string {
  const diff = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  if (diff < 1) return lang === 'so' ? 'hadda' : 'just now';
  if (diff < 60) return lang === 'so' ? `${diff} daq` : `${diff}m ago`;
  const hours = Math.floor(diff / 60);
  if (hours < 24) return lang === 'so' ? `${hours} saac` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return lang === 'so' ? `${days} maalmood` : `${days}d ago`;
}

export function ExecutionSheet({ task, token, lang, nowMs, onClose, onChanged }: Props) {
  const so = lang === 'so';

  // Close on Escape and keep the page behind the sheet from scrolling.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<WorkLogRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showBox, setShowBox] = useState(false);

  // blocker form
  const [reason, setReason] = useState<BlockerReason>('customer_unreachable');
  const [blockerNotes, setBlockerNotes] = useState('');

  // completion form
  const [dbmInput, setDbmInput] = useState('');
  const [completionNotes, setCompletionNotes] = useState('');
  const [portInput, setPortInput] = useState('');
  const [done, setDone] = useState<CompleteResult | null>(null);

  // confirm-start list
  const [otherRunning, setOtherRunning] = useState<
    { id: string; line_number: string; customer_name: string }[]
  >([]);

  const elapsed = elapsedSeconds(task, nowMs);
  const warnings = taskWarnings(task);
  const running = task.status === 'in_progress';
  const blocked = task.status === 'blocked';
  const completed = task.status === 'completed';

  const dbmCheck = useMemo(() => parseDbm(dbmInput), [dbmInput]);
  const blocker = blockerById(task.blocker_reason);

  useEffect(() => {
    let cancelled = false;
    void fetchWorkLog(task.id)
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch(() => {
        /* history is a nicety, never block the job */
      });
    return () => {
      cancelled = true;
    };
  }, [task.id, task.status]);

  const refresh = async () => {
    await onChanged();
  };

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  const doStart = async (confirm: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await startTask(token, task.id, confirm);
      if (result.needs_confirmation) {
        setOtherRunning(result.other_running ?? []);
        setMode('confirm-start');
        return;
      }
      setMode('idle');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the job');
    } finally {
      setBusy(false);
    }
  };

  const doResume = async () => {
    setBusy(true);
    setError(null);
    try {
      await resumeTask(token, task.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resume the job');
    } finally {
      setBusy(false);
    }
  };

  const doBlock = async () => {
    if (reason === 'other' && !blockerNotes.trim()) {
      setError(so ? 'Sharax dhibaatada marka hore.' : 'Please describe the problem first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await blockTask({
        token,
        taskId: task.id,
        reason,
        notes: blockerNotes.trim() || undefined,
      });
      setMode('idle');
      setBlockerNotes('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the blocker');
    } finally {
      setBusy(false);
    }
  };

  const doComplete = async () => {
    if (dbmCheck.value === null) {
      setError(dbmCheck.error ?? (so ? 'Geli cabbirka dBm.' : 'Enter the dBm reading.'));
      return;
    }

    const port = portInput.trim() ? Number(portInput.trim()) : null;
    if (port !== null && (!Number.isFinite(port) || port < 1 || port > 64)) {
      setError(so ? 'Port-ku ma saxna.' : 'That port number is not valid.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await completeTask({
        token,
        taskId: task.id,
        dbm: dbmCheck.value,
        notes: completionNotes.trim() || undefined,
        portNumber: port,
      });
      setDone(result);
      setMode('idle');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete the job');
    } finally {
      setBusy(false);
    }
  };

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onMouseDown={(event) => {
        // Only a tap on the backdrop itself closes the sheet, never a drag out of a field.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="bg-slate-50 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[94vh] flex flex-col">
        {/* header */}
        <div className="bg-white rounded-t-3xl border-b border-slate-100 px-4 py-3 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-mono text-[11px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                {task.line_number}
              </span>
              {task.priority === 'urgent' && (
                <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-extrabold">
                  {so ? 'DEGDEG' : 'URGENT'}
                </span>
              )}
              <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 text-[10px] font-bold">
                {task.task_type === 'installation'
                  ? so
                    ? 'Galinta'
                    : 'Installation'
                  : so
                    ? 'Cilada'
                    : 'Fault'}
              </span>
            </div>
            <h2 className="mt-1 text-[16px] font-extrabold text-slate-900 leading-tight">
              {task.customer_name || '—'}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {task.cablebox_code_raw || task.xaafada || '—'}
                {task.port_number !== null && task.port_number !== undefined && (
                  <span className="font-mono text-slate-400">· port {task.port_number}</span>
                )}
              </span>
              {task.service_type && (
                <span className="inline-flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {task.service_type}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mr-1 rounded-xl text-slate-400 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3 space-y-3">
          {/* call + meta */}
          <div className="flex gap-2">
            {task.customer_phone && (
              <a
                href={`tel:${formatPhoneE164(task.customer_phone)}`}
                className="flex-1 inline-flex items-center justify-center gap-2 h-12 rounded-2xl bg-emerald-700 text-white text-sm font-extrabold active:scale-95 transition"
              >
                <Phone className="w-4 h-4" />
                {formatPhoneLocal(task.customer_phone)}
              </a>
            )}
            {task.speed_plan && (
              <div className="inline-flex items-center gap-1.5 px-3 rounded-2xl bg-white border border-slate-200 text-xs font-bold text-slate-700">
                <Signal className="w-3.5 h-3.5 text-emerald-700" />
                {task.speed_plan}
              </div>
            )}
          </div>

          {/* warnings */}
          {warnings.length > 0 && (
            <div className="space-y-1.5">
              {warnings.map((warning) => (
                <div
                  key={warning.key}
                  className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold ${
                    warning.tone === 'rose'
                      ? 'bg-rose-50 text-rose-800 border border-rose-100'
                      : warning.tone === 'amber'
                        ? 'bg-amber-50 text-amber-900 border border-amber-100'
                        : 'bg-sky-50 text-sky-800 border border-sky-100'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{so ? warning.textSo : warning.textEn}</span>
                </div>
              ))}
            </div>
          )}

          {/* box history shortcut */}
          {task.cablebox_id && (
            <button
              type="button"
              onClick={() => setShowBox(true)}
              className="w-full inline-flex items-center justify-between gap-2 px-3 h-10 rounded-2xl bg-white border border-slate-200 text-[11px] font-bold text-slate-700 active:scale-[0.99] transition cursor-pointer"
            >
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-emerald-700" />
                {so ? 'Taariikhda sanduuqa' : 'Box history'}
                <span className="font-mono text-slate-400">{task.cablebox_code_raw}</span>
              </span>
              <span className="text-slate-400">›</span>
            </button>
          )}

          {/* timer */}
          <div
            className={`rounded-2xl p-4 text-center ${
              running ? 'bg-emerald-950 text-white' : 'bg-white border border-slate-200'
            }`}
          >
            <div
              className={`text-[10px] font-bold uppercase tracking-widest ${
                running ? 'text-emerald-300' : 'text-slate-400'
              }`}
            >
              {completed
                ? so
                  ? 'Waqtiga la qaatay'
                  : 'Time taken'
                : running
                  ? so
                    ? 'Saacaddu waa socotaa'
                    : 'Timer running'
                  : so
                    ? 'Waqti la ururiyay'
                    : 'Time recorded'}
            </div>
            <div
              className={`font-mono text-4xl font-extrabold tabular-nums mt-1 ${
                running ? 'text-white' : 'text-slate-900'
              }`}
            >
              {formatClock(elapsed)}
            </div>
            {blocked && (
              <div className="mt-1 text-[11px] font-bold text-rose-600">
                {so ? 'Joogsan — ' : 'Paused — '}
                {blocker ? (so ? blocker.labelSo : blocker.labelEn) : ''}
              </div>
            )}
            {task.blocker_notes && blocked && (
              <div className="mt-1 text-[11px] text-slate-500 italic">“{task.blocker_notes}”</div>
            )}
            {completed && task.optical_dbm !== null && (
              <div className="mt-1 text-[11px] font-bold text-emerald-700">
                {Number(task.optical_dbm).toFixed(2)} dBm
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-[11px] font-semibold text-rose-800">
              {error}
            </div>
          )}

          {/* success */}
          {done && (
            <div className="rounded-2xl bg-emerald-600 text-white p-4 text-center space-y-1">
              <CheckCheck className="w-7 h-7 mx-auto" />
              <div className="text-sm font-extrabold">{so ? 'Shaqadu waa dhammaatay' : 'Job completed'}</div>
              <div className="text-[11px] text-emerald-100">
                {so ? 'Waqti' : 'Duration'} {formatClock(done.duration_seconds)} ·{' '}
                {done.optical_dbm.toFixed(2)} dBm
              </div>
            </div>
          )}

          {/* actions */}
          {!completed && mode === 'idle' && !done && (
            <div className="space-y-2">
              {!running && !blocked && (
                <button
                  type="button"
                  onClick={() => void doStart(false)}
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-2 h-14 rounded-2xl bg-emerald-700 text-white text-sm font-extrabold active:scale-[0.98] transition disabled:opacity-60 cursor-pointer"
                >
                  {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                  {so ? 'Bilow shaqada' : 'Start the job'}
                </button>
              )}

              {running && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMode('blocker')}
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-1.5 h-12 rounded-2xl bg-amber-100 text-amber-900 border border-amber-200 text-xs font-extrabold active:scale-95 transition cursor-pointer"
                  >
                    <PauseCircle className="w-4 h-4" />
                    {so ? 'Caqabad' : 'Blocker'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('complete')}
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-1.5 h-12 rounded-2xl bg-emerald-700 text-white text-xs font-extrabold active:scale-95 transition cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    {so ? 'Dhammee' : 'Complete'}
                  </button>
                </div>
              )}

              {blocked && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void doResume()}
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-1.5 h-12 rounded-2xl bg-amber-600 text-white text-xs font-extrabold active:scale-95 transition cursor-pointer"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                    {so ? 'Sii wad' : 'Resume'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('complete')}
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-1.5 h-12 rounded-2xl bg-white border border-emerald-300 text-emerald-800 text-xs font-extrabold active:scale-95 transition cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    {so ? 'Dhammee' : 'Complete'}
                  </button>
                </div>
              )}
            </div>
          )}

          {done && (
            <button
              type="button"
              onClick={onClose}
              className="w-full h-12 rounded-2xl bg-slate-900 text-white text-xs font-extrabold cursor-pointer"
            >
              {so ? 'Xir' : 'Done'}
            </button>
          )}

          {/* ---------------------------------------------------------- */}
          {/* Blocker picker                                             */}
          {/* ---------------------------------------------------------- */}
          {mode === 'blocker' && (
            <div className="rounded-2xl bg-white border border-slate-200 p-3 space-y-2">
              <div className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400">
                {so ? 'Maxaa ku hor istaagay?' : 'What is blocking you?'}
              </div>

              {BLOCKERS.map((item) => {
                const active = reason === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setReason(item.id)}
                    className={`w-full text-left rounded-xl border px-3 py-2.5 transition cursor-pointer ${
                      active
                        ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-300'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-4 h-4 rounded-full border-2 shrink-0 ${
                          active ? 'border-emerald-600 bg-emerald-600' : 'border-slate-300'
                        }`}
                      >
                        {active && <Check className="w-3 h-3 text-white mx-auto -mt-0.5" />}
                      </span>
                      <span className="text-[13px] font-extrabold text-slate-900">
                        {so ? item.labelSo : item.labelEn}
                      </span>
                    </div>
                    <div className="mt-0.5 pl-6 text-[11px] text-slate-500">
                      {so ? item.hintSo : item.hintEn}
                    </div>
                    {active && (
                      <div className="mt-1 pl-6 text-[11px] font-semibold text-emerald-800">
                        {so ? item.actionSo : item.actionEn}
                      </div>
                    )}
                  </button>
                );
              })}

              <textarea
                value={blockerNotes}
                onChange={(e) => setBlockerNotes(e.target.value)}
                rows={2}
                placeholder={
                  reason === 'other'
                    ? so
                      ? 'Sharax dhibaatada (waa qasab)'
                      : 'Describe the problem (required)'
                    : so
                      ? 'Faahfaahin (ikhtiyaari)'
                      : 'Notes (optional)'
                }
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('idle')}
                  className="flex-1 h-11 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  {so ? 'Jooji' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={() => void doBlock()}
                  disabled={busy}
                  className="flex-[2] inline-flex items-center justify-center gap-1.5 h-11 rounded-xl bg-amber-600 text-white text-xs font-extrabold disabled:opacity-60 cursor-pointer"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PauseCircle className="w-4 h-4" />}
                  {so ? 'Xaqiiji caqabadda' : 'Save blocker'}
                </button>
              </div>
              <p className="text-[10px] text-slate-400 text-center">
                {so
                  ? 'Saacaddu way joogsanaysaa; shaqadu waxay ku sii jirtaa liiska.'
                  : 'The clock stops; the job stays on your list as Blocked.'}
              </p>
            </div>
          )}

          {/* ---------------------------------------------------------- */}
          {/* Completion form                                            */}
          {/* ---------------------------------------------------------- */}
          {mode === 'complete' && (
            <div className="rounded-2xl bg-white border border-slate-200 p-3 space-y-3">
              <div className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400">
                {so ? 'Dhamaystirka shaqada' : 'Complete the job'}
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600">
                  {so ? 'Cabbirka dBm (qasab)' : 'Optical dBm reading (required)'}
                </label>
                <input
                  value={dbmInput}
                  onChange={(e) => setDbmInput(e.target.value)}
                  inputMode="decimal"
                  placeholder="-21.5"
                  className={`mt-1 w-full h-14 rounded-2xl border-2 px-3 text-center font-mono text-2xl font-extrabold focus:outline-none ${
                    dbmInput === ''
                      ? 'border-slate-200 text-slate-900'
                      : dbmCheck.value === null
                        ? 'border-rose-300 text-rose-700'
                        : dbmTone(dbmCheck.value) === 'good'
                          ? 'border-emerald-500 text-emerald-800'
                          : dbmTone(dbmCheck.value) === 'bad'
                            ? 'border-amber-500 text-amber-800'
                            : 'border-sky-400 text-sky-800'
                  }`}
                />
                <div className="mt-1 flex flex-wrap gap-1">
                  {DBM_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setDbmInput(String(preset))}
                      className="px-2 py-1 rounded-lg bg-slate-100 text-[11px] font-mono font-bold text-slate-600 active:scale-95 cursor-pointer"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                {dbmCheck.error && (
                  <p className="mt-1 text-[11px] font-semibold text-rose-700">{dbmCheck.error}</p>
                )}
                {dbmCheck.warning && (
                  <p className="mt-1 text-[11px] font-semibold text-amber-700">⚠ {dbmCheck.warning}</p>
                )}
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600">
                  {so ? 'Port (haddii la beddelay)' : 'Port (if changed)'}
                </label>
                <input
                  value={portInput}
                  onChange={(e) => setPortInput(e.target.value)}
                  inputMode="numeric"
                  placeholder={
                    task.port_number !== null && task.port_number !== undefined
                      ? String(task.port_number)
                      : '—'
                  }
                  className="mt-1 w-full h-11 rounded-xl border border-slate-200 px-3 text-center font-mono text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600">
                  {so ? 'Maxaad samaysay?' : 'What did you do?'}
                </label>
                <textarea
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  rows={3}
                  placeholder={
                    so ? 'Tusaale: fiilo cusub, connector la nadiifiyay…' : 'e.g. new drop cable, cleaned connector…'
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('idle')}
                  className="flex-1 h-12 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  {so ? 'Jooji' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={() => void doComplete()}
                  disabled={busy || dbmCheck.value === null}
                  className="flex-[2] inline-flex items-center justify-center gap-1.5 h-12 rounded-xl bg-emerald-700 text-white text-xs font-extrabold disabled:opacity-50 cursor-pointer"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {so ? 'Dhammee shaqada' : 'Complete job'}
                </button>
              </div>
            </div>
          )}

          {/* ---------------------------------------------------------- */}
          {/* Multiple-timer confirmation                                */}
          {/* ---------------------------------------------------------- */}
          {mode === 'confirm-start' && (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3 space-y-2">
              <div className="flex items-start gap-2 text-[12px] font-bold text-amber-900">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                {so
                  ? 'Shaqo kale ayaa saacaddeeda socota'
                  : 'You already have another job running'}
              </div>
              <ul className="space-y-1">
                {otherRunning.map((row) => (
                  <li key={row.id} className="text-[11px] text-amber-900 font-semibold">
                    · {row.line_number} — {row.customer_name}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-amber-800">
                {so
                  ? 'Haddii aad sii waddo, labada saacadood way wada socon doonaan.'
                  : 'If you continue, both clocks will run at the same time.'}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('idle')}
                  className="flex-1 h-11 rounded-xl bg-white border border-amber-300 text-amber-900 text-xs font-bold cursor-pointer"
                >
                  {so ? 'Jooji' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={() => void doStart(true)}
                  disabled={busy}
                  className="flex-[2] inline-flex items-center justify-center gap-1.5 h-11 rounded-xl bg-amber-600 text-white text-xs font-extrabold disabled:opacity-60 cursor-pointer"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  {so ? 'Sii wad — labadaba' : 'Start anyway'}
                </button>
              </div>
            </div>
          )}

          {/* ---------------------------------------------------------- */}
          {/* History                                                    */}
          {/* ---------------------------------------------------------- */}
          {history.length > 0 && (
            <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="w-full px-3 py-2.5 flex items-center justify-between text-[11px] font-extrabold uppercase tracking-wide text-slate-400 cursor-pointer"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  {so ? 'Taariikhda shaqada' : 'Job history'}
                </span>
                <span className="text-slate-300">{showHistory ? '−' : '+'}</span>
              </button>

              {showHistory && (
                <ul className="border-t border-slate-100 divide-y divide-slate-100">
                  {history.map((row) => {
                    const label = ACTION_LABEL[row.action] ?? { en: row.action, so: row.action };
                    const blockerRow = blockerById(row.blocker_reason);
                    return (
                      <li key={row.id} className="px-3 py-2 flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-bold text-slate-800">
                            {so ? label.so : label.en}
                            {row.session_seconds > 0 && (
                              <span className="ml-1 font-mono font-normal text-slate-500">
                                {formatClock(row.session_seconds)}
                              </span>
                            )}
                            {row.optical_dbm !== null && (
                              <span className="ml-1 font-mono font-normal text-emerald-700">
                                {Number(row.optical_dbm).toFixed(1)} dBm
                              </span>
                            )}
                          </div>
                          {blockerRow && (
                            <div className="text-[10px] text-rose-700 font-semibold">
                              {so ? blockerRow.labelSo : blockerRow.labelEn}
                            </div>
                          )}
                          {row.notes && (
                            <div className="text-[10px] text-slate-500 italic">“{row.notes}”</div>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 shrink-0">
                          {timeAgo(row.created_at, lang)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {showBox && task.cablebox_id && (
        <BoxSheet
          boxId={task.cablebox_id}
          token={token}
          lang={lang}
          canEdit
          onClose={() => setShowBox(false)}
        />
      )}
    </div>
  );
}
