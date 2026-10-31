import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { describeError } from '../../../lib/useErrorMessage';
import { Activity, AlertTriangle, Timer } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useLanguage } from '../../../lib/i18n';
import { blockerById, formatClock, serverOffsetMs } from '../../../lib/execution';
import { fetchLiveStatus, type LiveRow } from '../../../lib/executionService';
import { useNow } from '../../../lib/useNow';

/**
 * "Who is on a job right now" — the supervisor's live view of the crews.
 * Timers are recomputed from the server timestamps every second; nothing is
 * accumulated locally, so a phone left in a pocket still shows the truth.
 */
export function LiveStrip() {
  const { session, activeGroup } = useAuth();
  const { lang } = useLanguage();
  const so = lang === 'so';

  const [rows, setRows] = useState<LiveRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const token = session?.token ?? '';
  const groupId = activeGroup?.id ?? '';

  const load = useCallback(async () => {
    if (!token || !groupId) return;
    try {
      const receivedAt = Date.now();
      const data = await fetchLiveStatus({ token, groupId });
      setRows(data.rows ?? []);
      setOffset(serverOffsetMs(data.server_now, receivedAt));
      setError(null);
    } catch (err) {
      setError(describeError(err, lang));
    }
  }, [token, groupId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const running = useMemo(() => rows.filter((row) => row.status === 'in_progress'), [rows]);
  const now = useNow(running.length > 0);
  const nowMs = now + offset;

  if (error) return null;
  if (rows.length === 0) return null;

  return (
    <div className="rounded-2xl bg-slate-900 text-white p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <Activity className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-300">
          {so ? 'Hadda goobta' : 'Live in the field'}
        </span>
        <span className="ml-auto text-[10px] font-bold text-slate-400">
          {running.length} {so ? 'socda' : 'running'}
          {rows.length > running.length ? ` · ${rows.length - running.length} ${so ? 'caqabad' : 'blocked'}` : ''}
        </span>
      </div>

      <div className="space-y-1.5">
        {rows.map((row) => {
          const blocker = blockerById(row.blocker_reason);
          const isRunning = row.status === 'in_progress';
          const base = row.accumulated_seconds ?? 0;
          const started = row.started_at ? Date.parse(row.started_at) : NaN;
          const seconds =
            isRunning && Number.isFinite(started)
              ? base + Math.max(0, Math.floor((nowMs - started) / 1000))
              : base;

          return (
            <div
              key={row.id}
              className="flex items-center gap-2 rounded-xl bg-white/5 px-2.5 py-2"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold truncate">
                  {row.worker_name}
                  <span className="font-mono font-normal text-slate-400"> · {row.line_number}</span>
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                  {row.customer_name}
                  {row.cablebox_code_raw ? ` · ${row.cablebox_code_raw}` : row.xaafada ? ` · ${row.xaafada}` : ''}
                </div>
              </div>

              {blocker && !isRunning ? (
                <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-200 text-[10px] font-bold">
                  <AlertTriangle className="w-2.5 h-2.5" />
                  {so ? blocker.labelSo.split(' ')[0] : blocker.labelEn.split(' ')[0]}
                </span>
              ) : (
                <span className="shrink-0 inline-flex items-center gap-1 font-mono text-[11px] font-bold text-emerald-300 tabular-nums">
                  <Timer className="w-3 h-3" />
                  {formatClock(seconds)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
