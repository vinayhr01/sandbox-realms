/**
 * Display settings that act on the page (13 section 15): the colour-blind palette, map layer
 * opacity and brightness, the layout width, and the vignette. Pure functions only; main.ts applies
 * the results to the DOM. The map is one Pixi canvas, so its colour-blind correction is an SVG
 * colour matrix applied as a CSS filter to that canvas. The UI text is not filtered.
 */

export type ColourBlindPalette = 'none' | 'deuteranopia' | 'protanopia' | 'tritanopia';
export type LayoutChoice = 'auto' | 'compact' | 'medium' | 'expanded';

/** Dichromacy simulation in sRGB (Machado et al. 2009, severity 1.0, rounded). */
const SIMULATE: Readonly<Record<Exclude<ColourBlindPalette, 'none'>, readonly number[][]>> = {
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.28085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** Where the lost colour information is moved (the usual daltonize error matrix). */
const ERROR_SPREAD: Readonly<Record<Exclude<ColourBlindPalette, 'none'>, readonly number[][]>> = {
  deuteranopia: [
    [0, 0, 0],
    [0.7, 1, 0],
    [0.7, 0, 1],
  ],
  protanopia: [
    [0, 0, 0],
    [0.7, 1, 0],
    [0.7, 0, 1],
  ],
  tritanopia: [
    [1, 0.7, 0],
    [0, 0, 0],
    [0, 0.7, 1],
  ],
};

const mul = (a: readonly number[][], b: readonly number[][]): number[][] =>
  a.map((row) => [0, 1, 2].map((j) => row.reduce((sum, v, k) => sum + v * (b[k]?.[j] ?? 0), 0)));

/**
 * The daltonize correction for a palette: corrected = (I + E (I - S)) applied to RGB, where S is the
 * dichromacy simulation and E the error spread. Returns the 3x3 matrix, or null for 'none'.
 */
export function daltonizeMatrix(palette: ColourBlindPalette): number[][] | null {
  if (palette === 'none') return null;
  const s = SIMULATE[palette];
  const identity = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const iMinusS = identity.map((row, i) => row.map((v, j) => v - (s[i]?.[j] ?? 0)));
  const m = mul(ERROR_SPREAD[palette], iMinusS);
  return identity.map((row, i) => row.map((v, j) => v + (m[i]?.[j] ?? 0)));
}

export const CVD_FILTER_PREFIX = 'sr-cvd-';

/** SVG markup with one colour-matrix filter per palette; mounted once in the page. */
export function colourFilterMarkup(): string {
  const filters = (['deuteranopia', 'protanopia', 'tritanopia'] as const).map((p) => {
    const m = daltonizeMatrix(p) ?? [];
    const values = m.map((row) => `${row[0]} ${row[1]} ${row[2]} 0 0`).join(' ');
    return `<filter id="${CVD_FILTER_PREFIX}${p}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${values} 0 0 0 1 0"/></filter>`;
  });
  return `<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute">${filters.join('')}</svg>`;
}

/**
 * The CSS filter for the map canvas: the colour-blind correction (when chosen) and the layer
 * brightness (percent, 60-100). 'none' when neither applies.
 */
export function mapCanvasFilter(palette: ColourBlindPalette, brightnessPct: number): string {
  const parts: string[] = [];
  if (palette !== 'none') parts.push(`url(#${CVD_FILTER_PREFIX}${palette})`);
  if (brightnessPct !== 100) parts.push(`brightness(${(brightnessPct / 100).toFixed(2)})`);
  return parts.length > 0 ? parts.join(' ') : 'none';
}

/** Max width of the app column in CSS px for a layout choice; null means the full width. */
export function layoutMaxWidth(layout: LayoutChoice): number | null {
  switch (layout) {
    case 'compact':
      return 600;
    case 'medium':
      return 960;
    case 'expanded':
      return 1440;
    default:
      return null;
  }
}
