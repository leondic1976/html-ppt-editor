import type { Page } from './schema.js';

/**
 * The single place where model units become physical units (plan §6, ADR-003).
 *
 * Model coordinates are logical px normalised to the slide, not CSS px. A 1920-wide
 * page maps to a 13⅓in slide, so 144 model-px = 1in and fontSize(pt) = px × 0.5.
 */
export const SLIDE_WIDTH_IN = 40 / 3;
const EMU_PER_IN = 914_400;

export interface UnitConverter {
  readonly widthIn: number;
  readonly heightIn: number;
  inches(modelPx: number): number;
  emu(modelPx: number): number;
  points(modelPx: number): number;
  /** Inverse: model-px from inches. */
  fromInches(inches: number): number;
}

export function createUnitConverter(page: Pick<Page, 'width' | 'height'>): UnitConverter {
  if (!(page.width > 0) || !(page.height > 0)) throw new RangeError('page size must be positive');
  const inPerPx = SLIDE_WIDTH_IN / page.width;
  return {
    widthIn: SLIDE_WIDTH_IN,
    heightIn: page.height * inPerPx,
    inches: (px) => px * inPerPx,
    emu: (px) => Math.round(px * inPerPx * EMU_PER_IN),
    points: (px) => px * inPerPx * 72,
    fromInches: (inches) => inches / inPerPx,
  };
}
