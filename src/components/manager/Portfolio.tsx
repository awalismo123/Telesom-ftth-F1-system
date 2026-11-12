import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle2, Clock, Users, ChevronDown, Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n';
import {
  fetchDemoSummary,
  fetchManagerPortfolio,
  fetchManagerTasks,
  type DemoSummary,
  type ManagerPortfolio,
} from '../../lib/reads';
import { portfolioDemoNotice } from '../../lib/demo';
import { isoDaysAgo } from '../../lib/format';
import type { Task } from '../../types/database';
import {
  MANAGER_WINDOWS,
  groupCaption,
  groupTone,
  overdueLabel,
  overdueShare,
  portfolioAgrees,
  rankGroups,
  summarisePortfolio,
  windowLabel,
} from '../../lib/manager';
import { agingBand, waitingDays, agingLabel } from '../../lib/activity';
import { describeError } from '../../lib/useErrorMessage';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { SkeletonCard } from '../ui/Skeleton';
import { formatNumber, formatDateTime } from '../../lib/format';

const TONE_RING: Record<string, string> = {
  good: 'border-slate-200',
  warn: 'border-amber-200 bg-amber-50/40',
  bad: 'border-rose-200 bg-rose-50/40',
};

const STATUS_STYLE: Record<string, string> = {
  unassigned: 'bg-slate-100 text-slate-700 border-slate-200',
  assigned: 'bg-sky-50 text-sky-700 border-sky-200',
  in_progress: 'bg-brand-50 text-brand-700 border-brand-200',
  blocked: 'bg-amber-50 text-amber-800 border-amber-200',
};

/**
 * Every group, side by side.
 *
 * The rule that shapes this screen: a manager compares, they do not act. So
 * there is no checkbox, no assign button and no timer — a tile that opens the
 * jobs behind it, and nothing that can change them.
 */
export function Portfolio() {
  const { session } = useAuth();
  const { lang } = useLanguage();
  const so = lang === 'so';
  const token = session?.token ?? '';

  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<ManagerPortfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoSummary | null>(null);

  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setData(await fetchManagerPortfolio(token, days));
      setError(null);

      // A manager comparing groups must know whether the comparison is against
      // synthetic work. Never blocks the portfolio: a failed count leaves the
      // notice off rather than failing the screen.
      try {
        setDemo(
          await fetchDemoSummary(token, {
            from: isoDaysAgo(days - 1),
            to: null,
          }),
        );
      } catch {
        setDemo(null);
      }
    } catch (err) {
      setError(describeError(err, lang));
    } finally {
      setLoading(false);
    }
  }, [token, days, lang]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => rankGroups(data?.groups ?? []), [data]);
  const summary = useMemo(() => summarisePortfolio(data?.groups ?? []), [data]);
  const agrees = data ? portfolioAgrees(data) : true;

  const toggleGroup = async (groupId: string) => {
    if (openGroupId === groupId) {
      setOpenGroupId(null);
      return;
    }

    setOpenGroupId(groupId);
    setTasks([]);
    setTasksError(null);
    setTasksLoading(true);

    try {
      setTasks(await fetchManagerTasks(token, groupId));
    } catch (err) {
      setTasksError(describeError(err, lang));
    } finally {
      setTasksLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-extrabold text-slate-900 inline-flex items-center gap-2">
            <Building2 className="w-4 h-4 text-brand-700" aria-hidden="true" />
            {so ? 'Guudmarka kooxaha' : 'Group portfolio'}
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {so
              ? 'Koox kasta, hal shaashad — akhris kaliya.'
              : 'Every group on one screen — read only.'}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1">
          {MANAGER_WINDOWS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setDays(value)}
              aria-pressed={days === value}
              className={`h-9 px-2.5 rounded-xl text-[11px] font-extrabold border transition cursor-pointer ${
                days === value
                  ? 'bg-brand-700 text-white border-brand-700'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {windowLabel(value, lang)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <Alert tone="danger" onDismiss={() => setError(null)} dismissLabel={so ? 'Xir' : 'Dismiss'}>
          {error}
        </Alert>
      )}

      {/* Demo disclosure. The group cards below count demo work as real work;
          a manager comparing groups across a window of mixed data is comparing
          a group with synthetic history against one without. */}
      {portfolioDemoNotice(demo, lang) && (
        <Alert tone="warning">{portfolioDemoNotice(demo, lang)}</Alert>
      )}

      {/* A mismatch between the server's totals and its own rows is a bug, and a
          manager is the last person who should be shown a number nobody checked. */}
      {!loading && data && !agrees && (
        <Alert tone="warning">
          {so
            ? 'Tirooyinka guud iyo safka kooxaha isku mid maaha. Warbixinta lama isticmaalin karo ilaa la saxayo.'
            : 'The totals and the group rows disagree. Treat these numbers as unverified.'}
        </Alert>
      )}

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
      )}

      {!loading && data && (
        <>
          {/* headline tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              {
                icon: <Building2 className="w-3.5 h-3.5 text-brand-700" aria-hidden="true" />,
                label: so ? 'Kooxo firfircoon' : 'Live groups',
                value: formatNumber(summary.liveGroups),
                hint: `${formatNumber(data.groups.length)} ${so ? 'guud' : 'total'}`,
              },
              {
                icon: <Clock className="w-3.5 h-3.5 text-sky-700" aria-hidden="true" />,
                label: so ? 'Shaqo furan' : 'Open jobs',
                value: formatNumber(summary.openJobs),
                hint: `${formatNumber(summary.blocked)} ${so ? 'xayiray' : 'blocked'}`,
              },
              {
                icon: <AlertTriangle className="w-3.5 h-3.5 text-rose-700" aria-hidden="true" />,
                label: so ? 'Ka badan 3 maalmood' : 'Over 3 days',
                value: formatNumber(summary.overdue),
                hint: so ? 'Ballanqaadka la dhaafay' : 'Past the promise',
              },
              {
                icon: <CheckCircle2 className="w-3.5 h-3.5 text-brand-700" aria-hidden="true" />,
                label: so ? 'Dhammaatay' : 'Completed',
                value: formatNumber(summary.completed),
                hint: `${formatNumber(summary.photos)} ${so ? 'sawir' : 'photos'} · ${windowLabel(days, lang)}`,
              },
            ].map((tile) => (
              <div key={tile.label} className="bg-white rounded-2xl border border-slate-200 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    {tile.label}
                  </span>
                  {tile.icon}
                </div>
                <div className="text-xl font-extrabold text-slate-900 tabular-nums">{tile.value}</div>
                <div className="text-[10px] text-slate-500 mt-0.5 truncate">{tile.hint}</div>
              </div>
            ))}
          </div>

          {/* groups */}
          <div className="space-y-2">
            {groups.map((group) => {
              const tone = groupTone(group);
              const expanded = openGroupId === group.id;

              return (
                <div
                  key={group.id}
                  className={`rounded-2xl border bg-white overflow-hidden ${TONE_RING[tone]}`}
                >
                  <div className="p-3">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-900 text-white text-xs font-extrabold">
                        {group.code}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-extrabold text-slate-900 truncate">
                          {group.name}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate">
                          {groupCaption(group, lang)}
                        </div>
                      </div>

                      <span
                        className={`shrink-0 rounded-lg border px-1.5 py-0.5 text-[10px] font-extrabold ${
                          tone === 'bad'
                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                            : tone === 'warn'
                              ? 'border-amber-200 bg-amber-50 text-amber-800'
                              : 'border-brand-200 bg-brand-50 text-brand-700'
                        }`}
                      >
                        {overdueLabel(group, lang)}
                      </span>
                    </div>

                    <div className="mt-2 grid grid-cols-4 gap-1.5">
                      {[
                        { label: so ? 'Furan' : 'Open', value: group.active + group.unassigned },
                        { label: so ? 'Xayiray' : 'Blocked', value: group.blocked },
                        { label: so ? 'Daahday' : 'Late', value: group.waiting_over_sla },
                        { label: so ? 'Dhammaatay' : 'Done', value: group.completed },
                      ].map((cell) => (
                        <div key={cell.label} className="rounded-lg bg-slate-50 px-2 py-1.5">
                          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                            {cell.label}
                          </div>
                          <div className="text-sm font-extrabold text-slate-900 tabular-nums">
                            {formatNumber(cell.value)}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* how much of the open work is late */}
                    <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={tone === 'bad' ? 'h-full bg-rose-500' : 'h-full bg-brand-600'}
                        style={{ width: `${Math.round(overdueShare(group) * 100)}%` }}
                      />
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-[10px] text-slate-500 inline-flex items-center gap-1">
                        <Users className="w-3 h-3" aria-hidden="true" />
                        {group.technicians} {so ? 'farsamayaqaan' : 'technicians'}
                      </span>
                      {group.last_activity_at && (
                        <span className="text-[10px] text-slate-500 truncate">
                          · {so ? 'Dhaqdhaqaaqii ugu dambeeyay' : 'Last activity'}{' '}
                          {formatDateTime(group.last_activity_at, lang)}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        className="ml-auto"
                        disabled={group.active + group.unassigned === 0}
                        onClick={() => void toggleGroup(group.id)}
                      >
                        <ChevronDown
                          className={`w-3.5 h-3.5 transition ${expanded ? 'rotate-180' : ''}`}
                          aria-hidden="true"
                        />
                        {so ? 'Shaqooyinka' : 'Open jobs'}
                      </Button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 space-y-1.5">
                      {tasksLoading && (
                        <div className="text-[11px] text-slate-500 inline-flex items-center gap-1.5 py-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                          {so ? 'Soo dejinaya…' : 'Loading…'}
                        </div>
                      )}
                      {tasksError && (
                        <p className="text-[11px] font-semibold text-rose-700">{tasksError}</p>
                      )}
                      {!tasksLoading && !tasksError && tasks.length === 0 && (
                        <p className="text-[11px] text-slate-500 py-2">
                          {so ? 'Ma jiraan shaqooyin furan.' : 'No open jobs in this group.'}
                        </p>
                      )}
                      {!tasksLoading &&
                        tasks.map((task) => {
                          const daysWaiting = waitingDays(task);
                          const band = agingBand(daysWaiting);
                          return (
                            <div
                              key={task.id}
                              className="flex items-center gap-2 rounded-lg bg-white border border-slate-200 px-2 py-1.5"
                            >
                              <span className="font-mono text-[10px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                                {task.line_number}
                              </span>
                              <span className="text-[11px] text-slate-700 truncate min-w-0 flex-1">
                                {task.customer_name}
                              </span>
                              {task.xaafada && (
                                <span className="hidden sm:inline text-[10px] text-slate-500 truncate max-w-[110px]">
                                  {task.xaafada}
                                </span>
                              )}
                              {band !== 'fresh' && daysWaiting !== null && (
                                <span
                                  className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-extrabold ${
                                    band === 'late'
                                      ? 'border-rose-200 bg-rose-50 text-rose-700'
                                      : 'border-amber-200 bg-amber-50 text-amber-800'
                                  }`}
                                >
                                  {agingLabel(daysWaiting, lang)}
                                </span>
                              )}
                              <span
                                className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                                  STATUS_STYLE[task.status] ?? 'bg-slate-100 text-slate-700 border-slate-200'
                                }`}
                              >
                                {task.status.replace('_', ' ')}
                              </span>
                            </div>
                          );
                        })}
                      <p className="text-[10px] text-slate-500 pt-0.5">
                        {so
                          ? 'Liiskan waa akhris kaliya — maamulaha ma beddeli karo shaqada.'
                          : 'This list is read-only — a manager cannot change a job.'}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {groups.length === 0 && (
            <EmptyState
              icon={<Building2 className="w-6 h-6" aria-hidden="true" />}
              title={so ? 'Ma jiraan kooxo' : 'No groups yet'}
              description={so ? 'Kooxaha waxay ka muuqan doonaan halkan.' : 'Groups will appear here.'}
            />
          )}

          <p className="text-[10px] text-slate-500 text-center">
            {so
              ? `Guud ahaan ${formatNumber(summary.openJobs)} shaqo furan oo dhammaan kooxaha ah · ${windowLabel(days, lang)}.`
              : `${formatNumber(summary.openJobs)} open jobs across every group · ${windowLabel(days, lang)} completed window.`}
          </p>
        </>
      )}
    </div>
  );
}
