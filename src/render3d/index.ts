/**
 * Entry point of the lazy render3d chunk. main.ts imports this module only when the 3D view is chosen, and falls back to
 * the 2D view when it throws.
 */
import type { WorldRenderer } from '../render/world-renderer.ts';
import { Renderer3D } from './renderer3d.ts';

export async function createRenderer3D(host: HTMLElement): Promise<WorldRenderer> {
  return new Renderer3D(host);
}
