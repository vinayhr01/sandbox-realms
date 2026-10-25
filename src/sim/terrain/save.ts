import type { Sim } from '../sim.ts';
import { terrainState, type FloraJob, type Quake, type Vent } from './state.ts';

/** Quake footprint offsets reach at most this far from the origin (quake.ts HALF). */
export const QUAKE_REACH = 60;

/** One flora spread job as saved: its flora kind, the next expiry tick, the queue and the cursor into it. */
export interface FloraJobSave {
  kind: string;
  next: number;
  queue: number[];
  cursor: number;
}

/** Vent, quake and flora spread state that a Chronicle carries (04 sections 7.2, 9 and 10). Creep hubs are saved with the settlements. */
export interface TerrainSave {
  vents: Vent[];
  quake: Quake | null;
  shapeOrder: number[];
  shapeCursor: number;
  /** Flora spread jobs, in the order the sim holds them. Absent in older terrain sections: those load with none. */
  floraJobs: FloraJobSave[];
}

/** Copies the vents, the quake in progress, the fissure shape cycle and the flora spread jobs out of the sim. */
export function snapshotTerrain(sim: Sim): TerrainSave {
  const s = terrainState(sim);
  return {
    vents: s.vents.map((v) => ({ ...v })),
    quake: s.quake ? { ...s.quake, steps: [...s.quake.steps] } : null,
    shapeOrder: [...s.shapeOrder],
    shapeCursor: s.shapeCursor,
    floraJobs: [...s.floraJobs.entries()].map(([kind, j]) => ({ kind, next: j.next, queue: [...j.queue], cursor: j.cursor })),
  };
}

/** Puts a checked terrain save back into the sim. The caller has checked the shapes (chronicle.ts checkTerrain). */
export function restoreTerrain(sim: Sim, snap: TerrainSave): void {
  const s = terrainState(sim);
  s.vents = snap.vents.map((v) => ({ ...v }));
  s.quake = snap.quake ? { ...snap.quake, steps: [...snap.quake.steps] } : null;
  s.shapeOrder = [...snap.shapeOrder];
  s.shapeCursor = snap.shapeCursor;
  s.floraJobs = new Map<string, FloraJob>(snap.floraJobs.map((j): [string, FloraJob] => [j.kind, { next: j.next, queue: [...j.queue], cursor: j.cursor }]));
}

/**
 * Whether the terrain state holds anything a save must keep. Default state writes no section. A flora spread job
 * counts: its expiry tick is state, so a realm that has run the spread keeps it (a job rebuilt on load would start its timer late).
 */
export function terrainHasState(sim: Sim): boolean {
  const s = terrainState(sim);
  return s.vents.length > 0 || s.quake !== null || s.shapeOrder.length > 0 || s.floraJobs.size > 0;
}
