/**
 * Compact text codec for per-parcel ids in the snapshot (MapTiles). Each value is two base-64 characters, so a
 * realm of 1024 parcels costs 2 KB of the snapshot budget. A value of -1, or one that does not fit (>= NONE), is
 * written as NONE and decodes to -1. Pure functions, shared by the sim (snapshot.ts) and the renderer.
 */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/';
const NONE = 64 * 64 - 1;

const CODE_OF: ReadonlyMap<string, number> = new Map<string, number>([...ALPHABET].map((ch, i): [string, number] => [ch, i]));

export function encodeParcels(values: readonly number[]): string {
  let out = '';
  for (const v of values) {
    const n = v < 0 || v >= NONE ? NONE : v;
    out += ALPHABET.charAt(Math.floor(n / 64)) + ALPHABET.charAt(n % 64);
  }
  return out;
}

export function decodeParcels(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < text.length; i += 2) {
    const hi = CODE_OF.get(text[i] ?? '') ?? 0;
    const lo = CODE_OF.get(text[i + 1] ?? '') ?? 0;
    const n = hi * 64 + lo;
    out.push(n === NONE ? -1 : n);
  }
  return out;
}
