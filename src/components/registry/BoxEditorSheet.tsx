import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, MapPin, Plus, Save, Server } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import {
  PORT_OPTIONS,
  boxDraftFrom,
  emptyBoxDraft,
  normaliseBoxCode,
  validateBoxDraft,
  type BoxDraft,
  type BoxLookup,
} from '../../lib/ops';
import { upsertCablebox } from '../../lib/opsService';
import { describeError } from '../../lib/useErrorMessage';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Input, Select, Textarea } from '../ui/Field';
import { Sheet } from '../ui/Sheet';
import { useToast } from '../ui/Toast';

/**
 * Register a box, or correct one that is already registered.
 *
 * Duplicate detection is the point of this screen. Two supervisors in the same
 * street both typing "FAT 48" used to create two boxes and split that box's
 * history; now the second one is shown the existing box and can open it.
 */
export function BoxEditorSheet({
  open,
  onClose,
  token,
  groupId,
  existingBoxes,
  editBox,
  onSaved,
  onOpenExisting,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  groupId: string;
  existingBoxes: BoxLookup[];
  /** null = register a new box */
  editBox?: {
    id: string;
    box_code: string;
    xaafada: string | null;
    olt_path: string | null;
    total_ports: number;
    location_notes?: string | null;
  } | null;
  onSaved: (boxCode: string) => void;
  onOpenExisting: (boxId: string) => void;
}) {
  const { lang } = useLanguage();
  const so = lang === 'so';
  const toast = useToast();

  const [draft, setDraft] = useState<BoxDraft>(emptyBoxDraft);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverDuplicate, setServerDuplicate] = useState<{ id: string; box_code: string; group_id: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(editBox ? boxDraftFrom(editBox) : emptyBoxDraft());
    setTouched(false);
    setServerError(null);
    setServerDuplicate(null);
  }, [open, editBox]);

  const validation = useMemo(() => validateBoxDraft(draft, existingBoxes, lang), [draft, existingBoxes, lang]);
  const hasErrors = Object.keys(validation.errors).length > 0;
  const editing = Boolean(draft.id);

  const set = <K extends keyof BoxDraft>(key: K, value: BoxDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    setTouched(true);
    setServerError(null);
    setServerDuplicate(null);

    if (hasErrors || validation.duplicate || !token || !groupId) return;

    setSaving(true);
    try {
      const result = await upsertCablebox({ token, groupId, draft });

      if (!result.ok && result.reason === 'duplicate') {
        setServerDuplicate({ id: result.box.id, box_code: result.box.box_code, group_id: result.box.group_id });
        return;
      }

      toast.success(
        result.reason === 'created'
          ? so
            ? 'Sanduuqa waa la diiwaan geliyay'
            : 'Cablebox registered'
          : so
            ? 'Sanduuqa waa la cusbooneysiiyay'
            : 'Cablebox updated',
        { description: result.box.box_code },
      );
      onSaved(result.box.box_code);
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
          <Server className="w-4 h-4 text-emerald-700" aria-hidden="true" />
          {editing
            ? so
              ? 'Wax ka beddel sanduuqa'
              : 'Edit cablebox'
            : so
              ? 'Diiwaan geli sanduuq cusub'
              : 'Register a cablebox'}
        </span>
      }
      description={
        so
          ? 'Lambarka sanduuqa sida ay ku qoran tahay field-ka. Labanlaab waa la ogaan doonaa.'
          : 'The code exactly as written on the box. A duplicate is caught before it is saved.'
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {so ? 'Jooji' : 'Cancel'}
          </Button>
          <Button
            onClick={() => void submit()}
            loading={saving}
            disabled={saving || (touched && (hasErrors || Boolean(validation.duplicate)))}
          >
            {editing ? <Save className="w-4 h-4" aria-hidden="true" /> : <Plus className="w-4 h-4" aria-hidden="true" />}
            {editing ? (so ? 'Kaydi' : 'Save changes') : so ? 'Diiwaan geli' : 'Register box'}
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

        {(validation.duplicate || serverDuplicate) && (
          <Alert
            tone="warning"
            title={
              serverDuplicate && serverDuplicate.group_id !== groupId
                ? so
                  ? 'Sanduuqan waxa iska leh group kale'
                  : 'This box belongs to another group'
                : so
                  ? 'Sanduuq horey ayaa loo diiwaan geliyay'
                  : 'This box already exists'
            }
          >
            <div className="space-y-2">
              <p>
                {serverDuplicate && serverDuplicate.group_id !== groupId
                  ? so
                    ? 'Lambarka sanduuqa waa mid caalami ah. Beddel lambarka, ama ka shaqee group-kaas.'
                    : 'Box codes are unique across the department. Use a different code, or work from that group.'
                  : so
                    ? 'Lambarkaani waa horey u jiray. Laba sanduuq oo isku mid ah ayaa kala qaybin lahaa taariikhda.'
                    : 'This code is already registered. A second copy would split that box’s history in two.'}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {!(serverDuplicate && serverDuplicate.group_id !== groupId) && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onOpenExisting((validation.duplicate ?? serverDuplicate)!.id)}
                  >
                    {so ? 'Fur sanduuqa jira' : 'Open the existing box'}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => set('box_code', `${validation.normalisedCode || draft.box_code}-2`)}
                >
                  {so ? 'Isticmaal lambar kale' : 'Use a different code'}
                </Button>
              </div>
            </div>
          </Alert>
        )}

        <Input
          label={so ? 'Lambarka sanduuqa' : 'Cablebox code'}
          value={draft.box_code}
          onChange={(event) => set('box_code', event.target.value)}
          placeholder="FAT 48"
          autoCapitalize="characters"
          error={touched ? validation.errors.box_code : null}
          hint={
            validation.normalisedCode && validation.normalisedCode !== draft.box_code
              ? so
                ? `Waxaa lagu kaydin doonaa: ${validation.normalisedCode}`
                : `Will be saved as: ${validation.normalisedCode}`
              : so
                ? 'Tusaale: FAT 48, B6 (52)'
                : 'For example: FAT 48, B6 (52)'
          }
          leadingIcon={<Server className="w-4 h-4" />}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label={so ? 'Xaafada' : 'Area / neighbourhood'}
            value={draft.xaafada}
            onChange={(event) => set('xaafada', event.target.value)}
            placeholder={so ? 'Tusaale: Masalaha' : 'For example: Masalaha'}
            leadingIcon={<MapPin className="w-4 h-4" />}
          />

          <Select
            label={so ? 'Tirada port-yada' : 'Ports on this box'}
            value={draft.total_ports}
            onChange={(event) => set('total_ports', Number(event.target.value))}
            hint={
              editing
                ? so
                  ? 'Yarayn lama ogola in port-yo shaqaynaya ku jiraan'
                  : 'Shrinking is refused while a port above the new count is in use'
                : undefined
            }
          >
            {PORT_OPTIONS.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </Select>
        </div>

        <Input
          label={so ? 'Jidka OLT (ikhtiyaari)' : 'OLT path (optional)'}
          value={draft.olt_path}
          onChange={(event) => set('olt_path', event.target.value)}
          placeholder="OLT-3 / PON-2"
          hint={so ? 'Sida ay shirkadda u qoran tahay' : 'As written on the network plan'}
        />

        <Textarea
          label={so ? 'Faahfaahin goobta (ikhtiyaari)' : 'Location notes (optional)'}
          value={draft.location_notes}
          onChange={(event) => set('location_notes', event.target.value)}
          placeholder={
            so ? 'Tusaale: gadaasha dukaanka, darbiga cagaaran' : 'For example: behind the shop, green wall'
          }
          hint={
            so
              ? 'Wax kasta oo farsamayaqaanka caawinaya inuu sanduuqa helo'
              : 'Anything that helps a technician find the box'
          }
        />

        {editing && (
          <Alert tone="note">
            {so
              ? 'Beddelka lambarka wuxuu saameynayaa taariikhda sanduuqa — hubi inuu yahay isla sanduuq.'
              : 'Changing the code keeps this box’s history. Make sure it is the same physical box.'}
          </Alert>
        )}

        {normaliseBoxCode(draft.box_code) && !validation.duplicate && (
          <div className="flex items-start gap-2 text-[11px] text-slate-500">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {so
                ? 'Hubi in sanduuqan aan horey loo diiwaan gelin — raadinta sare ayaa ku tusinaysa.'
                : 'Check this box is not already listed — the search above will show it.'}
            </span>
          </div>
        )}
      </div>
    </Sheet>
  );
}
