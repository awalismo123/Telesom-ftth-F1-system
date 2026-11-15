import React from 'react';
import { useLanguage } from '../../lib/i18n';
import { useToast } from './Toast';
import {
  applyTextSize,
  nextTextSize,
  readTextSize,
  textSizeCopy,
  writeTextSize,
  type TextSize,
} from '../../lib/textSize';
import { cx } from './cx';

/**
 * Cycles normal → large → extra large.
 *
 * It is a cycle rather than a menu on purpose: one tap, one obvious result, and
 * the button itself shows the state ("Aa · Large"). A dropdown with three radio
 * buttons would be more precise and considerably harder for the person this
 * exists for.
 *
 * The label is always visible, not just an icon — an unlabelled "Aa" is a
 * puzzle, and puzzles are what this setting is meant to remove.
 */
export function TextSizeButton({ compact = false }: { compact?: boolean }) {
  const { lang } = useLanguage();
  const toast = useToast();
  const [size, setSize] = React.useState<TextSize>(() =>
    typeof localStorage === 'undefined' ? 'normal' : readTextSize(localStorage),
  );

  // Keep the root attribute honest if anything else ever sets it.
  React.useEffect(() => {
    if (typeof document !== 'undefined') applyTextSize(size, document.documentElement);
  }, [size]);

  const copy = textSizeCopy(size, lang);

  const handleClick = () => {
    const upcoming = nextTextSize(size);
    setSize(upcoming);
    if (typeof document !== 'undefined') applyTextSize(upcoming, document.documentElement);
    if (typeof localStorage !== 'undefined') writeTextSize(upcoming, localStorage);

    const nextCopy = textSizeCopy(upcoming, lang);
    toast.info(nextCopy.label, {
      description: lang === 'so' ? 'Waa la keydiyay qalabkan.' : 'Saved on this device.',
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`${copy.label}. ${copy.next}`}
      title={`${copy.label} — ${copy.next}`}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-lg bg-brand-900/90 hover:bg-brand-800 border border-brand-700/80 text-brand-100 transition cursor-pointer',
        compact ? 'h-9 px-2' : 'px-2.5 py-1.5',
      )}
    >
      <span aria-hidden="true" className="font-bold leading-none tracking-tight">
        <span className="text-[11px]">A</span>
        <span className="text-[14px]">a</span>
      </span>
      <span className="text-[11px] font-semibold hidden sm:inline">{copy.short}</span>
    </button>
  );
}
