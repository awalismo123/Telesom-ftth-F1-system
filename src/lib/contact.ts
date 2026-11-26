import { formatPhoneE164 } from './dispatch';

/**
 * How the message leaves the phone.
 *
 * Three channels, in the order they help most customers:
 *
 * 1. **WhatsApp** — reads well, no cost, but only reaches somebody who has it
 *    *and* has data. This is what the app relied on until now, and it quietly
 *    excluded the customers who most need a call: the ones at home waiting.
 * 2. **SMS** — reaches any phone, including the ones with no smartphone at all.
 *    Telesom staff have free SMS, so this costs the department nothing. The
 *    `sms:` link opens the phone's own messaging app with the number and the
 *    text already in it; the person still presses send.
 * 3. **Call** — the only channel that works when the customer cannot read, and
 *    the one that answers "when are you coming" properly. Dialling out is all
 *    this does; there is no script, because the technician knows more about the
 *    visit than any text could.
 *
 * ## What this module does and does not do
 *
 * It builds **URLs**. It never opens one, never fetches, and never reports
 * whether anything was sent — because it cannot know. A person presses the
 * button, their own phone composes the message, and they press send in an app
 * this code has no window into. Recording "notified" would therefore be a claim
 * about delivery that we are not in a position to make; recording that the
 * *button was pressed* is honest, and that is what the audit note says.
 *
 * ## Why the number is in the SMS link and not the WhatsApp one
 *
 * `sms:` needs a recipient, so the customer's number goes in. WhatsApp does not:
 * `wa.me/?text=` opens WhatsApp's own contact picker, so the number is chosen on
 * the phone and never travels in a URL that could end up in a browser history.
 * That asymmetry is deliberate and is worth keeping when editing.
 */

export type ContactChannel = 'whatsapp' | 'sms' | 'call';

/** Why a channel cannot be used, in words the person can act on. */
export interface ChannelState {
  /** `null` when the channel is usable. */
  unavailable: 'no_phone' | 'not_mobile' | null;
}

/**
 * A Somali mobile number in E.164 form, or `''`.
 *
 * `formatPhoneE164` already knows the shapes this department writes: `634…`,
 * `0634…`, `+252634…`, and the OCR'd variants with a stray space. Reusing it
 * means the number in an SMS link matches the number in the `tel:` link and the
 * number on the printed job sheet — three places that must never disagree about
 * which customer is being called.
 */
export function contactNumber(raw: string | null | undefined): string {
  return formatPhoneE164(raw);
}

/**
 * What each channel would do, given this customer's number.
 *
 * Kept separate from the link builders so a screen can hide or disable a button
 * with a reason, instead of offering a button that does nothing. A customer with
 * no number recorded is the common case on a fresh import — the sheet often has
 * a blank phone column — and a dead button teaches a technician to stop looking.
 */
export function channelStates(rawNumber: string | null | undefined): Record<ContactChannel, ChannelState> {
  const e164 = contactNumber(rawNumber);
  if (!e164) {
    return {
      whatsapp: { unavailable: 'no_phone' },
      sms: { unavailable: 'no_phone' },
      call: { unavailable: 'no_phone' },
    };
  }
  return {
    // WhatsApp opens its own picker, so it needs no number in the URL — but
    // there is no point offering it for a customer we cannot identify at all.
    whatsapp: { unavailable: null },
    sms: { unavailable: null },
    call: { unavailable: null },
  };
}

/**
 * `sms:+252634418376?body=…`
 *
 * The `?body=` form is the one every Android messaging app and iOS Messages
 * accept. iOS uses `&body=` with a different separator historically (`;`), but
 * `?body=` has been the interoperable form for years and is what both current
 * platforms parse; the old `;body=` variant is not emitted because it breaks
 * Android.
 *
 * Returns `''` when there is no usable number, so a caller that ignores the
 * state above still cannot build a link that silently messages nobody.
 */
export function smsLink(rawNumber: string | null | undefined, message: string): string {
  const e164 = contactNumber(rawNumber);
  if (!e164) return '';

  // Encode exactly as `wa.me` and `tel:` links are encoded elsewhere in the app:
  // newlines become %0A, which both platforms turn back into line breaks.
  return `sms:${e164}?body=${encodeURIComponent(message)}`;
}

/** `tel:+252634418376` — dials directly, no message. */
export function telLink(rawNumber: string | null | undefined): string {
  const e164 = contactNumber(rawNumber);
  if (!e164) return '';
  return `tel:${e164}`;
}

/**
 * The label for each channel, in the reader's language.
 *
 * "SMS" is not translated: it is what the icon on the phone says, in both
 * languages, and a technician scanning for it will look for those three letters.
 */
export const CHANNEL_LABEL: Record<ContactChannel, { en: string; so: string }> = {
  whatsapp: { en: 'WhatsApp', so: 'WhatsApp' },
  sms: { en: 'SMS', so: 'SMS' },
  call: { en: 'Call', so: 'Wac' },
};

/** What each channel is for, shown under the buttons when there is room. */
export const CHANNEL_HINT: Record<ContactChannel, { en: string; so: string }> = {
  whatsapp: {
    en: 'Needs WhatsApp and data',
    so: 'Wuxuu u baahan yahay WhatsApp iyo internet',
  },
  sms: {
    en: 'Works on any phone — free for us',
    so: 'Wuu shaqeeyaa taleefan kasta — annaga waa lacag la’aan',
  },
  call: {
    en: 'Dials them directly',
    so: 'Si toos ah ayuu u wacaa',
  },
};
