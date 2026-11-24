import React, { useState } from 'react';
import { useLanguage } from '../../../lib/i18n';
import { describeError } from '../../../lib/useErrorMessage';
import type { Task } from '../../../types/database';
import { FAULT_TYPE_LABEL, FAULT_TYPES, asFaultType, taskKind } from '../../../lib/faults';
import { editTask } from '../../../lib/opsService';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { Input, Select } from '../../ui/Field';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';

/**
 * Correct a job.
 *
 * ## Why this is the most valuable control on the page
 *
 * Six of the nine live faults have **no area and no box**. `clusterTasks` groups
 * by exactly those two fields, so without an edit path those six can never be
 * planned, no matter how many crews are on shift. Until now there was no way to
 * fill them in short of a database console.
 *
 * ## What it will not do
 *
 * Status, assignment, timers and proof are absent on purpose. Each has its own
 * flow with its own rules — assigning needs a confirm step, cancelling needs a
 * reason, completing belongs to the technician. A form that could set `status`
 * would be a way around all of them, and the database refuses that too.
 *
 * The server is the authority: it rejects a fault type on an installation, a
 * date in the future, and any edit to a completed job. This form shows those
 * refusals rather than pre-empting them with hidden buttons.
 */
export function EditJobSheet({
  open,
  onClose,
  task,
  token,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  task: Task | null;
  token: string;
  onSaved: () => void;
}) {
  const { lang } = useLanguage();
  const so = lang === 'so';
  const toast = useToast();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The form starts from the job and diverges only where the supervisor types.
   *
   * Seeded on open rather than in an effect: an effect that resets state while
   * the sheet is animating in would wipe the first keystroke.
   */
  const [form, setForm] = useState(() => seed(task));
  const [seedId, setSeedId] = useState(task?.id ?? null);

  if (task && task.id !== seedId) {
    setSeedId(task.id);
    setForm(seed(task));
  }

  if (!task) return null;

  const isFault = taskKind(task) === 'fault';
  const changed = diff(task, form);

  const submit = async () => {
    if (changed === null) return;
    setBusy(true);
    setError(null);
    try {
      await editTask({ token, taskId: task.id, ...changed });
      toast.success(so ? 'Shaqada waa la cusboonaysiiyay' : 'Job updated', {
        description: `${task.line_number} · ${task.customer_name}`,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, lang));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={so ? 'Wax ka beddel shaqada' : 'Edit job'}
      description={`${task.line_number} · ${task.customer_name}`}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {so ? 'Jooji' : 'Cancel'}
          </Button>
          <Button loading={busy} disabled={changed === null} onClick={() => void submit()}>
            {so ? 'Kaydi' : 'Save'}
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

        {/* The one thing a supervisor most often needs to fix. */}
        {(!form.xaafada.trim() || !form.cablebox.trim()) && (
          <Alert tone="warning" title={so ? 'Goobta waa ka maqan tahay' : 'This job has no place'}>
            {so
              ? 'Shaqadan xaafad ama sanduuq ma laha, marka lama jihayn karo. Buuxi mid ka mid ah si qaybsigu u shaqeeyo.'
              : 'Without an area or a box this job cannot be put on a route. Fill one in so dispatch can plan it.'}
          </Alert>
        )}

        <Input
          label={so ? 'Magaca macmiilka' : 'Customer name'}
          value={form.customerName}
          onChange={(e) => setForm({ ...form, customerName: e.target.value })}
          maxLength={120}
        />

        <Input
          label={so ? 'Telefoonka' : 'Phone'}
          value={form.customerPhone}
          onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
          inputMode="tel"
          maxLength={20}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            label={so ? 'Xaafada' : 'Area (xaafada)'}
            value={form.xaafada}
            onChange={(e) => setForm({ ...form, xaafada: e.target.value })}
            placeholder="Jigjigayar"
            maxLength={80}
          />
          <Input
            label={so ? 'Sanduuqa (cablebox)' : 'Cable box'}
            value={form.cablebox}
            onChange={(e) => setForm({ ...form, cablebox: e.target.value })}
            placeholder="CB190-229 (06)"
            maxLength={40}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            label={so ? 'Deegaanka (port)' : 'Port'}
            value={form.port}
            onChange={(e) => setForm({ ...form, port: e.target.value.replace(/\D/g, '') })}
            inputMode="numeric"
            maxLength={4}
          />
          <Input
            label={so ? 'Maalinta la sheegay' : 'Reported date'}
            type="date"
            value={form.reportedDate}
            onChange={(e) => setForm({ ...form, reportedDate: e.target.value })}
          />
        </div>

        <Select
          label={so ? 'Culeyska' : 'Priority'}
          value={form.priority}
          onChange={(e) => setForm({ ...form, priority: e.target.value === 'urgent' ? 'urgent' : 'normal' })}
        >
          <option value="normal">{so ? 'Caadi' : 'Normal'}</option>
          <option value="urgent">{so ? 'Degdeg' : 'Urgent'}</option>
        </Select>

        {/* Only a fault has a fault type — the database refuses it on anything else. */}
        {isFault && (
          <Select
            label={so ? 'Nooca cilada' : 'Fault type'}
            hint={
              FAULT_TYPE_LABEL[asFaultType(form.faultType) ?? 'other']?.hint[lang]
            }
            value={form.faultType}
            onChange={(e) => setForm({ ...form, faultType: e.target.value })}
          >
            <option value="">{so ? 'Lama qorin' : 'Not recorded'}</option>
            {FAULT_TYPES.map((type) => (
              <option key={type} value={type}>
                {FAULT_TYPE_LABEL[type][lang]}
              </option>
            ))}
          </Select>
        )}

        {/* Honesty about what this form is not. */}
        <p className="text-[10px] leading-snug text-slate-500 border-t border-slate-100 pt-2">
          {so
            ? 'Foomkani ma beddeli karo xaaladda, qaybsiga ama waqtiga. Kuwaas waxay leeyihiin habraacyo gaar ah.'
            : 'This form cannot change status, assignment or timers. Those have their own flows.'}
        </p>
      </div>
    </Sheet>
  );
}

interface EditForm {
  customerName: string;
  customerPhone: string;
  xaafada: string;
  cablebox: string;
  port: string;
  priority: 'normal' | 'urgent';
  faultType: string;
  reportedDate: string;
}

function seed(task: Task | null): EditForm {
  return {
    customerName: task?.customer_name ?? '',
    customerPhone: task?.customer_phone ?? '',
    xaafada: task?.xaafada ?? '',
    cablebox: task?.cablebox_code_raw ?? '',
    port: task?.port_number != null ? String(task.port_number) : '',
    priority: task?.priority === 'urgent' ? 'urgent' : 'normal',
    faultType: task?.fault_type ?? '',
    reportedDate: task?.reported_date ?? '',
  };
}

/**
 * Only the fields that actually changed, or `null` when nothing did.
 *
 * Sending every field on every save would write an audit row for a form opened
 * and closed without a change, which makes the history useless.
 *
 * Clearing is a distinct signal: `faultType` going from a value to `''` must
 * send `clearFaultType`, because `faultType: null` means "leave it alone".
 */
/** The editable half of an edit call — everything but the token and the id. */
type EditChanges = Omit<Parameters<typeof editTask>[0], 'token' | 'taskId'>;

function diff(task: Task, form: EditForm): EditChanges | null {
  const out: EditChanges = {};

  if (form.customerName.trim() !== (task.customer_name ?? '')) out.customerName = form.customerName.trim();
  if (form.customerPhone.trim() !== (task.customer_phone ?? '')) out.customerPhone = form.customerPhone.trim();
  if (form.xaafada.trim() !== (task.xaafada ?? '')) out.xaafada = form.xaafada.trim();
  if (form.cablebox.trim() !== (task.cablebox_code_raw ?? '')) out.cableboxCodeRaw = form.cablebox.trim();
  if (form.port !== (task.port_number != null ? String(task.port_number) : '')) {
    out.portNumber = form.port ? Number(form.port) : null;
  }
  if (form.priority !== (task.priority ?? 'normal')) out.priority = form.priority;
  if (form.reportedDate !== (task.reported_date ?? '')) out.reportedDate = form.reportedDate || null;

  const currentType = task.fault_type ?? '';
  if (form.faultType !== currentType) {
    if (form.faultType === '') out.clearFaultType = true;
    else out.faultType = form.faultType;
  }

  return Object.keys(out).length === 0 ? null : out;
}
