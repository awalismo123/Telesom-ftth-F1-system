import { useMemo, useState } from 'react';
import { MessageSquare, Phone, Send } from 'lucide-react';
import { whatsappLink } from '../../lib/dispatch';
import {
  CHANNEL_HINT,
  CHANNEL_LABEL,
  channelStates,
  smsLink,
  telLink,
  type ContactChannel,
} from '../../lib/contact';
import {
  buildCustomerUpdatePair,
  type CustomerUpdateKind,
  type CustomerUpdateLang,
  type CustomerUpdateTask,
} from '../../lib/customerUpdate';

/**
 * Tell the customer what is happening, by whichever channel reaches them.
 *
 * The message is the same on all three; only the way it leaves the phone
 * changes. That is the point of the panel: a customer with WhatsApp gets a
 * readable message, a customer with an old Nokia gets an SMS, and a customer who
 * cannot read gets a call — and none of them is left waiting all day because the
 * app assumed a smartphone.
 *
 * **Nothing is sent from here.** Each button hands the text to the phone's own
 * app with the recipient filled in, and a person presses send. There is no API,
 * no cost, and no way for this code to claim a message was delivered.
 *
 * The language defaults to Somali and can be switched to English before
 * sending — most customers are Somali speakers, but not all of them, and a
 * wrong-language message about a technician visit is worse than none.
 */

export interface ContactCustomerPanelProps {
  kind: CustomerUpdateKind;
  /** The customer's phone as recorded on the job. */
  phone: string | null | undefined;
  /** The job, for the line number and the day. */
  task: CustomerUpdateTask;
  /** Who is looking, for the default language. */
  defaultLang?: CustomerUpdateLang;
  /** Appended to the sign-off, e.g. `F1`. */
  groupCode?: string | null;
  /** The sender's own day, `YYYY-MM-DD`. */
  today: string;
  /** Called when a channel is used, so the caller can record the intent. */
  onUsed?: (channel: ContactChannel, lang: CustomerUpdateLang) => void;
  /** Heading override. Defaults to "Contact the customer". */
  title?: string;
  className?: string;
}

const CHANNEL_ICON: Record<ContactChannel, typeof Phone> = {
  whatsapp: MessageSquare,
  sms: Send,
  call: Phone,
};

const CHANNELS: ContactChannel[] = ['whatsapp', 'sms', 'call'];

export function ContactCustomerPanel({
  kind,
  phone,
  task,
  defaultLang = 'so',
  groupCode = null,
  today,
  onUsed,
  title,
  className = '',
}: ContactCustomerPanelProps) {
  const [lang, setLang] = useState<CustomerUpdateLang>(defaultLang);
  const so = lang === 'so';

  const pair = useMemo(
    () => buildCustomerUpdatePair(task, { kind, today, groupCode }),
    [task, kind, today, groupCode],
  );

  const text = pair[lang];
  const states = channelStates(phone);
  const allBlocked = CHANNELS.every((channel) => states[channel].unavailable !== null);

  /**
   * Open one channel.
   *
   * `window.open` for WhatsApp because it is a web page; a real anchor click for
   * `sms:` and `tel:` because those are handled by the operating system and a
   * `window.open` on them is blocked by mobile browsers or opens a blank tab
   * that never closes. This asymmetry is the whole reason this is a function and
   * not three `<a href>` elements — an `<a>` would need the text re-encoded on
   * every keystroke of the language toggle, and would navigate the app away when
   * a scheme is unhandled.
   */
  const open = (channel: ContactChannel) => {
    if (states[channel].unavailable) return;

    if (channel === 'whatsapp') {
      window.open(whatsappLink(text), '_blank', 'noopener,noreferrer');
    } else if (channel === 'sms') {
      const link = smsLink(phone, text);
      if (link) window.location.href = link;
    } else {
      const link = telLink(phone);
      if (link) window.location.href = link;
    }

    // The button was pressed, not the message sent. The caller records that.
    onUsed?.(channel, lang);
  };

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white overflow-hidden ${className}`}>
      <div className="px-3 pt-2.5 pb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-extrabold text-slate-800">
          {title ?? (so ? 'La xiriir macmiilka' : 'Contact the customer')}
        </h3>

        {/* The language the message is written in, not the language of this
            screen. A Somali-speaking supervisor may still be writing to a
            customer who only reads English. */}
        <div
          className="inline-flex rounded-lg border border-slate-200 overflow-hidden"
          role="group"
          aria-label={so ? 'Luqadda fariinta' : 'Message language'}
        >
          {(['so', 'en'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setLang(option)}
              aria-pressed={lang === option}
              className={`px-2 py-1 text-[10px] font-extrabold transition cursor-pointer ${
                lang === option
                  ? 'bg-brand-900 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {option === 'so' ? 'SO' : 'EN'}
            </button>
          ))}
        </div>
      </div>

      {/* The exact words that will be sent. Shown rather than hidden behind a
          "preview" toggle on purpose: a person is about to put their name to
          this message, and it is three lines long. */}
      <div className="mx-3 mb-2 rounded-xl bg-slate-50 border border-slate-200 px-2.5 py-2">
        <p className="text-[11px] leading-relaxed text-slate-700 whitespace-pre-line">{text}</p>
      </div>

      <div className="px-3 pb-2.5">
        <div className="grid grid-cols-3 gap-1.5">
          {CHANNELS.map((channel) => {
            const Icon = CHANNEL_ICON[channel];
            const blocked = states[channel].unavailable;
            const primary = channel === 'sms';

            return (
              <button
                key={channel}
                type="button"
                onClick={() => open(channel)}
                disabled={Boolean(blocked)}
                title={CHANNEL_HINT[channel][lang]}
                className={`min-h-11 inline-flex flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-extrabold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  primary
                    ? 'bg-brand-900 text-white hover:bg-brand-950'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                {CHANNEL_LABEL[channel][lang]}
              </button>
            );
          })}
        </div>

        {allBlocked && (
          <p className="mt-1.5 text-[10px] font-semibold text-rose-700">
            {so
              ? 'Taleefan macmiilka lama qorin — waxba lama diri karo. Wax ka beddel shaqada oo taleefanka geli.'
              : 'No phone number on this job — nothing can be sent. Edit the job and add the number first.'}
          </p>
        )}

        {!allBlocked && (
          <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
            {so
              ? 'Waxba si toos ah looma diro. Fariinta waxay furtaa app-ka taleefankaaga, adigaa riixaya dir.'
              : 'Nothing is sent automatically. The message opens in your phone’s own app and you press send.'}
          </p>
        )}
      </div>
    </div>
  );
}
