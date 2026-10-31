import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bell, BellRing, CheckCheck, Clock, Plus } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n';
import {
  buildSupervisorNotifications,
  buildTechnicianNotifications,
  type OpsNotification,
} from '../../lib/ops';
import { fetchSupervisorNotifications, fetchTechnicianNotifications } from '../../lib/opsService';
import { useTableChanges, useVisibleInterval } from '../../lib/realtime';
import type { NavIntent } from '../../lib/navigation';
import { Sheet } from './Sheet';
import { Skeleton } from './Skeleton';
import { cx } from './cx';

/**
 * What changed while you were not looking.
 *
 * A technician is told when work lands on their route or a blocker clears; a
 * supervisor is told which jobs are blocked and which have been running far too
 * long. Nothing here is a notification table — it is derived from the job data
 * the app already has, so it cannot drift out of sync with reality.
 *
 * "Seen" is per device and per person: the badge counts what arrived after the
 * last time this bell was opened on this phone.
 */

const seenKey = (userId: string) => `telesom_f1_notif_seen_${userId}`;

const TIME = (iso: string | null): string => {
  if (!iso) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

const TONE_DOT: Record<OpsNotification['tone'], string> = {
  rose: 'bg-rose-500',
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-500',
  sky: 'bg-sky-500',
};

export function NotificationsBell({
  onNavigate,
  className,
}: {
  onNavigate: (intent: NavIntent) => void;
  className?: string;
}) {
  const { session, activeGroup } = useAuth();
  const { lang } = useLanguage();
  const so = lang === 'so';

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OpsNotification[]>([]);
  const [loading, setLoading] = useState(false);
  /**
   * Two clocks, deliberately.
   *
   * `seenAt` is the badge baseline — it moves forward when the bell is opened.
   * `listSince` is frozen when the sheet opens, so the list the person is
   * looking at does not empty itself the instant it is marked read.
   */
  const [listSince, setListSince] = useState<number | null>(null);
  const [seenAt, setSeenAt] = useState<number>(() => {
    if (typeof localStorage === 'undefined' || !session?.user.id) return 0;
    const raw = localStorage.getItem(seenKey(session.user.id));
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  });

  const since = open && listSince !== null ? listSince : seenAt;
  const token = session?.token ?? '';
  const groupId = activeGroup?.id ?? '';
  const isSupervisor = session?.user.role === 'supervisor';
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!token || !groupId) return;
    setLoading(true);
    try {
      if (isSupervisor) {
        const tasks = await fetchSupervisorNotifications(groupId);
        if (!mounted.current) return;
        setItems(buildSupervisorNotifications({ tasks, now: Date.now(), lang }));
      } else {
        const { tasks, resumed } = await fetchTechnicianNotifications({ token, seenAt: since });
        if (!mounted.current) return;
        setItems(
          buildTechnicianNotifications({
            tasks: tasks.map((task) => ({ ...task, status: task.status ?? 'assigned' })),
            resumed,
            seenAt: since,
            lang,
          }),
        );
      }
    } catch {
      // A bell that cannot load is not worth an error card; the next tick retries.
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [token, groupId, isSupervisor, lang, since]);

  useEffect(() => {
    void load();
  }, [load]);

  // New work is a Postgres change, not something to poll for.
  useTableChanges({ table: 'tasks', filter: groupId ? `group_id=eq.${groupId}` : undefined, enabled: Boolean(groupId), onChange: () => void load(), debounceMs: 1500 });
  useVisibleInterval(() => void load(), 180_000, Boolean(groupId));

  const unseen = useMemo(() => items.filter((item) => item.at && new Date(item.at).getTime() > seenAt).length, [items, seenAt]);

  const markSeen = () => {
    const now = Date.now();
    setSeenAt(now);
    try {
      if (session?.user.id) localStorage.setItem(seenKey(session.user.id), String(now));
    } catch {
      // Private mode; the badge simply reappears next time.
    }
  };

  const openSheet = () => {
    // Freeze the list against the old baseline, then move the baseline forward
    // so the badge clears. The effect refetches as `since` changes.
    setListSince(seenAt);
    setOpen(true);
    markSeen();
  };

  const closeSheet = () => {
    setOpen(false);
    setListSince(null);
  };

  const pick = (item: OpsNotification) => {
    onNavigate(
      item.taskId
        ? item.target === 'route'
          ? { to: 'route', taskId: item.taskId }
          : { to: 'dispatch', taskId: item.taskId }
        : { to: item.target === 'route' ? 'route' : 'dispatch' },
    );
    closeSheet();
  };

  const Icon = unseen > 0 ? BellRing : Bell;

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        className={cx(
          'relative inline-flex items-center justify-center h-9 w-9 rounded-lg bg-emerald-900/60 border border-emerald-800/80 text-emerald-100 hover:bg-emerald-800 transition cursor-pointer',
          className,
        )}
        aria-label={
          unseen > 0
            ? so
              ? `Ogeysiisyo, ${unseen} cusub`
              : `Notifications, ${unseen} new`
            : so
              ? 'Ogeysiisyo'
              : 'Notifications'
        }
        title={so ? 'Ogeysiisyo' : 'Notifications'}
      >
        <Icon className="w-4 h-4" aria-hidden="true" />
        {unseen > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-extrabold flex items-center justify-center">
            {unseen > 9 ? '9+' : unseen}
          </span>
        )}
      </button>

      <Sheet
        open={open}
        onClose={closeSheet}
        size="md"
        title={so ? 'Ogeysiisyo' : 'Notifications'}
        description={
          isSupervisor
            ? so
              ? 'Shaqooyin caqabad ku haysata iyo kuwa aad u socda.'
              : 'Jobs with a blocker, and jobs running far too long.'
            : so
              ? 'Shaqo cusub oo kugu soo baxday iyo caqabado la furay.'
              : 'New work on your route and blockers that cleared.'
        }
      >
        {loading && items.length === 0 && (
          <div className="space-y-2" role="status" aria-busy="true">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="py-10 text-center">
            <CheckCheck className="w-8 h-8 text-emerald-600 mx-auto" aria-hidden="true" />
            <p className="mt-2 text-[13px] font-bold text-slate-900">
              {so ? 'Waxba sugaya ma jiro' : 'Nothing needs you right now'}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {isSupervisor
                ? so
                  ? 'Ma jiro shaqo caqabad ku haysata ama aad u socota.'
                  : 'No blocked jobs and no job running unusually long.'
                : so
                  ? 'Shaqooyinkaaga waa la siman yahay.'
                  : 'Your route is up to date.'}
            </p>
          </div>
        )}

        <ul className="space-y-2">
          {items.map((item) => {
            const isNew = Boolean(item.at && new Date(item.at).getTime() > seenAt);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => pick(item)}
                  className="w-full text-left rounded-xl border border-slate-200 bg-white hover:border-emerald-300 px-3 py-2.5 transition cursor-pointer"
                >
                  <div className="flex items-start gap-2.5">
                    <span className={cx('mt-1.5 w-2 h-2 rounded-full shrink-0', TONE_DOT[item.tone])} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-extrabold text-slate-900">
                          {item.title}
                          {isNew && (
                            <span className="ml-1.5 text-[10px] font-extrabold text-emerald-700 uppercase">
                              {so ? 'cusub' : 'new'}
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] font-bold text-slate-500 shrink-0">{TIME(item.at)}</span>
                      </div>
                      <p className="text-[11px] text-slate-600 truncate">{item.detail}</p>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        {items.length > 0 && (
          <div className="mt-3 flex items-start gap-2 text-[10px] text-slate-500">
            {isSupervisor ? (
              <Clock className="w-3 h-3 mt-0.5" aria-hidden="true" />
            ) : (
              <Plus className="w-3 h-3 mt-0.5" aria-hidden="true" />
            )}
            <span>
              {so
                ? 'Liiska waa la cusbooneysiiyaa marka shaqo is beddesho.'
                : 'The list refreshes itself when a job changes.'}
            </span>
          </div>
        )}

        {items.some((item) => item.kind === 'blocked') && (
          <div className="mt-3 flex items-start gap-2 text-[10px] text-amber-700">
            <AlertTriangle className="w-3 h-3 mt-0.5" aria-hidden="true" />
            <span>
              {so
                ? 'Shaqooyinka caqabadka leh waxay u baahan yihiin go’aan: dib u qoondee ama jooji.'
                : 'Blocked jobs need a decision: reassign them or cancel with a reason.'}
            </span>
          </div>
        )}
      </Sheet>
    </>
  );
}
