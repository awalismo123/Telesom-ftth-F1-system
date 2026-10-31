import React, { useCallback, useEffect, useState } from 'react';
import { describeError } from '../../lib/useErrorMessage';
import { invalidateCache } from '../../lib/cache';
import {
  AlertTriangle,
  Cable,
  Clock,
  History,
  Loader2,
  MapPin,
  RefreshCw,
  Signal,
  Wrench,
  X,
} from 'lucide-react';
import {
  eventLabel,
  formatDbm,
  formatMinutes,
  healthMeta,
  portUsage,
  timeAgoShort,
  type BoxDetail,
  type Lang,
  type PortStatus,
} from '../../lib/registry';
import { fetchBoxDetail, setPortStatus } from '../../lib/registryService';
import { formatClock } from '../../lib/execution';
import { PortGrid } from './PortGrid';
import { useToast } from '../ui/Toast';
import { useLanguage } from '../../lib/i18n';

const PORT_LABEL_EN: Record<PortStatus, string> = {
  free: 'Free', occupied: 'In use', damaged: 'Damaged', reserved: 'Reserved', unknown: 'Not checked',
};
const PORT_LABEL_SO: Record<PortStatus, string> = {
  free: 'Banaan', occupied: 'La isticmaalo', damaged: 'Burbur', reserved: 'Kaydsan', unknown: 'Aan la hubin',
};

interface Props {
  boxId: string;
  token: string;
  lang: Lang;
  canEdit: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

/**
 * One cablebox, everything about it: port map, health, every incident and
 * every job done there. Used by the supervisor registry and by the technician.
 */
export function BoxSheet({ boxId, token, lang, canEdit, onClose, onChanged }: Props) {
  const so = lang === 'so';
  const toast = useToast();
  const [detail, setDetail] = useState<BoxDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'ports' | 'history' | 'jobs'>('ports');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchBoxDetail(token, boxId);
      setDetail(data);
      setError(null);
    } catch (err) {
      setError(describeError(err, lang));
    } finally {
      setLoading(false);
    }
  }, [token, boxId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const savePort = async (port: number, status: PortStatus, notes?: string) => {
    await setPortStatus({ token, boxId, portNumber: port, status, notes });
    toast.success(
      so ? `Port ${port} waa la cusboonaysiiyay` : `Port ${port} updated`,
      { description: so ? PORT_LABEL_SO[status] : PORT_LABEL_EN[status] },
    );
    await load();
    invalidateCache('directory:');
    invalidateCache('analytics:');
    onChanged?.();
  };

  const box = detail?.box;
  const health = box ? healthMeta(box.health_status, lang) : null;
  const usage = box ? portUsage(box) : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="bg-slate-50 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[94vh] flex flex-col">
        {/* header */}
        <div className="bg-white rounded-t-3xl border-b border-slate-100 px-4 py-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[17px] font-extrabold text-slate-900">
                  {box?.box_code ?? (so ? 'Cablebox' : 'Cablebox')}
                </h2>
                {health && (
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold border ${health.chip}`}>
                    {health.label}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                {box?.xaafada && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {box.xaafada}
                  </span>
                )}
                {box?.olt_path && (
                  <span className="inline-flex items-center gap-1 font-mono text-[10px]">
                    <Cable className="w-3 h-3" />
                    {box.olt_path}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              title={so ? 'Cusbooneysii' : 'Refresh'}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close / Xir"
              title="Close / Xir"
              className="p-2 -mr-1 rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-4 py-3 space-y-3">
          {loading && !detail && (
            <div className="py-10 text-center">
              <Loader2 className="w-6 h-6 text-emerald-700 animate-spin mx-auto mb-2" />
              <p className="text-xs text-slate-500">{so ? 'Waa la soo dejinayaa…' : 'Loading…'}</p>
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-[11px] font-semibold text-rose-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="flex-1">{error}</span>
              <button type="button" onClick={() => void load()} className="underline cursor-pointer">
                {so ? 'Isku day' : 'Retry'}
              </button>
            </div>
          )}

          {box && detail && (
            <>
              {/* stats */}
              <div className="grid grid-cols-4 gap-1.5">
                <div className="rounded-xl bg-white border border-slate-200 px-2 py-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    {so ? 'Port-yada' : 'Ports'}
                  </div>
                  <div className="text-sm font-extrabold text-slate-900">
                    {usage?.used}/{box.total_ports}
                  </div>
                </div>
                <div className="rounded-xl bg-white border border-slate-200 px-2 py-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    {so ? 'Cilado 30m' : 'Faults 30d'}
                  </div>
                  <div className="text-sm font-extrabold text-rose-700">{detail.stats.faults_30d}</div>
                </div>
                <div className="rounded-xl bg-white border border-slate-200 px-2 py-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">dBm</div>
                  <div className="text-sm font-extrabold text-slate-900">
                    {detail.stats.last_dbm !== null ? Number(detail.stats.last_dbm).toFixed(1) : '—'}
                  </div>
                </div>
                <div className="rounded-xl bg-white border border-slate-200 px-2 py-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    {so ? 'Celcelis' : 'Avg time'}
                  </div>
                  <div className="text-sm font-extrabold text-slate-900">
                    {formatMinutes(detail.stats.avg_minutes, lang)}
                  </div>
                </div>
              </div>

              {box.location_notes && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] font-semibold text-amber-900 flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{box.location_notes}</span>
                </div>
              )}

              {/* tabs */}
              <div className="flex gap-1">
                {(
                  [
                    ['ports', so ? 'Port-yada' : 'Ports', <Signal key="p" className="w-3.5 h-3.5" />],
                    ['history', so ? 'Taariikh' : 'History', <History key="h" className="w-3.5 h-3.5" />],
                    ['jobs', so ? 'Shaqooyin' : 'Jobs', <Wrench key="j" className="w-3.5 h-3.5" />],
                  ] as const
                ).map(([key, label, icon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-xl text-[11px] font-extrabold transition cursor-pointer ${
                      tab === key
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-500 border border-slate-200'
                    }`}
                  >
                    {icon}
                    {label}
                  </button>
                ))}
              </div>

              {tab === 'ports' && (
                <div className="rounded-2xl bg-white border border-slate-200 p-2.5">
                  <PortGrid
                    ports={detail.ports}
                    totalPorts={box.total_ports}
                    lang={lang}
                    canEdit={canEdit}
                    onSave={savePort}
                  />
                </div>
              )}

              {tab === 'history' && (
                <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
                  {detail.incidents.length === 0 && (
                    <p className="px-3 py-6 text-center text-[11px] text-slate-500">
                      {so ? 'Weli wax dhacdo ah lama diiwaangelin.' : 'No incidents recorded for this box yet.'}
                    </p>
                  )}
                  <ul className="divide-y divide-slate-100">
                    {detail.incidents.map((incident) => (
                      <li key={incident.id} className="px-3 py-2 flex items-start gap-2">
                        <span
                          className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                            incident.event_type === 'fiber_break' || incident.event_type === 'port_damaged'
                              ? 'bg-rose-500'
                              : incident.event_type === 'box_full'
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-bold text-slate-800">
                            {eventLabel(incident.event_type, lang)}
                            {incident.port_number !== null && (
                              <span className="ml-1 font-mono font-normal text-slate-500">
                                P{incident.port_number}
                              </span>
                            )}
                            {incident.optical_dbm !== null && (
                              <span className="ml-1 font-mono font-normal text-emerald-700">
                                {formatDbm(incident.optical_dbm)}
                              </span>
                            )}
                            {incident.is_demo && (
                              <span className="ml-1 px-1 rounded bg-slate-100 text-slate-500 text-[10px] font-bold">
                                DEMO
                              </span>
                            )}
                          </div>
                          {incident.notes && (
                            <div className="text-[10px] text-slate-500 italic">“{incident.notes}”</div>
                          )}
                          <div className="text-[10px] text-slate-500">
                            {incident.logged_by ?? '—'}
                            {incident.line_number ? ` · line ${incident.line_number}` : ''}
                          </div>
                        </div>
                        <span className="text-[10px] text-slate-500 shrink-0">
                          {timeAgoShort(incident.created_at, lang)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {tab === 'jobs' && (
                <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
                  {detail.jobs.length === 0 && (
                    <p className="px-3 py-6 text-center text-[11px] text-slate-500">
                      {so ? 'Weli shaqo lagama diiwaangelin sanduuqan.' : 'No jobs recorded on this box yet.'}
                    </p>
                  )}
                  <ul className="divide-y divide-slate-100">
                    {detail.jobs.map((job) => (
                      <li key={job.id} className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] font-bold text-slate-600 bg-slate-100 px-1 rounded">
                            {job.line_number}
                          </span>
                          <span className="text-[11px] font-bold text-slate-800 truncate flex-1">
                            {job.customer_name}
                          </span>
                          <span
                            className={`text-[10px] font-extrabold px-1 rounded ${
                              job.status === 'completed'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-amber-50 text-amber-700'
                            }`}
                          >
                            {job.status.toUpperCase()}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-slate-500">
                          {job.port_number !== null && <span className="font-mono">P{job.port_number}</span>}
                          {job.optical_dbm !== null && <span className="font-mono">{formatDbm(job.optical_dbm)}</span>}
                          {job.duration_seconds > 0 && (
                            <span className="inline-flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" />
                              {formatClock(job.duration_seconds)}
                            </span>
                          )}
                          <span>{job.worker ?? '—'}</span>
                          <span className="ml-auto">{timeAgoShort(job.completed_at, lang)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
