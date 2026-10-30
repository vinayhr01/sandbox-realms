/**
 * Post-processing in 3D (spec "Settings visuals"): bloom (`map.bloom`) through three's EffectComposer, at night only. By
 * day, with bloom off, or under the ladder's map3d.post step, the frame is drawn directly. The composer path cost about
 * 6x a direct frame in software GL (750 vs 116 ms), so the vignette is a CSS overlay (renderer3d.ts) instead of a pass,
 * and the composer targets are not multisampled.
 * Renderer3D asks renderFrame() to draw the frame; the Layer3D frame() hook does nothing.
 *
 * Bloom follows the night: the physical sky is HDR, so by day bloom smeared it over the whole view as a white haze. Its
 * strength scales with the night amount, so it only lifts window glow and night lights.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { FrameInput } from '../render/world-renderer.ts';
import { DayClock } from '../render/day-clock.ts';
import { light01 } from '../shared/daytime.ts';
import { registerLayer, type Layer3D, type Layer3DContext } from './layer.ts';

/** Bloom strength at full night; it fades to 0 by day. */
const BLOOM_STRENGTH = 0.5;
const BLOOM_RADIUS = 0.4;
const BLOOM_THRESHOLD = 0.85;

/** True when bloom may draw this frame: the setting is on and neither the ladder nor map3d.post has turned it off. */
export function postActive(input: FrameInput): boolean {
  return input.map.bloom && !input.degradedOff.has('map.bloom') && !input.degradedOff.has('map3d.post');
}

export class Post3D implements Layer3D {
  readonly id = 'post';
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private readonly clock = new DayClock();

  init(ctx: Layer3DContext): void {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    const composer = new EffectComposer(ctx.renderer, target);
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    composer.addPass(new RenderPass(ctx.scene, ctx.camera));
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.bloom = bloom;
  }

  /** Draws the frame through the composer when post is active. Returns false when the caller should draw directly. */
  renderFrame(input: FrameInput): boolean {
    if (!this.composer || !this.bloom || !postActive(input)) return false;
    const night = 1 - light01(this.clock.update(input));
    if (night <= 0.05) return false;
    this.bloom.strength = BLOOM_STRENGTH * night;
    this.composer.render();
    return true;
  }

  /** Resizes the composer's targets to the drawing buffer (css size times the pixel ratio). */
  setSize(width: number, height: number, pixelRatio: number): void {
    if (!this.composer) return;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  frame(): void {}

  dispose(): void {
    this.composer?.dispose();
    this.bloom?.dispose();
    this.composer = null;
    this.bloom = null;
  }
}

registerLayer(() => new Post3D());
