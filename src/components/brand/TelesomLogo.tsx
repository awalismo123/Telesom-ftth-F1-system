import React from 'react';
import { cx } from '../ui/cx';

/**
 * The Telesom mark.
 *
 * Traced from the official raster rather than borrowed from a brand directory:
 * the orbits were fitted by least squares (blue ellipse: centre 230,172 ·
 * outer 122 × 67 · −28.7°), the disc measured off its widest scanline, and the
 * colours sampled from the artwork. See `docs/BRAND.md` for the measurements.
 *
 * Three things this gets right that a resized JPEG cannot:
 *   · it is vector, so it is sharp on a 3× phone screen and cheap in the bundle
 *   · it has a `reverse` variant, because blue on a dark green header is 1.4:1
 *   · it takes a `title`, so screen readers get a name instead of an image
 */

export type EmblemVariant = 'colour' | 'reverse' | 'mono';

export interface TelesomEmblemProps {
  className?: string;
  variant?: EmblemVariant;
  /** Omit when the mark sits next to visible text that already names it. */
  title?: string;
  style?: React.CSSProperties;
}

const PALETTE: Record<EmblemVariant, { ring: string; disc: string; wedge: string }> = {
  // The mark as printed on white.
  colour: { ring: '#313195', disc: '#F8DC09', wedge: '#F8DC09' },
  // For dark green and dark blue surfaces. Blue-on-dark is unreadable, and a
  // reversed logo is standard brand practice, not an invention.
  reverse: { ring: '#ffffff', disc: '#F8DC09', wedge: '#F8DC09' },
  // Single-colour, for letterheads and anywhere colour would compete.
  mono: { ring: 'currentColor', disc: 'currentColor', wedge: 'currentColor' },
};

export function TelesomEmblem({ className, variant = 'colour', title, style }: TelesomEmblemProps) {
  const c = PALETTE[variant];
  return (
    <svg
      viewBox="110 82 270 178"
      className={cx('block', className)}
      style={style}
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}

      {/* Gold orbit, behind — reads as the right-hand crescent and the wedge. */}
      <ellipse
        cx="237"
        cy="178"
        rx="112"
        ry="56"
        transform="rotate(-28.7 237 178)"
        fill="none"
        stroke={c.wedge}
        strokeWidth="11.5"
      />
      <path d="M300 203 L350 258 L220 258 Z" fill={c.wedge} />

      {/* Peak, in front of the orbit. */}
      <path d="M250 100 L177 258 L302 258 Z" fill={c.ring} />

      {/* Blue orbit, over the peak's apex. */}
      <ellipse
        cx="230"
        cy="172"
        rx="116"
        ry="61"
        transform="rotate(-28.7 230 172)"
        fill="none"
        stroke={c.ring}
        strokeWidth="11.5"
      />

      {/* The disc, in front of everything. */}
      <circle cx="217" cy="181" r="45" fill={c.disc} />
    </svg>
  );
}

export interface TelesomWordmarkProps {
  className?: string;
  /** Renders the second "o" in brand gold, as the logo does. */
  goldO?: boolean;
}

/**
 * "Telesom" as a wordmark.
 *
 * The real wordmark is a slab serif. The app ships no webfont — adding one for
 * a single word would cost more than it returns on a 2G connection — so this
 * uses a slab-first system stack and accepts that it lands a little softer than
 * the printed mark. Everything else (weight, tracking, the gold "o") matches.
 */
export function TelesomWordmark({ className, goldO = true }: TelesomWordmarkProps) {
  return (
    <span
      className={cx(
        'font-serif font-bold tracking-tight leading-none',
        '[font-family:Rockwell,"Roboto_Slab","Bookman_Old_Style",Georgia,serif]',
        className,
      )}
    >
      Teles
      {goldO ? <span className="text-gold-400">o</span> : 'o'}
      m
    </span>
  );
}

export interface TelesomLogoProps {
  className?: string;
  variant?: EmblemVariant;
  /** Size of the emblem in px. */
  size?: number;
  /** Hide the wordmark and show only the emblem. */
  markOnly?: boolean;
  subtitle?: string;
  title?: string;
}

/**
 * The lockup used in headers: emblem on the left, wordmark beside it, an
 * optional subtitle underneath. Used by the login screen, the supervisor header
 * and the config-error screen so all three agree.
 */
export function TelesomLogo({
  className,
  variant = 'colour',
  size = 36,
  markOnly = false,
  subtitle,
  title,
}: TelesomLogoProps) {
  return (
    <div className={cx('flex items-center gap-2.5', className)}>
      <TelesomEmblem
        variant={variant}
        className="shrink-0"
        title={markOnly ? (title ?? 'Telesom') : undefined}
        style={{ width: size, height: Math.round((size * 178) / 270) }}
      />
      <span className="sr-only">{title ?? 'Telesom'}</span>
      {!markOnly && (
        <div className="min-w-0">
          <TelesomWordmark className="text-lg" />
          {subtitle && (
            <div
              className={cx(
                'text-[11px] font-medium leading-tight truncate',
                variant === 'reverse' ? 'text-brand-200' : 'text-slate-500',
              )}
            >
              {subtitle}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
