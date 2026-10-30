import type { WorldRenderer } from '../render/world-renderer.ts';

/** The 3D view (three.js). Task 3 replaces this stub with the real renderer; until then 3D always fails, which tests the 2D fallback. */
export async function createRenderer3D(_host: HTMLElement): Promise<WorldRenderer> {
  throw new Error('3D renderer not built yet');
}
