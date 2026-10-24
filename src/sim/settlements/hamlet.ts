import { ground } from '../../content/grounds.ts';
import type { Rng } from '../../shared/rng.ts';
import { BUILDINGS, BUILDING_BY_ID, type BuildingDef } from './catalogue.ts';

/** Parcels are 8x8 tiles (01 section 2). */
export const PARCEL = 8;

export interface Placed {
  def: BuildingDef;
  x: number;
  y: number;
}

export interface Hamlet {
  /** Parcel indices (py * parcelsPerAxis + px) owned by the hamlet. */
  parcels: Set<number>;
  food: number;
  wood: number;
  stone: number;
  folk: number;
  buildings: Placed[];
  /** Ticks until the next growth check. */
  growTimer: number;
}

/** Structural context: the hamlet step needs no Sim import. */
export interface HamletContext {
  realm: { side: number; ground: Uint8Array; flags: Uint16Array; cover: Uint8Array; flora: Uint8Array };
  rng: Rng;
  tick: number;
  /** Realm Rule lookup (rules.isOn). */
  isOn(id: string): boolean;
  /** True when another hamlet already owns the parcel; expansion must not take it. */
  claimed?: (parcel: number) => boolean;
}

/** Food the hamlet store holds before any granary is built (matches the starting stock). */
export const BASE_FOOD_STORE = 200;

export function createHamlet(parcelIndex: number, folk: number): Hamlet {
  return { parcels: new Set([parcelIndex]), food: BASE_FOOD_STORE, wood: 60, stone: 30, folk, buildings: [], growTimer: 0 };
}

/** Food capacity of the store: the base store plus the capacity each granary adds. */
export function foodCapacity(h: Hamlet): number {
  return BASE_FOOD_STORE + h.buildings.reduce((s, b) => s + (b.def.id === 'granary' ? b.def.foodCapacity : 0), 0);
}

/** True when a tile can carry a building: land (not water, molten, slime or blocked), no flora, free of other buildings. */
export function buildable(ctx: HamletContext, x: number, y: number, h: Hamlet): boolean {
  const side = ctx.realm.side;
  if (x < 0 || y < 0 || x >= side || y >= side) return false;
  const i = y * side + x;
  const kind = ground(ctx.realm.ground[i] ?? 0);
  if (kind.layer !== 'land' || kind.damages > 0) return false;
  if ((ctx.realm.flora[i] ?? 0) !== 0) return false;
  const p = Math.floor(y / PARCEL) * (side / PARCEL) + Math.floor(x / PARCEL);
  if (!h.parcels.has(p)) return false;
  for (const b of h.buildings) {
    if (x >= b.x && y >= b.y && x < b.x + b.def.footprint && y < b.y + b.def.footprint) return false;
    if (x === b.x && y === b.y) return false;
  }
  return true;
}

/** Tries to place a building of `def` in the first free spot of the hamlet's parcels (scan order). */
export function placeBuilding(ctx: HamletContext, h: Hamlet, def: BuildingDef): boolean {
  if (h.wood < def.wood || h.stone < def.stone) return false;
  const side = ctx.realm.side;
  const ordered = [...h.parcels].sort((a, b) => a - b);
  const perAxis = side / PARCEL;
  for (const p of ordered) {
    const px = (p % perAxis) * PARCEL;
    const py = Math.floor(p / perAxis) * PARCEL;
    for (let y = py; y <= py + PARCEL - def.footprint; y++) {
      for (let x = px; x <= px + PARCEL - def.footprint; x++) {
        let ok = true;
        for (let dy = 0; dy < def.footprint && ok; dy++) {
          for (let dx = 0; dx < def.footprint && ok; dx++) {
            ok = buildable(ctx, x + dx, y + dy, h);
          }
        }
        if (!ok) continue;
        h.wood -= def.wood;
        h.stone -= def.stone;
        h.buildings.push({ def, x, y });
        return true;
      }
    }
  }
  return false;
}

/** Extends the territory by one parcel next to an owned one, if the parcel is mostly land. */
export function expandTerritory(ctx: HamletContext, h: Hamlet): boolean {
  const side = ctx.realm.side;
  const perAxis = side / PARCEL;
  const candidates: number[] = [];
  for (const p of h.parcels) {
    const px = p % perAxis;
    const py = Math.floor(p / perAxis);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= perAxis || ny >= perAxis) continue;
      const q = ny * perAxis + nx;
      if (!h.parcels.has(q) && !candidates.includes(q) && !ctx.claimed?.(q)) candidates.push(q);
    }
  }
  candidates.sort((a, b) => a - b);
  for (const q of candidates) {
    let land = 0;
    for (let y = 0; y < PARCEL; y++) {
      for (let x = 0; x < PARCEL; x++) {
        const i = (Math.floor(q / perAxis) * PARCEL + y) * side + (q % perAxis) * PARCEL + x;
        if (ground(ctx.realm.ground[i] ?? 0).layer === 'land') land++;
      }
    }
    if (land >= 32) {
      h.parcels.add(q);
      return true;
    }
  }
  return false;
}

/**
 * One hamlet tick (09 sections 4-5, reduced). Every 100 ticks: folk eat from the store, the
 * population grows when food covers it and housing has room, and the hamlet builds the cheapest
 * useful building it can afford (house first while folk outnumber housing, then granary, then well).
 */
export function hamletStep(ctx: HamletContext, h: Hamlet): void {
  h.growTimer -= 1;
  if (h.growTimer > 0) return;
  h.growTimer = 100;
  const eaten = Math.min(h.food, h.folk);
  h.food -= eaten;
  if (h.food < h.folk) h.folk = Math.max(1, h.folk - 1);
  const housing = h.buildings.reduce((s, b) => s + b.def.housing, 0);
  if (ctx.isOn('folk_births') && h.food > h.folk * 2 && h.folk < housing && h.folk < 100) h.folk += 1;
  const granaries = h.buildings.filter((b) => b.def.id === 'granary').length;
  const wells = h.buildings.filter((b) => b.def.id === 'well').length;
  const houses = h.buildings.filter((b) => b.def.id === 'house').length;
  const wanted = h.folk > housing ? 'house' : granaries === 0 ? 'granary' : wells === 0 ? 'well' : houses < 4 ? 'house' : null;
  const def = wanted ? BUILDING_BY_ID.get(wanted) : undefined;
  // Territory grows only after an affordable building is actually placed.
  if (def && h.wood >= def.wood && h.stone >= def.stone && placeBuilding(ctx, h, def)) expandTerritory(ctx, h);
  // Wells yield food per step; granaries only raise the store cap. Yield stops at the cap; stock above it is kept.
  const cap = foodCapacity(h);
  if (h.food < cap) h.food = Math.min(h.food + h.buildings.reduce((s, b) => s + b.def.foodYield, 0), cap);
  h.wood += h.buildings.reduce((s, b) => s + b.def.woodYield, 0);
}

