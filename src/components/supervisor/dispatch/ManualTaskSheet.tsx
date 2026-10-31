import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, MapPin, Phone, Plus, Server, User, Users } from 'lucide-react';
import { useLanguage } from '../../../lib/i18n';
import { emptyManualDraft, validateManualTask, type ManualTaskDraft } from '../../../lib/ops';
import { createManualTask } from '../../../lib/opsService';
import { describeError } from '../../../lib/useErrorMessage';
import type { DispatchTarget } from '../../../lib/dispatch';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { Input, Select, Textarea } from '../../ui/Field';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';

/**
 * A job that arrives by phone call, captured while the caller is still talking.
 *
 * The rule from the importer carries over: if there is already an open job for
 * this line, the supervisor is told and must confirm before a second one is
 * created — never a silent duplicate.
 */
export function ManualTaskSheet({
  open,
  onClose,
  token,
  groupId,
  targets,
  boxCodes,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  groupId: string;
  targets: DispatchTarget[];
  boxCodes: { box_code: string; total_ports: number }[];
  onCreated: (taskId: string) => void;
}) {
  const { lang } = useLanguage();
  const so = lang === 'so';
  const toast = useToast();

  const [draft, setDraft] = useState<ManualTaskDraft>(emptyManualDraft);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; line_number: string; customer_name: string; status: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(emptyManualDraft());
    setTouched(false);
    setServerError(null);
    setDuplicate(null);
  }, [open]);

  const validation = useMemo(() => validateManualTask(draft, lang), [draft, lang]);
  const hasErrors = Object.keys(validation.errors).length > 0;

  const set = <K extends keyof ManualTaskDraft>(key: K, value: ManualTaskDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const knownBox = useMemo(
    () => boxCodes.find((box) => box.box_code === draft.box_code.trim().toUpperCase()) ?? null,
    [boxCodes, draft.box_code],
  );

  const submit = async (allowDuplicate = false) => {
    setTouched(true);
    setServerError(null);

    if (hasErrors || !token || !groupId) return;
    if (!allowDuplicate && duplicate) return;

    setSaving(true);
    try {
      const result = await createManualTask({
        token,
        groupId,
        payload: validation.payload,
        allowDuplicate,
      });

      if (!result.ok && result.reason === 'duplicate') {
        const existing = result.task as { id: string; line_number: string; customer_name: string; status: string };
        setDuplicate(existing);
        return;
      }

      toast.success(so ? 'Shaqada waa lagu daray' : 'Job added', {
        description: `${draft.line_number.trim()} · ${
          (result as { assigned_to?: string | null }).assigned_to ?? (so ? 'guddiga' : 'in the pool')
        }`,
      });

      onCreated((result.task as { id: string }).id);
      onClose();
    } catch (err) {
      setServerError(describeError(err, lang));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <Phone className="w-4 h-4 text-emerald-700" aria-hidden="true" />
          {so ? 'Shaqo telefoon ku timid' : 'Phone-in job'}
        </span>
      }
      description={
        so
          ? 'Qor waxa macmiilku sheegay. Waxay u gudbi doontaa shaqooyinka la qaybinayo.'
          : 'Capture the call. The job lands in the dispatch pool straight away.'
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {so ? 'Jooji' : 'Cancel'}
          </Button>
          <Button
            onClick={() => void submit(false)}
            loading={saving}
            disabled={saving || (touched && hasErrors)}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            {so ? 'Ku dar shaqada' : 'Add job'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {serverError && (
          <Alert tone="danger" onDismiss={() => setServerError(null)} dismissLabel={so ? 'Xir' : 'Dismiss'}>
            {serverError}
          </Alert>
        )}

        {duplicate && (
          <Alert tone="warning" title={so ? 'Shaqo furan ayaa horey u jirtay' : 'An open job already exists'}>
            <div className="space-y-2">
              <p className="font-mono text-[12px]">
                {duplicate.line_number} · {duplicate.customer_name}
              </p>
              <p>
                {so
                  ? 'Khadkan shaqo furan ayaa horey u haysta. Haddii aad labaad u baahan tahay, xaqiiji.'
                  : 'This line already has an open job. Only add a second one if it is genuinely a different visit.'}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="secondary" onClick={() => void submit(true)} loading={saving}>
                  {so ? 'Sii wad — labaad ku dar' : 'Add a second job anyway'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => set('line_number', '')}>
                  {so ? 'Beddel lambarka khadka' : 'Change the line number'}
                </Button>
              </div>
            </div>
          </Alert>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label={so ? 'Lambarka khadka' : 'Line number'}
            value={draft.line_number}
            onChange={(event) => set('line_number', event.target.value)}
            placeholder="634…"
            inputMode="numeric"
            error={touched ? validation.errors.line_number : null}
            autoFocus
          />
          <Input
            label={so ? 'Magaca macmiilka' : 'Customer name'}
            value={draft.customer_name}
            onChange={(event) => set('customer_name', event.target.value)}
            placeholder={so ? 'Magaca oo buuxa' : 'Full name'}
            error={touched ? validation.errors.customer_name : null}
          />
        </div>

        <Input
          label={so ? 'Taleefanka macmiilka' : 'Customer phone'}
          value={draft.customer_phone}
          onChange={(event) => set('customer_phone', event.target.value)}
          placeholder="63…"
          inputMode="tel"
          error={touched ? validation.errors.customer_phone : null}
          hint={so ? 'Farsamayaqaanku wuu wici karaa isagoo gujinaya' : 'The technician can tap to call'}
          leadingIcon={<Phone className="w-4 h-4" />}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label={so ? 'Nooca shaqada' : 'Job type'}
            value={draft.task_type}
            onChange={(event) => set('task_type', event.target.value as ManualTaskDraft['task_type'])}
          >
            <option value="cilada">{so ? 'Cilad (fault)' : 'Fault (cilada)'}</option>
            <option value="installation">{so ? 'Ku xirid cusub' : 'New installation'}</option>
          </Select>

          <Select
            label={so ? 'Degdeg' : 'Priority'}
            value={draft.priority}
            onChange={(event) => set('priority', event.target.value as ManualTaskDraft['priority'])}
          >
            <option value="normal">{so ? 'Caadi' : 'Normal'}</option>
            <option value="urgent">{so ? 'Degdeg' : 'Urgent'}</option>
          </Select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label={so ? 'Xaafada' : 'Area'}
            value={draft.xaafada}
            onChange={(event) => set('xaafada', event.target.value)}
            placeholder={so ? 'Tusaale: Masalaha' : 'For example: Masalaha'}
            leadingIcon={<MapPin className="w-4 h-4" />}
          />
          <Input
            label={so ? 'Sanduuqa (ikhtiyaari)' : 'Cablebox (optional)'}
            value={draft.box_code}
            onChange={(event) => set('box_code', event.target.value)}
            placeholder="FAT 48"
            list="manual-box-codes"
            leadingIcon={<Server className="w-4 h-4" />}
            hint={
              knownBox
                ? so
                  ? `Sanduuqan ${knownBox.total_ports} port ayaa leh`
                  : `This box has ${knownBox.total_ports} ports`
                : so
                  ? 'Haddii uusan jirin, waa la abuuri doonaa'
                  : 'If it does not exist yet, it will be created'
            }
          />
          <datalist id="manual-box-codes">
            {boxCodes.map((box) => (
              <option key={box.box_code} value={box.box_code} />
            ))}
          </datalist>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label={so ? 'Port (ikhtiyaari)' : 'Port (optional)'}
            value={draft.port_number}
            onChange={(event) => set('port_number', event.target.value)}
            placeholder="1 – 32"
            inputMode="numeric"
            error={touched ? validation.errors.port_number : null}
          />
          <Input
            label={so ? 'Nooca cabashada' : 'Complaint type'}
            value={draft.complain_type}
            onChange={(event) => set('complain_type', event.target.value)}
            placeholder={so ? 'Tusaale: internet ma leh' : 'For example: no internet'}
          />
        </div>

        <Select
          label={so ? 'U qoondee hadda (ikhtiyaari)' : 'Assign now (optional)'}
          value={draft.assign_key}
          onChange={(event) => set('assign_key', event.target.value)}
          hint={
            so
              ? 'Haddii aad ka tagto madhan, shaqadu waxay ku biiraysaa guddiga'
              : 'Leave empty and the job goes to the pool for tomorrow’s dispatch'
          }
        >
          <option value="">{so ? 'Guddiga — qaybiya gadaal' : 'The pool — dispatch later'}</option>
          {targets.map((target) => (
            <option key={`${target.kind}:${target.id}`} value={`${target.kind}:${target.id}`}>
              {target.kind === 'crew' ? '🚚 ' : '👤 '}
              {target.name}
            </option>
          ))}
        </Select>

        <Textarea
          label={so ? 'Waxa macmiilku sheegay' : 'What the caller said'}
          value={draft.notes}
          onChange={(event) => set('notes', event.target.value)}
          placeholder={
            so
              ? 'Tusaale: wuxuu sheegay in laydhku socdo laakiin internet-ku ma shaqeynayo tan iyo shalay'
              : 'For example: power is on but the internet has been down since yesterday'
          }
          hint={so ? 'Waa lagu kaydin doonaa taariikhda shaqada' : 'Kept in the job’s audit trail'}
        />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1">
            {draft.assign_key.startsWith('crew') ? <Users className="w-3 h-3" /> : <User className="w-3 h-3" />}
            {draft.assign_key ? (so ? 'La qoondeeyay' : 'Will be assigned') : so ? 'Guddiga' : 'Pool'}
          </span>
          <span className="inline-flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {so ? 'Laba shaqo oo isku khad ah waa la ogaan doonaa' : 'A duplicate line is caught before saving'}
          </span>
        </div>
      </div>
    </Sheet>
  );
}
