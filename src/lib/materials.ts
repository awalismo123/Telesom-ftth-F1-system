/**
 * What was used to fix the job.
 *
 * ## Why usage and not stock
 *
 * The obvious feature is "how many routers are left". It cannot be built
 * honestly from what exists. A stock figure is `received − used`, and **nothing
 * in this system records a delivery**. Computing `0 − used` would produce a
 * negative number that drifts further from the shelf every week, and a
 * supervisor would eventually make a purchase decision on it.
 *
 * So this tracks **usage**, which is a fact: on this job, on this day, this
 * technician fitted one router and six metres of drop cable. That number can be
 * reconciled against the store by a person holding the paperwork, and it is
 * what the department actually needs to reorder by.
 *
 * Every screen that shows a total from this data calls it **usage**, never
 * stock. `tests/materials.test.ts` fails the build if a label claims otherwise.
 *
 * ## Free text, with suggestions
 *
 * Items are free text, not a foreign key to a catalogue. A catalogue is the
 * right answer once somebody maintains it; inventing one now would mean a
 * technician unable to record "the green clip" because it is not on a list.
 * A short list of common items is offered as one-tap suggestions, and anything
 * else can be typed.
 */

/** How a quantity is counted. Metres are cut from a drum; pieces are boxed. */
export type MaterialUnit = 'pcs' | 'm' | 'roll' | 'box';

export const MATERIAL_UNITS: MaterialUnit[] = ['pcs', 'm', 'roll', 'box'];

export const UNIT_LABEL: Record<MaterialUnit, { en: string; so: string }> = {
  pcs: { en: 'pcs', so: 'xabo' },
  m: { en: 'm', so: 'm' },
  roll: { en: 'roll', so: 'duub' },
  box: { en: 'box', so: 'sanduuq' },
};

/**
 * The items a technician reaches for most often.
 *
 * Deliberately short and Somali/English in the same string, because the sheet,
 * the store and the technician all use the English trade name while the
 * interface is bilingual. A long list would need maintaining; this is the set
 * that covers most jobs, and typing covers the rest.
 */
export const COMMON_ITEMS = [
  'ONT / Router',
  'Patch cord (SC/APC)',
  'Drop cable',
  'Fast connector',
  'Fusion splice sleeve',
  'Splitter',
  'Cable clip',
  'Cable tie',
] as const;

export interface MaterialLine {
  item: string;
  quantity: number;
  unit: MaterialUnit;
}

export type MaterialProblem = 'no-item' | 'bad-quantity' | 'too-long' | 'not-a-unit';

export const MATERIAL_PROBLEM_COPY: Record<MaterialProblem, { en: string; so: string }> = {
  'no-item': { en: 'Say what was used.', so: 'Sheeg waxa la isticmaalay.' },
  'bad-quantity': {
    en: 'Quantity must be a number greater than zero.',
    so: 'Tirada waa in ay tahay lambar ka weyn eber.',
  },
  'too-long': { en: 'That item name is too long.', so: 'Magaca shayga waa aad u dheer.' },
  'not-a-unit': { en: 'Choose a unit.', so: 'Dooro unug.' },
};

/** A generous ceiling: a job that used more than this was a rebuild, and the
 *  number is more likely a slipped decimal point than a real quantity. */
export const MAX_QUANTITY = 10_000;
export const MAX_ITEM_LENGTH = 80;

/**
 * Why a line cannot be recorded, or `null` if it can.
 *
 * The database enforces the same rules. This exists so the technician gets an
 * instant answer in their own language instead of a Postgres constraint name.
 */
export function materialProblem(line: Partial<MaterialLine>): MaterialProblem | null {
  const item = (line.item ?? '').trim();
  if (!item) return 'no-item';
  if (item.length > MAX_ITEM_LENGTH) return 'too-long';

  const quantity = line.quantity;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity)) return 'bad-quantity';
  if (quantity <= 0 || quantity > MAX_QUANTITY) return 'bad-quantity';

  if (line.unit && !MATERIAL_UNITS.includes(line.unit as MaterialUnit)) return 'not-a-unit';

  return null;
}

/** Trim and normalise a line for saving. Assumes `materialProblem` is null. */
export function normaliseLine(line: MaterialLine): MaterialLine {
  return {
    item: line.item.trim().replace(/\s+/g, ' '),
    quantity: Math.round(line.quantity * 100) / 100,
    unit: line.unit,
  };
}

/**
 * A quantity as a person writes it: `6 m`, `1 pcs`.
 *
 * Whole numbers lose the decimals, because `6.00 m` reads like a measurement
 * and `6 m` reads like a length.
 */
export function formatQuantity(quantity: number, unit: MaterialUnit, lang: 'en' | 'so'): string {
  const rounded = Math.round(quantity * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return `${text} ${UNIT_LABEL[unit][lang]}`;
}

export interface UsageRow {
  item: string;
  unit: MaterialUnit;
  quantity: number;
  /** How many separate jobs used it — one job using 3 connectors is different
   *  from three jobs using one each. */
  jobs: number;
}

/**
 * Total by item across a set of lines.
 *
 * Grouped by item **and unit**, because "6" of a cable in metres and "6" of a
 * connector in pieces cannot be added together. Mixing them would silently
 * produce a meaningless total.
 */
export function usageByItem(lines: readonly MaterialLine[]): UsageRow[] {
  const totals = new Map<string, UsageRow>();

  for (const line of lines) {
    const key = `${line.item}::${line.unit}`;
    const existing = totals.get(key);
    if (existing) {
      existing.quantity += line.quantity;
      existing.jobs += 1;
    } else {
      totals.set(key, {
        item: line.item,
        unit: line.unit,
        quantity: line.quantity,
        jobs: 1,
      });
    }
  }

  return [...totals.values()]
    .map((row) => ({ ...row, quantity: Math.round(row.quantity * 100) / 100 }))
    .sort((a, b) => b.quantity - a.quantity || a.item.localeCompare(b.item));
}

/**
 * What the reporting screen must call this figure.
 *
 * A constant rather than a literal in the component, so the wording can be
 * tested — and so nobody can quietly relabel usage as stock in one screen while
 * the docs say otherwise.
 */
export const USAGE_LABEL = {
  en: 'Materials used in this period',
  so: 'Alaabta la isticmaalay muddadan',
} as const;

/** Said wherever a materials total appears, because the absence of a stock
 *  figure is the thing a supervisor will otherwise assume is a bug. */
export const NO_STOCK_NOTE = {
  en: 'This counts what was used, not what is left. Stock on hand is not tracked.',
  so: 'Tani waxay tirinaysaa waxa la isticmaalay, ma aha waxa hadhay. Bakhaarka lama tirinayo.',
} as const;

/* -------------------------------------------------------------------------- */
/* Wire shape                                                                  */
/* -------------------------------------------------------------------------- */

/** One recorded line as the server returns it. */
export interface RecordedMaterial extends MaterialLine {
  id: string;
  recorded_by_name: string | null;
  created_at: string;
}

/** The row shape of the `materials_usage` RPC. `basis` is always `'usage'`. */
export interface UsageResponse {
  from: string;
  to: string;
  rows: UsageRow[];
  basis: 'usage';
}
