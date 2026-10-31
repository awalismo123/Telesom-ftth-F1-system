import React, { useEffect, useState } from 'react';
import {
  Ban,
  CalendarClock,
  MapPin,
  RotateCcw,
  Server,
  Undo2,
  User,
  UserCheck,
  Users,
} from 'lucide-react';
import { useLanguage } from '../../../lib/i18n';
import { CANCEL_REASONS, cancelReasonText, statusLabel, type Lang } from '../../../lib/ops';
import { cancelTask, fetchTask, reopenTask } from '../../../lib/opsService';
import { assignTasks, unassignTasks } from '../../../lib/dispatchService';
import type { DispatchTarget } from '../../../lib/dispatch';
import type { Task } from '../../../types/database';
import { describeError } from '../../../lib/useErrorMessage';
import { Alert } from '../../ui/Alert';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Select, Textarea } from '../../ui/Field';
import { Sheet } from '../../ui/Sheet';
import { Skeleton } from '../../ui/Skeleton';
import { useToast } from '../../ui/Toast';

/**
 * Everything a supervisor can do to one job, in one place.
 *
 * The four actions that used to be a phone call to the office: give it to
 * someone else, take it back, cancel it with a reason, or reopen one that was
 * closed too early. Each one is a database function with its own rules; this
 * sheet only decides what to offer.
 */
export function JobActionsSheet({
  open,
  taskId,
  onClose,
  onChanged,
  token,
  groupId,
  targets,
}: {
  open: boolean;
  taskId: string | null;
  onClose: () => void;
  onChanged: () => void;
  token: string;
  groupId: string;
  targets: DispatchTarget[];
}) {
  const { lang } = useLanguage();
  const so = lang === 'so';
  const toast = useToast();

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [targetKey, setTargetKey] = useState('');
  const [cancelReason, setCancelReason] = useState('customer_request');
  const [cancelNote, setCancelNote] = useState('');
  const [reopenNote, setReopenNote] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    if (!open || !taskId) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    setConfirmCancel(false);
    setCancelNote('');
    setReopenNote('');
    setTargetKey('');

    void fetchTask(taskId)
      .then((row) => {
        if (cancelled) return;
        setTask(row);
        setTargetKey(
          row.assigned_user_id
            ? `user:${row.assigned_user_id}`
            : row.assigned_crew_id
              ? `crew:${row.assigned_crew_id}`
              : '',
        );
      })
      .catch((err) => !cancelled && setError(describeError(err, lang)))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [open, taskId, lang]);

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await work();
      onChanged();
    } catch (err) {
      setError(describeError(err, lang));
    } finally {
      setBusy(null);
    }
  };

  const assign = () => {
    if (!task || !targetKey) return;
    const [kind, id] = targetKey.split(':');
    const target = targets.find((item) => item.kind === kind && item.id === id);
    if (!target) return;

    void run('assign', async () => {
      const result = await assignTasks({ token, groupId, taskIds: [task.id], target });
      toast.success(so ? 'Shaqada waa la qoondeeyay' : 'Job assigned', {
        description:
          result.skipped > 0
            ? so
              ? `${result.skipped} lama beddeli karin`
              : `${result.skipped} could not be changed`
            : result.target,
      });
      onClose();
    });
  };

  const release = () => {
    if (!task) return;
    void run('release', async () => {
      const result = await unassignTasks({ token, groupId, taskIds: [task.id] });
      toast.success(so ? 'Shaqada waa lagu celiyay guddiga' : 'Returned to the pool', {
        description: `${result.released} ${so ? 'shaqo' : 'job'}`,
      });
      onClose();
    });
  };

  const cancel = () => {
    if (!task) return;
    const reason = cancelReasonText(cancelReason, cancelNote, lang);

    if (cancelReason === 'other' && cancelNote.trim().length < 3) {
      setError(so ? 'Qor sababta joojinta' : 'Write why this job is being cancelled');
      return;
    }

    if (!confirmCancel) {
      setConfirmCancel(true);
      return;
    }

    void run('cancel', async () => {
      await cancelTask({ token, taskId: task.id, reason });
      toast.success(so ? 'Shaqada waa la joojiyay' : 'Job cancelled', { description: reason });
      onClose();
    });
  };

  const reopen = () => {
    if (!task) return;
    void run('reopen', async () => {
      const result = await reopenTask({ token, taskId: task.id, reason: reopenNote.trim() || undefined });
      toast.success(so ? 'Shaqada waa dib loo furay' : 'Job reopened', {
        description: statusLabel(result.status, lang),
      });
      onClose();
    });
  };

  const status = task?.status ?? 'assigned';
  const open_ = task ? !['completed', 'cancelled'].includes(task.status) : false;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="md"
      title={so ? 'Shaqada — talaabooyin' : 'Job actions'}
      description={task ? `${task.line_number} · ${task.customer_name}` : undefined}
      footer={
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            {so ? 'Xir' : 'Close'}
          </Button>
        </div>
      }
    >
      {loading && (
        <div className="space-y-3" role="status" aria-busy="true">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
      )}

      {!loading && error && !task && (
        <Alert tone="danger">{error}</Alert>
      )}

      {!loading && task && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={status === 'cancelled' ? 'rose' : status === 'completed' ? 'slate' : 'emerald'}>
                {statusLabel(status, lang)}
              </Badge>
              {task.priority === 'urgent' && <Badge tone="rose">{so ? 'Degdeg' : 'Urgent'}</Badge>}
              {task.reopened_count > 0 && (
                <Badge tone="amber">
                  {so ? `dib loo furay ${task.reopened_count}` : `reopened ${task.reopened_count}×`}
                </Badge>
              )}
              {task.source === 'manual' && <Badge tone="sky">{so ? 'Telefoon' : 'Phone-in'}</Badge>}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {task.xaafada || '—'}
              </span>
              <span className="inline-flex items-center gap-1">
                <Server className="w-3 h-3" />
                {task.cablebox_code_raw || '—'}
                {task.port_number ? ` · ${task.port_number}` : ''}
              </span>
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="w-3 h-3" />
                {task.reported_date || '—'}
              </span>
            </div>

            {task.cancel_reason && (
              <p className="text-[11px] text-rose-700">
                {so ? 'Sababta: ' : 'Reason: '}
                {task.cancel_reason}
              </p>
            )}

            {task.intake_notes && (
              <p className="text-[11px] text-slate-600 italic">“{task.intake_notes}”</p>
            )}
          </div>

          {error && (
            <Alert tone="danger" onDismiss={() => setError(null)} dismissLabel={so ? 'Xir' : 'Dismiss'}>
              {error}
            </Alert>
          )}

          {open_ && (
            <>
              <section className="space-y-2">
                <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                  {so ? 'U qoondee' : 'Assign'}
                </h3>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Select
                    aria-label={so ? 'Qoondee' : 'Assign to'}
                    value={targetKey}
                    onChange={(event) => setTargetKey(event.target.value)}
                    className="flex-1"
                  >
                    <option value="">{so ? 'Dooro farsamayaqaan ama crew' : 'Choose a technician or crew'}</option>
                    {targets.map((target) => (
                      <option key={`${target.kind}:${target.id}`} value={`${target.kind}:${target.id}`}>
                        {target.kind === 'crew' ? '🚚 ' : '👤 '}
                        {target.name}
                        {target.openJobs ? ` (${target.openJobs})` : ''}
                      </option>
                    ))}
                  </Select>
                  <Button onClick={assign} disabled={!targetKey || busy !== null} loading={busy === 'assign'}>
                    {targetKey.startsWith('crew') ? (
                      <Users className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <UserCheck className="w-4 h-4" aria-hidden="true" />
                    )}
                    {so ? 'Qoondee' : 'Assign'}
                  </Button>
                </div>

                {(task.assigned_user_id || task.assigned_crew_id) && (
                  <Button
                    variant="secondary"
                    onClick={release}
                    disabled={busy !== null}
                    loading={busy === 'release'}
                    fullWidth
                  >
                    <Undo2 className="w-4 h-4" aria-hidden="true" />
                    {so ? 'Ku celi guddiga' : 'Return to the pool'}
                  </Button>
                )}
              </section>

              <section className="space-y-2 border-t border-slate-200 pt-4">
                <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                  <Ban className="w-3.5 h-3.5" aria-hidden="true" />
                  {so ? 'Jooji shaqada' : 'Cancel this job'}
                </h3>

                <Select
                  aria-label={so ? 'Sababta' : 'Reason'}
                  value={cancelReason}
                  onChange={(event) => {
                    setCancelReason(event.target.value);
                    setConfirmCancel(false);
                  }}
                >
                  {CANCEL_REASONS.map((reason) => (
                    <option key={reason.id} value={reason.id}>
                      {reason[lang as Lang]}
                    </option>
                  ))}
                </Select>

                <Textarea
                  aria-label={so ? 'Faahfaahin' : 'Note'}
                  value={cancelNote}
                  onChange={(event) => {
                    setCancelNote(event.target.value);
                    setConfirmCancel(false);
                  }}
                  placeholder={
                    cancelReason === 'other'
                      ? so
                        ? 'Sababta oo kooban'
                        : 'A short reason'
                      : so
                        ? 'Faahfaahin dheeraad ah (ikhtiyaari)'
                        : 'Extra detail (optional)'
                  }
                />

                <Button
                  variant="danger"
                  onClick={cancel}
                  disabled={busy !== null}
                  loading={busy === 'cancel'}
                  fullWidth
                >
                  <Ban className="w-4 h-4" aria-hidden="true" />
                  {confirmCancel
                    ? so
                      ? 'Riix mar labaad si aad u joojiso'
                      : 'Tap again to cancel the job'
                    : so
                      ? 'Jooji shaqada'
                      : 'Cancel the job'}
                </Button>
              </section>
            </>
          )}

          {!open_ && (
            <section className="space-y-2">
              <Alert tone={status === 'cancelled' ? 'warning' : 'info'}>
                {status === 'cancelled'
                  ? so
                    ? 'Shaqadan waa la joojiyay. Haddii macmiilku soo waco, dib u fur — taariikhda way sii socotaa.'
                    : 'This job is cancelled. If the customer calls back, reopen it — the history is kept.'
                  : so
                    ? 'Shaqadan waa dhammaatay. Haddii cilladdu soo noqoto, dib u fur si loo diiwaan geliyo booqasho cusub.'
                    : 'This job is completed. If the fault returned, reopen it so the new visit is recorded.'}
              </Alert>

              <Textarea
                aria-label={so ? 'Sababta dib u furista' : 'Reason for reopening'}
                value={reopenNote}
                onChange={(event) => setReopenNote(event.target.value)}
                placeholder={so ? 'Sababta (ikhtiyaari)' : 'Why (optional)'}
              />

              <Button
                variant="secondary"
                onClick={reopen}
                disabled={busy !== null}
                loading={busy === 'reopen'}
                fullWidth
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                {so ? 'Dib u fur shaqada' : 'Reopen the job'}
              </Button>
            </section>
          )}

          {task.assigned_user_id == null && task.assigned_crew_id == null && open_ && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1">
              <User className="w-3 h-3" aria-hidden="true" />
              {so ? 'Weli lama qoondeyn qof.' : 'Nobody is assigned yet.'}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}
