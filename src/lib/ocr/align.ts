/**
 * Mapping self-correction.
 *
 * When a vertical rule in the photographed sheet is missing (merged cells) or
 * an extra one is detected, every column after that point shifts by one and the
 * whole import silently becomes wrong. Here we score a handful of candidate
 * offsets against the *content* of each column (line numbers must be 6 digits,
 * groups must be known codes, …) and keep the best alignment.
 */

import type { SheetTemplate } from './templates';
import { columnWeight, looksValid } from './score';

export interface MappingScore {
  offset: number;
  score: number;
}

function scoreMapping(
  cells: string[][],
  mapping: number[],
  template: SheetTemplate,
): number {
  let earned = 0;
  let possible = 0;

  template.columns.forEach((col, templateIdx) => {
    const weight = columnWeight(col.kind);
    if (!weight) return;
    const detectedIdx = mapping[templateIdx];
    possible += weight * cells.length;
    if (detectedIdx < 0) return;

    for (const row of cells) {
      if (looksValid(col.kind, row[detectedIdx] ?? '')) earned += weight;
    }
  });

  return possible === 0 ? 0 : earned / possible;
}

/**
 * Try the detected mapping plus small offsets, and return the best one.
 * `mapping` is template-column → detected-column.
 */
export function realignMapping(
  cells: string[][],
  mapping: number[],
  template: SheetTemplate,
  detectedCols: number,
): { mapping: number[]; offset: number; confidence: number; original: number } {
  const original = scoreMapping(cells, mapping, template);
  let best = { mapping, offset: 0, confidence: original, original };

  for (const offset of [-2, -1, 1, 2]) {
    const candidate = mapping.map((idx) => {
      if (idx < 0) return -1;
      const next = idx + offset;
      return next >= 0 && next < detectedCols ? next : -1;
    });

    // A shift that empties out most of the mapping is not a real candidate.
    const kept = candidate.filter((i) => i >= 0).length;
    if (kept < Math.ceil(mapping.filter((i) => i >= 0).length * 0.7)) continue;

    const score = scoreMapping(cells, candidate, template);
    if (score > best.confidence + 0.02) {
      best = { mapping: candidate, offset, confidence: score, original };
    }
  }

  return best;
}
