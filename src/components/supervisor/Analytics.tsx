import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { describeError } from '../../lib/useErrorMessage';
import {
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Loader2,
  MessageCircle,
  RefreshCw,
  ShieldAlert,
  Signal,
  Sparkles,
  Timer,
  Trash2,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n';
import {
  blockerLabel,
  buildBoxCsv,
  buildJobsCsv,
  buildOpsMessage,
  buildTechCsv,
  dbmQuality,
  downloadCsv,
  formatDbm,
  formatMinutes,
  healthMeta,
  timeAgoShort,
  type AnalyticsResponse,
} from '../../lib/registry';
import {
  clearDemoData,
  fetchAnalytics,
  fetchReportJobs,
  seedDemoData,
  type ReportJob,
} from '../../lib/registryService';
import { BoxSheet } from '../registry/BoxSheet';
import { useToast } from '../ui/Toast';

const WINDOWS = [7, 30, 90];

export function Analytics() {
  const { session, activeGroup } = useAuth();
  const { lang } = useLanguage();
  const so = lang === 'so';

  const token = session?.token ?? '';
  const groupId = activeGroup?.id ?? '';

  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [openBoxId, setOpenBoxId] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    if (!token || !groupId) return;
    setLoading(true);
    try {
      const payload = await fetchAnalytics(token, groupId, days);
      setData(payload);
      setError(null);
    } catch (err) {
      setError(describeError(err, lang));
    } finally {
      setLoading(false);
    }
  }, [token, groupId, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = data?.totals;
  const quality = totals ? dbmQuality(totals.bands) : 0;
  const peak = useMemo(
    () => Math.max(1, ...(data?.daily ?? []).map((day) => day.completed)),
    [data],
  );

  const exportCsv = async () => {
    if (!token || !groupId) return;
    setBusy(true);
    try {
      const jobs: ReportJob[] = await fetchReportJobs(token, groupId, days);
      if (jobs.length === 0) {
        setError(so ? 'Xog la dejin karo ma jirto.' : 'There is nothing to export in this window.');
        return;
      }
      const date = new Date().toISOString().slice(0, 10);
      downloadCsv(`telesom-${activeGroup?.code ?? 'F1'}-jobs-${date}.csv`, buildJobsCsv(jobs));
      if (data) {
        downloadCsv(`telesom-${activeGroup?.code ?? 'F1'}-teams-${date}.csv`, buildTechCsv(data.techs));
        downloadCsv(`telesom-${activeGroup?.code ?? 'F1'}-boxes-${date}.csv`, buildBoxCsv(data.boxes));
      }
      toast.success(so ? '3 fayl CSV waa la soo dejiyay' : '3 CSV files downloaded', {
        description: `${jobs.length} ${so ? 'shaqo' : 'jobs'} · ${days} ${so ? 'maalmood' : 'days'}`,
      });
    } catch (err) {
      setError(describeError(err, lang));
    } finally {
      setBusy(false);
    }
  };

  const copyReport = async () => {
    if (!data) return;
    const message = buildOpsMessage({
      analytics: data,
      groupCode: activeGroup?.code ?? 'F1',
      lang,
    });
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      toast.success(so ? 'Warbixinta waa la nuqulay' : 'Report copied', {
        description: so ? 'Ku dheji WhatsApp ama Telegram.' : 'Paste it into WhatsApp or Telegram.',
      });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(so ? 'Nuqul ma suurtogalin.' : 'Could not copy the report.');
    }
  };

  const loadDemo = async () => {
    if (!token || !groupId) return;
    setBusy(true);
    try {
      const result = await seedDemoData(token, groupId);
      toast.success(so ? 'Xogta tijaabada waa lagu daray' : 'Demo history loaded', {
        description: `${result.tasks_created} ${so ? 'shaqo' : 'jobs'} · ${result.logs_created} ${so ? 'dhacdo' : 'incidents'}`,
      });
      await load();
    } catch (err) {
      setError(describeError(err, lang));
    } finally {
      setBusy(false);
    }
  };

  const removeDemo = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const result = await clearDemoData(token);
      toast.success(so ? 'Xogta tijaabada waa la tirtiray' : 'Demo data removed', {
        description: `${result.removed_tasks} ${so ? 'shaqo' : 'jobs'} · ${result.removed_logs} ${so ? 'dhacdo' : 'incidents'}`,
      });
      await load();
    } catch (err) {
      setError(describeError(err, lang));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-extrabold text-slate-900 inline-flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-700" />
            {so ? 'Falanqaynta shaqada' : 'Operations analytics'}
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {so
              ? 'Waxqabadka shaqaalaha iyo caafimaadka cablebox-yada — labadaba hal shaashad.'
              : 'Team output and cablebox health, side by side.'}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1">
          {WINDOWS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setDays(value)}
              className={`px-2.5 h-9 rounded-xl text-[11px] font-bold border transition cursor-pointer ${
                days === value
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200'
              }`}
            >
              {value}
              {so ? 'm' : 'd'}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void load()}
            className="p-2 rounded-xl text-slate-400 hover:bg-white hover:text-slate-600 cursor-pointer"
            title={so ? 'Cusbooneysii' : 'Refresh'}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-[11px] font-semibold text-rose-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="underline cursor-pointer">
            {so ? 'Xir' : 'Dismiss'}
          </button>
        </div>
      )}

      {data && (
        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 flex flex-wrap items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-violet-600 shrink-0" />
          <span className="text-[11px] font-semibold text-slate-600 flex-1">
            {data.demo.tasks > 0
              ? so
                ? `${data.demo.tasks} shaqo tijaabo ah ayaa lagu daray xogta.`
                : `${data.demo.tasks} demo jobs are included in these numbers.`
              : so
                ? 'Xogta dhabta ah oo kaliya ayaa lagu jiraa.'
                : 'Only real data is included.'}
          </span>
          {data.demo.tasks > 0 ? (
            <button
              type="button"
              onClick={() => void removeDemo()}
              disabled={busy}
              className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-bold disabled:opacity-50 cursor-pointer"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              {so ? 'Tirtir tijaabada' : 'Remove demo data'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void loadDemo()}
              disabled={busy}
              className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg bg-violet-50 text-violet-700 border border-violet-200 text-[11px] font-bold disabled:opacity-50 cursor-pointer"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {so ? 'Soo geli tijaabo' : 'Load demo history'}
            </button>
          )}
        </div>
      )}

      {loading && !data && (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
          <Loader2 className="w-6 h-6 text-emerald-700 animate-spin mx-auto mb-2" />
          <p className="text-xs text-slate-500">{so ? 'Falanqaynta waa la xisaabinayaa…' : 'Crunching the numbers…'}</p>
        </div>
      )}

      {totals && data && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            <Kpi
              icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}
              label={so ? 'La dhammeeyay' : 'Completed'}
              value={String(totals.completed)}
              hint={
                totals.urgent_completed > 0
                  ? `${totals.urgent_completed} ${so ? 'degdeg' : 'urgent'}`
                  : so
                    ? 'weli degdeg ma jirto'
                    : 'no urgent jobs'
              }
            />
            <Kpi
              icon={<Timer className="w-4 h-4 text-sky-600" />}
              label={so ? 'Celcelis waqti' : 'Avg time on job'}
              value={formatMinutes(totals.avg_minutes, lang)}
              hint={`${totals.active_days} ${so ? 'maalmood firfircoon' : 'active days'}`}
            />
            <Kpi
              icon={<Signal className="w-4 h-4 text-emerald-600" />}
              label={so ? 'dBm caafimaad' : 'Healthy dBm'}
              value={`${quality}%`}
              hint={`${totals.bands.healthy} / ${totals.bands.healthy + totals.bands.weak + totals.bands.strong} ${so ? 'cabbir' : 'readings'}`}
            />
            <Kpi
              icon={<Clock className="w-4 h-4 text-amber-600" />}
              label={so ? 'Hadda furan' : 'Open now'}
              value={String(totals.open_now)}
              hint={`${totals.running_now} ${so ? 'socda' : 'running'} · ${totals.blocked_now} ${so ? 'caqabad' : 'blocked'}`}
            />
          </div>

          {/* daily trend */}
          <div className="bg-white rounded-2xl border border-slate-200 p-3.5">
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-700" />
              <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                {so ? 'Shaqooyin maalin kasta' : 'Jobs completed per day'}
              </span>
              <span className="ml-auto text-[10px] font-bold text-slate-400">
                {data.window_days} {so ? 'maalmood' : 'days'}
              </span>
            </div>
            <div className="flex items-end gap-[3px] h-24">
              {data.daily.map((day) => (
                <div key={day.date} className="flex-1 flex flex-col items-center justify-end h-full group">
                  <div
                    className={`w-full rounded-t transition ${
                      day.completed > 0 ? 'bg-emerald-600 group-hover:bg-emerald-500' : 'bg-slate-100'
                    }`}
                    style={{ height: `${day.completed === 0 ? 3 : Math.max(6, (day.completed / peak) * 100)}%` }}
                    title={`${day.date} · ${day.completed} ${so ? 'shaqo' : 'jobs'}${day.avg_minutes ? ` · ${formatMinutes(day.avg_minutes, lang)}` : ''}`}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[9px] text-slate-400 mt-1">
              <span>{data.daily[0]?.date ?? ''}</span>
              <span>{data.daily[data.daily.length - 1]?.date ?? ''}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* teams */}
            <div className="bg-white rounded-2xl border border-slate-200 p-3.5">
              <div className="flex items-center gap-1.5 mb-2">
                <Users className="w-3.5 h-3.5 text-sky-700" />
                <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                  {so ? 'Shaqaalaha' : 'Teams & technicians'}
                </span>
              </div>
              {data.techs.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-slate-400">
                  {so ? 'Weli shaqo lama dhammeeyin.' : 'No completed jobs in this window yet.'}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {data.techs.map((tech) => {
                    const top = Math.max(1, ...data.techs.map((row) => row.completed));
                    return (
                      <div key={tech.name} className="rounded-xl border border-slate-100 px-2.5 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-extrabold text-slate-800 truncate flex-1">
                            {tech.name}
                          </span>
                          {tech.running_now > 0 && (
                            <span className="px-1 rounded bg-emerald-100 text-emerald-800 text-[9px] font-extrabold">
                              {tech.running_now} {so ? 'socda' : 'live'}
                            </span>
                          )}
                          {tech.blocked_now > 0 && (
                            <span className="px-1 rounded bg-rose-100 text-rose-700 text-[9px] font-extrabold">
                              {tech.blocked_now} {so ? 'caqabad' : 'blocked'}
                            </span>
                          )}
                          <span className="font-mono text-[11px] font-extrabold text-slate-900">
                            {tech.completed}
                          </span>
                        </div>
                        <div className="mt-1 h-1 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full bg-sky-500"
                            style={{ width: `${(tech.completed / top) * 100}%` }}
                          />
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-2.5 text-[10px] text-slate-500">
                          <span>
                            {formatMinutes(tech.avg_minutes, lang)} {so ? 'celcelis' : 'avg'}
                          </span>
                          <span>
                            {tech.urgent} {so ? 'degdeg' : 'urgent'}
                          </span>
                          {tech.avg_dbm !== null && <span className="font-mono">{formatDbm(tech.avg_dbm)}</span>}
                          {tech.repeats > 0 && (
                            <span className="text-amber-700">
                              {tech.repeats} {so ? 'soo noqod' : 'repeat'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* boxes */}
            <div className="bg-white rounded-2xl border border-slate-200 p-3.5">
              <div className="flex items-center gap-1.5 mb-2">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
                <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                  {so ? 'Caafimaadka cablebox' : 'Cablebox health'}
                </span>
              </div>
              {data.boxes.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-slate-400">
                  {so ? 'Weli sanduuq lama diiwaangelin.' : 'No cableboxes registered yet.'}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {data.boxes.map((box) => {
                    const health = healthMeta(box.health_status, lang);
                    return (
                      <button
                        key={box.id}
                        type="button"
                        onClick={() => setOpenBoxId(box.id)}
                        className="w-full text-left rounded-xl border border-slate-100 px-2.5 py-1.5 hover:border-emerald-300 transition cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-extrabold text-slate-800 truncate flex-1">
                            {box.box_code}
                            {box.xaafada && (
                              <span className="ml-1 font-normal text-slate-400">· {box.xaafada}</span>
                            )}
                          </span>
                          {box.chronic && (
                            <span className="px-1 rounded bg-rose-100 text-rose-700 text-[9px] font-extrabold">
                              {so ? 'SOO NOQNOQDA' : 'CHRONIC'}
                            </span>
                          )}
                          <span className={`w-1.5 h-1.5 rounded-full ${health.dot}`} />
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-x-2.5 text-[10px] text-slate-500">
                          <span className="text-rose-700 font-semibold">
                            {box.faults} {so ? 'cilad' : 'faults'}
                          </span>
                          <span>
                            {box.completed} {so ? 'la dhammeeyay' : 'done'}
                          </span>
                          {box.damaged_ports > 0 && (
                            <span className="text-amber-700">
                              {box.damaged_ports} {so ? 'port burbur' : 'ports damaged'}
                            </span>
                          )}
                          {box.avg_dbm !== null && <span className="font-mono">{formatDbm(box.avg_dbm)}</span>}
                          <span className="ml-auto">{timeAgoShort(box.last_event_at, lang)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* blockers + dbm */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="bg-white rounded-2xl border border-slate-200 p-3.5">
              <div className="flex items-center gap-1.5 mb-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                  {so ? 'Caqabadaha' : 'Blockers'}
                </span>
              </div>
              {data.blockers.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-slate-400">
                  {so ? 'Weli caqabad lama diiwaangelin.' : 'No blockers recorded in this window.'}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {data.blockers.map((blocker) => {
                    const top = Math.max(1, ...data.blockers.map((row) => row.count));
                    return (
                      <div key={blocker.reason}>
                        <div className="flex items-center justify-between text-[10px] font-semibold text-slate-600">
                          <span>{blockerLabel(blocker.reason, lang)}</span>
                          <span className="font-mono">{blocker.count}</span>
                        </div>
                        <div className="mt-0.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full bg-amber-500"
                            style={{ width: `${(blocker.count / top) * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-3.5">
              <div className="flex items-center gap-1.5 mb-2">
                <Signal className="w-3.5 h-3.5 text-emerald-700" />
                <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                  {so ? 'Tayada dBm' : 'dBm quality'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-center">
                <div className="rounded-xl bg-emerald-50 border border-emerald-100 py-2">
                  <div className="text-lg font-extrabold text-emerald-800">{totals.bands.healthy}</div>
                  <div className="text-[9px] font-bold uppercase text-emerald-700">
                    {so ? 'Caafimaad' : 'Healthy'}
                  </div>
                  <div className="text-[9px] text-emerald-600/70">−27…−8</div>
                </div>
                <div className="rounded-xl bg-amber-50 border border-amber-100 py-2">
                  <div className="text-lg font-extrabold text-amber-800">{totals.bands.weak}</div>
                  <div className="text-[9px] font-bold uppercase text-amber-700">
                    {so ? 'Daciif' : 'Weak'}
                  </div>
                  <div className="text-[9px] text-amber-600/70">&lt; −27</div>
                </div>
                <div className="rounded-xl bg-sky-50 border border-sky-100 py-2">
                  <div className="text-lg font-extrabold text-sky-800">{totals.bands.strong}</div>
                  <div className="text-[9px] font-bold uppercase text-sky-700">
                    {so ? 'Xoog' : 'Strong'}
                  </div>
                  <div className="text-[9px] text-sky-600/70">&gt; −8</div>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-slate-500 text-center">
                {so ? 'Celcelis guud' : 'Group average'}:{' '}
                <span className="font-mono font-bold text-slate-700">{formatDbm(totals.avg_dbm)}</span>
              </div>
            </div>
          </div>

          {/* exports */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void exportCsv()}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 h-11 rounded-2xl bg-emerald-700 text-white text-xs font-extrabold disabled:opacity-60 cursor-pointer"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {so ? 'Soo deji CSV' : 'Download CSV'}
            </button>
            <button
              type="button"
              onClick={() => void copyReport()}
              className="inline-flex items-center justify-center gap-2 h-11 rounded-2xl bg-slate-900 text-white text-xs font-extrabold cursor-pointer"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? (so ? 'La nuqulay!' : 'Copied!') : so ? 'Nuqul warbixinta WhatsApp' : 'Copy WhatsApp report'}
            </button>
          </div>
          <p className="text-[10px] text-slate-400 text-center inline-flex items-center justify-center gap-1 w-full">
            <MessageCircle className="w-3 h-3" />
            {so
              ? 'Warbixinta waxay ku habboon tahay WhatsApp ama Telegram kooxda.'
              : 'The report is formatted for the WhatsApp or Telegram group.'}
          </p>
        </>
      )}

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

function Kpi({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
        {icon}
      </div>
      <div className="text-xl font-extrabold text-slate-900">{value}</div>
      <div className="text-[10px] text-slate-500 mt-0.5 truncate">{hint}</div>
    </div>
  );
}
