import { useState } from 'react';
import { Check, ChevronDown, Wrench } from 'lucide-react';
import { FAULT_TYPE_LABEL, FAULT_TYPES, asFaultType } from '../../lib/faults';
import { useToast } from '../ui/Toast';
import { describeError } from '../../lib/useErrorMessage';
import { setFaultType } from '../../lib/opsService';

/**
 * "What is actually wrong?" — the technician's answer.
 *
 * A fault arrives with whatever the customer said on the phone, and that is
 * usually not a fault type: the complaint column holds "CILAD", "degdeg", "ok",
 * or a phone number. The person who can tell slow speed from a cut cable is the
 * one standing at the box, so the choice belongs here, on the job, not on a
 * supervisor's screen hours later.
 *
 * Collapsed by default. A technician mid-job needs the address and the phone
 * number, not eight options; the current type is shown so one tap opens the
 * list when they are ready to answer it.
 *
 * Every option carries what it *means*, because "no signal" and "slow speed"
 * sound alike on a bad line and picking the wrong one sends the next visit to
 * the wrong place with the wrong van.
 */
export function FaultTypePicker({
  taskId,
  token,
  current,
  lang,
  onChanged,
}: {
  taskId: string;
  token: string;
  current: string | null | undefined;
  lang: 'so' | 'en';
  onChanged?: () => void;
}) {
  const so = lang === 'so';
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(current ?? null);

  const selected = asFaultType(chosen);

  const choose = async (type: string | null) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setFaultType({ token, taskId, faultType: type });
      setChosen(type);
      setOpen(false);
      toast.success(
        type
          ? so
            ? 'Nooca cilada la kaydiyay'
            : 'Fault type saved'
          : so
            ? 'Nooca cilada la tirtiray'
            : 'Fault type cleared',
        type ? { description: FAULT_TYPE_LABEL[type as keyof typeof FAULT_TYPE_LABEL][lang] } : undefined,
      );
      onChanged?.();
    } catch (err) {
      // Shown in place, not as a toast: this is a form the technician is
      // standing in front of, and the reason must stay on screen.
      setError(describeError(err, lang));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-3 min-h-11 text-left cursor-pointer active:scale-[0.995] transition"
      >
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
          <Wrench className="w-3.5 h-3.5 text-brand-700" aria-hidden="true" />
          {so ? 'Nooca cilada' : 'Fault type'}
        </span>
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <span
            className={`truncate text-[11px] font-extrabold ${
              selected ? 'text-brand-800' : 'text-amber-700'
            }`}
          >
            {selected ? FAULT_TYPE_LABEL[selected][lang] : so ? 'Lama qorin' : 'Not recorded'}
          </span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 p-2 space-y-1">
          <p className="px-1 pb-1 text-[10px] text-slate-500 leading-snug">
            {so
              ? 'Dooro waxa aad ka heshay goobta. Tan ayaa la keydinayaa shaqadan.'
              : 'Pick what you actually found on site. This is saved on this job only.'}
          </p>

          {error && (
            <div
              role="alert"
              className="mx-1 mb-1 rounded-lg bg-rose-50 border border-rose-100 px-2 py-1.5 text-[10px] font-semibold text-rose-800"
            >
              {error}
            </div>
          )}

          {FAULT_TYPES.map((type) => {
            const info = FAULT_TYPE_LABEL[type];
            const isCurrent = chosen === type;
            return (
              <button
                key={type}
                type="button"
                disabled={busy}
                onClick={() => void choose(type)}
                className={`w-full text-left rounded-xl px-2.5 py-2 transition cursor-pointer disabled:opacity-50 ${
                  isCurrent
                    ? 'bg-brand-50 border border-brand-200'
                    : 'border border-transparent hover:bg-slate-50'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-extrabold text-slate-800">{info[lang]}</span>
                  {isCurrent && <Check className="w-3.5 h-3.5 text-brand-700" aria-hidden="true" />}
                </span>
                <span className="block text-[10px] text-slate-500 leading-snug">{info.hint[lang]}</span>
              </button>
            );
          })}

          {/* Clearing is a real correction: somebody picked the wrong one. */}
          {chosen && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void choose(null)}
              className="w-full text-left rounded-xl px-2.5 py-2 text-[10px] font-bold text-slate-500 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
            >
              {so ? 'Tirtir — nooc ma leh' : 'Clear — no type'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
