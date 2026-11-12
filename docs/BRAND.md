# Telesom Brand System

How the app uses Telesom's identity, and the evidence behind each value.
Companion to `BRAND_REDESIGN_PLAN.md` (what is being changed and why).

---

## 1. Where the values came from

A brand directory ([brandfetch.com/telesom.com](https://brandfetch.com/telesom.com)) publishes this palette:

| Published | Name |
| :--- | :--- |
| `#FFC107` | Amber |
| `#389955` | Chateau Green |
| `#F8BB86` | Manhattan (peach) |

**It is wrong in two ways.** It omits the royal blue entirely — the most
distinctive part of the emblem — and the amber it lists is not the gold in the
mark. So the colours here were sampled from the logo files themselves and the
geometry fitted to the artwork.

| Colour | Hex | Where it appears in the logo | Status |
| :--- | :--- | :--- | :--- |
| **Telesom green** | `#389955` | the "Telesom" wordmark | **primary** — `brand-600` |
| **Telesom gold** | `#F8DC09` | the final "o", the orbit | accent — `gold-400` |
| **Telesom blue** | `#313195` | the orbit ring | secondary — `ink-600` |

Gold was measured consistent to ±1 hex across three independent logo files,
which is why it is the one value to trust without question.

The mark itself: a slab-serif wordmark in deep green with a **gold counter in
the final "o"**, over a blue-and-gold elliptical emblem, above the tagline
*The Reliable Choice*. Warm and optimistic — not a cold corporate mark.

---

## 2. The refusals

Colour in this app is not decoration; it carries meaning, and meaning has to
survive a phone in the sun. Three things the brand values insist on that the
design refuses.

**The exact brand green cannot carry white text.** `#389955` on white is
**3.58:1**; white on it is the same. That fails AA for the 11 px labels this app
puts on solid green — the "Running" strip on a route card, "Job completed", the
back-online banner. So:

> **Rule:** text-bearing green surfaces use `brand-700` (6.2:1 with white).
> `brand-600` is for the logo, borders, icons, chart bars and pure fills.

Six surfaces broke this rule when the palette landed. All six were moved, and
`tests/brand.test.ts` now fails the build if `bg-brand-600` appears in the same
class list as `text-white`.

**Gold is never text on light.** `#F8DC09` on white is **1.38:1** — invisible,
not merely weak. Gold appears only as a fill, a rule, a badge background, or on
dark surfaces, where it is excellent (12.5:1 on `brand-950`). Text *on* gold
uses `gold-900`.

**The mid green is a fill, not a text colour.** `brand-500` on white is
3.59:1, so it never carries words on a light surface. There is a test asserting
it stays below AA, so that if the ramp is ever re-tuned the rule above it gets
revisited rather than silently broken.

---

## 3. The ramp, and why it is generated

480 `emerald-*` utilities across 47 files became `brand-*`. That is only safe if
contrast does not move, so **each brand shade sits at the same relative
luminance as the emerald of the same number**:

| Shade | Tailwind emerald | Telesom brand | Δ luminance |
| ---: | :--- | :--- | ---: |
| 50 | `#ECFDF5` (0.947) | `#F6FAF7` (0.947) | 0.000 |
| 100 | `#D1FAE5` (0.876) | `#E9F3EC` (0.875) | 0.001 |
| 200 | `#A7F3D0` (0.769) | `#D4E8DA` (0.768) | 0.001 |
| 300 | `#6EE7B7` (0.639) | `#ABDDBA` (0.639) | 0.000 |
| 400 | `#34D399` (0.496) | `#80CB97` (0.495) | 0.001 |
| 500 | `#10B981` (0.364) | `#4EB76D` (0.366) | 0.002 |
| 600 | `#059669` (0.229) | **`#389955`** (0.228) | 0.001 |
| 700 | `#047857` (0.142) | `#307645` (0.140) | 0.001 |
| 800 | `#065F46` (0.087) | `#265E37` (0.087) | 0.000 |
| 900 | `#064E3B` (0.058) | `#1F4D2D` (0.058) | 0.000 |
| 950 | `#022C22` (0.019) | `#172A1D` (0.019) | 0.000 |

`brand-600` is the exact sampled colour. The rest keep Telesom's hue (138°) and
are solved to the target luminance, with saturation eased at the extremes so the
light tints stay grey-green rather than mint.

Consequence, stated plainly: **no contrast ratio in the app changed.** The hue
did. That is why the swap touched 47 files without a visual audit of each one.

The test pins all eleven luminances to ±0.02, so a future "nicer" shade fails the
build instead of quietly changing how readable a screen is.

---

## 4. The emblem

One drawing, four encodings. All four are generated from the same measurements
and `tests/brand.test.ts` fails if any drifts:

| Encoding | File | Use |
| :--- | :--- | :--- |
| SVG asset | `public/brand/telesom-emblem.svg` | print, documents, the deck |
| Favicon | `public/favicon.svg` | browser tab |
| React | `src/components/brand/TelesomLogo.tsx` | in-app header, login |
| Icon generator | `scripts/generate-icons.mjs` | PWA icons, apple-touch |

### Measurements

Fitted to the official raster by least squares, not eyeballed:

* **Blue orbit** — centre `(230, 172)`, outer radii `122 × 67`, rotation
  **−28.7°**. Drawn radii are the centreline: `116 × 61`, stroke `11.5`.
* **Gold orbit** — centre `(237, 178)`, radii `112 × 56`, stroke `11.5`. Offset
  right and down from the blue orbit, which is what produces the gold crescent
  on the right edge.
* **Disc** — centre `(217, 181)`, radius `45`.
* **Peak** — apex `(250, 100)`, base `(177, 258)` to `(302, 258)`.
* **Gold wedge** — `(300, 203)`, `(350, 258)`, `(220, 258)`.
* **Baseline** — `y = 258`.

Paint order: gold orbit → gold wedge → peak → blue orbit → disc. The peak's apex
clears the ring's opening while its base runs across the ring's lower arc, which
is what makes the mark read as one interlocking object rather than three shapes.

### Variants

| Variant | Ring | Disc | Use |
| :--- | :--- | :--- | :--- |
| `colour` | blue `#313195` | gold | white surfaces |
| `reverse` | white | gold | dark green headers, the login screen |
| `mono` | `currentColor` | `currentColor` | letterheads, single-colour print |

The reverse exists for a measured reason: blue on `brand-950` is **1.4:1** —
effectively invisible. A one-colour reverse is standard brand practice.

### What is *not* faithful

The wordmark is set in a slab-first system stack
(Rockwell → Roboto Slab → Bookman → Georgia), with the gold "o" and matching
weight. The printed mark is a specific slab face this app does not ship, and
adding a webfont for one word would cost more than it returns on a 2G phone.

**It looks close. It is not identical.** Anyone preparing print collateral
should use the official logo file, not a screenshot of the app.

---

## 5. Using it

```tsx
import { TelesomEmblem, TelesomWordmark, TelesomLogo } from './brand/TelesomLogo';

<TelesomLogo variant="reverse" size={44} subtitle="Group F1" />

// Emblem alone, e.g. as an app icon or a bullet
<TelesomEmblem className="w-8" variant="colour" title="Telesom" />

// The name inside a sentence — wordmark only, no emblem
<TelesomWordmark className="text-base" />
```

Rules that matter:

* **No emblem without a reason.** It is a company mark, not a background texture.
  The login screen uses its orbit geometry faintly at 13% opacity — that is the
  one decorative use, and it is the mark's own geometry, not a stock pattern.
* **Never recolour it.** `mono` and `reverse` are the only alternatives.
* **No title when adjacent text already names it** — otherwise a screen reader
  says "Telesom" twice.
* **Keep the aspect ratio.** The emblem is 270 × 178. Square icons go through the
  generator, which pads rather than distorts.

---

## 6. Type and density

Unchanged, by decision. The app keeps its existing scale and spacing; this
redesign changes colour, identity and the login screen only. Larger text for
older staff arrives as an opt-in **larger-text mode** in a later phase, so nobody
who reads fine today loses their density.

The `--font-sans` stack declares `Inter var` first but the app ships no webfont,
so it resolves to the platform UI font. That is deliberate: a network font fetch
is the first thing to fail on a weak connection, and the app must open instantly.
