import { rpc, rpcRead } from './rpc';

/**
 * Department PINs, and who is still on one.
 *
 * An account whose PIN somebody else chose must replace it at sign-in. The
 * first version of this module tried to work that out by guessing: it treated
 * every active member whose `must_change_pin` was not true as "still on a
 * department PIN". But `false` is the *normal, finished* state — somebody who
 * has already chosen their own PIN. So the check reported the people who had
 * done the right thing, the "flag everybody" button found nothing left to flag,
 * and the banner could not be dismissed. It was permanent by construction, and
 * the sentence it showed ("1 person can still sign in with the PIN the
 * department set") was about the one person who had changed theirs.
 *
 * The database now keeps the fact this screen actually needs:
 * `users.seed_pin_flag`, set when a supervisor issues a PIN, cleared the moment
 * that person chooses their own. There is exactly one source for it, so the
 * banner, the badge and the forced-change wall cannot disagree, and — the part
 * that matters — the banner clears when the work is done.
 */

export interface PinStatusMember {
  full_name: string;
  role: string;
  is_active: boolean;
  /** True while this account signs in with a PIN the department chose. */
  seed_pin_flag?: boolean;
  must_change_pin?: boolean;
}

/**
 * Active people who can still sign in with a PIN the department chose.
 *
 * Reads `seed_pin_flag` and nothing else: that column is set by the same action
 * that issues the PIN and cleared by the same action that replaces it. The old
 * `must_change_pin !== true` test is gone — it counted finished accounts, which
 * is why nobody could ever make the count reach zero.
 */
export function stalePinMembers<T extends PinStatusMember>(members: T[]): T[] {
  return members.filter(
    (member) =>
      member.is_active &&
      (member.role === 'supervisor' || member.role === 'technician') &&
      member.seed_pin_flag === true,
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
    return count === 1
      ? '1 qof ayaa wali geli kara PIN-kii waaxda.'
      : `${count} qof ayaa wali geli kara PIN-kii waaxda.`;
  }

  return count === 1
    ? '1 person can still sign in with the PIN the department set.'
    : `${count} people can still sign in with the PIN the department set.`;
}

/**
 * What the banner's button does, in the words a supervisor needs first.
 *
 * Deliberately short and specific: this flags whoever is *not* already on a
 * department PIN, so it is honest about the fact that it may change nobody.
 */
export function flagPinsExplanation(lang: 'so' | 'en'): string {
  return lang === 'so'
    ? 'Qof kasta oo aan wali PIN-kiisa dooran wuxuu dooranayaa marka uu xiga soo galo. Waxaad sidoo kale beddeli kartaa PIN-kiisa isla boggan.'
    : 'Anyone who has not yet chosen a PIN will be asked to choose one at their next sign-in. You can also change anybody’s PIN from this page.';
}

/** Kept for the call sites that still ask what the button will do. */
export const flagPinsWarning = flagPinsExplanation;

/** Accounts currently locked out after wrong PINs — invisible before, and why
 *  "I gave him a new PIN" appeared to do nothing. */
export interface LockedMember {
  id: string;
  full_name: string;
  until: string;
}

export interface PinStatus {
  onDepartmentPin: { id: string; full_name: string }[];
  locked: LockedMember[];
}

/** Who is on a department PIN, and who is locked out. One read for both. */
export async function fetchPinStatus(token: string, groupId: string): Promise<PinStatus> {
  const raw = await rpcRead<{ on_department_pin?: unknown; locked?: unknown }>('pin_status', {
    p_token: token,
    p_group_id: groupId,
  });

  const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

  return {
    onDepartmentPin: asArray(raw?.on_department_pin).filter(
      (row): row is { id: string; full_name: string } =>
        typeof row === 'object' && row !== null && typeof (row as { id?: unknown }).id === 'string',
    ),
    locked: asArray(raw?.locked).filter(
      (row): row is LockedMember =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as { id?: unknown }).id === 'string' &&
        typeof (row as { until?: unknown }).until === 'string',
    ),
  };
}

/** Flag everybody who is not already on a department PIN. Returns how many. */
export async function flagDepartmentPins(token: string): Promise<number> {
  const result = await rpc<{ changed?: number; flagged?: number }>('flag_department_pins', {
    p_token: token,
  });
  return result?.changed ?? result?.flagged ?? 0;
}

/**
 * Clear the department-PIN state for everybody in the group.
 *
 * The counterpart that never existed. Without it a supervisor could only ever
 * move accounts *onto* a department PIN, never off, which is the other half of
 * why the banner had no exit.
 */
export async function clearDepartmentPins(token: string): Promise<number> {
  const result = await rpc<{ changed?: number }>('set_department_pin_flag', {
    p_token: token,
    p_flagged: false,
  });
  return result?.changed ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Issuing a PIN                                                              */
/* -------------------------------------------------------------------------- */

/** Four to six digits, the same rule the database enforces. */
export function pinProblem(pin: string, lang: 'so' | 'en'): string | null {
  const trimmed = pin.trim();
  if (trimmed.length === 0) {
    return lang === 'so' ? 'PIN ma qoran' : 'No PIN entered';
  }
  if (!/^\d{4,6}$/.test(trimmed)) {
    return lang === 'so' ? 'PIN waa 4 ama 6 lambar' : 'A PIN is 4 to 6 digits';
  }
  return null;
}

/**
 * A supervisor issues somebody a PIN.
 *
 * Goes through `upsert_team_member`, which is the function that owns this row
 * and now also clears any lockout — the reason a "new PIN" used to leave the
 * person still unable to sign in. The caller passes the member's existing
 * details unchanged; only the PIN differs.
 */
export async function setMemberPin(params: {
  token: string;
  memberId: string;
  groupId: string;
  username: string;
  fullName: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  pin: string;
}): Promise<void> {
  await rpc<string>('upsert_team_member', {
    p_token: params.token,
    p_member_id: params.memberId,
    p_group_id: params.groupId,
    p_username: params.username,
    p_full_name: params.fullName,
    p_phone: params.phone,
    p_role: params.role,
    p_pin: params.pin.trim(),
    p_is_active: params.isActive,
  });
}

/** `Locked until 23:07` — a supervisor deciding whether a reset is the fix. */
export function lockedSentence(until: string, lang: 'so' | 'en'): string {
  const when = new Date(until);
  if (Number.isNaN(when.getTime())) return '';

  const clock = when.toLocaleTimeString(lang === 'so' ? 'en-GB' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return lang === 'so'
    ? `Wuu xiran yahay ilaa ${clock}`
    : `Locked out until ${clock}`;
}
