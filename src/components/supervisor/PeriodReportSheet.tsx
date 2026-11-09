import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileText, Printer, RefreshCw, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n';
import { useToast } from '../ui/Toast';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { describeError } from '../../lib/useErrorMessage';
import {
  fetchManagerReport,
  fetchPeriodReport,
  type ManagerReport,
  type PeriodReport,
} from '../../lib/reads';
import { formatDate, formatDbm, formatDuration, formatNumber, todayKey } from '../../lib/format';
import { BUILD_LABEL } from '../../lib/version';
import { downloadCsv } from '../../lib/registry';

/**
 * One period, on one page, printable.
 *
 * "Print to PDF" is deliberate: the browser's own print dialogue is the most
 * reliable PDF generator on earth, it costs no bundle bytes, and it is the one
 * a manager already knows. Everything else here is about making that page look
 * like a report rather than a screenshot of a web app — so the sheet renders in
 * a portal on `document.body`, the app hides itself in print, and the numbers
 * are laid out for A4 rather than for a phone.
 */

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return todayKey(date);
}

const PRESETS: { id: string; days: number | 'month' | 'lastMonth'; en: string; so: string }[] = [
  { id: 'today', days: 0, en: 'Today', so: 'Maanta' },
  { id: 'week', days: 6, en: '7 days', so: '7 maalmood' },
  { id: 'month', days: 'month', en: 'This month', so: 'Bishan' },
  { id: 'last', days: 'lastMonth', en: 'Last month', so: 'Bishii hore' },
];

export function PeriodReportSheet({
  open,
  onClose,
  scope = 'group',
}: {
  open: boolean;
  onClose: () => void;
  /** `manager` renders every group and adds a per-group table. */
  scope?: 'group' | 'manager';
}) {
  const { session, activeGroup } = useAuth();
  const { lang } = useLanguage();
  const so = lang === 'so';
  const toast = useToast();

  const token = session?.token ?? '';
  const groupId = activeGroup?.id ?? '';

  const [from, setFrom] = useState(() => isoDaysAgo(6));
  const [to, setTo] = useState(() => todayKey());
  const [preset, setPreset] = useState<string>('week');
  const [report, setReport] = useState<PeriodReport | ManagerReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    if (scope === 'group' && !groupId) return;
    setLoading(true);
    try {
      const payload =
        scope === 'manager'
          ? await fetchManagerReport(token, from, to)
          : await fetchPeriodReport(token, groupId, from, to);
      setReport(payload);
      setError(null);
    } catch (err) {
      setError(describeError(err, lang));
    } finally {
      setLoading(false);
    }
  }, [token, groupId, from, to, lang, scope]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  // Escape closes, like every other sheet in the app.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const applyPreset = (id: string) => {
    setPreset(id);
    const today = new Date();

    if (id === 'today') {
      setFrom(todayKey(today));
      setTo(todayKey(today));
      return;
    }
    if (id === 'week') {
      setFrom(isoDaysAgo(6));
      setTo(todayKey(today));
      return;
    }
    if (id === 'month') {
      setFrom(todayKey(new Date(today.getFullYear(), today.getMonth(), 1)));
      setTo(todayKey(today));
      return;
    }
    // last month, whole
    const firstOfLast = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastOfLast = new Date(today.getFullYear(), today.getMonth(), 0);
    setFrom(todayKey(firstOfLast));
    setTo(todayKey(lastOfLast));
  };

  const totals = report?.totals;
  const peak = useMemo(
    () => Math.max(1, ...(report?.daily ?? []).map((day) => Math.max(day.completed, day.created))),
    [report],
  );

  const exportCsv = () => {
    if (!report || !totals) return;
    const rows: (string | number)[][] = [
      [so ? 'Warbixinta xilliga' : 'Period report', `${report.from} → ${report.to}`],
      [],
      [so ? 'Cusub' : 'New jobs', totals.created],
      [so ? 'Dhammaatay' : 'Completed', totals.completed],
      [so ? 'La tirtiray' : 'Cancelled', totals.cancelled],
      [so ? 'Furan' : 'Open at end', totals.open_at_end],
      [so ? 'Ka badan 3 maalmood' : 'Waiting over 3 days', totals.waiting_over_sla],
      [so ? 'Celcelis daqiiqo' : 'Average minutes', totals.avg_minutes],
      ['dBm', totals.avg_dbm ?? '—'],
      [so ? 'Qorshayaal la diray' : 'Plans sent', totals.dispatches],
      [],
      [so ? 'Farsamayaqaan' : 'Technician', so ? 'Dhammaatay' : 'Completed', so ? 'Daqiiqo' : 'Minutes', 'dBm'],
      ...(report.techs ?? []).map((tech) => [tech.name, tech.completed, tech.avg_minutes, tech.avg_dbm ?? '']),
      [],
      [so ? 'Sanduuq' : 'Box', so ? 'Cillado' : 'Faults', so ? 'Ports xun' : 'Damaged ports'],
      ...(report.boxes ?? []).map((box) => [box.box_code, box.faults, box.damaged_ports]),
    ];

    // A manager's export starts with the comparison, because that is the reason
    // they asked for it.
    const groupRows = (report as ManagerReport).groups;
    if (scope === 'manager' && Array.isArray(groupRows)) {
      rows.splice(2, 0,
        [so ? 'Koox' : 'Group', so ? 'Cusub' : 'New', so ? 'Dhammaatay' : 'Done', so ? 'Daahday' : 'Late'],
        ...groupRows.map((group) => [
          group.code,
          group.totals.created,
          group.totals.completed,
          group.totals.waiting_over_sla,
        ]),
        [],
      );
    }

    downloadCsv(
      `telesom-${scope === 'manager' ? 'all-groups' : activeGroup?.code ?? 'F1'}-report-${report.from}_${report.to}.csv`,
      rows.map((row) => row.map((cell) => String(cell ?? '')).join(',')).join('\n'),
    );
    toast.success(so ? 'Warbixinta waa la soo dejiyay' : 'Report exported');
  };

  if (!open) return null;

  const content = (
    <div
      className="print-root fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm overflow-y-auto"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="min-h-full flex justify-center p-3 sm:p-6">
        <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden print:shadow-none print:rounded-none print:max-w-none">
          {/* toolbar — never printed */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50 no-print">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <FileText className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
              <span className="text-sm font-extrabold text-slate-900 truncate">
                {so ? 'Warbixinta xilliga' : 'Period report'}
              </span>
            </div>

            <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!report}>
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              CSV
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={() => window.print()}
              disabled={!report}
              className="print:hidden"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden="true" />
              {so ? 'Daabac / PDF' : 'Print / PDF'}
            </Button>

            <button
              type="button"
              onClick={onClose}
              aria-label={so ? 'Xir' : 'Close'}
              title={so ? 'Xir' : 'Close'}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* period picker — never printed */}
          <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-end gap-2 no-print">
            {PRESETS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => applyPreset(option.id)}
                className={`px-2.5 h-8 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                  preset === option.id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                {so ? option.so : option.en}
              </button>
            ))}

            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 ml-auto">
              {so ? 'Laga bilaabo' : 'From'}
              <input
                type="date"
                value={from}
                max={to}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setPreset('');
                }}
                className="block mt-0.5 h-9 px-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800"
              />
            </label>

            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              {so ? 'Ilaa' : 'To'}
              <input
                type="date"
                value={to}
                min={from}
                onChange={(event) => {
                  setTo(event.target.value);
                  setPreset('');
                }}
                className="block mt-0.5 h-9 px-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800"
              />
            </label>

            <Button variant="ghost" size="icon-sm" onClick={() => void load()} aria-label={so ? 'Cusbooneysii' : 'Refresh'}>
              <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {error && (
            <div className="p-4 no-print">
              <Alert tone="danger" onDismiss={() => setError(null)} dismissLabel={so ? 'Xir' : 'Dismiss'}>
                {error}
              </Alert>
            </div>
          )}

          {/* the report itself */}
          {report && totals && (
            <div className="p-5 sm:p-7 space-y-5 print:p-0">
              {/* letterhead */}
              <div className="flex items-start justify-between gap-4 border-b-2 border-slate-900 pb-3">
                <div>
                  <div className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-emerald-800">
                    Telesom · Fixed Broadband
                  </div>
                  <h1 className="text-xl font-extrabold text-slate-900 leading-tight">
                    {so ? 'Warbixinta Xilliga' : 'Period Report'}
                  </h1>
                  <div className="text-xs font-semibold text-slate-600 mt-0.5">
                    {scope === 'manager'
                      ? so
                        ? 'Dhammaan kooxaha'
                        : 'All groups'
                      : `${so ? 'Kooxda' : 'Group'} ${activeGroup?.code ?? 'F1'}${
                          activeGroup?.name ? ` · ${activeGroup.name}` : ''
                        }`}
                  </div>
                </div>
                <div className="text-right text-[11px] text-slate-600 leading-relaxed">
                  <div className="font-extrabold text-slate-900 tabular-nums">
                    {formatDate(report.from, lang)} — {formatDate(report.to, lang)}
                  </div>
                  <div>
                    {so ? 'La sameeyay' : 'Generated'}: {formatDate(todayKey(), lang)}
                  </div>
                  <div className="truncate max-w-[180px]">{session?.user.full_name}</div>
                </div>
              </div>

              {/* headline numbers */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: so ? 'Cusub' : 'New jobs', value: formatNumber(totals.created) },
                  { label: so ? 'Dhammaatay' : 'Completed', value: formatNumber(totals.completed) },
                  { label: so ? 'La tirtiray' : 'Cancelled', value: formatNumber(totals.cancelled) },
                  { label: so ? 'Furan' : 'Open at end', value: formatNumber(totals.open_at_end) },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl border border-slate-200 px-3 py-2 print-block">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      {stat.label}
                    </div>
                    <div className="text-lg font-extrabold text-slate-900 tabular-nums">{stat.value}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-xl border border-slate-200 px-3 py-2 print-block">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {so ? 'Celcelis waqti' : 'Average time'}
                  </div>
                  <div className="text-sm font-extrabold text-slate-900">
                    {formatDuration(totals.avg_minutes * 60)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 px-3 py-2 print-block">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {so ? 'Celcelis dBm' : 'Average dBm'}
                  </div>
                  <div className="text-sm font-extrabold text-slate-900">{formatDbm(totals.avg_dbm)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 px-3 py-2 print-block">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {so ? 'Qorshayaal la diray' : 'Plans sent'}
                  </div>
                  <div className="text-sm font-extrabold text-slate-900 tabular-nums">
                    {formatNumber(totals.dispatches)}
                  </div>
                </div>
                <div
                  className={`rounded-xl border px-3 py-2 print-block ${
                    totals.waiting_over_sla > 0
                      ? 'border-rose-200 bg-rose-50'
                      : 'border-emerald-200 bg-emerald-50'
                  }`}
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                    {so ? 'Ka badan 3 maalmood' : 'Waiting over 3 days'}
                  </div>
                  <div className="text-sm font-extrabold text-slate-900 tabular-nums">
                    {formatNumber(totals.waiting_over_sla)}
                  </div>
                </div>
              </div>

              {/* Evidence: the question after "how many did you finish". */}
              <p className="text-[10px] text-slate-600 print-block">
                {so
                  ? `${formatNumber(totals.photos)} sawir caddayn ah ayaa lagu daray shaqooyinka la dhammeeyay.`
                  : `${formatNumber(totals.photos)} photo proofs were attached to completed jobs.`}
              </p>

              {scope === 'manager' && Array.isArray((report as ManagerReport).groups) && (
                <section className="print-block">
                  <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 mb-2">
                    {so ? 'Koox kasta' : 'By group'}
                  </h2>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-slate-500 border-b border-slate-300">
                        <th className="py-1 font-bold">{so ? 'Koox' : 'Group'}</th>
                        <th className="py-1 font-bold text-right">{so ? 'Cusub' : 'New'}</th>
                        <th className="py-1 font-bold text-right">{so ? 'Dhammaatay' : 'Done'}</th>
                        <th className="py-1 font-bold text-right">{so ? 'Daahday' : 'Late'}</th>
                        <th className="py-1 font-bold text-right">{so ? 'Sawir' : 'Photos'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(report as ManagerReport).groups.map((group) => (
                        <tr key={group.id} className="border-b border-slate-100">
                          <td className="py-1 font-extrabold text-slate-900">{group.code}</td>
                          <td className="py-1 text-right tabular-nums">{formatNumber(group.totals.created)}</td>
                          <td className="py-1 text-right tabular-nums">{formatNumber(group.totals.completed)}</td>
                          <td
                            className={`py-1 text-right tabular-nums ${
                              group.totals.waiting_over_sla > 0 ? 'text-rose-700 font-bold' : ''
                            }`}
                          >
                            {formatNumber(group.totals.waiting_over_sla)}
                          </td>
                          <td className="py-1 text-right tabular-nums">{formatNumber(group.totals.photos)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {/* daily trend */}
              <section className="print-block">
                <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 mb-2">
                  {so ? 'Maalin kasta' : 'Day by day'}
                </h2>
                <div className="flex items-end gap-1 h-24 border-b border-slate-300 pb-1">
                  {(report.daily ?? []).map((day) => (
                    <div key={day.day} className="flex-1 flex flex-col items-center justify-end gap-0.5 min-w-0">
                      <div
                        className="w-full bg-emerald-600 rounded-t-sm"
                        style={{ height: `${Math.max(2, (day.completed / peak) * 72)}px` }}
                        title={`${day.day}: ${day.completed} ${so ? 'dhammaatay' : 'completed'}`}
                      />
                      <div
                        className="w-full bg-slate-300 rounded-t-sm"
                        style={{ height: `${Math.max(2, (day.created / peak) * 30)}px` }}
                        title={`${day.day}: ${day.created} ${so ? 'cusub' : 'new'}`}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-[10px] font-semibold text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600" aria-hidden="true" />
                    {so ? 'Dhammaatay' : 'Completed'}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm bg-slate-300" aria-hidden="true" />
                    {so ? 'Cusub' : 'New'}
                  </span>
                  <span className="ml-auto tabular-nums">
                    {formatDate(report.from, lang)} → {formatDate(report.to, lang)}
                  </span>
                </div>
              </section>

              {/* technicians */}
              <section className="print-block">
                <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 mb-2">
                  {so ? 'Shaqada farsamayaqaanka' : 'Work by technician'}
                </h2>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-300 text-[10px] uppercase tracking-wider text-slate-500">
                      <th className="text-left py-1.5 font-extrabold">{so ? 'Magaca' : 'Name'}</th>
                      <th className="text-right py-1.5 font-extrabold">{so ? 'Dhammaatay' : 'Completed'}</th>
                      <th className="text-right py-1.5 font-extrabold">{so ? 'Celcelis' : 'Avg time'}</th>
                      <th className="text-right py-1.5 font-extrabold">dBm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report.techs ?? []).map((tech) => (
                      <tr key={tech.id} className="border-b border-slate-100">
                        <td className="py-1.5 font-semibold text-slate-800">{tech.name}</td>
                        <td className="py-1.5 text-right tabular-nums font-bold">{formatNumber(tech.completed)}</td>
                        <td className="py-1.5 text-right tabular-nums text-slate-600">
                          {tech.completed > 0 ? formatDuration(tech.avg_minutes * 60) : '—'}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-slate-600">
                          {formatDbm(tech.avg_dbm)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              {/* boxes */}
              {(report.boxes ?? []).length > 0 && (
                <section className="print-block">
                  <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 mb-2">
                    {so ? 'Sanduuqyada' : 'Cableboxes'}
                  </h2>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-300 text-[10px] uppercase tracking-wider text-slate-500">
                        <th className="text-left py-1.5 font-extrabold">{so ? 'Sanduuq' : 'Box'}</th>
                        <th className="text-right py-1.5 font-extrabold">{so ? 'Cillado' : 'Faults'}</th>
                        <th className="text-right py-1.5 font-extrabold">{so ? 'Ports xun' : 'Damaged'}</th>
                        <th className="text-right py-1.5 font-extrabold">{so ? 'Xaalad' : 'State'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(report.boxes ?? []).map((box) => (
                        <tr key={box.box_code} className="border-b border-slate-100">
                          <td className="py-1.5 font-mono font-bold text-slate-800">{box.box_code}</td>
                          <td className="py-1.5 text-right tabular-nums">{formatNumber(box.faults)}</td>
                          <td className="py-1.5 text-right tabular-nums text-slate-600">
                            {box.damaged_ports} / {box.total_ports}
                          </td>
                          <td className="py-1.5 text-right capitalize text-slate-600">{box.health_status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {(report.cancel_reasons ?? []).length > 0 && (
                <section className="print-block">
                  <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 mb-2">
                    {so ? 'Sababaha la tirtiray' : 'Why jobs were cancelled'}
                  </h2>
                  <ul className="text-xs text-slate-700 space-y-1">
                    {(report.cancel_reasons ?? []).map((reason) => (
                      <li key={reason.reason} className="flex justify-between border-b border-slate-100 py-1">
                        <span className="capitalize">{reason.reason.replace(/_/g, ' ')}</span>
                        <span className="tabular-nums font-bold">{formatNumber(reason.count)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <footer className="pt-3 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-500">
                <span>
                  Telesom Fixed Broadband · {so ? 'Kooxda' : 'Group'} {activeGroup?.code ?? 'F1'}
                </span>
                <span className="tabular-nums">{BUILD_LABEL}</span>
              </footer>
            </div>
          )}

          {loading && !report && <div className="p-6 text-center text-xs text-slate-500">…</div>}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
