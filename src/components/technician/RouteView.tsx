import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeError } from '../../lib/useErrorMessage';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  MapPin,
  Play,
  RefreshCw,
  RotateCcw,
  Route as RouteIcon,
  Timer,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n';
import type { RouteTask } from '../../lib/execution';
import {
  elapsedSeconds,
  formatClock,
  groupRoute,
  routeStats,
  serverOffsetMs,
  sortRoute,
} from '../../lib/execution';
import { fetchRoute, resumeTask, startTask } from '../../lib/executionService';
import { useNow } from '../../lib/useNow';
import { useTableChanges, useVisibleInterval } from '../../lib/realtime';
import { RouteCard } from './RouteCard';
import { ExecutionSheet } from './ExecutionSheet';
import { useToast } from '../ui/Toast';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';

interface ConfirmState {
  task: RouteTask;
  others: { id: string; line_number: string; customer_name: string }[];
}

export function RouteView({
  focusTaskId = null,
  focusNonce = 0,
}: {
  focusTaskId?: string | null;
  focusNonce?: number;
}) {
  const { session, activeGroup } = useAuth();
  const { lang } = useLanguage();
  const so = lang === 'so';

  const token = session?.token ?? '';

  const [tasks, setTasks] = useState<RouteTask[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [showDone, setShowDone] = useState(false);
  const toast = useToast();

  // A search result or a notification asked for one specific job.
  useEffect(() => {
    if (focusTaskId) setOpenTaskId(focusTaskId);
  }, [focusTaskId, focusNonce]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (!token) return;
      if (!silent) setLoading(true);
      try {
        const receivedAt = Date.now();
        const data = await fetchRoute(token);
        if (!mounted.current) return;
        setTasks(data.tasks);
        setOffset(serverOffsetMs(data.server_now, receivedAt));
        setError(null);
      } catch (err) {
        if (!mounted.current) return;
        setError(describeError(err, lang));
      } finally {
        if (mounted.current && !silent) setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Freshness without polling.
   *
   * A new assignment, a supervisor's reassignment or another crew member
   * finishing a shared job all arrive as a Postgres change. The fallback poll
   * is deliberately slow (3 min) and only runs while the tab is visible — the
   * old code polled every 60 s and kept a hidden tab awake.
   */
  useTableChanges({
    table: 'tasks',
    filter: activeGroup?.id ? `group_id=eq.${activeGroup.id}` : undefined,
    enabled: Boolean(token),
    onChange: () => void load(true),
  });

  useVisibleInterval(() => void load(true), 180_000, Boolean(token));

  const hasRunning = tasks.some((task) => task.status === 'in_progress');
  const now = useNow(hasRunning);
  const nowMs = now + offset;

  const stats = useMemo(() => routeStats(tasks), [tasks]);
  const sections = useMemo(() => groupRoute(tasks, lang), [tasks, lang]);
  const completedToday = useMemo(
    () =>
      sortRoute(tasks).filter(
        (task) =>
          task.status === 'completed' &&
          (task.completed_at ?? '').slice(0, 10) === new Date().toISOString().slice(0, 10),
      ),
    [tasks],
  );

  const openTask = tasks.find((task) => task.id === openTaskId) ?? null;

  /**
   * A search result can be any job in the group — including one that is not
   * this technician's. Opening nothing would look like a broken button, so say
   * what happened, once.
   */
  const missingFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!focusTaskId || loading) return;
    if (tasks.some((task) => task.id === focusTaskId)) return;
    if (missingFocus.current === focusTaskId) return;
    missingFocus.current = focusTaskId;
    toast.info(
      so ? 'Shaqadan kama jirto safarkaaga' : 'That job is not on your route',
      {
        description: so
          ? 'Waxaa laga yaabaa in loo qoondeeyay farsamayaqaan kale.'
          : 'It may be assigned to another technician.',
      },
    );
  }, [focusTaskId, loading, tasks, so, toast]);

  const quickStart = async (task: RouteTask) => {
    setBusyId(task.id);
    setError(null);
    try {
      const result = await startTask(token, task.id, false);
      if (result.needs_confirmation) {
        setConfirm({ task, others: result.other_running ?? [] });
        return;
      }
      toast.success(so ? 'Waqtiga waa bilaabmay' : 'Timer started', {
        description: `${task.line_number} · ${task.customer_name}`,
      });
      await load(true);
    } catch (err) {
      setError(describeError(err, lang));
    } finally {
      setBusyId(null);
    }
  };

  const quickResume = async (task: RouteTask) => {
    setBusyId(task.id);
    setError(null);
    try {
      await resumeTask(token, task.id);
      toast.success(so ? 'Waqtiga wuu sii socday' : 'Timer resumed', {
        description: `${task.line_number}`,
      });
      await load(true);
    } catch (err) {
      setError(describeError(err, lang));
    } finally {
      setBusyId(null);
    }
  };

  if (!session) return null;

  return (
    <div className="space-y-4">
      {/* summary */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-white border border-slate-200 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {so ? 'Furan' : 'Open'}
          </div>
          <div className="text-2xl font-extrabold text-slate-900">{stats.open}</div>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {so ? 'Degdeg' : 'Urgent'}
          </div>
          <div className={`text-2xl font-extrabold ${stats.urgent > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
            {stats.urgent}
          </div>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {so ? 'Maanta' : 'Done today'}
          </div>
          <div className="text-2xl font-extrabold text-emerald-700">{stats.doneToday}</div>
        </div>
      </div>

      {error && (
        <Alert
          tone="danger"
          action={
            <Button variant="ghost" size="sm" onClick={() => void load()} className="underline">
              {so ? 'Isku day' : 'Retry'}
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-500 inline-flex items-center gap-1.5">
          <RouteIcon className="w-3.5 h-3.5" />
          {so ? 'Jidkayga maanta' : 'My route today'}
          {stats.running > 0 && (
            <span className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-extrabold">
              <Timer className="w-3 h-3" />
              {stats.running}
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={() => void load()}
          className="p-2 rounded-xl text-slate-500 hover:bg-white hover:text-slate-600 cursor-pointer"
          title={so ? 'Cusbooneysii' : 'Refresh'}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading && tasks.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <Loader2 className="w-6 h-6 text-emerald-700 animate-spin mx-auto mb-2" />
          <p className="text-xs text-slate-500">{so ? 'Jidkaaga waa la soo dejinayaa…' : 'Loading your route…'}</p>
        </div>
      )}

      {!loading && stats.open === 0 && (
        <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-8 text-center space-y-2">
          <RouteIcon className="w-7 h-7 text-slate-500 mx-auto" aria-hidden="true" />
          <p className="text-xs font-semibold text-slate-600">
            {so ? 'Maanta shaqo laguu qoondeynin.' : 'Nothing assigned to you right now.'}
          </p>
          <p className="text-[11px] text-slate-500">
            {so
              ? 'Marka kormeeruhu shaqo kuu qaybiyo, halkan ayay ka soo muuqan doontaa.'
              : 'As soon as the supervisor dispatches work to you or your crew, it appears here.'}
          </p>
        </div>
      )}

      {/* running jobs first, grouped by box / area */}
      {sections.map((section) => (
        <div key={section.key} className="space-y-2">
          <div className="flex items-center gap-1.5 px-1 pt-1">
            <MapPin className="w-3.5 h-3.5 text-emerald-700" />
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-600">
              {section.label}
            </span>
            {section.sublabel && (
              <span className="text-[11px] text-slate-500">· {section.sublabel}</span>
            )}
            <span className="ml-auto text-[10px] font-bold text-slate-500">
              {section.tasks.length} {so ? 'shaqo' : section.tasks.length === 1 ? 'job' : 'jobs'}
            </span>
          </div>

          {section.tasks.map((task) => (
            <div key={task.id} className={busyId === task.id ? 'opacity-60 pointer-events-none' : ''}>
              <RouteCard
                task={task}
                lang={lang}
                nowMs={nowMs}
                onOpen={(t) => setOpenTaskId(t.id)}
                onQuickStart={(t) => void quickStart(t)}
                onQuickResume={(t) => void quickResume(t)}
              />
            </div>
          ))}
        </div>
      ))}

      {/* completed today */}
      {completedToday.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="w-full flex items-center gap-1.5 px-1 py-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-500 cursor-pointer"
          >
            {showDone ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {so ? 'Maanta la dhammeeyay' : 'Completed today'} · {completedToday.length}
          </button>

          {showDone &&
            completedToday.map((task) => (
              <RouteCard
                key={task.id}
                task={task}
                lang={lang}
                nowMs={nowMs}
                onOpen={(t) => setOpenTaskId(t.id)}
                onQuickStart={() => undefined}
                onQuickResume={() => undefined}
              />
            ))}
        </div>
      )}

      {/* running timers summary, always visible at the bottom of the list */}
      {stats.running > 0 && (
        <div className="rounded-2xl bg-emerald-950 text-white p-3 flex items-center gap-3">
          <Timer className="w-5 h-5 text-emerald-300 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold text-emerald-200">
              {stats.running === 1
                ? so
                  ? '1 shaqo ayaa socota'
                  : '1 job running'
                : so
                  ? `${stats.running} shaqo ayaa socda`
                  : `${stats.running} jobs running`}
            </div>
            <div className="text-[10px] text-emerald-300/80 font-mono">
              {tasks
                .filter((task) => task.status === 'in_progress')
                .map((task) => `${task.line_number} ${formatClock(elapsedSeconds(task, nowMs))}`)
                .join('  ·  ')}
            </div>
          </div>
        </div>
      )}

      {/* multiple-timer confirmation */}
      {confirm && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center">
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-4 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-extrabold text-slate-900">
                  {so ? 'Shaqo kale ayaa socota' : 'Another job is already running'}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {so
                    ? 'Haddii aad bilowdo, labada saacadood way wada socon doonaan.'
                    : 'If you start this one, both clocks will run at the same time.'}
                </div>
              </div>
            </div>

            <ul className="rounded-xl bg-amber-50 border border-amber-200 p-2.5 space-y-1">
              {confirm.others.map((row) => (
                <li key={row.id} className="text-[11px] font-semibold text-amber-900">
                  · {row.line_number} — {row.customer_name}
                </li>
              ))}
            </ul>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="flex-1 h-11 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
              >
                {so ? 'Jooji' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const pending = confirm;
                  setConfirm(null);
                  setBusyId(pending.task.id);
                  void startTask(token, pending.task.id, true)
                    .then(() => load(true))
                    .catch((err: unknown) =>
                      setError(describeError(err, lang)),
                    )
                    .finally(() => setBusyId(null));
                }}
                className="flex-[2] inline-flex items-center justify-center gap-1.5 h-11 rounded-xl bg-amber-600 text-white text-xs font-extrabold cursor-pointer"
              >
                <Play className="w-4 h-4" />
                {so ? 'Sii wad — labadaba' : 'Start anyway'}
              </button>
            </div>
          </div>
        </div>
      )}

      {openTask && (
        <ExecutionSheet
          task={openTask}
          token={token}
          lang={lang}
          nowMs={nowMs}
          onClose={() => setOpenTaskId(null)}
          onChanged={() => load(true)}
        />
      )}

      {/* quiet footer so the fixed tab bar never hides the last card */}
      <div className="h-2" />

      {stats.blocked > 0 && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-3 text-[11px] font-semibold text-rose-800 flex items-center gap-2">
          <RotateCcw className="w-4 h-4 shrink-0" />
          {so
            ? `${stats.blocked} shaqo ayaa caqabad ku haysata — fur si aad u sii waddo.`
            : `${stats.blocked} job(s) blocked — open them to resume when it is sorted.`}
        </div>
      )}

      {activeGroup && (
        <div className="text-center text-[10px] text-slate-500 pt-1">
          Group {activeGroup.code} · {session.user.full_name}
        </div>
      )}
    </div>
  );
}
