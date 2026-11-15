import React, { useState } from 'react';
import { KeyRound, ShieldCheck, LogOut } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n';
import { describeError } from '../../lib/useErrorMessage';
import { Alert } from './Alert';
import { Button } from './Button';
import { Input } from './Field';

/**
 * The wall between "signed in" and "inside the app" for an account that is
 * still using the PIN the department gave it.
 *
 * A shared PIN is not a credential: the supervisor knows it, the person next to
 * them knows it, and the audit trail stops meaning anything. The database marks
 * such accounts with `must_change_pin`, `change_own_pin` clears it, and this
 * screen is the only way past — there is no dismiss.
 */
export function ForcePinChange() {
  const { signOut, refreshSession, changeOwnPin } = useAuth();
  const { t, lang } = useLanguage();
  const so = lang === 'so';

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirmPin.length > 0 && newPin !== confirmPin;
  const canSubmit = currentPin.length >= 4 && newPin.length >= 4 && newPin === confirmPin && !busy;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);
    try {
      await changeOwnPin(currentPin, newPin);
      // The server has cleared the flag; re-reading the session flips the gate.
      await refreshSession();
    } catch (err) {
      setError(describeError(err, lang));
      setCurrentPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden">
        <div className="bg-brand-950 px-6 py-5 text-center">
          <div className="mx-auto w-11 h-11 rounded-2xl bg-brand-800 text-brand-200 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" aria-hidden="true" />
          </div>
          <h1 className="mt-3 text-base font-extrabold text-white">
            {so ? 'Dooro PIN-kaaga' : 'Choose your own PIN'}
          </h1>
          <p className="mt-1 text-[11px] text-brand-200/90 leading-relaxed">
            {so
              ? 'Akoonkaaga wali wuxuu isticmaalayaa PIN-ka waaxdu ku siisay. Beddel si shaqadaada loo aqoonsado adiga oo kaliya.'
              : 'This account is still using the PIN the department set. Change it so the record of your work belongs to you.'}
          </p>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {error && (
            <Alert tone="danger" onDismiss={() => setError(null)} dismissLabel={t('close')}>
              {error}
            </Alert>
          )}

          <Input
            label={t('currentPin')}
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            maxLength={6}
            required
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
            hint={so ? 'PIN-ka waaxdu ku siisay' : 'The PIN you signed in with'}
          />

          <Input
            label={t('newPin')}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            required
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
            hint={t('pinHint')}
          />

          <Input
            label={so ? 'Ku celi PIN-ka cusub' : 'Repeat the new PIN'}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            required
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
            error={
              mismatch ? (so ? 'Labada PIN isku mid ma aha' : 'The two PINs do not match') : undefined
            }
          />

          <Button type="submit" fullWidth size="lg" disabled={!canSubmit} loading={busy}>
            <KeyRound className="w-4 h-4" aria-hidden="true" />
            {so ? 'Kaydi oo gal' : 'Save and continue'}
          </Button>

          <button
            type="button"
            onClick={() => void signOut()}
            className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            {so ? 'Ka bax oo isticmaal qof kale' : 'Sign out and use another account'}
          </button>
        </form>
      </div>

      <p className="mt-4 text-[11px] text-slate-500 text-center max-w-xs leading-relaxed">
        {so
          ? 'Haddii aadan garanayn PIN-ka hadda, la xiriir kormeeraha.'
          : 'If you do not know the current PIN, ask the supervisor to reset it.'}
      </p>
    </div>
  );
}
