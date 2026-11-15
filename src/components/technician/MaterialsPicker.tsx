import React, { useEffect, useState } from 'react';
import { Check, Loader2, Plus, X } from 'lucide-react';
import {
  COMMON_ITEMS,
  MATERIAL_PROBLEM_COPY,
  MATERIAL_UNITS,
  UNIT_LABEL,
  formatQuantity,
  materialProblem,
  normaliseLine,
  type MaterialLine,
  type MaterialUnit,
  type RecordedMaterial,
} from '../../lib/materials';
import { addTaskMaterial, fetchTaskMaterials } from '../../lib/materialsService';

/**
 * Recording what a job used.
 *
 * Downloaded on demand (`React.lazy` at the call site): most technicians open a
 * dozen jobs without touching this, and the hot bundle had under 5 kB of room.
 * It arrives while the completion form is already on screen, so the wait is
 * invisible in practice.
 *
 * Design decisions taken for a person standing in a stairwell:
 *
 * * **Common items are one tap.** Tapping a chip fills the name and the field
 *   keeps focus, so the usual job is: tap "Drop cable", type 6, Add.
 * * **The unit is remembered between lines.** A job with four lines of cable
 *   should not need "m" selected four times.
 * * **Nothing blocks completion.** A failed save shows an error and the
 *   technician can still finish the job — materials are important, but not more
 *   important than recording the dBm reading and closing the work.
 */

interface Props {
  token: string;
  taskId: string;
  lang: 'so' | 'en';
  /** Called after a line is saved, so the parent can refresh if it wants. */
  onChanged?: () => void;
}

export default function MaterialsPicker({ token, taskId, lang, onChanged }: Props) {
  const so = lang === 'so';

  const [lines, setLines] = useState<RecordedMaterial[]>([]);
  const [item, setItem] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<MaterialUnit>('pcs');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchTaskMaterials(token, taskId)
      .then((rows) => !cancelled && setLines(rows))
      .catch(() => {
        // A missing list must never block the completion form.
      });
    return () => {
      cancelled = true;
    };
  }, [token, taskId]);

  const add = async () => {
    const parsed: Partial<MaterialLine> = {
      item,
      quantity: quantity.trim() === '' ? NaN : Number(quantity),
      unit,
    };

    const problem = materialProblem(parsed);
    if (problem) {
      setError(MATERIAL_PROBLEM_COPY[problem][lang]);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const normalised = normaliseLine(parsed as MaterialLine);
      await addTaskMaterial({
        token,
        taskId,
        item: normalised.item,
        quantity: normalised.quantity,
        unit: normalised.unit,
      });

      // Optimistic enough to feel instant, then replaced by the server's copy
      // on the next open. The row carries `recorded_by_name` which we do not
      // know here, so the local echo omits it rather than inventing it.
      setLines((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          item: normalised.item,
          quantity: normalised.quantity,
          unit: normalised.unit,
          recorded_by_name: null,
          created_at: new Date().toISOString(),
        },
      ]);
      setItem('');
      setQuantity('');
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : so ? 'Lama kaydin karin' : 'Could not save it');
    } finally {
      setBusy(false);
    }
  };

  const total = lines.length;

  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-3 space-y-3">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between text-left cursor-pointer"
        aria-expanded={open}
      >
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
          {so ? 'Alaabta la isticmaalay' : 'Materials used'}
          {total > 0 && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-brand-100 text-brand-800 text-[10px]">
              {total}
            </span>
          )}
        </span>
        <span className="text-[11px] font-bold text-brand-700">{open ? (so ? 'Xir' : 'Hide') : so ? 'Ku dar' : 'Add'}</span>
      </button>

      {/* Recorded so far — visible even when collapsed, so nothing is silently
          added to a job somebody is about to close. */}
      {lines.length > 0 && (
        <ul className="space-y-1">
          {lines.map((line) => (
            <li
              key={line.id}
              className="flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-200/70 px-2 py-1.5"
            >
              <Check className="w-3 h-3 text-brand-700 shrink-0" aria-hidden="true" />
              <span className="text-[12px] font-bold text-slate-800 truncate">{line.item}</span>
              <span className="ml-auto font-mono text-[11px] font-bold text-slate-600 shrink-0">
                {formatQuantity(line.quantity, line.unit, lang)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <>
          <div className="flex flex-wrap gap-1">
            {COMMON_ITEMS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => {
                  setItem(suggestion);
                  // Cable is measured; everything else is counted. Guessing
                  // once here saves a tap on the common cases.
                  setUnit(suggestion === 'Drop cable' ? 'm' : 'pcs');
                }}
                className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                  item === suggestion
                    ? 'bg-brand-700 text-white border-brand-700'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {suggestion}
              </button>
            ))}
          </div>

          <div className="flex gap-1.5">
            <input
              value={item}
              onChange={(event) => setItem(event.target.value)}
              placeholder={so ? 'Shay' : 'Item'}
              maxLength={80}
              className="flex-1 min-w-0 min-h-11 rounded-xl border border-slate-300 px-2.5 text-[12px] font-semibold focus:outline-none focus:border-brand-500"
              aria-label={so ? 'Shayga' : 'Item'}
            />
            <input
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              inputMode="decimal"
              placeholder="0"
              className="w-16 min-h-11 rounded-xl border border-slate-300 px-2 text-center font-mono text-[12px] font-bold focus:outline-none focus:border-brand-500"
              aria-label={so ? 'Tirada' : 'Quantity'}
            />
            <select
              value={unit}
              onChange={(event) => setUnit(event.target.value as MaterialUnit)}
              className="min-h-11 rounded-xl border border-slate-300 px-1.5 text-[11px] font-bold bg-white focus:outline-none focus:border-brand-500"
              aria-label={so ? 'Unugga' : 'Unit'}
            >
              {MATERIAL_UNITS.map((option) => (
                <option key={option} value={option}>
                  {UNIT_LABEL[option][lang]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy}
              className="min-h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-xl bg-brand-700 text-white disabled:opacity-50 cursor-pointer active:scale-95 transition"
              aria-label={so ? 'Ku dar' : 'Add'}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </button>
          </div>

          {error && (
            <p className="flex items-start gap-1.5 text-[11px] font-semibold text-rose-700">
              <X className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}

          <p className="text-[10px] text-slate-500 leading-snug">
            {so
              ? 'Kani wuxuu diiwaan gelinayaa waxa la isticmaalay oo keliya — bakhaarka lama tirinayo.'
              : 'This records what was used only — stock on hand is not tracked.'}
          </p>
        </>
      )}
    </div>
  );
}
