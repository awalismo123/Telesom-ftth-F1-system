import React, { useState } from 'react';
import {
  Wifi,
  Globe,
  ShieldCheck,
  Wrench,
  Delete,
  ArrowRight,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { toErrorMessage } from '../lib/errors';
import { useLanguage } from '../lib/i18n';

const QUICK_ACCOUNTS = [
  {
    label: 'F1 Supervisor',
    sub: 'Kormeeraha F1',
    identifier: 'supervisor',
    pin: '1234',
    role: 'supervisor' as const,
  },
  {
    label: 'Cabdiraxmaan (Crew A)',
    sub: '634100101',
    identifier: 'cabdi',
    pin: '1111',
    role: 'technician' as const,
  },
  {
    label: 'Xasan Cali (Crew A)',
    sub: '634100102',
    identifier: 'xasan',
    pin: '1111',
    role: 'technician' as const,
  },
  {
    label: 'Maxamed (Crew B)',
    sub: '634100103',
    identifier: 'maxamed',
    pin: '1111',
    role: 'technician' as const,
  },
];

export function LoginScreen() {
  const { signInWithPin, sessionNotice, clearSessionNotice } = useAuth();
  const { lang, setLang, t } = useLanguage();

  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e?: React.FormEvent, overrideId?: string, overridePin?: string) => {
    if (e) e.preventDefault();
    const idToUse = overrideId ?? identifier;
    const pinToUse = overridePin ?? pin;
    if (!idToUse.trim() || pinToUse.length < 4) return;

    setError(null);
    clearSessionNotice();
    setSubmitting(true);
    try {
      await signInWithPin(idToUse, pinToUse);
    } catch (err) {
      setError(toErrorMessage(err instanceof Error ? err.message : String(err), lang));
      setPin('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeypadDigit = (digit: string) => {
    if (pin.length < 6) {
      setPin((prev) => prev + digit);
    }
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
  };

  const handleQuickFillAndSignIn = (accIdentifier: string, accPin: string) => {
    setIdentifier(accIdentifier);
    setPin(accPin);
    void handleSubmit(undefined, accIdentifier, accPin);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-950 via-slate-900 to-emerald-950 flex flex-col justify-between p-4 sm:p-6">
      {/* Top Bar */}
      <div className="max-w-md w-full mx-auto flex items-center justify-between pt-1">
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

      {/* Main Card */}
      <div className="max-w-md w-full mx-auto my-6">
        <div className="bg-white rounded-3xl shadow-2xl border border-emerald-900/20 overflow-hidden">
          <div className="px-6 pt-6 pb-4 bg-gradient-to-b from-emerald-50/80 to-white border-b border-slate-100">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold mb-2">
              <span>FTTH • GROUP F1</span>
            </div>
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
              {t('loginTitle')}
            </h1>
            <p className="text-xs text-slate-500 mt-1">{t('loginSubtitle')}</p>
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} className="p-6 space-y-5">
            {sessionNotice && !error && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2 text-amber-900 text-xs font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {lang === 'so'
                    ? 'Fadhigaagu wuu dhacay ama waqti ku dhammaaday. Mar kale gal.'
                    : 'Your session ended or expired. Please sign in again.'}
                </span>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                {t('identifierLabel')}
              </label>
              <input
                type="text"
                autoComplete="username"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={t('identifierPlaceholder')}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 transition"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-slate-700">{t('pinLabel')}</label>
                <span className="text-[11px] font-medium text-slate-400">4–6 digits</span>
              </div>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                required
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-slate-50 focus:bg-white text-center tracking-[0.5em] text-xl font-extrabold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 transition"
              />

              {/* Touch-friendly Numeric PIN Pad */}
              <div className="grid grid-cols-3 gap-2 mt-3">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    onClick={() => handleKeypadDigit(digit)}
                    className="h-11 rounded-xl bg-slate-100 hover:bg-emerald-50 active:bg-emerald-100 text-slate-800 font-bold text-base border border-slate-200/80 transition cursor-pointer"
                  >
                    {digit}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPin('')}
                  className="h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 font-semibold text-xs border border-slate-200/80 transition cursor-pointer"
                >
                  CLR
                </button>
                <button
                  type="button"
                  onClick={() => handleKeypadDigit('0')}
                  className="h-11 rounded-xl bg-slate-100 hover:bg-emerald-50 active:bg-emerald-100 text-slate-800 font-bold text-base border border-slate-200/80 transition cursor-pointer"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={handleBackspace}
                  aria-label="Backspace"
                  className="h-11 rounded-xl bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 flex items-center justify-center border border-slate-200/80 transition cursor-pointer"
                >
                  <Delete className="w-4 h-4" />
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || !identifier.trim() || pin.length < 4}
              className="w-full py-3.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold text-sm shadow-md shadow-emerald-900/15 flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <span>{submitting ? t('signingIn') : t('signInBtn')}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Quick Demo Fill Accounts */}
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200/80">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              <span>{t('demoAccountsTitle')}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_ACCOUNTS.map((acc) => (
                <button
                  key={acc.identifier}
                  type="button"
                  onClick={() => handleQuickFillAndSignIn(acc.identifier, acc.pin)}
                  className="flex items-center gap-2 p-2 rounded-xl bg-white hover:bg-emerald-50/70 border border-slate-200 hover:border-emerald-300 text-left transition cursor-pointer"
                >
                  {acc.role === 'supervisor' ? (
                    <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
                  ) : (
                    <Wrench className="w-4 h-4 text-emerald-600 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-800 truncate">{acc.label}</div>
                    <div className="text-[10px] text-slate-500 truncate">
                      ID: {acc.identifier} • PIN: {acc.pin}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-[11px] text-emerald-300/60 pb-1">
        Telesom Fixed Broadband Department • Group F1 Field System
      </div>
    </div>
  );
}
