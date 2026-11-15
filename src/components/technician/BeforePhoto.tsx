import React, { useRef, useState } from 'react';
import { Camera, CheckCircle2 } from 'lucide-react';
import { addTaskPhoto } from '../../lib/executionService';
import { preparePhoto } from '../../lib/photo';
import { BEFORE_WHY, canTakeBefore, optionalNote, whyNoBefore } from '../../lib/photoKind';

/**
 * A photo of the state on arrival.
 *
 * Optional, and it says so. A technician is never blocked from closing a job
 * because they did not photograph the before, and this upload is a separate call
 * from completion — exactly like the proof photo, because a camera that fails
 * must never hold a finished job hostage.
 *
 * The upload does **not** set the proof pointer on the task; only an after photo
 * does.
 */
export function BeforePhoto({
  token,
  taskId,
  status,
  lang,
}: {
  token: string;
  taskId: string;
  status: string;
  lang: 'so' | 'en';
}) {
  const so = lang === 'so';
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const why = whyNoBefore(status, lang);
  if (why) {
    // The job is finished or cancelled; say why rather than showing nothing.
    return <p className="px-1 text-[10px] text-slate-500">{why}</p>;
  }
  if (!canTakeBefore(status)) return null;

  const onPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setBusy(true);
    setError(null);
    try {
      const prepared = await preparePhoto(file);
      await addTaskPhoto({
        token,
        taskId,
        base64: prepared.base64,
        mime: prepared.mime,
        kind: 'before',
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : so ? 'Sawirka lama dirin' : 'Could not upload');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white border border-slate-200 px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <Camera className="w-3.5 h-3.5 text-brand-700 shrink-0" aria-hidden="true" />
        <span className="text-[11px] font-bold text-slate-700">
          {so ? 'Sawir ka hor shaqada' : 'Before photo'}
        </span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy || done}
          className="ml-auto inline-flex items-center gap-1 min-h-11 px-3 rounded-xl bg-slate-100 text-[11px] font-extrabold text-slate-800 disabled:opacity-50 active:scale-[0.99] transition cursor-pointer"
        >
          {done ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-brand-700" aria-hidden="true" />
              {so ? 'La diray' : 'Sent'}
            </>
          ) : busy ? (
            (so ? 'Diraya…' : 'Sending…')
          ) : (
            (so ? 'Qaado' : 'Take')
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          capture="environment"
          onChange={(e) => void onPick(e)}
          className="hidden"
        />
      </div>

      <p className="text-[10px] leading-snug text-slate-500">{optionalNote(lang)}</p>
      <p className="text-[10px] leading-snug text-slate-500">{BEFORE_WHY[lang]}</p>

      {error && <p className="text-[10px] font-semibold text-rose-700">{error}</p>}
    </div>
  );
}
