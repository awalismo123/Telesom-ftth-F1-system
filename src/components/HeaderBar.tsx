import React, { useState } from 'react';
import {
  Wifi,
  LogOut,
  KeyRound,
  Globe,
  ShieldCheck,
  Wrench,
  ChevronDown,
  X,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import { initials } from '../lib/session';
import { useToast } from './ui/Toast';
import { describeError } from '../lib/useErrorMessage';

/**
 * Who is signed in, in one chip.
 *
 * This used to be `hidden md:flex` — invisible on every phone, which is exactly
 * where the wrong account is hardest to notice. It is now the first thing in the
 * mobile header, and the role is spelled out rather than implied by an icon.
 */
function IdentityChip({ compact = false }: { compact?: boolean }) {
  const { session } = useAuth();
  const { t } = useLanguage();
  if (!session) return null;

  const supervisor = session.user.role === 'supervisor';
  const roleLabel = supervisor ? t('supervisorRole') : session.crews[0]?.name || t('technicianRole');

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1 rounded-lg bg-emerald-900/60 border border-emerald-800/80 min-w-0 ${
        compact ? '' : 'md:px-3 md:py-1.5'
      }`}
      title={`${session.user.full_name} — ${roleLabel}`}
    >
      <span
        className="w-6 h-6 md:w-7 md:h-7 rounded-md bg-emerald-400/15 border border-emerald-400/30 text-emerald-200 text-[10px] font-extrabold flex items-center justify-center shrink-0"
        aria-hidden="true"
      >
        {initials(session.user.full_name)}
      </span>
      <div className="text-left leading-tight min-w-0">
        <div className="text-[11px] md:text-xs font-semibold text-white truncate max-w-[104px] md:max-w-[150px]">
          {session.user.full_name}
        </div>
        <div className="text-[10px] md:text-[10px] text-emerald-300/90 truncate max-w-[104px] md:max-w-[150px] flex items-center gap-1">
          {supervisor ? (
            <ShieldCheck className="w-3 h-3 text-amber-300 shrink-0" />
          ) : (
            <Wrench className="w-3 h-3 text-emerald-300 shrink-0" />
          )}
          <span className="truncate">{roleLabel}</span>
        </div>
      </div>
    </div>
  );
}

export function HeaderBar() {
  const { session, activeGroup, availableGroups, setActiveGroupById, signOut, changeOwnPin } =
    useAuth();
  const { lang, setLang, t } = useLanguage();
  const toast = useToast();

  const [showPinModal, setShowPinModal] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSuccess, setPinSuccess] = useState(false);
  const [savingPin, setSavingPin] = useState(false);

  if (!session) return null;

  const isSupervisor = session.user.role === 'supervisor';
  const activeGroupsList = availableGroups.filter((g) => g.is_active);

  const handleToggleLanguage = async () => {
    const next = lang === 'so' ? 'en' : 'so';
    setLang(next);
    if (session?.token) {
      await supabase.rpc('set_preferred_language', {
        p_token: session.token,
        p_lang: next,
      });
    }
  };

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    setSavingPin(true);
    try {
      await changeOwnPin(currentPin, newPin);
      setPinSuccess(true);
      setCurrentPin('');
      setNewPin('');
      toast.success(lang === 'so' ? 'PIN-ka waa la beddelay' : 'PIN updated', {
        description: lang === 'so' ? 'Isticmaal PIN-ka cusub marka xigta.' : 'Use the new PIN next time.',
      });
      setTimeout(() => {
        setPinSuccess(false);
        setShowPinModal(false);
      }, 1200);
    } catch (err) {
      setPinError(describeError(err, lang));
    } finally {
      setSavingPin(false);
    }
  };

  const pinButton = (
    <button
      type="button"
      onClick={() => {
        setPinError(null);
        setPinSuccess(false);
        setShowPinModal(true);
      }}
      className="p-2 rounded-lg bg-emerald-900/80 hover:bg-emerald-800 text-emerald-200 hover:text-white border border-emerald-800 transition cursor-pointer"
      title={t('changePin')}
      aria-label={t('changePin')}
    >
      <KeyRound className="w-4 h-4" />
    </button>
  );

  const signOutButton = (compact = false) => (
    <button
      type="button"
      onClick={() => void signOut()}
      className={`inline-flex items-center gap-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 border border-rose-500/30 font-semibold transition cursor-pointer ${
        compact ? 'px-2 py-1.5 text-[11px]' : 'px-2.5 py-2 text-xs'
      }`}
      title={`${t('logout')} — ${session.user.full_name}`}
      aria-label={`${t('logout')} — ${session.user.full_name}`}
    >
      <LogOut className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      <span>{t('logout')}</span>
    </button>
  );

  return (
    <>
      <header className="sticky top-0 z-30 bg-emerald-950 text-white border-b border-emerald-800/80 shadow-sm">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-2">
          {/* Left Brand + Group Badge */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center shadow-inner shrink-0">
              <Wifi className="w-5 h-5 text-emerald-950 stroke-[2.5]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm sm:text-base tracking-tight truncate">
                  {t('appName')}
                </span>
                {isSupervisor && activeGroupsList.length > 1 ? (
                  <div className="relative inline-flex items-center">
                    <select
                      aria-label="Select Active Group"
                      value={activeGroup?.id || ''}
                      onChange={(e) => setActiveGroupById(e.target.value)}
                      className="appearance-none bg-emerald-800/90 hover:bg-emerald-700 text-emerald-100 text-xs font-bold pl-2.5 pr-6 py-1 rounded-full border border-emerald-600 cursor-pointer focus:outline-none"
                    >
                      {activeGroupsList.map((g) => (
                        <option key={g.id} value={g.id} className="bg-slate-900 text-white">
                          Group {g.code}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-emerald-300 absolute right-1.5 pointer-events-none" />
                  </div>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shrink-0">
                    Group {activeGroup?.code || 'F1'}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-emerald-300/80 truncate hidden sm:block">
                {t('deptSubtitle')}
              </p>
            </div>
          </div>

          {/* Right Controls (tablet and up). Phones get the identity row below. */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleToggleLanguage}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-900/90 hover:bg-emerald-800 border border-emerald-700/80 text-xs font-semibold text-emerald-100 transition cursor-pointer"
              title="Switch Language (Somali / English)"
              aria-label="Switch Language (Somali / English)"
            >
              <Globe className="w-3.5 h-3.5 text-emerald-300" />
              <span>{lang === 'so' ? 'SO' : 'EN'}</span>
            </button>

            <div className="hidden md:flex items-center gap-2">
              <IdentityChip />
              {pinButton}
              {signOutButton()}
            </div>
          </div>
        </div>

        {/*
          Phone row. A technician on a 360 px screen must still be able to see
          whose session this is before touching a customer's job.
        */}
        <div className="md:hidden border-t border-emerald-800/70 bg-emerald-900/30">
          <div className="px-3 h-12 flex items-center justify-between gap-2">
            <IdentityChip compact />
            <div className="flex items-center gap-1.5 shrink-0">
              {pinButton}
              {signOutButton(true)}
            </div>
          </div>
        </div>
      </header>

      {/* Change PIN Modal */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-sm overflow-hidden">
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-700" />
                <h3 className="font-bold text-slate-900 text-sm">{t('changePin')}</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPinModal(false)}
                className="p-1 rounded-lg text-slate-500 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePin} className="p-5 space-y-4">
              {pinError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                  {pinError}
                </div>
              )}
              {pinSuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>PIN updated successfully!</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t('currentPin')}
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-center tracking-[0.4em] font-bold text-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  placeholder="••••"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t('newPin')}
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-center tracking-[0.4em] font-bold text-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  placeholder="••••"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPinModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={savingPin || currentPin.length < 4 || newPin.length < 4}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white disabled:opacity-50 cursor-pointer"
                >
                  {savingPin ? '...' : t('saveChanges')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
