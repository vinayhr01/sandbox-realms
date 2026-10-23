/**
 * Ground kinds for M0/M1 (01 section 4). Keys, colours and elevation bands follow 18c section 1;
 * only the kinds needed for terrain painting are listed here, the rest arrive with their systems.
 * Ids are the byte value stored in the `ground` array; table order defines the ids.
 */
export interface GroundKind {
  id: number;
  key: string;
  /** Elevation at or above which this ground is chosen when derived from height (TUNE). */
  minElevation: number | null;
  color: string;
  liquid: boolean;
  sea: boolean;
  /** Walk speed multiplier for beings (01 section 4). */
  walkMult: number;
}

export const GROUNDS: readonly GroundKind[] = [
  { id: 0, key: 'deepmere', minElevation: 0, color: '#2E67BD', liquid: true, sea: true, walkMult: 0.1 },
  { id: 1, key: 'midmere', minElevation: 35, color: '#3B7DD4', liquid: true, sea: true, walkMult: 0.1 },
  { id: 2, key: 'shoal', minElevation: 75, color: '#5BB4F2', liquid: true, sea: true, walkMult: 0.1 },
  { id: 3, key: 'dug_deepmere', minElevation: null, color: '#878787', liquid: false, sea: false, walkMult: 1 },
  { id: 4, key: 'dug_midmere', minElevation: null, color: '#A3A3A3', liquid: false, sea: false, walkMult: 1 },
  { id: 5, key: 'dug_shoal', minElevation: null, color: '#C4C4C4', liquid: false, sea: false, walkMult: 1 },
  { id: 6, key: 'strand', minElevation: 101, color: '#F2E39A', liquid: false, sea: false, walkMult: 0.55 },
  { id: 7, key: 'lowloam', minElevation: 112, color: '#DE9650', liquid: false, sea: false, walkMult: 1 },
  { id: 8, key: 'highloam', minElevation: 133, color: '#B26B38', liquid: false, sea: false, walkMult: 1 },
  { id: 9, key: 'knoll', minElevation: 197, color: '#5E605E', liquid: false, sea: false, walkMult: 1 },
  { id: 10, key: 'crag', minElevation: 213, color: '#3F4444', liquid: false, sea: false, walkMult: 0.5 },
  { id: 11, key: 'pinnacle', minElevation: 233, color: '#303030', liquid: false, sea: false, walkMult: 0.5 },
];

export const GROUND_COUNT = GROUNDS.length;

/** Looks up a ground id's key; unknown ids return 'unknown' (never throws in the render path). */
export function groundKey(id: number): string {
  return GROUNDS[id]?.key ?? 'unknown';
}

/**
 * Precomputed elevation -> ground id table (256 entries). A tile gets the kind whose
 * minElevation is the greatest value <= elevation (01 section 4).
 */
export const GROUND_BY_ELEVATION: Uint8Array = (() => {
  const table = new Uint8Array(256);
  for (let e = 0; e < 256; e++) {
    let best = 0;
    let bestMin = -1;
    for (const g of GROUNDS) {
      if (g.minElevation !== null && g.minElevation <= e && g.minElevation > bestMin) {
        best = g.id;
        bestMin = g.minElevation;
      }
    }
    table[e] = best;
  }
  return table;
})();
