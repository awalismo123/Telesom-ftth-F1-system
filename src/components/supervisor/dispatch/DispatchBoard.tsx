import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { describeError } from '../../../lib/useErrorMessage';
import {
  CalendarClock,
  ChevronRight,
  MessageSquareText,
  PhoneCall,
  RefreshCw,
  Route,
  Search,
  Send,
  Sparkles,
  Truck,
  User,
  Users,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useLanguage } from '../../../lib/i18n';
import { truncatedNotice, OPEN_TASK_CAP } from '../../../lib/lists';
import { plannedJobs, shortDay } from '../../../lib/schedule';
import { todayKey } from '../../../lib/format';
import { SLA_DAYS } from '../../../lib/activity';
import type { Task } from '../../../types/database';
import {
  assignTasks,
  fetchDispatchLoad,
  fetchDispatchTasks,
  crewsWithoutMembers,
  toTargets,
  unassignTasks,
  type DispatchLoad,
} from '../../../lib/dispatchService';
import {
  CONFIRM_NOTE,
  confirmSummary,
  pendingKey,
  type ConfirmTask,
} from '../../../lib/dispatchConfirm';
import {
  autoPlan,
  clusterTasks,
  searchTasks,
  splitLargeClusters,
  targetKey,
  type DispatchTarget,
  type MessageLane,
} from '../../../lib/dispatch';
import {
  POOL_ORDER_NOTE,
  boardState,
  orderPool,
  triagePool,
  triageSentence,
  unroutableJobs,
  unroutableNotice,
} from '../../../lib/dispatchBoard';
import { TaskCard } from './TaskCard';
import { ClusterPlanSheet } from './ClusterPlanSheet';
import { DispatchMessageSheet } from './DispatchMessageSheet';
import { LiveStrip } from './LiveStrip';
import { FirstRunHint } from '../../ui/FirstRunHint';
import { ManualTaskSheet } from './ManualTaskSheet';
import { JobActionsSheet } from './JobActionsSheet';
import { fetchDirectory } from '../../../lib/registryService';
import { cacheKeys, readCache } from '../../../lib/cache';
import type { DirectoryResponse } from '../../../lib/registry';
import { useToast } from '../../ui/Toast';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Input } from '../../ui/Field';
import { Sheet } from '../../ui/Sheet';
import { Skeleton } from '../../ui/Skeleton';
import { Tabs } from '../../ui/Tabs';
import { useDebouncedValue } from '../../../lib/useDebouncedValue';
import { useTableChanges } from '../../../lib/realtime';

type Filter = 'all' | 'urgent';

export function DispatchBoard({
  focusTaskId = null,
  focusNonce = 0,
}: {
  focusTaskId?: string | null;
  focusNonce?: number;
}) {
  const { session, activeGroup } = useAuth();
  const { t, lang } = useLanguage();
  const so = lang === 'so';

  const [tasks, setTasks] = useState<Task[]>([]);
  // The board loads at most OPEN_TASK_CAP jobs; say so when it hits the cap
  // rather than printing the cap as though it were the backlog.
  const truncated = truncatedNotice(tasks.length, OPEN_TASK_CAP, lang);
  const [load, setLoad] = useState<DispatchLoad>({ users: [], crews: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string[]>([]);
  /** A target picked in the list but not yet committed. Nothing is assigned
   *  until the supervisor confirms it. */
  const [pendingTarget, setPendingTarget] = useState<DispatchTarget | null>(null);
  const [pickerFor, setPickerFor] = useState<'selection' | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [actionTaskId, setActionTaskId] = useState<string | null>(null);
  const [boxCodes, setBoxCodes] = useState<{ box_code: string; total_ports: number }[]>([]);

  const token = session?.token ?? '';
  const groupId = activeGroup?.id ?? '';
  const groupCode = activeGroup?.code ?? 'F1';

  const refresh = useCallback(async () => {
    if (!token || !groupId) return;
    setLoading(true);
    setError(null);
    try {
      const [taskRows, loadData] = await Promise.all([
        fetchDispatchTasks(token, groupId),
        fetchDispatchLoad(token, groupId),
      ]);
      setTasks(taskRows);
      setLoad(loadData);
    } catch (err) {
      setError(describeError(err, lang));
    } finally {
      setLoading(false);
    }
  }, [token, groupId]);

  const silentRefresh = useCallback(async () => {
    if (!token || !groupId) return;
    try {
      const [taskRows, loadData] = await Promise.all([
        fetchDispatchTasks(token, groupId),
        fetchDispatchLoad(token, groupId),
      ]);
      setTasks(taskRows);
      setLoad(loadData);
    } catch {
      // A background refresh must never replace the board with an error.
    }
  }, [token, groupId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The phone-in form offers the boxes we already know, so a supervisor does not
  // mistype a code and create a twin box.
  useEffect(() => {
    if (!token || !groupId) return;

    const toCodes = (directory: DirectoryResponse) =>
      setBoxCodes(directory.boxes.map((box) => ({ box_code: box.box_code, total_ports: box.total_ports })));

    // Reuse the registry's payload if the supervisor just looked at it.
    const cached = readCache<DirectoryResponse>(cacheKeys.directory(groupId));
    if (cached) toCodes(cached);

    void fetchDirectory(token, groupId).then(toCodes).catch(() => !cached && setBoxCodes([]));
  }, [token, groupId]);

  // Arrived from search or a notification: open that job's actions.
  useEffect(() => {
    if (focusTaskId) setActionTaskId(focusTaskId);
  }, [focusTaskId, focusNonce]);

  /**
   * The board is live: a technician starting or finishing a job moves it
   * between the pool and the lanes without a reload. Refreshed silently so the
   * selection the supervisor is building is never thrown away.
   */
  useTableChanges({
    table: 'tasks',
    filter: groupId ? `group_id=eq.${groupId}` : undefined,
    enabled: Boolean(groupId),
    onChange: () => void silentRefresh(),
    debounceMs: 1200,
  });

  const targets = useMemo(() => toTargets(load), [load]);
  // Crews that exist as rows but have nobody in them. They are filtered out of
  // the dispatch targets, so without this line they would vanish silently and a
  // supervisor would wonder where the crew went.
  const strandedCrews = useMemo(() => crewsWithoutMembers(load), [load]);
  const targetByKey = useMemo(() => {
    const map = new Map<string, DispatchTarget>();
    for (const target of targets) map.set(targetKey(target), target);
    return map;
  }, [targets]);

  /**
   * One day for the whole board.
   *
   * The pool, the lanes and the planned list all decide "is this today?" from
   * this one string. Computing it three times would let a board built across
   * midnight put a job in two places.
   */
  const today = todayKey();

  /**
   * Work whose day has not arrived yet.
   *
   * It is removed from the pool and from the lanes below, because a job planned
   * for Thursday is not something to send a crew to on Tuesday. It is shown in
   * its own list instead of being hidden — a job nobody can see is a job that
   * gets forgotten.
   */
  const planned = useMemo(
    () =>
      plannedJobs(
        tasks.filter((task) => task.status !== 'completed' && task.status !== 'cancelled'),
        today,
      ),
    [tasks, today],
  );

  const plannedIds = useMemo(() => new Set(planned.map((task) => task.id)), [planned]);

  const pool = useMemo(
    () =>
      tasks.filter(
        (task) => task.status === 'unassigned' && !plannedIds.has(task.id),
      ),
    [tasks, plannedIds],
  );

  /**
   * Typing on a phone keyboard is bursty: "FAT48" is five keystrokes and five
   * full rescans of the pool. Debounce the filter (not the input) so the field
   * still echoes every character, and only the list waits 200 ms.
   */
  const debouncedQuery = useDebouncedValue(query, 200);

  /**
   * The pool in dispatch order.
   *
   * `searchTasks` filters and `orderPool` sorts, and the sort is `compareTasks`
   * — the same comparison the WhatsApp message uses. The board used to inherit
   * whatever order the server returned, which meant the crew's message was
   * better ordered than the screen it was written from.
   */
  const visiblePool = useMemo(() => {
    let rows = searchTasks(pool, debouncedQuery);
    if (filter === 'urgent') rows = rows.filter((task) => task.priority === 'urgent');
    return orderPool(rows);
  }, [pool, debouncedQuery, filter]);

  /** What the pool contains, and what of it can actually be routed. */
  const triage = useMemo(() => triagePool(pool), [pool]);
  const unroutable = useMemo(() => unroutableJobs(pool), [pool]);
  const unroutableBanner = unroutableNotice(unroutable, lang);
  const state = boardState(pool.length, targets.length);

  const lanes: MessageLane[] = useMemo(
    () =>
      targets.map((target) => ({
        target,
        tasks: tasks.filter((task) => {
          if (task.status === 'completed' || plannedIds.has(task.id)) return false;
          return target.kind === 'crew'
            ? task.assigned_crew_id === target.id
            : task.assigned_user_id === target.id;
        }),
      })),
    [tasks, targets, plannedIds],
  );

  const assignedCount = lanes.reduce((sum, lane) => sum + lane.tasks.length, 0);

  const toggleSelect = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selectAllVisible = () =>
    setSelected((prev) => {
      const ids = visiblePool.map((task) => task.id);
      const allSelected = ids.every((id) => prev.includes(id));
      return allSelected ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])];
    });

  const runAssign = async (target: DispatchTarget): Promise<number> => {
    setBusy(true);
    setError(null);
    try {
      const result = await assignTasks({ token, groupId, taskIds: selected, target });
      const skipped = result.skipped ? ` · ${result.skipped} ${t('dispatchAssignSkipped')}` : '';
      toast.success(`${result.assigned} ${so ? 'shaqo →' : 'jobs →'} ${target.name}`, {
        description: skipped ? skipped.replace(/^ · /, '') : undefined,
      });
      setSelected([]);
      setPickerFor(null);
      setPendingTarget(null);
      await refresh();
      return result.assigned;
    } catch (err) {
      setError(describeError(err, lang));
      return 0;
    } finally {
      setBusy(false);
    }
  };

  const runUnassign = async (taskId: string) => {
    setBusy(true);
    setError(null);
    try {
      await unassignTasks({ token, groupId, taskIds: [taskId] });
      toast.info(so ? 'Shaqada waa lagu celiyay liiska' : 'Job returned to the pool');
      await refresh();
    } catch (err) {
      setError(describeError(err, lang));
    } finally {
      setBusy(false);
    }
  };

  const applyPlan = async (pairs: { taskIds: string[]; target: DispatchTarget }[]) => {
    setBusy(true);
    setError(null);
    try {
      let total = 0;
      let skipped = 0;
      for (const pair of pairs) {
        const result = await assignTasks({
          token,
          groupId,
          taskIds: pair.taskIds,
          target: pair.target,
        });
        total += result.assigned;
        skipped += result.skipped;
      }
      setPlanOpen(false);
      toast.success(
        `${total} ${so ? 'shaqo la qaybiyay' : 'jobs dispatched'}`,
        { description: skipped ? `${skipped} ${t('dispatchAssignSkipped')}` : undefined },
      );
      await refresh();
    } catch (err) {
      setError(describeError(err, lang));
    } finally {
      setBusy(false);
    }
  };

  const clusters = useMemo(() => clusterTasks(pool), [pool]);
  const plan = useMemo(
    () => autoPlan(splitLargeClusters(clusters, 6), targets, 6),
    [clusters, targets],
  );

  if (loading) {
    // Match the shape of the board so the page does not jump when data lands.
    return (
      <div className="space-y-4 pb-24" role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">{so ? 'Xogta waa la soo dejinayaa…' : 'Loading the board…'}</span>
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-14 w-full rounded-2xl" />
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          <div className="xl:col-span-2 space-y-2">
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
          <div className="xl:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-32 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24">
      {/* ---------------------------------------------------------------- */}
      {/* Header                                                            */}
      {/* ---------------------------------------------------------------- */}
      <div className="rounded-2xl bg-brand-950 text-white p-4 sm:p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-extrabold flex items-center gap-2">
              <Route className="w-5 h-5 text-brand-300" />
              {t('dispatchTitle')}
            </h2>
            <p className="text-[11px] sm:text-xs text-brand-100/80 mt-1 max-w-xl leading-relaxed">
              {t('dispatchSubtitle')}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void refresh()}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 transition cursor-pointer"
            title={so ? 'Cusbooneysii' : 'Refresh'}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/*
          The pool's state, in the order a dispatcher works it: what is waiting,
          what of it is urgent, what is late, and how much of it can actually be
          put on a route. The last figure is the one that was missing — a brace
          of urgent jobs with no area and no box cannot be clustered, and no
          screen said so before the plan was already made.
        */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <HeaderStat label={so ? 'Aan la qaybin' : 'Unassigned'} value={triage.total} />
          <HeaderStat
            label={so ? 'Degdeg' : 'Urgent'}
            value={triage.urgent}
            tone={triage.urgent > 0 ? 'rose' : 'plain'}
          />
          <HeaderStat
            label={so ? `Ka baxay ${SLA_DAYS}` : `Past ${SLA_DAYS} days`}
            value={triage.late}
            tone={triage.late > 0 ? 'amber' : 'plain'}
          />
          <HeaderStat
            label={so ? 'La jihayn karo' : 'Can be routed'}
            value={`${triage.routable}/${triage.total}`}
            tone={triage.unroutable > 0 ? 'amber' : 'plain'}
          />
          {/* Kept from the old header: how much work is already out with crews.
              Without it a dispatcher cannot tell whether to send more. */}
          <HeaderStat label={so ? 'La qaybiyay' : 'Dispatched'} value={assignedCount} />
        </div>

        <p className="mt-2.5 text-[11px] font-semibold text-brand-100/90 leading-snug">
          {triageSentence(triage, lang)}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="success"
            size="sm"
            onClick={() => setPlanOpen(true)}
            disabled={pool.length === 0 || targets.length === 0}
          >
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            {t('dispatchAutoCluster')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setMessageOpen(true)}>
            <MessageSquareText className="w-4 h-4" aria-hidden="true" />
            {t('dispatchMessage')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setManualOpen(true)}>
            <PhoneCall className="w-4 h-4" aria-hidden="true" />
            {so ? 'Shaqo telefoon' : 'Phone-in job'}
          </Button>
        </div>
      </div>

      <LiveStrip />

      <FirstRunHint
        id="dispatch-pool"
        userId={session?.user.id}
        title={so ? 'Sida loo qaybiyo shaqada' : 'How dispatching works'}
      >
        {so
          ? 'Dooro shaqooyin ka mid ah liiska bidixda, ka dib dooro farsamayaqaan ama gaadiid. “Isku-xidh si otomaatig ah” ayaa isku keenaysa shaqooyinka isla xaafada ama isla sanduuqa.'
          : 'Tick jobs in the left list, then choose a technician or a crew. “Auto-cluster” groups the ones in the same area or on the same box.'}
      </FirstRunHint>

      {error && (
        <Alert tone="danger" onDismiss={() => setError(null)} dismissLabel={t('cancel')}>
          {error}
        </Alert>
      )}

      {targets.length === 0 && (
        <Alert tone="warning">
          {t('dispatchNoTargets')}{' '}
          {so ? 'Ku dar farsamayaqaan ama crew Team-ga.' : 'Add a technician or crew in Team.'}
        </Alert>
      )}

      {/*
        Work that cannot be put on a route.

        `clusterTasks` groups by box, then by neighbourhood. A job with neither
        lands in one bucket with every other such job, so auto-cluster will
        cheerfully hand one crew a "route" of jobs in opposite corners of the
        city. The board says so before the plan is made rather than after it is
        sent.
      */}
      {unroutableBanner && (
        <Alert tone="warning" title={unroutableBanner.title}>
          {unroutableBanner.body}
        </Alert>
      )}

      {/*
        A board with jobs but nobody to send them to is blocked, not finished.
        It used to render a small note above an empty grid, which reads like a
        quiet afternoon.
      */}
      {state === 'no-targets' && (
        <Alert
          tone="danger"
          title={so ? 'Ma jiro cid la diri karo' : 'Nobody can be dispatched to'}
        >
          {so
            ? `${pool.length} shaqo ayaa sugaysa, laakiin ma jiro farsamayaqaan ama koox diyaar ah. Kooxaha cidna ku jirin lama diri karo — ku dar farsamayaqaan Team & Crews.`
            : `${pool.length} ${pool.length === 1 ? 'job is' : 'jobs are'} waiting, but no technician or crew can take them. A crew with nobody in it cannot be dispatched — add a technician in Team & Crews.`}
        </Alert>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* -------------------------------------------------------------- */}
        {/* Pool                                                           */}
        {/* -------------------------------------------------------------- */}
        <section className="xl:col-span-2 space-y-3">
          <div className="bg-white rounded-2xl border border-slate-200 p-3 space-y-2.5">
            {truncated && (
              <p className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                {truncated}
              </p>
            )}
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                {t('dispatchPool')} · {pool.length}
              </h3>
              {visiblePool.length > 0 && (
                <button
                  type="button"
                  onClick={selectAllVisible}
                  className="text-[11px] font-bold text-brand-700 hover:text-brand-900 cursor-pointer"
                >
                  {t('dispatchSelectAll')}
                </button>
              )}
            </div>

            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('dispatchSearch')}
              aria-label={t('dispatchSearch')}
              leadingIcon={<Search className="w-4 h-4" />}
            />

            <Tabs
              variant="bar"
              items={[
                { id: 'all' as Filter, label: t('dispatchFilterAll') },
                { id: 'urgent' as Filter, label: t('dispatchFilterUrgent') },
              ]}
              value={filter}
              onChange={setFilter}
              label={t('dispatchPool')}
            />

            {/*
              The order is stated rather than implied. It used to be whatever the
              server happened to return, and the one control that changed it was
              a filter you had to tap first.
            */}
            <p className="text-[10px] leading-snug text-slate-500 border-t border-slate-100 pt-1.5">
              {POOL_ORDER_NOTE[lang]}
            </p>
          </div>

          {planned.length > 0 && (
            <div className="bg-white rounded-2xl border border-amber-200 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-extrabold uppercase tracking-wide text-amber-800 flex items-center gap-1.5">
                  <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
                  {so ? 'La qorsheeyay' : 'Planned'} · {planned.length}
                </h3>
                <span className="text-[11px] font-semibold text-amber-700">
                  {so ? 'Maalmaha soo socda' : 'Not today'}
                </span>
              </div>

              <div className="space-y-1">
                {planned.slice(0, 12).map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => setActionTaskId(task.id)}
                    className="w-full flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-left hover:border-amber-300 hover:bg-amber-50/60 transition cursor-pointer"
                  >
                    <span className="font-mono text-[11px] font-bold text-slate-700 shrink-0">
                      {shortDay(task.scheduled_date)}
                    </span>
                    <span className="text-[12px] font-bold text-slate-900 truncate">
                      {task.customer_name || task.line_number}
                    </span>
                    <span className="ml-auto text-[10px] font-semibold text-slate-500 shrink-0">
                      {task.status === 'unassigned' ? (so ? 'lama qaybin' : 'unassigned') : (so ? 'la qaybiyay' : 'assigned')}
                    </span>
                  </button>
                ))}
                {planned.length > 12 && (
                  <p className="text-[11px] text-slate-500 px-1">
                    {so
                      ? `+${planned.length - 12} kale oo la qorsheeyay`
                      : `+${planned.length - 12} more planned`}
                  </p>
                )}
              </div>

              <p className="text-[11px] text-slate-500">
                {so
                  ? 'Taabo shaqo si aad maalinteeda u beddesho. Shaqooyinkan kama muuqdaan liiska maanta.'
                  : 'Tap a job to change its day. These are not in today’s pool.'}
              </p>
            </div>
          )}

          <div className="space-y-2">
            {visiblePool.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                lang={lang}
                selected={selected.includes(task.id)}
                onSelect={toggleSelect}
                onActions={() => setActionTaskId(task.id)}
                actionsLabel={so ? 'Talaabooyin' : 'Job actions'}
              />
            ))}

            {visiblePool.length === 0 && (
              <EmptyState
                icon={<Route className="w-5 h-5" />}
                title={pool.length === 0 ? t('dispatchPoolEmpty') : so ? 'Raadinta waxba ma heysato' : 'Nothing matches that search'}
                description={
                  pool.length === 0
                    ? so
                      ? 'Marka shaqooyin cusub la soo geliyo, halkan ayay ku soo baxaan.'
                      : 'New jobs land here as soon as a sheet is imported.'
                    : so
                      ? 'Beddel shaandhaynta ama tirtir raadinta.'
                      : 'Change the filter or clear the search.'
                }
                action={
                  (filter !== 'all' || query) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setFilter('all');
                        setQuery('');
                      }}
                    >
                      {so ? 'Tirtir shaandhaynta' : 'Clear filters'}
                    </Button>
                  )
                }
              />
            )}
          </div>
        </section>

        {/* -------------------------------------------------------------- */}
        {/* Lanes                                                          */}
        {/* -------------------------------------------------------------- */}
        <section className="xl:col-span-3 space-y-3">
          <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-500 px-1">
            {t('dispatchLanes')} · {targets.length}
          </h3>
          {strandedCrews.length > 0 && (
            <p className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 mx-1">
              {lang === 'so'
                ? `${strandedCrews.length} kooxood cidna kuma jirto, marka lama qaybin karo: ${strandedCrews
                    .map((crew) => crew.name)
                    .join(', ')}. Ku dar farsamayaqaan Team & Crews.`
                : `${strandedCrews.length} ${
                    strandedCrews.length === 1 ? 'crew has' : 'crews have'
                  } nobody in them, so cannot be dispatched: ${strandedCrews
                    .map((crew) => crew.name)
                    .join(', ')}. Add a technician in Team & Crews.`}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {targets.map((target) => {
              const lane = lanes.find((item) => targetKey(item.target) === targetKey(target));
              const laneTasks = lane?.tasks ?? [];
              const urgent = laneTasks.filter((task) => task.priority === 'urgent').length;

              return (
                <div
                  key={targetKey(target)}
                  className="bg-white rounded-2xl border border-slate-200 p-3 flex flex-col gap-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {target.kind === 'crew' ? (
                          <Truck className="w-3.5 h-3.5 text-brand-700 shrink-0" />
                        ) : (
                          <User className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                        )}
                        <span className="text-[13px] font-extrabold text-slate-900 truncate">
                          {target.name}
                        </span>
                      </div>
                      {target.subtitle && (
                        <div className="text-[10px] text-slate-500 truncate mt-0.5">{target.subtitle}</div>
                      )}
                    </div>

                    <span
                      className={`shrink-0 px-2 py-1 rounded-lg text-[10px] font-extrabold ${
                        laneTasks.length === 0
                          ? 'bg-slate-100 text-slate-500'
                          : laneTasks.length > 5
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-brand-100 text-brand-800'
                      }`}
                    >
                      {laneTasks.length}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1 text-[10px] font-semibold">
                    {urgent > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700">
                        {urgent} {t('dispatchUrgentJobs')}
                      </span>
                    )}
                    {target.activeJobs > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700">
                        {target.activeJobs} {t('dispatchInProgressShort')}
                      </span>
                    )}
                    {target.doneToday > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                        {target.doneToday} {t('dispatchDoneToday')}
                      </span>
                    )}
                    {target.zoneFocus && (
                      <span className="px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 truncate max-w-full">
                        {target.zoneFocus}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    {laneTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        lang={lang}
                        compact
                        statusLabel={
                          task.status === 'in_progress'
                            ? t('dispatchInProgressShort')
                            : task.status === 'blocked'
                              ? so
                                ? 'caqabad'
                                : 'blocked'
                              : undefined
                        }
                        onUnassign={task.status === 'assigned' ? () => void runUnassign(task.id) : undefined}
                        unassignLabel={t('dispatchUnassign')}
                        onActions={() => setActionTaskId(task.id)}
                        actionsLabel={so ? 'Talaabooyin' : 'Job actions'}
                      />
                    ))}

                    {laneTasks.length === 0 && (
                      <div className="text-[11px] text-slate-500 text-center py-3 border border-dashed border-slate-300 rounded-xl">
                        {t('dispatchLaneEmpty')}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {targets.length === 0 && (
            <EmptyState
              icon={<Users className="w-5 h-5" />}
              title={t('dispatchNoTargets')}
              description={
                so
                  ? 'Lanes-ka waxaa buuxiya farsamayaqaannada iyo crew-yada Team-ga.'
                  : 'Lanes are filled by the technicians and crews in Team.'
              }
            />
          )}
        </section>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Sticky selection bar                                              */}
      {/* ---------------------------------------------------------------- */}
      {selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-3">
          <div className="max-w-3xl mx-auto rounded-2xl bg-slate-900 text-white shadow-lg px-3.5 py-3 flex items-center gap-3">
            <div className="text-xs font-bold whitespace-nowrap">
              {selected.length} {t('dispatchSelected')}
            </div>
            <button
              type="button"
              onClick={() => setSelected([])}
              className="text-[11px] font-semibold text-slate-200 hover:text-white underline cursor-pointer"
            >
              {t('dispatchClear')}
            </button>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="success"
                size="sm"
                loading={busy}
                onClick={() => setPickerFor('selection')}
                disabled={targets.length === 0}
              >
                {!busy && <Send className="w-4 h-4" aria-hidden="true" />}
                {t('dispatchAssignTo')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Modal: pick a technician / crew                                   */}
      {/* ---------------------------------------------------------------- */}
      <Sheet
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        title={t('dispatchAssignTo')}
        description={`${selected.length} ${t('dispatchSelected')}`}
        size="md"
      >
        {/* Confirmation. Nothing is assigned until the confirm button is
            pressed: the picker row used to commit on a single tap, which is one
            thumb-width away from the wrong crew. */}
        {pendingTarget ? (
          (() => {
            const byId = new Map<string, ConfirmTask>();
            for (const task of [...pool, ...lanes.flatMap((lane) => lane.tasks)]) {
              byId.set(task.id, {
                id: task.id,
                line_number: task.line_number,
                priority: task.priority,
                status: task.status,
              });
            }
            const chosen = selected.map((id) => byId.get(id)).filter(Boolean) as ConfirmTask[];
            const summary = confirmSummary(pendingTarget, chosen, lang);

            return (
              <div key={pendingKey(pendingTarget, selected)} className="space-y-3">
                <div className="rounded-2xl border border-slate-200 p-3 space-y-2">
                  <div className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                    {summary.title}
                  </div>
                  <div className="text-sm font-extrabold text-slate-900">{summary.target}</div>
                  <div className="text-[11px] font-semibold text-slate-600">
                    {summary.count} {t('dispatchSelected')}
                  </div>
                  {summary.lines && (
                    <div className="font-mono text-[11px] font-bold text-slate-700 break-words">
                      {summary.lines}
                      {summary.hidden > 0 && (
                        <span className="text-slate-500">
                          {' '}
                          +{summary.hidden} {so ? 'kale' : 'more'}
                        </span>
                      )}
                    </div>
                  )}
                  {summary.warnings.length > 0 && (
                    <div className="rounded-xl bg-amber-50 border border-amber-200 px-2.5 py-2 space-y-1">
                      {summary.warnings.map((warning) => (
                        <p key={warning} className="text-[11px] font-bold text-amber-900">
                          {warning}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPendingTarget(null)}
                    disabled={busy}
                  >
                    {summary.cancelLabel}
                  </Button>
                  <Button
                    variant="success"
                    size="sm"
                    loading={busy}
                    onClick={() => void runAssign(pendingTarget)}
                  >
                    {summary.confirmLabel}
                  </Button>
                </div>

                <p className="text-[10px] leading-snug text-slate-500">{CONFIRM_NOTE[lang]}</p>
              </div>
            );
          })()
        ) : (
        <div className="space-y-2">
              {targets.map((target) => (
                <button
                  key={targetKey(target)}
                  type="button"
                  disabled={busy}
                  onClick={() => setPendingTarget(target)}
                  className="w-full text-left rounded-2xl border border-slate-200 hover:border-brand-400 hover:bg-brand-50/50 p-3 transition flex items-center gap-3 disabled:opacity-50 cursor-pointer"
                >
                  <span
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      target.kind === 'crew'
                        ? 'bg-brand-100 text-brand-800'
                        : 'bg-sky-100 text-sky-800'
                    }`}
                  >
                    {target.kind === 'crew' ? <Truck className="w-4 h-4" /> : <User className="w-4 h-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-extrabold text-slate-900 truncate">
                      {target.name}
                    </span>
                    <span className="block text-[11px] text-slate-500 truncate">
                      {target.subtitle || target.zoneFocus || '—'}
                    </span>
                  </span>
                  <span className="text-[11px] font-bold text-slate-500 shrink-0">
                    {target.openJobs} {t('dispatchOpenJobs')}
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                </button>
              ))}

              {targets.length === 0 && (
                <EmptyState
                  icon={<Users className="w-5 h-5" />}
                  title={t('dispatchNoTargets')}
                  description={so ? 'Marka hore ku dar team-ka.' : 'Add a technician or crew first.'}
                />
              )}
        </div>
        )}
      </Sheet>

      <ManualTaskSheet
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        token={token}
        groupId={groupId}
        targets={targets}
        boxCodes={boxCodes}
        onCreated={(taskId) => {
          setActionTaskId(taskId);
          void silentRefresh();
        }}
      />

      <JobActionsSheet
        open={Boolean(actionTaskId)}
        taskId={actionTaskId}
        onClose={() => setActionTaskId(null)}
        onChanged={() => void silentRefresh()}
        token={token}
        groupId={groupId}
        targets={targets}
      />

      <ClusterPlanSheet
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        plan={plan}
        targets={targets}
        busy={busy}
        onApply={applyPlan}
      />

      <DispatchMessageSheet
        open={messageOpen}
        onClose={() => setMessageOpen(false)}
        lanes={lanes}
        groupCode={groupCode}
        groupId={groupId}
      />

    </div>
  );
}

/**
 * One figure in the dark header.
 *
 * `tone` is about attention, not decoration: a zero in amber would train a
 * dispatcher to ignore amber.
 */
function HeaderStat({
  label,
  value,
  tone = 'plain',
}: {
  label: string;
  value: number | string;
  tone?: 'plain' | 'rose' | 'amber';
}) {
  const valueTone =
    tone === 'rose' ? 'text-rose-300' : tone === 'amber' ? 'text-amber-300' : 'text-white';

  return (
    <div className="rounded-xl bg-white/10 p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-brand-200/80 font-bold truncate">
        {label}
      </div>
      <div className={`text-xl font-extrabold tabular ${valueTone}`}>{value}</div>
    </div>
  );
}
