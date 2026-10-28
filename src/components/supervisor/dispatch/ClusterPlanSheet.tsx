import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Sparkles, Truck, User, X } from 'lucide-react';
import type { AutoPlan, DispatchTarget } from '../../../lib/dispatch';
import { targetKey } from '../../../lib/dispatch';
import { useLanguage } from '../../../lib/i18n';

interface Props {
  open: boolean;
  onClose: () => void;
  plan: AutoPlan;
  targets: DispatchTarget[];
  busy: boolean;
  onApply: (pairs: { taskIds: string[]; target: DispatchTarget }[]) => Promise<void>;
}

const REASON_KEY = {
  zone: 'dispatchPlanReasonZone',
  'same-box': 'dispatchPlanReasonBox',
  balance: 'dispatchPlanReasonBalance',
} as const;

export function ClusterPlanSheet({ open, onClose, plan, targets, busy, onApply }: Props) {
  const { t, lang } = useLanguage();
  const so = lang === 'so';

  const [excluded, setExcluded] = useState<string[]>([]);

  // Every time the sheet opens, start from "all routes accepted".
  useEffect(() => {
    if (open) setExcluded([]);
  }, [open]);

  const rows = useMemo(
    () => plan.assignments.filter((item) => !excluded.includes(item.cluster.id)),
    [plan.assignments, excluded],
  );

  const totalJobs = rows.reduce((sum, item) => sum + item.cluster.tasks.length, 0);
  const urgentJobs = rows.reduce((sum, item) => sum + item.cluster.urgentCount, 0);

  if (!open) return null;

  const toggle = (clusterId: string) =>
    setExcluded((prev) =>
      prev.includes(clusterId) ? prev.filter((id) => id !== clusterId) : [...prev, clusterId],
    );

  const apply = () => {
    const byTarget = new Map<string, { target: DispatchTarget; taskIds: string[] }>();

    for (const row of rows) {
      const key = targetKey(row.target);
      const existing = byTarget.get(key);
      const ids = row.cluster.tasks.map((task) => task.id);
      if (existing) existing.taskIds.push(...ids);
      else byTarget.set(key, { target: row.target, taskIds: ids });
    }

    void onApply([...byTarget.values()]);
  };

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="bg-white w-full sm:max-w-2xl rounded-t-3xl sm:rounded-3xl max-h-[88vh] flex flex-col">
        <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-emerald-700" />
              {t('dispatchPlanTitle')}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {rows.length} {so ? 'jidad' : 'routes'} · {totalJobs} {so ? 'shaqo' : 'jobs'}
              {urgentJobs > 0 && (
                <span className="text-rose-600 font-bold"> · {urgentJobs} {t('dispatchFilterUrgent')}</span>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-2 overflow-y-auto">
          <p className="px-2 py-1.5 text-[11px] text-slate-500">{t('dispatchAutoHint')}</p>

          {plan.assignments.length === 0 && (
            <div className="p-8 text-center text-xs text-slate-500">{t('dispatchPlanEmpty')}</div>
          )}

          <div className="space-y-1.5">
            {plan.assignments.map((row) => {
              const checked = !excluded.includes(row.cluster.id);
              return (
                <button
                  key={row.cluster.id}
                  type="button"
                  onClick={() => toggle(row.cluster.id)}
                  className={`w-full text-left rounded-2xl border p-2.5 transition flex items-start gap-2.5 cursor-pointer ${
                    checked
                      ? 'border-emerald-300 bg-emerald-50/40'
                      : 'border-slate-200 bg-white opacity-60'
                  }`}
                >
                  <span
                    className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${
                      checked ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-300'
                    }`}
                  >
                    {checked && <Check className="w-3 h-3" />}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-extrabold text-slate-900 truncate">
                        {row.cluster.label}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">
                        {row.cluster.tasks.length} {so ? 'shaqo' : 'jobs'}
                      </span>
                      {row.cluster.urgentCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-extrabold inline-flex items-center gap-0.5">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          {row.cluster.urgentCount}
                        </span>
                      )}
                      {row.cluster.kind === 'none' && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                          {so ? 'xaafad ma leh' : 'no area'}
                        </span>
                      )}
                    </span>

                    <span className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                      {row.target.kind === 'crew' ? (
                        <Truck className="w-3 h-3 text-emerald-700" />
                      ) : (
                        <User className="w-3 h-3 text-sky-700" />
                      )}
                      <span className="font-bold text-slate-700 truncate">{row.target.name}</span>
                      <span className="text-slate-400">· {t(REASON_KEY[row.reason])}</span>
                    </span>

                    <span className="mt-1 block text-[10px] text-slate-400 truncate">
                      {row.cluster.tasks
                        .slice(0, 4)
                        .map((task) => task.line_number)
                        .join(' · ')}
                      {row.cluster.tasks.length > 4 ? ' …' : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
          >
            {so ? 'Jooji' : 'Cancel'}
          </button>

          <button
            type="button"
            onClick={apply}
            disabled={busy || rows.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-extrabold disabled:opacity-40 cursor-pointer"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {rows.length === plan.assignments.length ? t('dispatchApplyPlan') : t('dispatchApplyPartial')}
            {rows.length > 0 && <span className="opacity-80">· {totalJobs}</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
