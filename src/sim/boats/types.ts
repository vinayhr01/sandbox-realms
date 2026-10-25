/**
 * Boat kinds and their numbers (10 section 13). Costs are wood, iron and gold. The hamlet holds no iron
 * (see catalogue.ts), so a transport boat (iron 2) cannot be paid for and is never built in this sim.
 * `speed` is the spec number; movement is speed / SPEED_PER_TILE tiles per sim-second (TUNE: the spec
 * gives no unit). Boats have no combat in this sim, so `attack` records the spec flag only.
 */
export type BoatKind = 'trading' | 'transport' | 'fishing';

export interface BoatTypeDef {
  kind: BoatKind;
  hp: number;
  speed: number;
  wood: number;
  iron: number;
  gold: number;
  attack: boolean;
}

export const BOAT_TYPES: readonly BoatTypeDef[] = [
  { kind: 'trading', hp: 200, speed: 30, wood: 10, iron: 0, gold: 10, attack: true },
  { kind: 'transport', hp: 1000, speed: 25, wood: 5, iron: 2, gold: 20, attack: false },
  { kind: 'fishing', hp: 100, speed: 10, wood: 5, iron: 0, gold: 5, attack: false },
];

export const BOAT_TYPE_BY_KIND: ReadonlyMap<BoatKind, BoatTypeDef> = new Map(BOAT_TYPES.map((t) => [t.kind, t]));

/** Spec speed units per tile per sim-second (TUNE). */
export const SPEED_PER_TILE = 10;
