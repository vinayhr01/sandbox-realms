/**
 * Which powers the UI can use today (12-powers-catalogue, 13 section 4). A power is enabled when its
 * handler is one the sim applies (src/sim/powers/handlers.ts executePower) or one the UI performs
 * itself. Every other power stays visible but disabled with a note. Pure data and functions.
 */
import type { PowerDef } from '../content/powers.ts';
import type { BrushOp } from '../shared/protocol.ts';
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
  'bless',
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

/** Handlers the UI carries out itself: pause, speed, windows, hiding the interface, and Realm Rules. */
export const UI_HANDLERS: readonly string[] = ['set_pause', 'cycle_speed', 'open_window', 'toggle_hud', 'toggle_rule'];

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
    const id = `win_${String(def.params['window'] ?? '')}`;
    return WINDOW_IDS.has(id) ? ok() : off(def);
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

/** Remaining cooldown in whole seconds (rounded up); 0 when ready. */
export function cooldownSecondsLeft(now: number, readyAt: number): number {
  return now >= readyAt ? 0 : Math.ceil((readyAt - now) / 1000);
}
