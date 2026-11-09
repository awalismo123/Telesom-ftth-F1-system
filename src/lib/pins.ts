import { rpc } from './rpc';

/**
 * Department PINs, and who is still on one.
 *
 * Batch B built the rule — an account whose PIN somebody else chose must replace
 * it at next sign-in — but nothing ever set the flag on the accounts that already
 * existed. Every seeded account, including the supervisor's, still signs in with
 * the PIN printed in the README, so the rule protected nobody. This module is
 * the small amount of logic needed to see that, say it out loud on the Team
 * screen, and fix it in one action at the right moment.
 *
 * The fix is deliberately manual: pressing it signs everybody out of a known
 * PIN, which is correct the day before real customers arrive and disruptive
 * halfway through a demonstration. A supervisor decides when.
 */

export interface PinStatusMember {
  full_name: string;
  role: string;
  is_active: boolean;
  must_change_pin?: boolean;
}

/** Active people who can still sign in with a PIN the department chose. */
export function stalePinMembers<T extends PinStatusMember>(members: T[]): T[] {
  return members.filter(
    (member) =>
      member.is_active &&
      (member.role === 'supervisor' || member.role === 'technician') &&
      member.must_change_pin !== true,
  );
}

/** `3 people can still sign in with the PIN the department set.` */
export function stalePinSentence(count: number, lang: 'so' | 'en'): string {
  if (count === 0) {
    return lang === 'so'
      ? 'Qof walba PIN-kiisa gaar ah ayuu isticmaalayaa.'
      : 'Everyone is using a PIN of their own.';
  }

  if (lang === 'so') {
    return `${count} qof ayaa wali geli kara PIN-kii waaxda.`;
  }

  return count === 1
    ? '1 person can still sign in with the PIN the department set.'
    : `${count} people can still sign in with the PIN the department set.`;
}

/** What the button will do, in the words a supervisor needs before pressing it. */
export function flagPinsWarning(lang: 'so' | 'en'): string {
  return lang === 'so'
    ? 'Qof kastaa wuxuu doortaa PIN cusub marka uu xiga soo galo. Waxaad u baahan doontaa inaad sidoo kale beddesho PIN-kaaga (menu-ga sare).'
    : 'Each person chooses a new PIN at their next sign-in. You will need to change your own too — from the header menu.';
}

/** The one call. Returns how many accounts were flagged. */
export async function flagDepartmentPins(token: string): Promise<number> {
  const result = await rpc<{ flagged: number }>('flag_department_pins', { p_token: token });
  return result?.flagged ?? 0;
}
