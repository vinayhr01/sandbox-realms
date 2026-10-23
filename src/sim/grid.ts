/** Neighbour helpers over a square grid, in fixed order so sweeps stay deterministic. */
export const N4X = [0, 1, 0, -1] as const;
export const N4Y = [-1, 0, 1, 0] as const;
export const N8X = [-1, 0, 1, -1, 1, -1, 0, 1] as const;
export const N8Y = [-1, -1, -1, 0, 0, 1, 1, 1] as const;

/** Index of the n4 neighbour k of tile i, or -1 when off the grid. */
export function n4(i: number, side: number, k: number): number {
  const x = (i % side) + (N4X[k] ?? 0);
  const y = Math.floor(i / side) + (N4Y[k] ?? 0);
  if (x < 0 || y < 0 || x >= side || y >= side) return -1;
  return y * side + x;
}

export function n8(i: number, side: number, k: number): number {
  const x = (i % side) + (N8X[k] ?? 0);
  const y = Math.floor(i / side) + (N8Y[k] ?? 0);
  if (x < 0 || y < 0 || x >= side || y >= side) return -1;
  return y * side + x;
}
