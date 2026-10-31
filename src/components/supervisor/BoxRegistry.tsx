import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { describeError } from '../../lib/useErrorMessage';
import {
  AlertTriangle,
  Cable,
  ChevronRight,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  Server,
  Signal,
  Zap,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n';
import {
  formatDbm,
  healthMeta,
  isChronic,
  portUsage,
  timeAgoShort,
  type BoxSummary,
  type DirectoryResponse,
} from '../../lib/registry';
import { fetchDirectory } from '../../lib/registryService';
import { BoxSheet } from '../registry/BoxSheet';

type Filter = 'all' | 'critical' | 'warning' | 'chronic';

export function BoxRegistry() {
  const { session, activeGroup } = useAuth();
  const { lang } = useLanguage();
  const so = lang === 'so';

  const token = session?.token ?? '';
  const groupId = activeGroup?.id ?? '';

  const [data, setData] = useState<DirectoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openBoxId, setOpenBoxId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !groupId) return;
    try {
      const payload = await fetchDirectory(token, groupId);
      setData(payload);
      setError(null);
    } catch (err) {
      setError(describeError(err, lang));
    } finally {
      setLoading(false);
    }
  }, [token, groupId]);

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

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-extrabold text-slate-900 inline-flex items-center gap-2">
            <Server className="w-4 h-4 text-emerald-700" />
            {so ? 'Diiwaanka Cablebox' : 'Cablebox registry'}
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {so
              ? 'Port-yada, ciladaha iyo dBm kasta oo sanduuq kasta — farsamayaqaanka soo socda ayaa arki doona.'
              : 'Every port, fault and dBm reading per box — the next technician inherits the history.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto p-2 rounded-xl text-slate-400 hover:bg-white hover:text-slate-600 cursor-pointer"
          title={so ? 'Cusbooneysii' : 'Refresh'}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* search + filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={so ? 'Raadi sanduuq ama xaafad…' : 'Search box code or area…'}
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {(
            [
              ['all', so ? 'Dhammaan' : 'All', counts.all],
              ['critical', so ? 'Halis' : 'Critical', counts.critical],
              ['warning', so ? 'Digniin' : 'Warning', counts.warning],
              ['chronic', so ? 'Soo noqnoqda' : 'Chronic', counts.chronic],
            ] as [Filter, string, number][]
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`whitespace-nowrap px-3 h-10 rounded-xl text-[11px] font-bold border transition cursor-pointer ${
                filter === key
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200'
              }`}
            >
              {label} <span className="opacity-60">{count}</span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-[11px] font-semibold text-rose-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => void load()} className="underline cursor-pointer">
            {so ? 'Isku day' : 'Retry'}
          </button>
        </div>
      )}

      {data && data.demo.tasks > 0 && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 px-3 py-2 text-[11px] font-semibold text-violet-800 flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 shrink-0" />
          {so
            ? `${data.demo.tasks} shaqo iyo ${data.demo.logs} dhacdo oo tijaabo ah ayaa ku jira.`
            : `${data.demo.tasks} demo jobs and ${data.demo.logs} demo incidents are included.`}
        </div>
      )}

      {loading && boxes.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
          <Loader2 className="w-6 h-6 text-emerald-700 animate-spin mx-auto mb-2" />
          <p className="text-xs text-slate-500">{so ? 'Diiwaanka waa la soo dejinayaa…' : 'Loading the registry…'}</p>
        </div>
      )}

      {!loading && visible.length === 0 && (
        <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center space-y-1">
          <Server className="w-7 h-7 text-slate-300 mx-auto" />
          <p className="text-xs font-semibold text-slate-600">
            {so ? 'Sanduuq lamana helin.' : 'No cablebox matches this filter.'}
          </p>
        </div>
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
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold border ${health.chip}`}>
              {health.label}
            </span>
            {chronic && (
              <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[9px] font-extrabold">
                {so ? 'SOO NOQNOQDA' : 'CHRONIC'}
              </span>
            )}
            {box.running_jobs > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[9px] font-extrabold inline-flex items-center gap-0.5">
                <span className="w-1 h-1 rounded-full bg-emerald-600 animate-pulse" />
                {box.running_jobs} {so ? 'socda' : 'live'}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-slate-500">
            {box.xaafada && (
              <span className="inline-flex items-center gap-0.5">
                <MapPin className="w-2.5 h-2.5" />
                {box.xaafada}
              </span>
            )}
            {box.olt_path && (
              <span className="inline-flex items-center gap-0.5 font-mono truncate max-w-[14rem]">
                <Cable className="w-2.5 h-2.5" />
                {box.olt_path}
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300 shrink-0 mt-1" />
      </div>

      {/* port usage bar */}
      <div className="mt-2.5">
        <div className="flex items-center justify-between text-[10px] font-bold text-slate-500">
          <span>
            {usage.used}/{box.total_ports} {so ? 'port la isticmaalo' : 'ports in use'}
          </span>
          {box.ports_damaged > 0 && (
            <span className="text-rose-600">
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
          <div className="text-[9px] font-bold uppercase text-slate-400">{so ? 'Cilado' : 'Faults'}</div>
          <div className={`text-xs font-extrabold ${box.faults_30d >= 3 ? 'text-rose-700' : 'text-slate-800'}`}>
            {box.faults_30d}
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 py-1">
          <div className="text-[9px] font-bold uppercase text-slate-400">{so ? 'Dhammaystiran' : 'Done'}</div>
          <div className="text-xs font-extrabold text-slate-800">{box.completed_30d}</div>
        </div>
        <div className="rounded-lg bg-slate-50 py-1">
          <div className="text-[9px] font-bold uppercase text-slate-400 inline-flex items-center gap-0.5">
            <Signal className="w-2.5 h-2.5" /> dBm
          </div>
          <div className="text-xs font-extrabold text-slate-800">
            {box.avg_dbm_30d !== null ? Number(box.avg_dbm_30d).toFixed(1) : '—'}
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
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
