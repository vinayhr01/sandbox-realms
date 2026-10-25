/**
 * Which powers the UI can use today (12-powers-catalogue, 13 section 4). A power is enabled when its
 * handler is one the sim applies (src/sim/powers/handlers.ts executePower) or one the UI performs
 * itself. Every other power stays visible but disabled with a note. Pure data and functions.
 */
import type { PowerDef } from '../content/powers.ts';
import type { BrushOp, MapTiles } from '../shared/protocol.ts';
import { decodeParcels } from '../shared/parcel-codec.ts';
import { WINDOW_IDS } from './windowCatalog.ts';

/** Handlers that src/sim/powers/handlers.ts executePower applies. tests/unit/ui-powers.test.ts checks this list against that file. */
export const SIM_HANDLERS: readonly string[] = [
  'terraform_raise',
  'terraform_lower',
  'paint_ground',
  'spawn_being',
  'bomb',
  'bolt',
  'calamity',
  'seed_biome',
  'plant_flora',
  'drop_rain',
  'drop_freeze',
  'start_fire',
  'quench',
  'add_heat',
  'start_volcano',
  'start_geyser',
  'place_creep_hub',
  'place_structure',
  'bless',
  'hex_cast',
  'lore',
  'favour_status',
  'favour_surge',
  'favour_mood',
  'favour_trait',
  'favour_trait_random',
  'favour_sleep',
  'favour_unweave',
  'favour_cleanse',
  'favour_purify',
  'favour_foundling',
  'favour_wake',
  'favour_items',
  'favour_loot',
];

/**
 * Handlers the UI carries out itself: pause, speed, windows, hiding the interface, Realm Rules, the
 * Insight view controls (arm inspect, follow a being, flip or cycle a display option).
 */
export const UI_HANDLERS: readonly string[] = [
  'set_pause',
  'cycle_speed',
  'open_window',
  'toggle_hud',
  'toggle_rule',
  'arm_inspect',
  'follow',
  'toggle_option',
  'cycle_option',
  'select_hamlet',
  'select_dominion',
  'layer_toggle',
  'toggle_view',
];

/**
 * Insight view flags (UI only, held for the session, not saved). Arrow kinds A01..A07 and the two tip kinds start on;
 * the history ticker (O07) starts off. The Settings masters ui.cursorArrows and ui.worldTooltips gate the arrows and tips.
 */
export const VIEW_FLAGS_ON_BY_DEFAULT: readonly string[] = [
  'arrow.destination',
  'arrow.home',
  'arrow.partner',
  'arrow.family',
  'arrow.parents',
  'arrow.children',
  'arrow.attack',
  'tip.tiles',
  'tip.beings',
];

/** A fresh set of view flags at their defaults. */
export function viewFlagsDefault(): Set<string> {
  return new Set(VIEW_FLAGS_ON_BY_DEFAULT);
}

/** Flips one view flag and returns its new state. */
export function toggleViewFlag(flags: Set<string>, key: string): boolean {
  if (flags.has(key)) {
    flags.delete(key);
    return false;
  }
  flags.add(key);
  return true;
}

/** The Settings master a view flag depends on (ui.cursorArrows for arrows, ui.worldTooltips for tips), or null. */
export function masterOfViewFlag(key: string): string | null {
  if (key.startsWith('arrow.')) return 'ui.cursorArrows';
  if (key.startsWith('tip.')) return 'ui.worldTooltips';
  return null;
}

/** Powers whose drag is a stroke that the sim's raise and lower brush applies. */
const STROKE_OPS: Readonly<Record<string, BrushOp>> = { terraform_raise: 'raise', terraform_lower: 'lower' };

export function strokeOp(def: PowerDef | null): BrushOp | null {
  return def ? (STROKE_OPS[def.handler] ?? null) : null;
}

export interface PowerStatus {
  enabled: boolean;
  /** Shown when the player taps a disabled power. Empty when enabled. */
  note: string;
}

export function powerStatus(def: PowerDef): PowerStatus {
  if (def.handler === 'open_window') {
    // `window` is a full window id (win_* or list_*, 13 section 7.1), the same id the window host uses.
    const id = String(def.params['window'] ?? '');
    return WINDOW_IDS.has(id) ? ok() : off(def);
  }
  if (def.handler === 'possess') {
    // Possession needs the beings command (not on main yet): the row stays visible and disabled until it lands.
    return { enabled: false, note: `${def.name} waits on the beings possession command, which is not on main yet.` };
  }
  if (SIM_HANDLERS.includes(def.handler) || UI_HANDLERS.includes(def.handler)) return ok();
  return off(def);
}

function ok(): PowerStatus {
  return { enabled: true, note: '' };
}

function off(def: PowerDef): PowerStatus {
  return { enabled: false, note: `${def.name} is not available yet: the system behind it is not built.` };
}

/** Tiles on the straight line from (x0,y0) to (x1,y1), both ends included (integer Bresenham). */
export function linePoints(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let x = Math.round(x0);
  let y = Math.round(y0);
  const tx = Math.round(x1);
  const ty = Math.round(y1);
  const dx = Math.abs(tx - x);
  const dy = -Math.abs(ty - y);
  const sx = x < tx ? 1 : -1;
  const sy = y < ty ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    points.push([x, y]);
    if (x === tx && y === ty) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
}

/** Next value of a cycled option: the entry after `current` in `values` (wraps); the first value when `current` is not listed. */
export function nextOptionValue(current: string, values: readonly string[]): string {
  if (values.length === 0) return current;
  const at = values.indexOf(current);
  return values[(at + 1) % values.length] ?? values[0] ?? current;
}

/**
 * The map point nearest to a screen point, within `radiusPx`, or null. Uses the same tile-to-screen
 * mapping as the mark layer (src/render/marks.ts): the point sits at the centre of its tile.
 */
export function nearestMapPoint<P extends { x: number; y: number }>(
  points: readonly P[],
  view: { offX: number; offY: number; zoom: number },
  sx: number,
  sy: number,
  radiusPx: number,
): P | null {
  let best: P | null = null;
  let bestD2 = radiusPx * radiusPx;
  for (const p of points) {
    const dx = view.offX + (p.x + 0.5) * view.zoom - sx;
    const dy = view.offY + (p.y + 0.5) * view.zoom - sy;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      best = p;
      bestD2 = d2;
    }
  }
  return best;
}

/** Index of the parcel holding tile (x, y), row-major as in MapTiles, or -1 off the realm. */
export function parcelOfTile(tiles: Pick<MapTiles, 'size' | 'perAxis'>, x: number, y: number): number {
  const col = Math.floor(x / tiles.size);
  const row = Math.floor(y / tiles.size);
  if (col < 0 || row < 0 || col >= tiles.perAxis || row >= tiles.perAxis) return -1;
  return row * tiles.perAxis + col;
}

/** Index (hamletsOf order, as in the snapshot's hamlet list) of the hamlet owning tile (x, y), or -1 when none. */
export function hamletAtTile(tiles: MapTiles | undefined, x: number, y: number): number {
  if (!tiles) return -1;
  const p = parcelOfTile(tiles, x, y);
  if (p < 0) return -1;
  return decodeParcels(tiles.hamlet)[p] ?? -1;
}

/** Id of the dominion owning tile (x, y) (the dominion id the snapshot's ties use), or -1 when none. */
export function dominionAtTile(tiles: MapTiles | undefined, x: number, y: number): number {
  if (!tiles) return -1;
  const p = parcelOfTile(tiles, x, y);
  if (p < 0) return -1;
  return decodeParcels(tiles.dominion)[p] ?? -1;
}

/** Remaining cooldown in whole seconds (rounded up); 0 when ready. */
export function cooldownSecondsLeft(now: number, readyAt: number): number {
  return now >= readyAt ? 0 : Math.ceil((readyAt - now) / 1000);
}
