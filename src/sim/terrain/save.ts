import type { Sim } from '../sim.ts';
import { terrainState, type Quake, type Vent } from './state.ts';

/** Quake footprint offsets reach at most this far from the origin (quake.ts HALF). */
export const QUAKE_REACH = 60;

/** Vent and quake state that a Chronicle carries (04 sections 7.2 and 9). Creep hubs are saved with the settlements. */
export interface TerrainSave {
  vents: Vent[];
  quake: Quake | null;
  shapeOrder: number[];
  shapeCursor: number;
}

/** Copies the vents, the quake in progress and the fissure shape cycle out of the sim. */
export function snapshotTerrain(sim: Sim): TerrainSave {
  const s = terrainState(sim);
  return {
    vents: s.vents.map((v) => ({ ...v })),
    quake: s.quake ? { ...s.quake, steps: [...s.quake.steps] } : null,
    shapeOrder: [...s.shapeOrder],
    shapeCursor: s.shapeCursor,
  };
}

/** Puts a checked terrain save back into the sim. The caller has checked the shapes (chronicle.ts checkTerrain). */
export function restoreTerrain(sim: Sim, snap: TerrainSave): void {
  const s = terrainState(sim);
  s.vents = snap.vents.map((v) => ({ ...v }));
  s.quake = snap.quake ? { ...snap.quake, steps: [...snap.quake.steps] } : null;
  s.shapeOrder = [...snap.shapeOrder];
  s.shapeCursor = snap.shapeCursor;
}

/** Whether the terrain state holds anything a save must keep. Default state writes no section. */
export function terrainHasState(sim: Sim): boolean {
  const s = terrainState(sim);
  return s.vents.length > 0 || s.quake !== null || s.shapeOrder.length > 0;
}
