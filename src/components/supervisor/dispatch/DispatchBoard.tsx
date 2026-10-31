import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { describeError } from '../../../lib/useErrorMessage';
import {
  ChevronRight,
  MessageSquareText,
  RefreshCw,
  Route,
  Search,
  Send,
  Sparkles,
  Truck,
  User,
  Users,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { useLanguage } from '../../../lib/i18n';
import type { Task } from '../../../types/database';
import {
  assignTasks,
  fetchDispatchLoad,
  fetchDispatchTasks,
  toTargets,
  unassignTasks,
  type DispatchLoad,
} from '../../../lib/dispatchService';
import {
  autoPlan,
  clusterTasks,
  searchTasks,
  splitLargeClusters,
  targetKey,
  type DispatchTarget,
  type MessageLane,
} from '../../../lib/dispatch';
import { TaskCard } from './TaskCard';
import { ClusterPlanSheet } from './ClusterPlanSheet';
import { DispatchMessageSheet } from './DispatchMessageSheet';
import { LiveStrip } from './LiveStrip';
import { useToast } from '../../ui/Toast';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Input } from '../../ui/Field';
import { Sheet } from '../../ui/Sheet';
import { Skeleton } from '../../ui/Skeleton';
import { Tabs } from '../../ui/Tabs';

type Filter = 'all' | 'urgent';

export function DispatchBoard() {
  const { session, activeGroup } = useAuth();
  const { t, lang } = useLanguage();
  const so = lang === 'so';

  const [tasks, setTasks] = useState<Task[]>([]);
  const [load, setLoad] = useState<DispatchLoad>({ users: [], crews: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [pickerFor, setPickerFor] = useState<'selection' | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);

  const token = session?.token ?? '';
  const groupId = activeGroup?.id ?? '';
  const groupCode = activeGroup?.code ?? 'F1';

  const refresh = useCallback(async () => {
    if (!token || !groupId) return;
    setLoading(true);
    setError(null);
    try {
      const [taskRows, loadData] = await Promise.all([
        fetchDispatchTasks(groupId),
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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const targets = useMemo(() => toTargets(load), [load]);
  const targetByKey = useMemo(() => {
    const map = new Map<string, DispatchTarget>();
    for (const target of targets) map.set(targetKey(target), target);
    return map;
  }, [targets]);

  const pool = useMemo(
    () => tasks.filter((task) => task.status === 'unassigned'),
    [tasks],
  );

  const visiblePool = useMemo(() => {
    let rows = searchTasks(pool, query);
    if (filter === 'urgent') rows = rows.filter((task) => task.priority === 'urgent');
    return rows;
  }, [pool, query, filter]);

  const lanes: MessageLane[] = useMemo(
    () =>
      targets.map((target) => ({
        target,
        tasks: tasks.filter((task) => {
          if (task.status === 'completed') return false;
          return target.kind === 'crew'
            ? task.assigned_crew_id === target.id
            : task.assigned_user_id === target.id;
        }),
      })),
    [tasks, targets],
  );

  const assignedCount = lanes.reduce((sum, lane) => sum + lane.tasks.length, 0);
  const urgentCount = pool.filter((task) => task.priority === 'urgent').length;

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
      <div className="rounded-2xl bg-emerald-950 text-white p-4 sm:p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-extrabold flex items-center gap-2">
              <Route className="w-5 h-5 text-emerald-300" />
              {t('dispatchTitle')}
            </h2>
            <p className="text-[11px] sm:text-xs text-emerald-100/80 mt-1 max-w-xl leading-relaxed">
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

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-white/10 p-2.5">
            <div className="text-[10px] uppercase tracking-wide text-emerald-200/80 font-bold">
              {so ? 'Aan la qaybin' : 'Unassigned'}
            </div>
            <div className="text-xl font-extrabold">{pool.length}</div>
          </div>
          <div className="rounded-xl bg-white/10 p-2.5">
            <div className="text-[10px] uppercase tracking-wide text-emerald-200/80 font-bold">
              {so ? 'Degdeg' : 'Urgent'}
            </div>
            <div className="text-xl font-extrabold text-rose-300">{urgentCount}</div>
          </div>
          <div className="rounded-xl bg-white/10 p-2.5">
            <div className="text-[10px] uppercase tracking-wide text-emerald-200/80 font-bold">
              {so ? 'La qaybiyay' : 'Dispatched'}
            </div>
            <div className="text-xl font-extrabold">{assignedCount}</div>
          </div>
        </div>

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
        </div>
      </div>

      <LiveStrip />

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

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* -------------------------------------------------------------- */}
        {/* Pool                                                           */}
        {/* -------------------------------------------------------------- */}
        <section className="xl:col-span-2 space-y-3">
          <div className="bg-white rounded-2xl border border-slate-200 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                {t('dispatchPool')} · {pool.length}
              </h3>
              {visiblePool.length > 0 && (
                <button
                  type="button"
                  onClick={selectAllVisible}
                  className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 cursor-pointer"
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
          </div>

          <div className="space-y-2">
            {visiblePool.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                lang={lang}
                selected={selected.includes(task.id)}
                onSelect={toggleSelect}
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
                          <Truck className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
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
                            : 'bg-emerald-100 text-emerald-800'
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
                      <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 truncate max-w-full">
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
        <div className="space-y-2">
              {targets.map((target) => (
                <button
                  key={targetKey(target)}
                  type="button"
                  disabled={busy}
                  onClick={() => void runAssign(target)}
                  className="w-full text-left rounded-2xl border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/50 p-3 transition flex items-center gap-3 disabled:opacity-50 cursor-pointer"
                >
                  <span
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      target.kind === 'crew'
                        ? 'bg-emerald-100 text-emerald-800'
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
      </Sheet>

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
