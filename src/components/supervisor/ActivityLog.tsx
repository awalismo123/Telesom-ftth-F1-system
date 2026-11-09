import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRightCircle,
  Ban,
  CheckCircle2,
  ClipboardList,
  Download,
  History,
  Phone,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Send,
  PauseCircle,
  Search,
  AlertTriangle,
  Camera,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n';
import { useToast } from '../ui/Toast';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Input } from '../ui/Field';
import { SkeletonCard } from '../ui/Skeleton';
import { describeError } from '../../lib/useErrorMessage';
import { fetchActivity, fetchManagerActivity } from '../../lib/reads';
import {
  activityDetail,
  activityLabel,
  activityTone,
  actorsIn,
  buildActivityCsv,
  countByKind,
  filterEvents,
  type ActivityEvent,
  type ActivityKind,
} from '../../lib/activity';
import { PhotoViewer } from '../ui/PhotoViewer';
import { formatDateTime } from '../../lib/format';
import { downloadCsv } from '../../lib/registry';

const WINDOWS = [1, 7, 30];

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  imported: ClipboardList,
  assigned: ArrowRightCircle,
  started: PlayCircle,
  paused: PauseCircle,
  blocked: AlertTriangle,
  resumed: RotateCcw,
  completed: CheckCircle2,
  reopened: RotateCcw,
  cancelled: Ban,
  dispatched: Send,
  manual_created: Phone,
};

const TONES: Record<string, string> = {
  neutral: 'bg-slate-100 text-slate-600 border-slate-200',
  good: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warn: 'bg-amber-50 text-amber-700 border-amber-200',
  bad: 'bg-rose-50 text-rose-700 border-rose-200',
};

/**
 * The record: who did what, when, and to which job.
 *
 * A supervisor's memory used to be the audit trail. Every state change was
 * already being written to `task_work_logs` — this screen is the first time it
 * was readable. It is grouped by day, filterable by action and by person, and
 * exportable, because "show me last Tuesday" is a question that arrives in a
 * meeting and not in the app.
 */
export function ActivityLog({ scope = 'group' }: { scope?: 'group' | 'manager' } = {}) {
  const { session, activeGroup } = useAuth();
  const { lang } = useLanguage();
  const so = lang === 'so';
  const toast = useToast();

  const token = session?.token ?? '';
  const groupId = activeGroup?.id ?? '';

  const [days, setDays] = useState(7);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<ActivityKind | 'all'>('all');
  const [actor, setActor] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [openPhotoId, setOpenPhotoId] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      // A manager's feed is not scoped to one group, so it does not need one.
      if (!token || (scope === 'group' && !groupId)) return;
      if (!silent) setLoading(true);
      try {
        const rows =
          scope === 'manager'
            ? await fetchManagerActivity(token, days, null, 300)
            : await fetchActivity(token, groupId, days, 300);
        setEvents(rows);
        setError(null);
      } catch (err) {
        if (!silent) setError(describeError(err, lang));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [token, groupId, days, lang, scope],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => filterEvents(events, { kind, actor, query }),
    [events, kind, actor, query],
  );

  const counts = useMemo(() => countByKind(events), [events]);
  const people = useMemo(() => actorsIn(events), [events]);

  const grouped = useMemo(() => {
    const buckets = new Map<string, ActivityEvent[]>();
    for (const event of filtered) {
      const key = event.at.slice(0, 10);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(event);
      else buckets.set(key, [event]);
    }
    return [...buckets.entries()];
  }, [filtered]);

  const chipKinds: ActivityKind[] = ['completed', 'blocked', 'assigned', 'started', 'cancelled', 'dispatched'];

  const exportCsv = () => {
    if (filtered.length === 0) {
      setError(so ? 'Wax la dejin karo ma jirto.' : 'There is nothing to export.');
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(
      `telesom-${scope === 'manager' ? 'all-groups' : activeGroup?.code ?? 'F1'}-activity-${stamp}.csv`,
      buildActivityCsv(filtered, lang, scope === 'manager'),
    );
    toast.success(so ? 'Diiwaanka waa la soo dejiyay' : 'Activity exported', {
      description: `${filtered.length} ${so ? 'dhacdo' : 'events'}`,
    });
  };

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
            <History className="w-5 h-5 text-emerald-700" aria-hidden="true" />
            {so ? 'Diiwaanka shaqada' : 'Activity record'}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {scope === 'manager'
              ? so
                ? 'Dhaqdhaqaaqa dhammaan kooxaha — yaa sameeyay, goorma, iyo shaqo tee.'
                : 'Every group in one feed — who did what, when, and to which job.'
              : so
                ? 'Yaa sameeyay, goorma, iyo shaqo tee — mid kasta oo ka mid ah dhaqdhaqaaqa kooxda.'
                : 'Who did what, when, and to which job — every change in the group.'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center rounded-xl border border-slate-200 overflow-hidden">
            {WINDOWS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setDays(value)}
                className={`px-3 h-9 text-[11px] font-bold transition cursor-pointer ${
                  days === value
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {value}
                {so ? 'm' : 'd'}
              </button>
            ))}
          </div>

          <Button variant="secondary" size="sm" onClick={exportCsv}>
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            {so ? 'CSV' : 'CSV'}
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void load()}
            aria-label={so ? 'Cusbooneysii' : 'Refresh'}
            title={so ? 'Cusbooneysii' : 'Refresh'}
            className="text-slate-500"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {error && (
        <Alert tone="danger" onDismiss={() => setError(null)} dismissLabel={so ? 'Xir' : 'Dismiss'}>
          {error}
        </Alert>
      )}

      {/* filters */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setKind('all')}
            className={`px-2.5 h-8 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
              kind === 'all'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            {so ? 'Dhammaan' : 'All'} · {events.length}
          </button>

          {chipKinds
            .filter((value) => (counts[value] ?? 0) > 0)
            .map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                className={`px-2.5 h-8 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                  kind === value
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                {activityLabel(value, lang)} · {counts[value]}
              </button>
            ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={so ? 'Raadi lambar, macmiil, ama qof' : 'Search a line, a customer, or a person'}
              aria-label={so ? 'Raadi' : 'Search'}
              leadingIcon={<Search className="w-4 h-4 text-slate-500" />}
              className="bg-slate-50"
            />
          </div>

          <select
            value={actor}
            onChange={(event) => setActor(event.target.value)}
            aria-label={so ? 'Qofka' : 'Person'}
            className="h-11 px-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 cursor-pointer sm:max-w-[220px]"
          >
            <option value="all">{so ? 'Qof kasta' : 'Everyone'}</option>
            {people.map((person) => (
              <option key={person} value={person}>
                {person}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* feed */}
      {loading && events.length === 0 && (
        <div className="space-y-3">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={4} />
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <EmptyState
          icon={<History className="w-5 h-5" />}
          title={
            events.length === 0
              ? so
                ? 'Weli wax dhacay ma jirto'
                : 'Nothing has happened yet'
              : so
                ? 'Ma jiro wax u dhigma'
                : 'No events match'
          }
          description={
            events.length === 0
              ? so
                ? 'Marka shaqo la qoondeeyo, la bilaabo ama la dhammeeyo, halkan ayay ka muuqan doontaa.'
                : 'Once a job is assigned, started or completed, it appears here.'
              : so
                ? 'Isku day muddo dheer ama ka saar shaandhaynta.'
                : 'Try a longer window, or clear the filters.'
          }
          action={
            events.length > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setKind('all');
                  setActor('all');
                  setQuery('');
                }}
              >
                {so ? 'Nadiifi shaandhaynta' : 'Clear filters'}
              </Button>
            ) : undefined
          }
        />
      )}

      {grouped.map(([day, dayEvents]) => (
        <div key={day} className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
              {formatDateTime(`${day}T00:00:00`, lang).split('·')[0].trim()}
            </span>
            <span className="flex-1 h-px bg-slate-200" />
            <span className="text-[10px] font-bold text-slate-500">
              {dayEvents.length} {so ? 'dhacdo' : dayEvents.length === 1 ? 'event' : 'events'}
            </span>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {dayEvents.map((event, index) => {
              const Icon = ICONS[event.kind] ?? History;
              const detail = activityDetail(event, lang);

              return (
                <div
                  key={`${event.at}-${event.kind}-${event.task_id ?? index}`}
                  className="flex items-start gap-3 px-3 py-2.5"
                >
                  <span
                    className={`mt-0.5 w-7 h-7 shrink-0 rounded-lg border flex items-center justify-center ${
                      TONES[activityTone(event.kind)]
                    }`}
                    aria-hidden="true"
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <span className="text-xs font-extrabold text-slate-900">
                        {activityLabel(event.kind, lang)}
                      </span>
                      {'group_code' in event && (event as { group_code?: string }).group_code && (
                        <span className="font-mono text-[10px] font-extrabold text-emerald-800 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                          {(event as { group_code?: string }).group_code}
                        </span>
                      )}
                      {event.line_number && (
                        <span className="font-mono text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                          {event.line_number}
                        </span>
                      )}
                      {event.customer_name && (
                        <span className="text-[11px] text-slate-600 truncate">
                          {event.customer_name}
                        </span>
                      )}

                      {/* Proof is only shown on the completion that produced it,
                          not on every other event of the same job. */}
                      {event.kind === 'completed' && event.photo_id && (
                        <button
                          type="button"
                          onClick={() => setOpenPhotoId(event.photo_id ?? null)}
                          aria-label={so ? 'Fur sawirka caddaynta' : 'Open the photo proof'}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-extrabold text-emerald-800 cursor-pointer"
                        >
                          <Camera className="w-3 h-3" aria-hidden="true" />
                          {so ? 'Sawir' : 'Photo'}
                        </button>
                      )}
                    </div>

                    <div className="mt-0.5 flex items-center gap-1.5 flex-wrap text-[11px] text-slate-500">
                      <span className="font-semibold text-slate-600">{event.actor}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{formatDateTime(event.at, lang).split('·')[1]?.trim() ?? '—'}</span>
                      {detail && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{detail}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {filtered.length > 0 && (
        <p className="text-center text-[11px] text-slate-500 pb-2">
          {so
            ? `${filtered.length} dhacdo oo la muujiyay · ${events.length} guud ahaan`
            : `${filtered.length} shown · ${events.length} in this window`}
        </p>
      )}

      {openPhotoId && (
        <PhotoViewer token={token} photoId={openPhotoId} onClose={() => setOpenPhotoId(null)} />
      )}
    </div>
  );
}
