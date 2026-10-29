import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// WCAG 2.x contrast ratio (13 section 14: text contrast >= 4.5:1; UI glyphs >= 3:1).
function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
type Rgb = [number, number, number];
function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A colour token: `#rrggbb` or `rgba(r, g, b, a)`. Returns the colour and its alpha (1 when opaque). */
function parseColour(value: string): { rgb: Rgb; alpha: number } {
  const rgba = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(value);
  if (rgba) return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: rgba[4] === undefined ? 1 : Number(rgba[4]) };
  return { rgb: hexToRgb(value), alpha: 1 };
}

/** The glass colour laid over an opaque surface (the sheet and the info card sit on the map; the surface is the worst base). */
function over(glass: { rgb: Rgb; alpha: number }, base: Rgb): Rgb {
  const a = glass.alpha;
  return [0, 1, 2].map((i) => Math.round(glass.rgb[i]! * a + base[i]! * (1 - a))) as Rgb;
}

/** The tokens of one exact selector block in a stylesheet (`:root` or `:root[data-theme='light']`). */
function blockTokens(file: string, selector: string): Record<string, string> {
  const css = readFileSync(file, 'utf8');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!block || !block[1]) throw new Error(`no ${selector} block in ${file}`);
  const out: Record<string, string> = {};
  for (const m of block[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1] ?? ''] = (m[2] ?? '').trim();
  return out;
}

const STYLES = 'src/ui/styles.css';
const TOKENS = 'src/ui/shell/tokens.css';

/** Each theme's colours: the base tokens from styles.css, and the glass and gold layer from tokens.css. */
function themeOf(selector: string, tokensSelector: string): Record<string, string> {
  return { ...blockTokens(STYLES, selector), ...blockTokens(TOKENS, tokensSelector) };
}

const THEMES: Array<{ name: string; tokens: Record<string, string> }> = [
  { name: 'dark', tokens: themeOf(':root', ':root') },
  { name: 'light', tokens: themeOf(":root[data-theme='light']", ":root[data-theme='light']") },
  { name: 'high contrast', tokens: themeOf(":root[data-theme='highcontrast']", ":root[data-theme='highcontrast']") },
];

describe.each(THEMES)('$name theme contrast (WCAG AA)', ({ tokens: t }) => {
  const surface = hexToRgb(t['surface'] ?? '#000000');
  const glass = parseColour(t['glass-bg'] ?? 'rgba(0, 0, 0, 1)');
  const onGlass = over(glass, surface);

  const textPairs: Array<[string, Rgb, Rgb]> = [
    ['text on surface', parseColour(t['text'] ?? '#000000').rgb, surface],
    ['text-dim on surface', parseColour(t['text-dim'] ?? '#000000').rgb, surface],
    ['accent-ink on accent', parseColour(t['accent-ink'] ?? '#000000').rgb, parseColour(t['accent'] ?? '#ffffff').rgb],
    ['text on glass', parseColour(t['text'] ?? '#000000').rgb, onGlass],
    ['text-dim on glass', parseColour(t['text-dim'] ?? '#000000').rgb, onGlass],
    ['gold-hi (toast and New cards) on glass', parseColour(t['gold-hi'] ?? '#000000').rgb, onGlass],
  ];
  for (const [label, fg, bg] of textPairs) {
    it(`${label}: 4.5:1`, () => {
      const ratio = contrast(fg, bg);
      expect(ratio, `${label} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  }

  const glyphPairs: Array<[string, Rgb, Rgb]> = [
    ['accent glyphs on glass', parseColour(t['accent'] ?? '#000000').rgb, onGlass],
    ['gold glyphs on glass', parseColour(t['gold'] ?? '#000000').rgb, onGlass],
  ];
  for (const [label, fg, bg] of glyphPairs) {
    it(`${label}: 3:1`, () => {
      const ratio = contrast(fg, bg);
      expect(ratio, `${label} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    });
  }
});
