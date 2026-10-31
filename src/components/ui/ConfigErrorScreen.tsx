import React, { useState } from 'react';
import { AlertTriangle, Globe, RefreshCw, Wifi } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { describeConnection, getConfigNotes, type SupabaseProbe } from '../../lib/supabase';

/**
 * Shown only when the deployment's own connection is broken — the one failure a
 * technician cannot fix by trying again with a different PIN.
 *
 * It replaces the raw gateway text ("Invalid API key") with what is actually
 * true, what to do about it, and a copyable diagnostic for the supervisor. It
 * deliberately does not show the key itself: only its shape, its last four
 * characters, and whether it came from the environment.
 */
export function ConfigErrorScreen({
  probe,
  onRetry,
  onContinue,
}: {
  probe: SupabaseProbe | null;
  onRetry: () => Promise<void> | void;
  /** escape hatch: never trap a working deployment behind a failed check */
  onContinue?: () => void;
}) {
  const { lang, setLang } = useLanguage();
  const [retrying, setRetrying] = useState(false);
  const [copied, setCopied] = useState(false);

  const connection = describeConnection();
  const notes = getConfigNotes();

  const copy = lang === 'so' ? 'Koobi faahfaahinta' : 'Copy details';
  const retry = lang === 'so' ? 'Isku day mar kale' : 'Try again';

  const details = [
    `Telesom F1 — connection problem`,
    `health: ${probe?.health ?? 'unknown'}`,
    `detail: ${probe?.detail ?? 'n/a'} (status ${probe?.status ?? 0})`,
    `project: ${connection.project}`,
    `url: ${connection.url}`,
    `key: ${connection.key}`,
    `key source: ${connection.keySource}`,
    `notes: ${notes.length ? notes.join(', ') : 'none'}`,
    `build: ${typeof window !== 'undefined' ? window.location.origin : ''}`,
  ].join('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-950 via-slate-900 to-emerald-950 flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-400 flex items-center justify-center shadow">
              <Wifi className="w-5 h-5 text-emerald-950 stroke-[2.5]" />
            </div>
            <div>
              <div className="text-white font-bold text-sm leading-tight">TELESOM FBB</div>
              <div className="text-emerald-300 text-[11px] font-medium">Group F1 Operations</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLang(lang === 'so' ? 'en' : 'so')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-semibold text-white transition cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5 text-emerald-300" />
            <span>{lang === 'so' ? 'Af-Soomaali • SO' : 'English • EN'}</span>
          </button>
        </div>

        <div className="bg-white rounded-3xl shadow-2xl border border-emerald-900/20 overflow-hidden">
          <div className="px-6 pt-6 pb-5 bg-rose-50 border-b border-rose-100 flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-extrabold text-slate-900 leading-tight">
                {lang === 'so' ? 'Nidaamka xiriirka ayaa qaldan' : 'The app cannot reach its database'}
              </h1>
              <p className="text-xs text-slate-600 mt-1">
                {lang === 'so'
                  ? 'Tani ma aha khalad PIN. Xiriirka app-ka iyo server-ka ayaa qaldan — kormeeraha ayaa sax kara.'
                  : 'This is not a PIN error. The connection between the app and its server is misconfigured — a supervisor can fix it.'}
              </p>
            </div>
          </div>

          <div className="p-6 space-y-4">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-1.5 text-[11px] text-slate-600">
              {[
                [lang === 'so' ? 'Mashruuca' : 'Project', connection.project],
                [lang === 'so' ? 'Furaha' : 'Key', connection.key],
                [lang === 'so' ? 'Isha furaha' : 'Key source', connection.keySource],
              ].map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-3">
                  <span className="font-semibold text-slate-500 uppercase tracking-wide text-[10px]">
                    {label}
                  </span>
                  <span className="font-mono text-slate-800 text-right break-all">{value}</span>
                </div>
              ))}
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold text-slate-500 uppercase tracking-wide text-[10px]">
                  {lang === 'so' ? 'Xaalad' : 'Status'}
                </span>
                <span className="font-mono text-slate-800 text-right break-all">
                  {probe?.detail ?? 'unknown'} (HTTP {probe?.status ?? 0})
                </span>
              </div>
            </div>

            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-[11px] text-amber-900 leading-relaxed">
              <p className="font-bold mb-1">
                {lang === 'so' ? 'Kormeeraha: sida loo saxo' : 'Supervisor: how to fix it'}
              </p>
              <p>
                {lang === 'so'
                  ? 'Hubi Vercel → Settings → Environment Variables. VITE_SUPABASE_ANON_KEY waa in uu yahay furaha anon ee mashruuca, isla markaana aan lahayn xariiq cusub ama xigasho. Tirtir haddii ay qaldan tahay, kadibna dib u deploy garee.'
                  : 'Check Vercel → Settings → Environment Variables. VITE_SUPABASE_ANON_KEY must be the project anon key, with no stray newline or quotes. Delete it if it is wrong, then redeploy.'}
              </p>
              {notes.length > 0 && (
                <p className="mt-2 font-mono text-[10px] text-amber-800/90">{notes.join(' · ')}</p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleRetry()}
                disabled={retrying}
                className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
                <span>{retrying ? (lang === 'so' ? 'Hubinaya…' : 'Checking…') : retry}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition cursor-pointer"
              >
                {copied ? (lang === 'so' ? 'La koobiyay' : 'Copied') : copy}
              </button>
            </div>

            {onContinue && (
              <button
                type="button"
                onClick={onContinue}
                className="w-full py-2 text-[11px] font-semibold text-slate-500 hover:text-slate-800 underline underline-offset-2 cursor-pointer"
              >
                {lang === 'so'
                  ? 'Sii wad si kastaba — haddii aad horey u gashay, isku day inaad gasho'
                  : 'Continue anyway — if you could sign in before, try signing in'}
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-[11px] text-emerald-300/60 mt-4">
          Telesom Fixed Broadband Department • Group F1 Field System
        </p>
      </div>
    </div>
  );
}
