import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// WCAG 2.x contrast ratio (13 section 14: text contrast >= 4.5:1).
function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Reads the :root block of the stylesheet (the dark default theme).
function rootTokens(): Record<string, string> {
  const css = readFileSync('src/ui/styles.css', 'utf8');
  const root = css.match(/:root\s*\{([^}]*)\}/);
  if (!root || !root[1]) throw new Error('no :root block in src/ui/styles.css');
  const out: Record<string, string> = {};
  for (const m of root[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[m[1] ?? ''] = m[2] ?? '';
  }
  return out;
}

describe('dark theme contrast (WCAG AA, 4.5:1)', () => {
  const t = rootTokens();
  const pairs: [string, string, string][] = [
    ['text', 'surface', 'primary text on surface'],
    ['text-dim', 'surface', 'secondary text on surface'],
    ['accent-ink', 'accent', 'ink on accent (primary button)'],
  ];
  for (const [fg, bg, label] of pairs) {
    it(label, () => {
      const fgHex = t[fg];
      const bgHex = t[bg];
      expect(fgHex, `missing --${fg}`).toBeDefined();
      expect(bgHex, `missing --${bg}`).toBeDefined();
      const ratio = contrast(fgHex ?? '#000000', bgHex ?? '#ffffff');
      console.log(`${label}: ${ratio.toFixed(2)}:1`);
      expect(ratio, `${label} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  }
});
