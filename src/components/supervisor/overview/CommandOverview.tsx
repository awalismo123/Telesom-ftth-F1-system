import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useLanguage } from '../../../lib/i18n';
import { todayKey } from '../../../lib/format';
import { useTableChanges } from '../../../lib/realtime';
import { OVERVIEW_NOTE, attentionTotal, type AttentionInput } from '../../../lib/overview';
import {
  fetchOverview,
  nothingLoaded,
  partialNotice,
  type OverviewPart,
} from '../../../lib/overviewService';
import { headlineTone, todayHeadline } from '../../../lib/today';
import { lastActivityDay } from '../../../lib/overview';
import { EMPTY_OVERVIEW, type OverviewData } from '../../../lib/overviewService';
import { ShiftHeader } from './ShiftHeader';
import { AttentionRail, attentionSentence } from './AttentionRail';
import { LoadBoard } from './LoadBoard';
import { WorkQueue } from './WorkQueue';
import { MovementPanel } from './MovementPanel';
import { LiveFeed } from './LiveFeed';
import { SlaWatchCard } from '../SlaWatchCard';
import { Alert } from '../../ui/Alert';
import { SkeletonCard } from '../../ui/Skeleton';

/**
 * The command page.
 *
 * ## What it replaces
 *
 * Four static tiles (technicians, crews, open tasks, box count) — numbers a
 * supervisor reads once and already knows — and a single dark panel. Nineteen
 * open jobs, two of them urgent and all of them past the promise, were not on
 * the screen at all.
 *
 * ## What it is now
 *
 * The page answers, in reading order: **what needs a decision** (the rail),
 * **who can take it** (the load board), **what to do first** (the queue), **is
 * the week going anywhere** (movement), and **what just happened** (the feed).
 * Every number is a control; every control leads somewhere that can act.
 *
 * ## Two things it refuses to do
 *
 * * **Show zeros when it does not know.** A failed load names the parts that did
 *   not arrive instead of reporting a quiet day. On this page a false zero is
 *   the most expensive kind of wrong.
 * * **Rank people.** Crews and technicians are alphabetical, and the note says so.
 */

export function CommandOverview({
  onNavigate,
  onOpenTask,
}: {
  onNavigate: (tab: 'dispatch' | 'team' | 'activity' | 'insights') => void;
  onOpenTask: (taskId: string) => void;
}) {
  const { session, activeGroup } = useAuth();
  const { lang } = useLanguage();
  const so = lang === 'so';

  const [data, setData] = useState<OverviewData>(EMPTY_OVERVIEW);
  const [partial, setPartial] = useState<OverviewPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [secondsAgo, setSecondsAgo] = useState<number | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  const token = session?.token ?? '';
  const groupId = activeGroup?.id ?? '';
  const groupCode = activeGroup?.code ?? 'F1';

  /** Guards a stale response overwriting a newer one after a fast double refresh. */
  const requestRef = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent') => {
      if (!token || !groupId) return;

      const seq = requestRef.current + 1;
      requestRef.current = seq;

      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);

      try {
        const result = await fetchOverview({ token, groupId, day: todayKey() });
        if (requestRef.current !== seq) return;

        // A silent refresh that loaded nothing must not replace good data with
        // zeros, and must not look like a clean load either.
        if (mode === 'silent' && nothingLoaded(result.partial)) {
          setPartial(result.partial);
          return;
        }

        setData(result.data);
        setPartial(result.partial);
        setLoadedAt(Date.now());
        setSecondsAgo(0);
      } finally {
        if (requestRef.current === seq) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [token, groupId],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  /**
   * Realtime.
   *
   * The dispatch board already refetches on `tasks` changes; this page did not,
   * so a supervisor left it open all shift and read a stale screen. Debounced
   * inside the hook, so dispatching eight jobs is one refetch.
   */
  const silent = useCallback(() => void load('silent'), [load]);
  const live = Boolean(token && groupId);

  // Jobs changing is the signal that matters, but the roster moving (somebody
  // added to a crew mid-shift) changes the load board too, and a supervisor
  // reading a stale crew list will assign work to a crew that no longer exists.
  useTableChanges({ table: 'tasks', enabled: live, onChange: silent, debounceMs: 900 });
  useTableChanges({ table: 'crew_members', enabled: live, onChange: silent, debounceMs: 1500 });

  /** Freshness has to move on its own, or "updated 3s ago" stays at 3 forever. */
  useEffect(() => {
    if (loadedAt === null) return;
    const tick = () => setSecondsAgo(Math.max(0, Math.floor((Date.now() - loadedAt) / 1000)));
    tick();
    const timer = window.setInterval(tick, 5000);
    return () => window.clearInterval(timer);
  }, [loadedAt]);

  const today = todayKey();

  /**
   * The attention input.
   *
   * `over_sla`, `blocked` and `due_today` come from the server's summary, which
   * is the only place that counts *every* open job. `unassigned` and `urgent`
   * are counted from the loaded task list, because the summary does not split
   * urgency and the list is already in memory.
   */
  const attention: AttentionInput = useMemo(
    () => ({
      blocked: data.today?.blocked ?? 0,
      over_sla: data.today?.over_sla ?? 0,
      due_today: data.today?.due_today ?? 0,
      unassigned: data.today?.unassigned ?? data.tasks.filter((task) => task.status === 'unassigned').length,
      urgent_open: data.tasks.filter(
        (task) =>
          task.priority === 'urgent' &&
          task.status !== 'completed' &&
          task.status !== 'cancelled',
      ).length,
    }),
    [data.today, data.tasks],
  );

  const notice = partialNotice(partial, lang);
  const everythingFailed = nothingLoaded(partial);

  /**
   * The page's one-sentence conclusion.
   *
   * Reuses `todayHeadline`, which is the tested ordering of bad news: blocked
   * first, then late, then unassigned — saying all three at once says nothing.
   * `last_activity` is attached so the sentence can tell a quiet week from a
   * queue that has stopped moving, which on the live database it had.
   */
  const lastMove = lastActivityDay(data.events);
  const summaryToday = data.today ? { ...data.today, last_activity: lastMove } : null;
  const headline = summaryToday ? todayHeadline(summaryToday, lang) : null;
  const tone = summaryToday ? headlineTone(summaryToday) : 'calm';

  if (loading && !loadedAt) {
    return (
      <div className="space-y-4" aria-busy="true">
        <SkeletonCard lines={3} />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-[76px] rounded-2xl bg-slate-100 animate-pulse" />
          ))}
        </div>
        <SkeletonCard lines={5} />
      </div>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <ShiftHeader
        day={today}
        secondsAgo={secondsAgo}
        refreshing={refreshing}
        error={notice}
        onRefresh={() => void load('refresh')}
        groupCode={groupCode}
        userName={session?.user?.full_name?.split(' ')[0] ?? ''}
        headline={headline}
        tone={tone}
      />

      {/* A partial load is named, never disguised as zeros. */}
      {notice && !everythingFailed && (
        <Alert tone="warning" title={so ? 'Qayb xogta ah lama soo qaadin' : 'Some data did not load'}>
          {notice}
        </Alert>
      )}

      {everythingFailed && (
        <Alert tone="danger" title={so ? 'Xogta lama soo qaadin' : 'Could not load the page'}>
          {so
            ? 'Isku day "Cusboonaysii". Haddii ay sii socoto, hubi internet-ka.'
            : 'Try Refresh. If it keeps failing, check the connection.'}
        </Alert>
      )}

      {/* Screen-reader summary of the rail, so a blind user hears the state
          without walking five tiles. */}
      <p className="sr-only" aria-live="polite">
        {attentionSentence(attention, lang)}
      </p>

      <AttentionRail input={attention} loading={false} onOpen={() => onNavigate('dispatch')} />

      {attentionTotal(attention) > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onNavigate('dispatch')}
            className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-xl bg-brand-700 text-white font-extrabold text-xs hover:bg-brand-800 active:scale-[0.99] transition cursor-pointer"
          >
            {so ? 'Qaybsiga fur' : 'Open dispatch'}
          </button>
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-xl bg-white border border-slate-200 text-slate-800 font-extrabold text-xs hover:border-brand-300 transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            {so ? 'Shaqo telefoon ku timid' : 'Add a job from a call'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
        <WorkQueue
          tasks={data.tasks}
          today={today}
          loading={loading}
          totalOpen={data.today?.open_now ?? data.tasks.length}
          onOpenTask={onOpenTask}
          onOpenDispatch={() => onNavigate('dispatch')}
        />
        <LoadBoard load={data.load} loading={loading} onOpenTeam={() => onNavigate('team')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
        <MovementPanel events={data.events} today={today} loading={loading} />
        <LiveFeed events={data.events} loading={loading} onOpenAll={() => onNavigate('activity')} />
      </div>

      <Suspense fallback={<SkeletonCard lines={2} />}>
        <SlaWatchCard />
      </Suspense>

      <p className="px-1 text-[10px] leading-snug text-slate-500">{OVERVIEW_NOTE[lang]}</p>

      {/* Adding a job from a phone call is the one write a command page needs:
          the customer is on the line, and making the supervisor switch tabs
          first is how the call gets written on a scrap of paper instead. */}
      {manualOpen && (
        <Suspense fallback={null}>
          <ManualTaskHost
            open={manualOpen}
            onClose={() => setManualOpen(false)}
            onCreated={() => {
              void load('silent');
              onNavigate('dispatch');
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

/**
 * The manual-task sheet needs a target list and the box codes, so it is split
 * out: a supervisor who never takes a phone call never downloads it.
 */
const ManualTaskHost = lazy(() =>
  import('./ManualTaskHost').then((m) => ({ default: m.ManualTaskHost })),
);
