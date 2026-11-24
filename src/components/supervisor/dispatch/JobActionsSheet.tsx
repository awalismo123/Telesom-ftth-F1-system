import React, { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CalendarClock,
  Camera,
  MapPin,
  RotateCcw,
  Server,
  Undo2,
  User,
  UserCheck,
  Users,
  MessageCircle,
  Trash2,
  // `History` collides with the DOM `History` type, which TypeScript then
  // refuses as a JSX component. Aliased at the import so the call site reads.
  History as HistoryIcon,
} from 'lucide-react';
import { useLanguage } from '../../../lib/i18n';
import { CANCEL_REASONS, cancelReasonText, statusLabel, type Lang } from '../../../lib/ops';
import { cancelTask, deleteTask, fetchTask, reopenTask, setTaskSchedule } from '../../../lib/opsService';
import { assignTasks, unassignTasks } from '../../../lib/dispatchService';
import type { DispatchTarget } from '../../../lib/dispatch';
import type { Task } from '../../../types/database';
import { describeError } from '../../../lib/useErrorMessage';
import { Alert } from '../../ui/Alert';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Input, Select, Textarea } from '../../ui/Field';
import { Sheet } from '../../ui/Sheet';
import { Skeleton } from '../../ui/Skeleton';
import { useToast } from '../../ui/Toast';
import { countLabel, formatDate } from '../../../lib/format';
import { fetchTaskPhotos, type TaskPhotoMeta } from '../../../lib/reads';
import { addDays, scheduleLabel, scheduleProblem, SCHEDULE_PROBLEM_COPY, todayLocal } from '../../../lib/schedule';
import { buildCustomerUpdatePair } from '../../../lib/customerUpdate';
import { whatsappLink } from '../../../lib/dispatch';
import { DirectionsButton } from '../../ui/DirectionsButton';
import { copyPlainText, todayKey } from '../../../lib/format';
import { photoSizeLabel } from '../../../lib/photo';
import { PhotoViewer } from '../../ui/PhotoViewer';
import { JobHistory } from './JobHistory';
import { whyNoDelete, faultTypeLabel, taskKind } from '../../../lib/faults';

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
  const [deleteReason, setDeleteReason] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [photos, setPhotos] = useState<TaskPhotoMeta[]>([]);
  const [openPhotoId, setOpenPhotoId] = useState<string | null>(null);
  const [plannedDay, setPlannedDay] = useState('');
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [customerLang, setCustomerLang] = useState<'so' | 'en'>('so');

  useEffect(() => {
    if (!open || !taskId) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    setConfirmCancel(false);
    setCancelNote('');
    setReopenNote('');
    setTargetKey('');

    setPhotos([]);
    void fetchTaskPhotos(token, taskId)
      .then((rows) => !cancelled && setPhotos(rows))
      .catch(() => {
        /* a missing photo list must never block the actions */
      });

    void fetchTask(token, taskId)
      .then((row) => {
        if (cancelled) return;
        setTask(row);
        setPlannedDay(row.scheduled_date ?? todayKey());
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
        description: countLabel(result.released, 'jobs', lang),
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

  /**
   * Delete a job nobody has worked on.
   *
   * Two taps, because there is no undo and no soft-delete row to recover from.
   * The server refuses if the job turns out to have history the client could not
   * see, and that refusal is shown as the server wrote it — a supervisor reading
   * "this job has photos" learns something the client could not have told them.
   */
  const remove = () => {
    if (!task) return;
    const reason = deleteReason.trim();
    if (reason.length < 3) {
      setError(so ? 'Qor sababta tirtirista' : 'Write why this job is being deleted');
      return;
    }
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    void run('delete', async () => {
      await deleteTask({ token, taskId: task.id, reason });
      toast.success(so ? 'Shaqada waa la tirtiray' : 'Job deleted', {
        description: `${task.line_number} · ${reason}`,
      });
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

  /**
   * Move the job to `day`.
   *
   * The date is checked here first so a typo is answered instantly and in the
   * right language, rather than as a Postgres error string. The database checks
   * again — this is a convenience, not the guard.
   */
  async function saveDay(day: string) {
    if (!task) return;

    const problem = scheduleProblem(day, todayLocal());
    if (problem) {
      setError(SCHEDULE_PROBLEM_COPY[problem][lang]);
      return;
    }

    setScheduleBusy(true);
    setError(null);
    try {
      const result = await setTaskSchedule({ token, taskId: task.id, day });
      setTask(result.task);
      setPlannedDay(result.task.scheduled_date ?? day);
      // `changed: false` means the job already had that day. Saying "moved"
      // would be a small lie, and this app does not tell those.
      toast.success(
        result.changed
          ? so
            ? `Maalinta la beddelay: ${day}`
            : `Moved to ${day}`
          : so
            ? 'Maalintaas horey ayay ugu jirtay'
            : 'It was already on that day',
      );
      onChanged();
    } catch (err) {
      setError(describeError(err, lang));
    } finally {
      setScheduleBusy(false);
    }
  }

  /**
   * What this customer would be told, in both languages.
   *
   * Both are built at once so the supervisor can check the Somali wording
   * against the English before sending — the two are written separately on
   * purpose, and a wrong translation is the kind of mistake that reaches a
   * customer.
   */
  const customerText = useMemo(() => {
    if (!task) return { so: '', en: '' };
    return buildCustomerUpdatePair(task, {
      kind: 'planned',
      today: todayLocal(),
      groupCode: null,
    });
  }, [task]);

  const copyCustomerText = async (text: string) => {
    const ok = await copyPlainText(text);
    if (ok) {
      toast.success(so ? 'La nuqulay' : 'Copied');
    } else {
      toast.error(so ? 'Nuqul ma suurtagalin' : 'Could not copy', {
        description: so ? 'Dooro qoraalka oo gacanta ku nuqul.' : 'Select the text and copy it by hand.',
      });
    }
  };

  /**
   * Open WhatsApp's contact picker with the message ready.
   *
   * No phone number goes into the URL: `wa.me/?text=` makes WhatsApp ask who to
   * send to, so the customer's number is chosen on the phone and never travels
   * through this app. A person still presses send.
   */
  const openWhatsapp = (text: string) => {
    window.open(whatsappLink(text), '_blank', 'noopener,noreferrer');
  };

  /** The next calendar day, as a key. Uses the shared day arithmetic. */
  const tomorrowKey = () => addDays(todayKey(), 1);

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
              {taskKind(task) === 'fault' && (
                <Badge tone={task.fault_type ? 'amber' : 'slate'}>
                  {faultTypeLabel(task.fault_type, lang) ?? (so ? 'Nooc ma leh' : 'No type')}
                </Badge>
              )}
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
                {formatDate(task.reported_date)}
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

          {/* A supervisor often relays directions to a crew on the phone, so
              the same honest map search belongs here too. */}
          <DirectionsButton
            place={{
              boxCode: task.cablebox_code_raw,
              xaafada: task.xaafada,
              // The supervisor's task payload has no cablebox_notes — only the
              // technician's route does. Not worth widening a hot RPC for; the
              // box code and the area are what a map search needs.
              locationNotes: null,
            }}
            lang={lang}
            onCopied={(ok) =>
              ok
                ? toast.success(so ? 'Ciwaanka la nuqulay' : 'Address copied')
                : toast.error(so ? 'Nuqul ma suurtagalin' : 'Could not copy')
            }
          />

          {/* A message for this one customer. Built here, copied or opened in
              WhatsApp by hand — this app never sends anything on its own. */}
          <section className="space-y-2">
            <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
              <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
              {so ? 'Fariin macmiilka' : 'Message the customer'}
            </h3>

            <div className="flex gap-1.5">
              {(['so', 'en'] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setCustomerLang(code)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-extrabold cursor-pointer transition ${
                    customerLang === code
                      ? 'bg-brand-700 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                  aria-pressed={customerLang === code}
                >
                  {code === 'so' ? 'Somali' : 'English'}
                </button>
              ))}
            </div>

            <pre className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-800 font-sans">
              {customerText[customerLang]}
            </pre>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void copyCustomerText(customerText[customerLang])}
              >
                {so ? 'Nuqul' : 'Copy'}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => openWhatsapp(customerText[customerLang])}
              >
                <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
                {so ? 'WhatsApp ku fur' : 'Open in WhatsApp'}
              </Button>
            </div>

            <p className="text-[11px] text-slate-500">
              {so
                ? 'Waxba si toos ah looma diro. WhatsApp ayaa furmaya, adigaa dooranaya macmiilka oo riixaya dir.'
                : 'Nothing is sent automatically. WhatsApp opens, you choose the contact and press send.'}
            </p>
          </section>

          {status !== 'completed' && status !== 'cancelled' && (
            <section className="space-y-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
                {so ? 'Maalinta la qorsheeyay' : 'Planned day'}
              </h3>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={plannedDay}
                  onChange={(event) => setPlannedDay(event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800"
                  aria-label={so ? 'Maalinta la qorsheeyay' : 'Planned day'}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={scheduleBusy || !plannedDay || plannedDay === task.scheduled_date}
                  onClick={() => void saveDay(plannedDay)}
                >
                  {scheduleBusy ? (so ? 'Waa la kaydinayaa…' : 'Saving…') : so ? 'Kaydi' : 'Save'}
                </Button>
                <Button variant="ghost" size="sm" disabled={scheduleBusy} onClick={() => void saveDay(todayKey())}>
                  {so ? 'Maanta' : 'Today'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={scheduleBusy}
                  onClick={() => void saveDay(tomorrowKey())}
                >
                  {so ? 'Berri' : 'Tomorrow'}
                </Button>
              </div>

              <p className="text-[11px] text-slate-500">
                {scheduleLabel(task.scheduled_date, todayKey(), lang)}
                {' · '}
                {so
                  ? 'Shaqo maalin dambe loo qorsheeyay kama muuqato liiska maanta, laakiin way ka muuqataa farsamayaqaanka oo calaamad leh.'
                  : 'A job planned for a later day leaves today\'s list, but stays on the technician\'s phone, labelled.'}
              </p>
            </section>
          )}

          {photos.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                {so ? 'Caddaynta sawirka' : 'Photo proof'}
              </h3>
              <div className="flex flex-wrap gap-2">
                {photos.map((photo, index) => (
                  <button
                    key={photo.id}
                    type="button"
                    onClick={() => setOpenPhotoId(photo.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 px-2 py-1.5 text-[11px] font-bold text-brand-800 cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                    {so ? 'Sawir' : 'Photo'} {index + 1}
                    <span className="font-mono text-[10px] font-normal text-brand-700">
                      {photoSizeLabel(photo.byte_size)}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500">
                {so
                  ? 'Waxaa qaatay farsamayaqaanka markuu shaqada dhammeeyay.'
                  : 'Taken by the technician when the job was completed.'}
              </p>
            </section>
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

          {/* What happened, so the delete rule below is something a supervisor
              can check rather than take on trust. */}
          <section className="space-y-2 border-t border-slate-200 pt-4">
            <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
              <HistoryIcon className="w-3.5 h-3.5" aria-hidden="true" />
              {so ? 'Taariikhda shaqada' : 'What happened'}
            </h3>
            <JobHistory token={token} taskId={task.id} />
          </section>

          {/*
            The niche control.

            A job that has never been touched is a typo in an import, and
            deleting it is the honest fix. Everything else is evidence. The
            policy lives in `whyNoDelete` so the sentence here and the sentence
            in the bulk sheet cannot disagree.
          */}
          <section className="space-y-2 border-t border-slate-200 pt-4">
            <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              {so ? 'Tirtir' : 'Delete'}
            </h3>

            {(() => {
              const reason = whyNoDelete(task, 0);
              if (reason) {
                return (
                  <p className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] leading-snug text-slate-600">
                    {reason[lang]}
                  </p>
                );
              }
              return (
                <>
                  <p className="text-[11px] leading-snug text-slate-600">
                    {so
                      ? 'Qofna weli ma shaqeyn shaqadan, marka waa la tirtiri karaa. Tani lama noqon karo.'
                      : 'Nobody has worked on this job, so it can be deleted. This cannot be undone.'}
                  </p>
                  <Input
                    aria-label={so ? 'Sababta' : 'Reason'}
                    value={deleteReason}
                    onChange={(event) => {
                      setDeleteReason(event.target.value);
                      setConfirmDelete(false);
                    }}
                    placeholder={so ? 'Sababta tirtirista' : 'Why delete it'}
                    maxLength={200}
                  />
                  <Button
                    variant="danger"
                    onClick={remove}
                    disabled={busy !== null || deleteReason.trim().length < 3}
                    loading={busy === 'delete'}
                    fullWidth
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                    {confirmDelete
                      ? so
                        ? 'Riix mar labaad — weligeed'
                        : 'Tap again — permanently'
                      : so
                        ? 'Tirtir shaqadan'
                        : 'Delete this job'}
                  </Button>
                </>
              );
            })()}
          </section>
        </div>
      )}

      {openPhotoId && task && (
        <PhotoViewer
          token={token}
          photoId={openPhotoId}
          caption={`${task.line_number} — ${task.customer_name}`}
          onClose={() => setOpenPhotoId(null)}
        />
      )}
    </Sheet>
  );
}
