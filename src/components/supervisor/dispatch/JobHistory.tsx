import React, { useEffect, useState } from 'react';
import { Camera, Clock, Package } from 'lucide-react';
import { useLanguage } from '../../../lib/i18n';
import { formatDate, formatDuration } from '../../../lib/format';
import { fetchWorkLogs, fetchTaskPhotos, type WorkLogRow, type TaskPhotoMeta } from '../../../lib/reads';
import { fetchTaskMaterials } from '../../../lib/materialsService';
import type { RecordedMaterial } from '../../../lib/materials';
import { Skeleton } from '../../ui/Skeleton';
import { cx } from '../../ui/cx';

/**
 * What happened to this job, in the order it happened.
 *
 * ## Why the supervisor needs it in the action sheet
 *
 * The delete rule is "a job with any history must be cancelled, not deleted".
 * A supervisor who is about to press delete needs to *see* that history, not
 * take a guard's word for it — and a supervisor reading a complaint about a
 * job needs the timer, the photos and the materials in one place rather than
 * three screens.
 *
 * It is read-only. Nothing here can change a job; that is `JobActionsSheet`'s
 * job, and mixing the two would put a destructive control next to evidence.
 *
 * ## Three sources, one list
 *
 * Work logs, materials and photos arrive from three different reads and are
 * merged by timestamp. They are shown with their own kind, because "4 photos"
 * and "4 work logs" mean different things when you are deciding whether a job
 * was worked on.
 */
export function JobHistory({ token, taskId }: { token: string; taskId: string }) {
  const { lang } = useLanguage();
  const so = lang === 'so';

  const [logs, setLogs] = useState<WorkLogRow[] | null>(null);
  const [materials, setMaterials] = useState<RecordedMaterial[] | null>(null);
  const [photos, setPhotos] = useState<TaskPhotoMeta[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setLogs(null);
    setMaterials(null);
    setPhotos(null);
    setFailed(false);

    /**
     * Each read fails independently.
     *
     * A group whose materials table is empty must still show its work logs; a
     * `Promise.all` would blank the whole panel for one missing grant.
     */
    void Promise.all([
      fetchWorkLogs(token, taskId).catch(() => null),
      fetchTaskMaterials(token, taskId).catch(() => null),
      fetchTaskPhotos(token, taskId).catch(() => null),
    ]).then(([logRows, materialRows, photoRows]) => {
      if (!live) return;
      setLogs(logRows ?? []);
      setMaterials(materialRows ?? []);
      setPhotos(photoRows ?? []);
      if (!logRows && !materialRows && !photoRows) setFailed(true);
    });

    return () => {
      live = false;
    };
  }, [token, taskId]);

  const loading = logs === null || materials === null || photos === null;

  if (failed) {
    return (
      <p className="text-[11px] text-slate-500">
        {so ? 'Taariikhda lama soo qaadin.' : 'The history could not be loaded.'}
      </p>
    );
  }

  if (loading) {
    return (
      <div className="space-y-1.5" role="status" aria-busy="true">
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>
    );
  }

  const nothing = (logs?.length ?? 0) + (materials?.length ?? 0) + (photos?.length ?? 0) === 0;

  if (nothing) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 px-2.5 py-2 text-[11px] text-slate-600">
        {so
          ? 'Taariikh ma leh — qofna weli ma shaqeyn. Tani waa shaqada kaliya ee la tirtiri karo.'
          : 'No history — nobody has worked on this. These are the only jobs that can be deleted.'}
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      {logs && logs.length > 0 && (
        <Section
          icon={<Clock className="w-3.5 h-3.5" aria-hidden="true" />}
          title={so ? 'Diiwaanka waqtiga' : 'Work log'}
        >
          <ul className="space-y-1">
            {logs.map((log) => (
              <li key={log.id} className="flex items-baseline gap-1.5 text-[11px]">
                <span className="font-bold text-slate-800 shrink-0">{logLabel(log.action, lang)}</span>
                {(log.session_seconds ?? 0) > 0 && (
                  <span className="tabular text-slate-600 shrink-0">
                    {formatDuration(log.session_seconds ?? 0)}
                  </span>
                )}
                {log.optical_dbm !== null && log.optical_dbm !== undefined && (
                  <span className="tabular text-slate-600 shrink-0">{Number(log.optical_dbm).toFixed(1)} dBm</span>
                )}
                <span className="ml-auto shrink-0 text-[10px] text-slate-500">{formatDate(log.created_at)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {materials && materials.length > 0 && (
        <Section
          icon={<Package className="w-3.5 h-3.5" aria-hidden="true" />}
          title={so ? 'Alaabta' : 'Materials'}
          count={materials.length}
        >
          <ul className="space-y-1">
            {materials.map((item) => (
              <li key={item.id} className="flex items-baseline gap-1.5 text-[11px]">
                <span className="font-semibold text-slate-800 truncate">{item.item}</span>
                <span className="ml-auto tabular shrink-0 text-slate-600">
                  {item.quantity} {item.unit}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {photos && photos.length > 0 && (
        <Section
          icon={<Camera className="w-3.5 h-3.5" aria-hidden="true" />}
          title={so ? 'Sawirrada' : 'Photos'}
          count={photos.length}
        >
          {/* Metadata only. The viewer lives in the action sheet, which already
              owns the full-screen photo state. */}
          <ul className="space-y-1">
            {photos.slice(0, 6).map((photo) => (
              <li key={photo.id} className="flex items-baseline gap-1.5 text-[11px] text-slate-600">
                <span className="truncate">
                  {photo.uploaded_by_name || (so ? 'sawir' : 'photo')}
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-slate-500">{formatDate(photo.created_at)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white px-2.5 py-2">
      <h4 className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-600">
        <span className="text-slate-500">{icon}</span>
        {title}
        {count !== undefined && <span className="tabular text-slate-500">· {count}</span>}
      </h4>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

/** The action names the database writes, in words a supervisor reads. */
function logLabel(action: string, lang: 'en' | 'so'): string {
  const labels: Record<string, { en: string; so: string }> = {
    started: { en: 'Start', so: 'Bilow' },
    resumed: { en: 'Resume', so: 'Sii wad' },
    paused: { en: 'Pause', so: 'Hakad' },
    blocked: { en: 'Blocked', so: 'Xannibmay' },
    completed: { en: 'Complete', so: 'Dhammee' },
    reopened: { en: 'Reopened', so: 'Dib loo furay' },
    cancelled: { en: 'Cancelled', so: 'La joojiyay' },
    edited: { en: 'Edited', so: 'La beddelay' },
    en_route: { en: 'En route', so: 'Wadada' },
    assigned: { en: 'Assigned', so: 'La qoondeeyay' },
  };
  return labels[action]?.[lang] ?? action.replace(/_/g, ' ');
}
