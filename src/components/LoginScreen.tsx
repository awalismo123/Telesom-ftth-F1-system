import React, { useState } from 'react';
import { Globe, Delete, ArrowRight, AlertCircle } from 'lucide-react';
import { useAuth, type SessionNotice } from '../contexts/AuthContext';
import { useLanguage } from '../lib/i18n';
import { BUILD_LABEL } from '../lib/version';
import { describeError } from '../lib/useErrorMessage';
import { Button } from './ui/Button';
import { Input } from './ui/Field';
import { TelesomLogo } from './brand/TelesomLogo';

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

/**
 * The sign-in screen.
 *
 * This is the one screen every person in the department sees, signed in or not,
 * so it carries the brand: the real Telesom mark, the real greens, the gold.
 *
 * It is also where the least confident user meets the system first, so the copy
 * answers the two questions that actually stop people: "what do I type" and
 * "what if I don't have a PIN". Both are answered on the screen rather than in
 * a phone call to the supervisor.
 */
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
    <div className="min-h-screen relative flex flex-col justify-between p-4 sm:p-6 bg-brand-950 overflow-hidden">
      {/* The orbit, drawn large and dim behind everything — the mark's own
          geometry rather than an unrelated stock pattern. */}
      <svg
        className="pointer-events-none absolute -right-24 -top-24 w-[520px] h-[520px] opacity-[0.13]"
        viewBox="0 0 200 200"
        aria-hidden="true"
        focusable="false"
      >
        <ellipse cx="100" cy="100" rx="92" ry="48" transform="rotate(-28.7 100 100)" fill="none" stroke="#F8DC09" strokeWidth="7" />
        <ellipse cx="96" cy="96" rx="80" ry="40" transform="rotate(-28.7 96 96)" fill="none" stroke="#ffffff" strokeWidth="6" />
      </svg>
      <div className="pointer-events-none absolute -left-32 bottom-0 w-[420px] h-[420px] rounded-full bg-brand-500/10 blur-3xl" aria-hidden="true" />

      {/* ── Brand bar ───────────────────────────────────────────────────── */}
      <header className="relative max-w-md w-full mx-auto flex items-center justify-between gap-3 pt-1">
        <TelesomLogo variant="reverse" size={44} subtitle={t('loginGroupBadge')} className="min-w-0" />

        <button
          type="button"
          onClick={() => setLang(lang === 'so' ? 'en' : 'so')}
          aria-label={lang === 'so' ? 'Switch to English' : 'U beddel Af-Soomaali'}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-semibold text-white transition cursor-pointer shrink-0"
        >
          <Globe className="w-3.5 h-3.5 text-gold-400" aria-hidden="true" />
          <span>{lang === 'so' ? 'SO' : 'EN'}</span>
        </button>
      </header>

      {/* ── Card ────────────────────────────────────────────────────────── */}
      <main className="relative max-w-md w-full mx-auto my-6">
        <div className="bg-white rounded-2xl shadow-2xl shadow-brand-950/40 overflow-hidden">
          {/* Gold hairline: the accent the mark is built from, used once. */}
          <div className="h-1 bg-gradient-to-r from-brand-600 via-gold-400 to-brand-600" aria-hidden="true" />

          <div className="px-6 pt-6 pb-5 border-b border-slate-100">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-50 border border-brand-200 text-brand-800 text-[11px] font-bold tracking-wide mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-600" aria-hidden="true" />
              <span>{t('loginGroupBadge')}</span>
            </div>
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
              {t('loginTitle')}
            </h1>
            <p className="text-[13px] text-slate-600 mt-1 leading-relaxed">{t('loginSubtitle')}</p>
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} className="p-6 space-y-5">
            {sessionNotice && !error && (
              <div
                role="status"
                className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2 text-amber-900 text-xs font-semibold"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{NOTICE_TEXT[sessionNotice][lang]}</span>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
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
                aria-label={t('pinLabel')}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-slate-50 focus:bg-white text-center tracking-[0.5em] text-xl font-extrabold text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600 transition"
              />

              {/* Touch-friendly numeric pad. Heights are unchanged: 44 px is the
                  floor, and the keypad already met it. */}
              <div className="grid grid-cols-3 gap-2 mt-3">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    onClick={() => handleKeypadDigit(digit)}
                    className="h-11 rounded-xl bg-slate-100 hover:bg-brand-50 active:bg-brand-100 text-slate-800 font-bold text-base border border-slate-200/80 transition cursor-pointer"
                  >
                    {digit}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPin('')}
                  className="h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-xs border border-slate-200/80 transition cursor-pointer"
                >
                  CLR
                </button>
                <button
                  type="button"
                  onClick={() => handleKeypadDigit('0')}
                  className="h-11 rounded-xl bg-slate-100 hover:bg-brand-50 active:bg-brand-100 text-slate-800 font-bold text-base border border-slate-200/80 transition cursor-pointer"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={handleBackspace}
                  aria-label={t('backspace')}
                  className="h-11 rounded-xl bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 flex items-center justify-center border border-slate-200/80 transition cursor-pointer"
                >
                  <Delete className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <Button
              type="submit"
              size="lg"
              fullWidth
              loading={submitting}
              disabled={!identifier.trim() || pin.length < 4}
              className="shadow-md shadow-brand-900/20"
            >
              <span>{submitting ? t('signingIn') : t('signInBtn')}</span>
              {!submitting && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
            </Button>

            {/* The two things that actually stop a first-time user. Answered on
                the screen, so it does not become a phone call. */}
            <div className="pt-1 space-y-1.5 border-t border-slate-100">
              <p className="text-[11px] text-slate-600 flex items-start gap-1.5">
                <span className="text-brand-600 font-bold" aria-hidden="true">?</span>
                <span>{t('loginNeedPin')}</span>
              </p>
              <p className="text-[11px] text-slate-600 flex items-start gap-1.5">
                <span className="text-brand-600 font-bold" aria-hidden="true">•</span>
                <span>{t('loginSecureLine')}</span>
              </p>
            </div>
          </form>
        </div>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="relative text-center pb-1 space-y-0.5">
        <div className="text-[11px] text-brand-300">{t('deptFooter')}</div>
        <div className="text-[11px] text-brand-400/80 tabular-nums">{BUILD_LABEL}</div>
      </footer>
    </div>
  );
}
