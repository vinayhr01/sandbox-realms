/**
 * The contract every 3D map layer implements, and the registry the renderer builds them from.
 *
 * A layer module registers itself when it is imported: `registerLayer(() => new X3D())` at module scope. renderer3d.ts
 * imports each layer module once, so adding a layer is one import line there.
 */
import type * as THREE from 'three';
import type { FrameInput, ScreenPoint } from '../render/world-renderer.ts';
import type { HeightField } from './heights.ts';

export interface Layer3DContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  field: HeightField;
  renderer: THREE.WebGLRenderer;
  /** Projects a tile centre (x + 0.5, y + 0.5 at its height) to canvas CSS px, or null when behind the camera. */
  toScreen(x: number, y: number): ScreenPoint | null;
}

export interface Layer3D {
  readonly id: string;
  init(ctx: Layer3DContext): void;
  /** Called with the row indices whose tiles changed in applyRows. */
  onRows?(dirtyRows: ReadonlySet<number>): void;
  /** Called on a new realm and after a WebGL context restore: drop meshes of the old side and rebuild. */
  onSide?(side: number): void;
  frame(input: FrameInput, ctx: Layer3DContext): void;
  dispose(): void;
}

const factories: Array<() => Layer3D> = [];

/** Adds a layer to the registry. Called from a layer module at import time. */
export function registerLayer(make: () => Layer3D): void {
  factories.push(make);
}

/** The factories of every registered layer, in registration order. */
export function layerFactories(): readonly (() => Layer3D)[] {
  return factories;
}
