# Telesom Brand & Usability Redesign — Research and Plan

**Request:** new design, best UI, easy for older and non-technical staff, impressive to managers, carrying real Telesom brand (logo, colours, identity).

**Status:** Phase A shipped 09/11/2026 — see `BRAND.md` for the system and
`git log` for the change. Phases B–E not started.
**Supersedes:** the earlier "keep emerald/slate, refine, do not redesign" constraint. This is an explicit design change, so that rule no longer applies.

---

## 1. What Telesom actually is

Researched 09/11/2026 from the company's own site, Brandfetch, GSMA, Wikipedia and press coverage.

| Fact | Detail | Why it matters to this design |
| :--- | :--- | :--- |
| Founded | 2002, Hargeisa — by local entrepreneurs | Local, not a foreign franchise. The brand reads Somali-owned and proud. |
| Scale | Largest operator in Somaliland; **~88–90% share**, roughly 2,600 employees | This is the national operator. The system should look institutional, not like a startup tool. |
| Firsts | First to bring 2G, 3G, LTE — and **5G on 1 Jan 2024**, nationally | The brand's self-image is *first, modern, forward*. A tired-looking internal tool contradicts it. |
| Fibre | "Telesom Fiber" — home, business, fibre-to-the-air | **This is the product our app delivers.** The app is the field arm of the flagship product. |
| ZAAD | Launched 2009, ZAAD means *to grow, to prosper* | Their most-loved brand. Proof they can make mass-market tech feel simple for non-technical people. |
| Positioning | "The Reliable Choice" (their logo tagline) | Reliability is the promise. For this app that means: never show a number that isn't true, never lose typed work. |

**The strategic read.** Telesom made mobile money work for people who had never used a bank. That is the same design problem as this app: a field technician with a cheap Android phone, in the sun, who needs the screen to be obvious on the first try. The app should feel like ZAAD — plain, confident, big, impossible to get wrong.

---

## 2. The brand, sampled from the actual logo

I pulled the colours out of the logo pixels rather than trusting a brand directory, because the directory was wrong.

**Brandfetch's published palette:** `#FFC107` amber, `#389955` green, `#F8BB86` peach.
**What the logo actually contains:** deep green, gold, **and royal blue** — the blue is the most distinctive part of the emblem and the directory omitted it entirely.

| Role | Hex | Source | Notes |
| :--- | :--- | :--- | :--- |
| **Telesom green** | `#1A8805` | sampled from the wordmark | The primary. Saturated, slightly yellow-shifted. |
| **Telesom gold** | `#F8DC09` | consistent across all three logo files (±1 hex) | The most reliable brand constant. It is the "o" in Telesom. |
| **Telesom blue** | `#313195` | the emblem's orbit | Royal/indigo. Secondary — use for information, not decoration. |

Notes on the mark itself: the wordmark is a **slab serif** in deep green with a **gold counter** in the final *o*, over a **blue-and-gold elliptical emblem** and the tagline *The Reliable Choice*. It is a warm, optimistic mark — not a cold corporate one.

### 2.1 Contrast is a real constraint, not a detail

Pure brand green `#1A8805` on white measures about **4.0:1** — fine for buttons and large headings, **below AA for body text**. Gold on white is unusable for text at any size.

So the design uses the brand colours as **fills and accents**, with a derived scale for text:

| Token | Hex | Use |
| :--- | :--- | :--- |
| `brand-500` | `#22A80A` | hover, focus glow |
| `brand-600` | `#1A8805` | **primary buttons, active states** (brand exact) |
| `brand-700` | `#146B04` | text on white, pressed states |
| `brand-800` | `#0F5203` | headings on tinted backgrounds |
| `brand-950` | `#062B02` | dark headers and panels |
| `gold-400` | `#F8DC09` | accent only — badges, the "o", highlight rules. **Never text on white.** |
| `gold-900` | `#3A3100` | text *on* gold |
| `ink-700` | `#313195` | secondary/info, links |
| `ink-950` | `#1A1A4E` | deep blue panels |

This is the standard move for a brand with a mid-luminance primary, and it keeps every word readable for a 55-year-old supervisor reading a phone in daylight.

---

## 3. Two users pulling in opposite directions

The request contains a genuine tension worth naming before designing around it:

* **Older / non-technical field staff** need *less*: bigger text, bigger targets, fewer choices, one obvious action.
* **Managers** are impressed by *more*: dense information, polish, evidence, printable reports.

A single compromise density serves neither. So:

| | **Field** (technician, login) | **Office** (supervisor, manager) |
| :--- | :--- | :--- |
| Base type | 17–18 px | 15–16 px |
| Primary target | **56 px** tall | 44 px |
| Choices per screen | 1 primary + 1 escape | several, grouped |
| Data shown | the job in front of them | the whole day, the whole group |
| Colour use | status is the loudest thing | chrome is quiet, data is loud |

Same brand, same components, two densities. The field shell picks its density from the role, not from a setting the user has to find.

---

## 4. Design principles (what "easy for old, non-tech people" actually means)

Each of these is testable, which is the point — a principle nobody can check is decoration.

1. **Bigger, but not just bigger.** 17 px body and 56 px targets, *and* fewer words per screen. Making small text large without removing content just makes a long screen longer.
2. **One primary action.** Every screen has exactly one button that looks like the thing to do. Everything else is secondary or hidden behind "more".
3. **Status is a word, a colour and a shape.** Never colour alone — sun glare, cheap screens and colour-blindness all defeat colour-only status. `Blocked` is a word, an amber fill and a triangle.
4. **Numbers are the loudest thing.** Jobs open, dBm, minutes. Tabular figures, large, aligned. A person should read the state of the day in two seconds.
5. **No hidden gestures, no hover-only, no icon-only for anything that matters.** An icon with no label is a puzzle.
6. **Say the plain word.** "Send the team" not "dispatch"; "the same job twice" not "deduplication". Domain words technicians already use (Xaafada, Cablebox, dBm) stay exactly as they are — that *is* their language.
7. **Never a false error, never a lost keystroke.** Already a standing rule in this project; a design that confuses people creates errors that look like bugs.
8. **Bilingual by construction, not by translation later.** Both languages designed at the same width — Somali is typically ~15% longer, and a layout that only works in English breaks in Somali.

---

## 5. What changes, screen by screen

### Login — the first impression
Currently a dark green full-bleed screen with a PIN keypad. It works. It should become the single most brand-forward screen in the app: real logo, gold accent, plain instructions, a visible "which language" control, and a first-run line that tells a new person what to do.

### Technician route — the hardest usability problem
Big job cards, one action per card (`Start` → `Finish`), the customer's number as a large tap-to-call button, status as word + colour + icon. The timer becomes unmissable. Blocked becomes effortless to explain.

### Supervisor overview — what managers see
The new "today" panel (just built) keeps its priority sentence, restyled in brand colours with bigger numbers. This is the screen that sells the system in a meeting.

### Manager portfolio & reports
Dense, calm, brand-consistent. The printable period report gets a proper letterhead with the logo — that sheet is what a head manager signs.

### Chrome
Header, navigation, empty states, error states, buttons, inputs, modals, toasts — one system, two densities.

---

## 6. Phases

Ordered so that something presentable exists early, and each phase ships independently.

### Phase A — Brand foundation (the proof)
- Brand tokens in the Tailwind v4 `@theme`: full `brand`, `gold`, `ink` ramps.
- Replace the 480 `emerald-*` usages across 47 files with `brand-*` (mechanical, verified by typecheck + 240 tests + a bundle check).
- Rebuild the logo as clean **SVG** — emblem, wordmark, and a compact mark for the header and favicon.
- Type scale: 17 px base, tighter line-height discipline, larger numeric scale.
- **Rebrand the login screen end-to-end.** This is the demo screen; it should be finished first.
- Favicon, app icon, PWA manifest colours.

**Deliverable:** a live, branded login screen on 5173 that you can show someone in 30 seconds.

### Phase B — Field simplicity (technician)
- Route card redesign: one primary action, tap-to-call as a large target, status as word + colour + icon.
- Running timer made unmissable; the execution sheet simplified into steps.
- 56 px targets on every primary control; a scan test enforces it.
- Plain-language pass over the technician copy in both languages.

### Phase C — Office polish (supervisor / manager)
- Branded header and navigation; the "today" panel restyled with brand numbers.
- Dispatch board: calmer chrome, clearer selection, the pool/lane distinction obvious.
- Manager portfolio and the printable report letterhead with the real logo.
- Print stylesheet checked against a real A4 page.

### Phase D — Accessibility and trust
- Contrast automated as a test (the existing `design.test.ts` extended to the brand ramp).
- **Larger-text mode** for staff with poor eyesight — a real toggle, not a browser zoom.
- Reduced-motion, focus-visible, keyboard order.
- A "show me" first-run tour of three screens, skippable, bilingual.

### Phase E — Brand assets and documentation
- `docs/BRAND.md`: palette, type, spacing, do/don't, with the sampled hex evidence.
- Screenshot set for the management deck, light and dark.

---

## 7. Decisions taken (09/11/2026)

| Question | Decision |
| :--- | :--- |
| The logo | **Recreated as clean SVG.** Faithful redraw, not a redesign of the mark. |
| Which green | **`#389955` (mid green)** — the value Brandfetch publishes. |
| Density | **Unchanged.** No size overhaul. |
| First deliverable | **Login screen + logo.** |

### What "density unchanged" means for the original brief

The request asked for a UI that is easier for older, non-technical staff. The
density decision removes the bluntest tool for that — making everything bigger —
so the goal is met by other means, in this order:

1. **The login screen now answers "what do I type" and "what if I have no PIN"
   on the screen itself**, instead of becoming a phone call to the supervisor.
2. **Larger-text mode** as an explicit opt-in (Phase D): the people who need
   bigger text get it, and the people who read fine keep their information
   density. A global increase would have taken pixels from the managers.
3. **One primary action per screen**, plain-language copy, and status carried by
   a word as well as a colour (Phases B–C).

The tension is real and worth stating: bigger-and-simpler for the field and
dense-and-polished for the office pull in opposite directions. Opt-in text size
is the honest way to serve both without pretending one compromise fits everyone.

---

## 8. Phase A — what shipped, and one thing it exposed

Brand tokens (generated ramp, luminance-matched to the emerald it replaced), the
emblem in four encodings from one set of measurements, PWA icons and favicon
regenerated from the emblem, and the login screen rebuilt.

**The exposure:** the exact brand green is **3.58:1** against white, and six
surfaces were already carrying 11 px white text on the equivalent mid-green
before the redesign — an existing AA failure that no lint was catching. All six
moved to `brand-700` (6.2:1), and `tests/brand.test.ts` now fails if the
combination returns. The brand colour did not cause this; it made a pre-existing
fault visible.

---

## 9. What I will not do

- **Not invent a new logo.** The mark is Telesom's. I will recreate it faithfully as vector or use an asset you supply; I will not modernise it.
- **Not promise a redesign I haven't run.** Every phase is verified in the browser on 5173, not described in a document.
- **Not sacrifice contrast for brand accuracy.** A beautiful green nobody can read in the sun is a failed field tool.
- **Not touch functionality while restyling.** Same tests, same database, same behaviour — the visual layer changes, the system does not.
