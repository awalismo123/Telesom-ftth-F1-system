import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, MapPin, Trash2, Wrench } from 'lucide-react';
import { useLanguage } from '../../../lib/i18n';
import { describeError } from '../../../lib/useErrorMessage';
import type { Task } from '../../../types/database';
import {
  FAULT_TYPE_LABEL,
  FAULT_TYPES,
  bulkDeletePlan,
  faultTypeLabel,
  taskKind,
  whyNoDelete,
} from '../../../lib/faults';
import { setFaultTypeBulk, setPlacementBulk, setPriorityBulk } from '../../../lib/opsService';
import { hasRoute } from '../../../lib/dispatchBoard';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { Input, Select } from '../../ui/Field';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { cx } from '../../ui/cx';

/**
 * Bulk edits for a selection of jobs.
 *
 * ## What it deliberately cannot do
 *
 * It cannot change status. Assignment has its own confirm flow, cancel has its
 * own reason and audit, completion belongs to the technician. A general "set
 * status" control would be a way to skip all three.
 *
 * So this does the three things a dispatcher genuinely does in bulk:
 *
 *  1. **Set the fault type** — the fix for "nine faults, no type".
 *  2. **Raise or lower urgency.**
 *  3. **Delete** — and the delete is refused per job by the database when the
 *     job has any history. The sheet says that *before* the button is pressed,
 *     and reports "7 deleted, 3 kept" afterwards rather than pretending.
 */

export type BulkAction = 'type' | 'priority' | 'place' | 'delete';

export function BulkEditSheet({
  open,
  onClose,
  tasks,
  token,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  /** The ticked jobs, resolved to full rows so the sheet can explain itself. */
  tasks: Task[];
  token: string;
  onDone: () => void;
}) {
  const { lang } = useLanguage();
  const so = lang === 'so';
  const toast = useToast();

  const [action, setAction] = useState<BulkAction>('type');
  /**
   * Empty, deliberately, and it must stay that way.
   *
   * This used to start at 'no_signal'. The action above also defaults to
   * 'type', so opening this sheet and pressing the primary button stamped
   * "No signal" on every ticked fault without anybody choosing it — which is
   * exactly what happened to all thirteen open faults on 24/11, three seconds
   * of writes with `before.fault_type = null` in the audit log. A fault type
   * is a fact about a customer's connection; a default is a guess wearing the
   * same clothes. Start blank and make the choice explicit.
   */
  const [faultType, setFaultType] = useState<string>('');
  const [priority, setPriority] = useState<'normal' | 'urgent'>('urgent');
  const [area, setArea] = useState('');
  const [box, setBox] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const faults = useMemo(() => tasks.filter((task) => taskKind(task) === 'fault'), [tasks]);

  /**
   * The jobs a bulk placement would actually help.
   *
   * `hasRoute` is the same test `clusterTasks` uses, so this count is the number
   * of jobs that will become plannable — not the number of jobs that look
   * incomplete.
   */
  /**
   * Faults that already carry a type, which this would overwrite.
   *
   * Counted so the sheet can say so before the button is pressed. Silently
   * replacing a type somebody worked out on site is the same fault as inventing
   * one, only later.
   */
  const alreadyTyped = useMemo(
    () => faults.filter((task) => Boolean(task.fault_type)),
    [faults],
  );

  const placeless = useMemo(() => tasks.filter((task) => !hasRoute(task)), [tasks]);

  /**
   * Which of the selection can actually be deleted.
   *
   * The rule lives in `bulkDeletePlan` so it can be tested without a browser;
   * this only renders its answer. It is not a substitute for the server check —
   * the server still refuses — it is so the supervisor is not surprised.
   */
  const plan = useMemo(() => bulkDeletePlan(tasks), [tasks]);
  const deletable = plan.deletable;
  const kept = plan.kept.length;

  const needsReason = action === 'delete';
  const canSubmit =
    !busy &&
    tasks.length > 0 &&
    (!needsReason || reason.trim().length >= 3) &&
    (action !== 'type' || (faults.length > 0 && faultType !== '')) &&
    (action !== 'place' || area.trim().length > 0 || box.trim().length > 0) &&
    (action !== 'delete' || deletable.length > 0);

  const run = async () => {
    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: tasks.length });

    try {
      if (action === 'type') {
        const result = await setFaultTypeBulk({
          token,
          taskIds: faults.map((task) => task.id),
          faultType,
        });
        toast.success(
          so ? `${result.updated} cilado la cusboonaysiiyay` : `${result.updated} faults updated`,
          result.refused.length
            ? {
                description: so
                  ? `${result.refused.length} lama beddelin`
                  : `${result.refused.length} could not be changed`,
              }
            : undefined,
        );
      } else if (action === 'priority') {
        const result = await setPriorityBulk({
          token,
          taskIds: tasks.map((task) => task.id),
          priority,
        });
        toast.success(
          priority === 'urgent'
            ? so
              ? `${result.updated} loo qaaday degdeg`
              : `${result.updated} marked urgent`
            : so
              ? `${result.updated} loo celiyay caadi`
              : `${result.updated} set to normal`,
        );
      } else if (action === 'place') {
        const result = await setPlacementBulk({
          token,
          taskIds: tasks.map((task) => task.id),
          xaafada: area,
          cableboxCodeRaw: box,
        });
        toast.success(
          so ? `${result.updated} shaqo goobta la geliyay` : `${result.updated} jobs placed`,
          {
            description: [area.trim(), box.trim()].filter(Boolean).join(' · ') || undefined,
          },
        );
      } else {
        /**
         * Deletion is imported here rather than at the top of the file so the
         * sheet a supervisor never opens for a delete does not pull the
         * bulk-delete code into the chunk.
         */
        const { deleteTasksBulk } = await import('../../../lib/opsService');
        const result = await deleteTasksBulk({
          token,
          taskIds: deletable.map((task) => task.id),
          reason: reason.trim(),
          onProgress: (done, total) => setProgress({ done, total }),
        });

        if (result.refused.length > 0) {
          // Reporting the truth: a bulk delete that half-succeeded is a normal
          // outcome, not an exception.
          toast.info(
            so
              ? `${result.deleted.length} la tirtiray, ${result.refused.length} la ilaaliyay`
              : `${result.deleted.length} deleted, ${result.refused.length} kept`,
            {
              description: so
                ? 'Kuwii la ilaaliyay waa la shaqeeyay — isticmaal jooji.'
                : 'The ones kept were worked on — cancel those instead.',
            },
          );
        } else {
          toast.success(
            so ? `${result.deleted.length} la tirtiray` : `${result.deleted.length} deleted`,
          );
        }
      }

      onDone();
      onClose();
    } catch (err) {
      setError(describeError(err, lang));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const title = so ? `Talaabo kooxeed · ${tasks.length}` : `Bulk action · ${tasks.length}`;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      description={so ? 'Shaqooyinka la doortay' : 'The jobs you ticked'}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {so ? 'Jooji' : 'Cancel'}
          </Button>
          <Button
            variant={action === 'delete' ? 'danger' : 'primary'}
            loading={busy}
            disabled={!canSubmit}
            onClick={() => void run()}
          >
            {progress ? `${progress.done}/${progress.total}` : so ? 'Ful' : 'Apply'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && (
          <Alert tone="danger" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Which actions, and what each is for. */}
        <div className="grid gap-2">
          <ActionChoice
            selected={action === 'type'}
            onSelect={() => setAction('type')}
            icon={<Wrench className="w-4 h-4" />}
            title={so ? 'Nooca cilada' : 'Fault type'}
            body={
              faults.length === 0
                ? so
                  ? 'Mid ka mid ah shaqooyinkan cilada ma aha.'
                  : 'None of these is a fault.'
                : so
                  ? `${faults.length} cilado`
                  : `${faults.length} ${faults.length === 1 ? 'fault' : 'faults'}`
            }
            disabled={faults.length === 0}
          />
          <ActionChoice
            selected={action === 'priority'}
            onSelect={() => setAction('priority')}
            icon={<AlertTriangle className="w-4 h-4" />}
            title={so ? 'Degdeg' : 'Urgency'}
            body={so ? `${tasks.length} shaqo` : `${tasks.length} ${tasks.length === 1 ? 'job' : 'jobs'}`}
          />
          <ActionChoice
            selected={action === 'place'}
            onSelect={() => setAction('place')}
            icon={<MapPin className="w-4 h-4" />}
            title={so ? 'Goobta' : 'Area and box'}
            body={
              placeless.length > 0
                ? so
                  ? `${placeless.length} shaqo goob ma leh`
                  : `${placeless.length} ${placeless.length === 1 ? 'job has' : 'jobs have'} no place`
                : so
                  ? 'Dhammaan goob bay leeyihiin'
                  : 'These all have a place'
            }
            disabled={placeless.length === 0}
          />
          <ActionChoice
            selected={action === 'delete'}
            onSelect={() => setAction('delete')}
            icon={<Trash2 className="w-4 h-4" />}
            title={so ? 'Tirtir' : 'Delete'}
            body={
              deletable.length === 0
                ? so
                  ? 'Midkoodna lama tirtiri karo'
                  : 'None of these can be deleted'
                : kept > 0
                  ? so
                    ? `${deletable.length} la tirtiri karaa · ${kept} la ilaalinayaa`
                    : `${deletable.length} can go · ${kept} will be kept`
                  : so
                    ? `${deletable.length} la tirtiri karaa`
                    : `${deletable.length} can be deleted`
            }
            disabled={deletable.length === 0}
            danger
          />
        </div>

        {/* The chosen action's form. */}
        {action === 'type' && faults.length > 0 && (
          <div className="space-y-1">
            <Select
              label={so ? 'Nooca cilada' : 'Fault type'}
              hint={
                faultType
                  ? FAULT_TYPE_LABEL[faultType as keyof typeof FAULT_TYPE_LABEL]?.hint[lang]
                  : so
                    ? 'Dooro nooca — ma jiro mid si toos ah loo doortay'
                    : 'Choose the type — nothing is selected by default'
              }
              value={faultType}
              onChange={(e) => setFaultType(e.target.value)}
            >
              <option value="">{so ? 'Dooro nooca…' : 'Choose a type…'}</option>
              {FAULT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {FAULT_TYPE_LABEL[type][lang]}
                </option>
              ))}
            </Select>

            {alreadyTyped.length > 0 && faultType !== '' && (
              <Alert tone="warning" className="mt-2">
                {so
                  ? `${alreadyTyped.length} cilad hore ayaa nooc u leh. Tan ayaa beddeli doonta.`
                  : `${alreadyTyped.length} of these already ${alreadyTyped.length === 1 ? 'has a type' : 'have a type'}. This will replace ${alreadyTyped.length === 1 ? 'it' : 'them'}.`}
              </Alert>
            )}
          </div>
        )}

        {action === 'priority' && (
          <Select
            label={so ? 'Culeyska' : 'Set to'}
            value={priority}
            onChange={(e) => setPriority(e.target.value === 'urgent' ? 'urgent' : 'normal')}
          >
            <option value="urgent">{so ? 'Degdeg' : 'Urgent'}</option>
            <option value="normal">{so ? 'Caadi' : 'Normal'}</option>
          </Select>
        )}

        {action === 'place' && (
          <div className="space-y-2">
            <p className="text-[11px] leading-snug text-slate-600">
              {so
                ? 'Waxaad buuxinaysaa goobta shaqooyinka aan la jihayn karin. Mid ka mid ah ku filan yahay in la jihayn karo.'
                : 'Fills in the place on jobs that cannot be routed. Either field alone is enough to plan them.'}
            </p>
            <Input
              label={so ? 'Xaafada' : 'Area (xaafada)'}
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="Jigjigayar"
              maxLength={80}
            />
            <Input
              label={so ? 'Sanduuqa (cablebox)' : 'Cable box'}
              value={box}
              onChange={(e) => setBox(e.target.value)}
              placeholder="CB190-229 (06)"
              maxLength={40}
              hint={
                so
                  ? 'Mid keliya buuxi haddii aadan labadaba garanayn.'
                  : 'Fill in only one if you do not know both.'
              }
            />
          </div>
        )}

        {action === 'delete' && (
          <>
            <Alert tone="warning" title={so ? 'Tirtirid waa joogtayn' : 'A delete cannot be undone'}>
              {so
                ? 'Waxa la tirtiri karaa oo keliya shaqo aan weli la shaqeyn. Shaqo kasta oo leh taariikh (waqti, sawir, alaab) waa la ilaalinayaa oo waa in la joojiyaa.'
                : 'Only jobs nobody has worked on can be deleted. Any job with a history — a timer, a photo, materials — is kept and must be cancelled instead.'}
            </Alert>

            {kept > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2">
                <p className="text-[11px] font-bold text-amber-900">
                  {so
                    ? `${kept} shaqo ayaa la ilaalinayaa sababtoo ah waa laga shaqeeyay.`
                    : `${kept} ${kept === 1 ? 'job' : 'jobs'} will be kept because they have been worked on.`}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {plan.kept
                    .slice(0, 5)
                    .map((task) => (
                      <li key={task.id} className="text-[10px] text-amber-900 truncate">
                        {task.line_number} · {whyNoDelete(task, 0)![lang]}
                      </li>
                    ))}
                </ul>
              </div>
            )}

            <Input
              label={so ? 'Sababta (loo baahan yahay)' : 'Reason (required)'}
              hint={so ? 'Waa lagu kaydinayaa tuubbada soo dejinta.' : 'Recorded against the import.'}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={so ? 'Tusaale: laba jeer la soo dejiyay' : 'e.g. imported twice'}
              maxLength={200}
            />
          </>
        )}

        {/* The selection itself, so the supervisor can check it. */}
        <details className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2">
          <summary className="text-[11px] font-bold text-slate-700 cursor-pointer">
            {so ? `Arag ${tasks.length} shaqo` : `See the ${tasks.length} jobs`}
          </summary>
          <ul className="mt-1.5 space-y-0.5 max-h-40 overflow-auto">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-baseline gap-1.5 text-[10px] text-slate-600">
                <span className="font-mono font-bold text-slate-800">{task.line_number}</span>
                <span className="truncate">{task.customer_name || '—'}</span>
                {task.task_type === 'cilada' && (
                  <span className="ml-auto shrink-0 text-slate-500">
                    {faultTypeLabel(task.fault_type, lang) ?? (so ? 'nooc ma leh' : 'no type')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </Sheet>
  );
}

function ActionChoice({
  selected,
  onSelect,
  icon,
  title,
  body,
  disabled,
  danger,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  body: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cx(
        'w-full min-h-11 text-left rounded-xl border px-2.5 py-2 flex items-start gap-2 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
        selected
          ? danger
            ? 'border-rose-400 bg-rose-50 ring-1 ring-rose-300'
            : 'border-brand-400 bg-brand-50 ring-1 ring-brand-300'
          : 'border-slate-200 bg-white hover:border-brand-300',
      )}
    >
      <span
        className={cx(
          'mt-0.5 shrink-0',
          selected ? (danger ? 'text-rose-700' : 'text-brand-700') : 'text-slate-500',
        )}
        aria-hidden="true"
      >
        {selected ? <Check className="w-4 h-4" /> : icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] font-extrabold text-slate-900">{title}</span>
        <span className="block text-[10px] text-slate-500">{body}</span>
      </span>
    </button>
  );
}
