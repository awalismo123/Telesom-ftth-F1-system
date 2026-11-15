import React from 'react';
import { ExternalLink, MapPin } from 'lucide-react';
import { MAP_COPY, mapSearchUrl, spokenLocation, type Place } from '../../lib/directions';
import { copyPlainText } from '../../lib/format';

/**
 * "Find on map" — one component so the warning is worded once.
 *
 * The button opens a **search**, not a pin, and says so underneath. If the
 * wording lived in two screens it would drift, and the sentence is the whole
 * honesty of the feature: a technician who is not told it is a search will
 * reasonably assume the app knows where the box is.
 *
 * Renders nothing at all when there is no box or area to search for. A button
 * that opens a map searching for an empty string is a dead end dressed up as an
 * action, and "no address recorded" is better said once than shown as a control.
 */

interface Props {
  place: Place;
  lang: 'so' | 'en';
  /** `compact` for a route card, `full` for the job sheet. */
  variant?: 'compact' | 'full';
  /** Optional: show a copy button beside it. */
  onCopied?: (ok: boolean) => void;
}

export function DirectionsButton({ place, lang, variant = 'full', onCopied }: Props) {
  const so = lang === 'so';
  const url = mapSearchUrl(place);
  const spoken = spokenLocation(place);

  if (!url) return null;

  const copyAddress = async () => {
    const ok = await copyPlainText(spoken.join(', '));
    onCopied?.(ok);
  };

  if (variant === 'compact') {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-brand-700 bg-brand-50 border border-brand-100 active:scale-95 transition"
        title={MAP_COPY.note[lang]}
      >
        <MapPin className="w-3 h-3" aria-hidden="true" />
        {MAP_COPY.label[lang]}
        <ExternalLink className="w-2.5 h-2.5 opacity-60" aria-hidden="true" />
      </a>
    );
  }

  return (
    <div className="space-y-1">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl bg-white border border-slate-300 text-sm font-extrabold text-slate-800 active:scale-95 transition"
      >
        <MapPin className="w-4 h-4 text-brand-700" aria-hidden="true" />
        {MAP_COPY.label[lang]}
        <ExternalLink className="w-3 h-3 ml-auto mr-3 text-slate-500" aria-hidden="true" />

        <span className="sr-only">
          {so ? 'waxay furtaa bog cusub' : 'opens in a new tab'}
        </span>
      </a>

      {/* The sentence that keeps this honest. */}
      <p className="text-[10px] leading-snug text-slate-500 px-0.5">{MAP_COPY.note[lang]}</p>

      {spoken.length > 0 && (
        <button
          type="button"
          onClick={() => void copyAddress()}
          className="text-[10px] font-bold text-brand-700 underline underline-offset-2 px-0.5 cursor-pointer"
        >
          {so ? 'Nuqul ciwaanka qoraalka' : 'Copy the address as text'}
        </button>
      )}
    </div>
  );
}
