/**
 * Glyph icons for the powers that have no creature art (UX redesign, spec B). One line-drawn shape per chip, with a few
 * overrides where a power is easier to read by its own shape. Drawn on a 24-unit grid, in currentColor.
 */
import type { PowerDef } from '../../content/powers.ts';
import { chipOf, type ChipId } from './powerCatalog.ts';

const CHIP_PATH: Readonly<Record<ChipId, string>> = {
  land: 'M2 20 L9 8 L13 14 L16 10 L22 20 Z',
  nature: 'M12 3 C17 7 18 12 12 21 C6 12 7 7 12 3 Z M12 21 V11',
  creatures: 'M8 14 C8 11 16 11 16 14 C16 18 8 18 8 14 Z M5 10 L6 7 M10 7 L10.5 4 M14 7 L13.5 4 M19 10 L18 7',
  weather: 'M7 18 A4 4 0 0 1 7 10 A5 5 0 0 1 16.6 9 A4 4 0 0 1 18 18 Z',
  disasters: 'M13 2 L4 14 H11 L9 22 L20 9 H13 Z',
  blessings: 'M12 2 L14 9 L21 12 L14 15 L12 22 L10 15 L3 12 L10 9 Z',
  peoples: 'M3 11 L12 4 L21 11 M5 10 V20 H19 V10',
  inspect: 'M10 4 A6 6 0 1 0 10 16 A6 6 0 1 0 10 4 Z M15 15 L21 21',
  windows: 'M4 4 H10 V10 H4 Z M14 4 H20 V10 H14 Z M4 14 H10 V20 H4 Z M14 14 H20 V20 H14 Z',
};

const POWER_PATH: Readonly<Record<string, string>> = {
  shape_raise: 'M12 4 L19 13 H14 V20 H10 V13 H5 Z',
  shape_lower: 'M12 20 L19 11 H14 V4 H10 V11 H5 Z',
  ins_inspect: CHIP_PATH.inspect,
  sky_warm: 'M12 7 A5 5 0 1 0 12 17 A5 5 0 1 0 12 7 Z M12 2 V4 M12 20 V22 M2 12 H4 M20 12 H22',
  sky_chill: 'M12 2 V22 M4 7 L20 17 M20 7 L4 17',
  sky_rain: 'M8 13 Q12 6 16 13 A4 4 0 0 1 8 13 Z M12 3 V5',
  sky_snow: 'M12 2 V22 M3 12 H21 M5 5 L19 19 M19 5 L5 19',
  sky_ignite: 'M12 3 C15 8 18 10 17 15 A5 5 0 0 1 7 15 C7 11 9 9 10 7 C11 9 12 9 12 9 C12 7 12 5 12 3 Z',
  sky_quench: 'M12 3 C15 8 18 10 17 15 A5 5 0 0 1 7 15 C7 11 9 9 10 7 Z',
};

/** Terrain ground paints (brush powers on the Land chip) share one wave. */
const GROUND_PATH = 'M3 15 Q7.5 11 12 15 T21 15';

export function glyphPath(power: PowerDef): string {
  const override = POWER_PATH[power.id];
  if (override) return override;
  if (power.tab === 'shape') return GROUND_PATH;
  const chip = chipOf(power);
  return CHIP_PATH[chip ?? 'windows'];
}

/** The icon of a power without creature art: a line glyph in currentColor. */
export function PowerGlyph({ power }: { power: PowerDef }) {
  return (
    <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={glyphPath(power)} />
    </svg>
  );
}
