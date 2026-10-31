import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { describeError } from '../../lib/useErrorMessage';
import { Cable, ChevronRight, MapPin, RefreshCw, Search, Server, Signal } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n';
import {
  healthMeta,
  isChronic,
  portUsage,
  timeAgoShort,
  type BoxSummary,
  type DirectoryResponse,
} from '../../lib/registry';
import { fetchDirectory } from '../../lib/registryService';
import { cacheKeys, readCache, writeCache } from '../../lib/cache';
import { BoxSheet } from '../registry/BoxSheet';
import { Alert } from '../ui/Alert';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Input } from '../ui/Field';
import { SkeletonCard } from '../ui/Skeleton';
import { Tabs } from '../ui/Tabs';
import { cx } from '../ui/cx';
import type { BadgeTone } from '../ui/Badge';

type Filter = 'all' | 'critical' | 'warning' | 'chronic';

/** The registry's status colours, expressed once so the card and the filter agree. */
const HEALTH_TONE: Record<string, BadgeTone> = {
  critical: 'rose',
  warning: 'amber',
  healthy: 'emerald',
};

export function BoxRegistry() {
  const { session, activeGroup } = useAuth();
  const { lang } = useLanguage();
  const so = lang === 'so';

  const token = session?.token ?? '';
  const groupId = activeGroup?.id ?? '';

  /**
   * Paint from the last payload immediately, then revalidate. Coming back to
   * this tab should not cost a second of skeleton for data that is a minute
   * old and about to be refreshed anyway.
   */
  const [data, setData] = useState<DirectoryResponse | null>(() =>
    groupId ? readCache<DirectoryResponse>(cacheKeys.directory(groupId)) : null,
  );
  const [loading, setLoading] = useState(() => !data);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openBoxId, setOpenBoxId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !groupId) return;
    try {
      const payload = await fetchDirectory(token, groupId);
      setData(payload);
      writeCache(cacheKeys.directory(groupId), payload);
      setError(null);
    } catch (err) {
      setError(describeError(err, lang));
    } finally {
      setLoading(false);
    }
  }, [token, groupId, lang]);

  useEffect(() => {
    void load();
  }, [load]);

  const boxes = useMemo(() => data?.boxes ?? [], [data]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return boxes.filter((box) => {
      if (filter === 'critical' && box.health_status !== 'critical') return false;
      if (filter === 'warning' && box.health_status !== 'warning') return false;
      if (filter === 'chronic' && !isChronic(box)) return false;
      if (!needle) return true;
      return [box.box_code, box.xaafada, box.olt_path, box.location_notes]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });
  }, [boxes, filter, query]);

  const counts = useMemo(
    () => ({
      all: boxes.length,
      critical: boxes.filter((b) => b.health_status === 'critical').length,
      warning: boxes.filter((b) => b.health_status === 'warning').length,
      chronic: boxes.filter(isChronic).length,
    }),
    [boxes],
  );

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: so ? 'Dhammaan' : 'All' },
    { id: 'critical', label: so ? 'Halis' : 'Critical' },
    { id: 'warning', label: so ? 'Digniin' : 'Warning' },
    { id: 'chronic', label: so ? 'Soo noqnoqda' : 'Chronic' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-extrabold text-slate-900 inline-flex items-center gap-2">
            <Server className="w-4 h-4 text-emerald-700" aria-hidden="true" />
            {so ? 'Diiwaanka Cablebox' : 'Cablebox registry'}
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {so
              ? 'Port-yada, ciladaha iyo dBm kasta oo sanduuq kasta — farsamayaqaanka soo socda ayaa arki doona.'
              : 'Every port, fault and dBm reading per box — the next technician inherits the history.'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void load()}
          aria-label={so ? 'Cusbooneysii' : 'Refresh'}
          title={so ? 'Cusbooneysii' : 'Refresh'}
          className="text-slate-500"
        >
          <RefreshCw className={cx('w-4 h-4', loading && 'animate-spin')} aria-hidden="true" />
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="flex-1 min-w-0">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={so ? 'Raadi sanduuq ama xaafad…' : 'Search box code or area…'}
            aria-label={so ? 'Raadi sanduuq' : 'Search boxes'}
            leadingIcon={<Search className="w-4 h-4" />}
          />
        </div>
        <Tabs
          variant="bar"
          items={filters.map((item) => ({
            id: item.id,
            label: item.label,
            badge: counts[item.id],
          }))}
          value={filter}
          onChange={setFilter}
          label={so ? 'Shaandhaynta sanduuqa' : 'Box filter'}
          className="shrink-0 overflow-x-auto"
        />
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

      {data && data.demo.tasks > 0 && (
        <Alert tone="note">
          {so
            ? `${data.demo.tasks} shaqo iyo ${data.demo.logs} dhacdo oo tijaabo ah ayaa ku jira.`
            : `${data.demo.tasks} demo jobs and ${data.demo.logs} demo incidents are included.`}
        </Alert>
      )}

      {loading && boxes.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <SkeletonCard key={index} lines={4} />
          ))}
          <span className="sr-only" role="status">
            {so ? 'Diiwaanka waa la soo dejinayaa…' : 'Loading the registry…'}
          </span>
        </div>
      )}

      {!loading && visible.length === 0 && (
        <EmptyState
          icon={<Server className="w-5 h-5" />}
          title={
            boxes.length === 0
              ? so
                ? 'Weli sanduuq lama diiwaangelin'
                : 'No cableboxes registered yet'
              : so
                ? 'Sanduuq lamana helin'
                : 'No cablebox matches this filter'
          }
          description={
            boxes.length === 0
              ? so
                ? 'Sanduuqyada waxay soo galaan marka shaqo la galo oo cablebox-keeda la aqoonsado.'
                : 'Boxes appear as soon as a job is imported with a recognisable cablebox code.'
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

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {visible.map((box) => (
          <BoxCard key={box.id} box={box} lang={lang} onOpen={() => setOpenBoxId(box.id)} />
        ))}
      </div>

      {openBoxId && (
        <BoxSheet
          boxId={openBoxId}
          token={token}
          lang={lang}
          canEdit
          onClose={() => setOpenBoxId(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

function BoxCard({ box, lang, onOpen }: { box: BoxSummary; lang: 'so' | 'en'; onOpen: () => void }) {
  const so = lang === 'so';
  const health = healthMeta(box.health_status, lang);
  const usage = portUsage(box);
  const chronic = isChronic(box);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left bg-white rounded-2xl border border-slate-200 p-3.5 hover:border-emerald-300 hover:shadow-sm transition cursor-pointer"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-extrabold text-slate-900">{box.box_code}</span>
            <Badge tone={HEALTH_TONE[box.health_status] ?? 'slate'}>{health.label}</Badge>
            {chronic && <Badge tone="rose">{so ? 'Soo noqnoqda' : 'Chronic'}</Badge>}
            {box.running_jobs > 0 && (
              <Badge tone="emerald" dot>
                {box.running_jobs} {so ? 'socda' : 'live'}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-slate-500">
            {box.xaafada && (
              <span className="inline-flex items-center gap-0.5">
                <MapPin className="w-2.5 h-2.5" aria-hidden="true" />
                {box.xaafada}
              </span>
            )}
            {box.olt_path && (
              <span className="inline-flex items-center gap-0.5 font-mono truncate max-w-[14rem]">
                <Cable className="w-2.5 h-2.5" aria-hidden="true" />
                {box.olt_path}
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-500 shrink-0 mt-1" aria-hidden="true" />
      </div>

      <div className="mt-2.5">
        <div className="flex items-center justify-between text-[10px] font-bold text-slate-500">
          <span>
            {usage.used}/{box.total_ports} {so ? 'port la isticmaalo' : 'ports in use'}
          </span>
          {box.ports_damaged > 0 && (
            <span className="text-rose-700">
              {box.ports_damaged} {so ? 'burbur' : 'damaged'}
            </span>
          )}
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden flex">
          <div className="bg-sky-500" style={{ width: `${(usage.used / Math.max(1, box.total_ports)) * 100}%` }} />
          <div className="bg-rose-500" style={{ width: `${(box.ports_damaged / Math.max(1, box.total_ports)) * 100}%` }} />
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded-lg bg-slate-50 py-1">
          <div className="text-[10px] font-bold uppercase text-slate-500">{so ? 'Cilado' : 'Faults'}</div>
          <div className={cx('text-xs font-extrabold', box.faults_30d >= 3 ? 'text-rose-700' : 'text-slate-800')}>
            {box.faults_30d}
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 py-1">
          <div className="text-[10px] font-bold uppercase text-slate-500">{so ? 'Dhammaystiran' : 'Done'}</div>
          <div className="text-xs font-extrabold text-slate-800">{box.completed_30d}</div>
        </div>
        <div className="rounded-lg bg-slate-50 py-1">
          <div className="text-[10px] font-bold uppercase text-slate-500 inline-flex items-center gap-0.5">
            <Signal className="w-2.5 h-2.5" aria-hidden="true" /> dBm
          </div>
          <div className="text-xs font-extrabold text-slate-800">
            {box.avg_dbm_30d !== null ? Number(box.avg_dbm_30d).toFixed(1) : '—'}
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
        <span>
          {box.open_jobs > 0
            ? `${box.open_jobs} ${so ? 'shaqo furan' : 'open job(s)'}`
            : so
              ? 'Ma jirto shaqo furan'
              : 'No open jobs'}
        </span>
        <span>{box.last_event_at ? timeAgoShort(box.last_event_at, lang) : so ? 'weli ma jirin' : 'no activity yet'}</span>
      </div>
    </button>
  );
}
