import React, { useState } from 'react';
import {
  Wifi,
  Globe,
  Delete,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';
import { useAuth, type SessionNotice } from '../contexts/AuthContext';
import { useLanguage } from '../lib/i18n';
import { BUILD_LABEL } from '../lib/version';
import { describeError } from '../lib/useErrorMessage';
import { Button } from './ui/Button';
import { Input } from './ui/Field';

const NOTICE_TEXT: Record<SessionNotice, { en: string; so: string }> = {
  expired: {
    en: 'Your session ended or expired. Please sign in again.',
    so: 'Fadhigaagu wuu dhacay ama waqti ku dhammaaday. Mar kale gal.',
  },
  switched: {
    en: 'This device was signed out or switched to another user. Sign in to continue.',
    so: 'Qalabkan waa laga baxay ama qof kale ayaa isticmaalay. Mar kale gal si aad u sii waddo.',
  },
  unavailable: {
    en: 'We could not confirm your session — the network did not answer. Sign in again.',
    so: 'Ma xaqiijin karin fadhigaaga — shabakaddu ma jawaabin. Mar kale gal.',
  },
};

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
      setError(describeError(err, lang));
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
            <div className="text-emerald-200 text-[11px] font-medium">Group F1 Operations</div>
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
              <div
                role="status"
                className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2 text-amber-900 text-xs font-semibold"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{NOTICE_TEXT[sessionNotice][lang]}</span>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Input
              label={t('identifierLabel')}
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={t('identifierPlaceholder')}
              inputSize="lg"
              className="bg-slate-50 font-semibold focus:bg-white"
            />

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-slate-700">{t('pinLabel')}</label>
                <span className="text-[11px] font-medium text-slate-500">{t('pinHint')}</span>
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
                  aria-label={t('backspace')}
                  className="h-11 rounded-xl bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 flex items-center justify-center border border-slate-200/80 transition cursor-pointer"
                >
                  <Delete className="w-4 h-4" />
                </button>
              </div>
            </div>

            <Button
              type="submit"
              size="lg"
              fullWidth
              loading={submitting}
              disabled={!identifier.trim() || pin.length < 4}
              className="shadow-md shadow-emerald-900/15"
            >
              <span>{submitting ? t('signingIn') : t('signInBtn')}</span>
              {!submitting && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
            </Button>
          </form>

        </div>
      </div>

      {/* Footer — the version is here because this is the one screen everyone
          sees, signed in or not, and "which version?" is the first question
          when something looks different from what was approved. */}
      <div className="text-center text-[11px] text-emerald-300/80 pb-1 space-y-0.5">
        <div>{t('deptFooter')}</div>
        <div className="text-emerald-400/70 tabular-nums">{BUILD_LABEL}</div>
      </div>
    </div>
  );
}
