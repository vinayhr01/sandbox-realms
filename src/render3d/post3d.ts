/**
 * Post-processing in 3D (spec "Settings visuals"): bloom (`map.bloom`) and vignette (`map.vignette`) through three's
 * EffectComposer. When both are off, or the ladder's map3d.post step is on, the frame is drawn directly with no composer.
 * Renderer3D asks renderFrame() to draw the frame; the Layer3D frame() hook does nothing.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import type { FrameInput } from '../render/world-renderer.ts';
import { registerLayer, type Layer3D, type Layer3DContext } from './layer.ts';

const BLOOM_STRENGTH = 0.5;
const BLOOM_RADIUS = 0.4;
const BLOOM_THRESHOLD = 0.85;

/** True when the composer should draw this frame: bloom or vignette is on and the ladder has not turned post off. */
export function postActive(input: FrameInput): boolean {
  const bloom = input.map.bloom && !input.degradedOff.has('map.bloom');
  return (bloom || input.map.vignette) && !input.degradedOff.has('map3d.post');
}

export class Post3D implements Layer3D {
  readonly id = 'post';
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private vignette: ShaderPass | null = null;

  init(ctx: Layer3DContext): void {
    const composer = new EffectComposer(ctx.renderer);
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    const vignette = new ShaderPass(VignetteShader);
    composer.addPass(new RenderPass(ctx.scene, ctx.camera));
    composer.addPass(bloom);
    composer.addPass(vignette);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.bloom = bloom;
    this.vignette = vignette;
  }

  /** Draws the frame through the composer when post is active. Returns false when the caller should draw directly. */
  renderFrame(input: FrameInput): boolean {
    if (!this.composer || !this.bloom || !this.vignette || !postActive(input)) return false;
    this.bloom.enabled = input.map.bloom && !input.degradedOff.has('map.bloom');
    this.vignette.enabled = input.map.vignette;
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
    this.vignette = null;
  }
}

registerLayer(() => new Post3D());
