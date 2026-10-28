import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Timer } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n';
import type { RouteTask } from '../../lib/execution';
import { elapsedSeconds, formatClock, serverOffsetMs } from '../../lib/execution';
import { fetchRoute } from '../../lib/executionService';
import { useNow } from '../../lib/useNow';

/**
 * Floating "you have work running" pill, shown above the tab bar so the timer
 * is never hidden behind another tab. Tapping it jumps back to the route.
 */
export function RunningPill({ onGoToRoute }: { onGoToRoute: () => void }) {
  const { session } = useAuth();
  const { lang } = useLanguage();
  const so = lang === 'so';
  const token = session?.token ?? '';

  const [tasks, setTasks] = useState<RouteTask[]>([]);
  const [offset, setOffset] = useState(0);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const receivedAt = Date.now();
      const data = await fetchRoute(token);
      setTasks(data.tasks.filter((task) => task.status === 'in_progress'));
      setOffset(serverOffsetMs(data.server_now, receivedAt));
    } catch {
      /* the pill is decoration — never surface errors here */
    }
  }, [token]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 45_000);
    return () => window.clearInterval(id);
  }, [load]);

  const now = useNow(tasks.length > 0);
  const nowMs = now + offset;

  if (tasks.length === 0) return null;

  return (
    <button
      type="button"
      onClick={onGoToRoute}
      className="fixed bottom-[72px] inset-x-0 z-30 mx-auto max-w-md px-3 cursor-pointer"
    >
      <div className="rounded-2xl bg-emerald-950 text-white shadow-lg px-3 py-2 flex items-center gap-2.5">
        <span className="relative flex w-2 h-2 shrink-0">
          <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-70 animate-ping" />
          <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-400" />
        </span>
        <div className="min-w-0 flex-1 text-left">
          <div className="text-[10px] font-extrabold uppercase tracking-wide text-emerald-300">
            {tasks.length === 1
              ? so
                ? 'Shaqo socota'
                : 'Job running'
              : so
                ? `${tasks.length} shaqo socda`
                : `${tasks.length} jobs running`}
          </div>
          <div className="font-mono text-xs font-bold tabular-nums text-white/90 truncate">
            {tasks
              .slice(0, 2)
              .map((task) => `${task.line_number} ${formatClock(elapsedSeconds(task, nowMs))}`)
              .join('  ·  ')}
          </div>
        </div>
        <Timer className="w-4 h-4 text-emerald-400 shrink-0" />
        <ChevronRight className="w-4 h-4 text-emerald-300 shrink-0" />
      </div>
    </button>
  );
}
