/**
 * Deploy effects in 3D (spec "Effects"): the 2D recipes (render/effects.ts RECIPES) played as point particles at the height
 * of their tile. One Points object draws a pool of MAX_PARTICLES; over the cap the next slot is reused, as in 2D. The
 * particle timing, the reduce-motion ring and the stroke-puff throttle are the 2D ones. Each burst shape is a point sprite
 * drawn in the shader (dot, ring, streak, puff, sparkle).
 */
import * as THREE from 'three';
import type { RecipeId } from '../render/effectRecipes.ts';
import { FADE_MS, MAX_PARTICLES, RECIPES, STROKE_PUFF_MS, type Burst } from '../render/effect-table.ts';
import type { FrameInput } from '../render/world-renderer.ts';
import type { HeightField } from './heights.ts';
import { registerLayer, type Layer3D, type Layer3DContext } from './layer.ts';

/** The 2D effects work in px at 16 px per tile; the 3D particles convert those px to tiles the same way. */
const PX_PER_TILE = 16;
/** Height above the ground at which particles spawn, in tiles. */
const LIFT = 0.15;
const SHAPE_ID: Readonly<Record<Burst['shape'], number>> = { dot: 0, ring: 1, streak: 2, puff: 3, sparkle: 4 };

interface Particle {
  active: boolean;
  shape: number;
  tx: number;
  ty: number;
  sizeTiles: number;
  /** Offset from the tile centre at birth, px. */
  ox: number;
  oy: number;
  /** Milliseconds since birth; negative while the burst is delayed. */
  age: number;
  delayMs: number;
  lifeMs: number;
  size0: number;
  size1: number;
  dy: number;
  flash: boolean;
  colour: number;
}

export interface Effects3DOptions {
  /** Reads the reduce-motion setting (defaults to the `data-reduce-motion` attribute). */
  reduceMotion?: () => boolean;
  /** Reads the reduce-flash setting (defaults to the `data-reduce-flash` attribute). */
  reduceFlash?: () => boolean;
}

function domFlag(name: string): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute(name);
}

/** A small deterministic generator, as in the 2D layer, so each burst's spread repeats on every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The bursts a recipe plays. Reduce motion turns each into one fading ring, as the 2D layer does. */
function burstsFor(id: RecipeId, reduceMotion: boolean): readonly Burst[] {
  if (!reduceMotion) return RECIPES[id].bursts;
  if (id === 'rule') return [];
  const colour = RECIPES[id].bursts[0]?.colour ?? 0xffffff;
  return [{ shape: 'ring', colour, count: 1, delayMs: 0, lifeMs: FADE_MS, size0: 20, size1: 20, spread: 0, dy: 0 }];
}

const VERTEX = /* glsl */ `
attribute float size;
attribute vec4 aColour;
attribute float aShape;
uniform float uScale;
varying vec4 vColour;
varying float vShape;
void main() {
  vColour = aColour;
  vShape = aShape;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / max(-mv.z, 0.01);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = /* glsl */ `
varying vec4 vColour;
varying float vShape;
void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float d = length(c) * 2.0;
  float a;
  if (vShape < 0.5) a = 1.0 - smoothstep(0.7, 1.0, d);
  else if (vShape < 1.5) a = 1.0 - smoothstep(0.0, 0.12, abs(d - 0.7));
  else if (vShape < 2.5) a = (abs(c.x) < 0.12 && d < 1.0) ? 1.0 : 0.0;
  else if (vShape < 3.5) a = (1.0 - smoothstep(0.2, 1.0, d)) * 0.7;
  else a = 1.0 - smoothstep(0.5, 1.0, d);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(vColour.rgb, vColour.a * a);
}
`;

export class Effects3D implements Layer3D {
  readonly id = 'effects';
  private readonly slots: Particle[] = [];
  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly colours = new Float32Array(MAX_PARTICLES * 4);
  private readonly sizes = new Float32Array(MAX_PARTICLES);
  private readonly shapes = new Float32Array(MAX_PARTICLES);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly uScale = { value: 1 };
  private readonly material: THREE.ShaderMaterial;
  private readonly points: THREE.Points;
  private readonly reduceMotion: () => boolean;
  private readonly reduceFlash: () => boolean;
  private readonly random = rng(0x5eed);
  private field: HeightField | null = null;
  /** Next slot to reuse when every slot is busy. */
  private next = 0;
  private live = 0;
  private enabled = true;
  /** Frame time summed from update(); the stroke puff throttle reads it, so tests need no clock. */
  private clockMs = 0;
  private lastStrokePuffMs = -STROKE_PUFF_MS;

  constructor(options: Effects3DOptions = {}) {
    this.reduceMotion = options.reduceMotion ?? (() => domFlag('data-reduce-motion'));
    this.reduceFlash = options.reduceFlash ?? (() => domFlag('data-reduce-flash'));
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.slots.push({ active: false, shape: 0, tx: 0, ty: 0, sizeTiles: 1, ox: 0, oy: 0, age: 0, delayMs: 0, lifeMs: 1, size0: 0, size1: 0, dy: 0, flash: false, colour: 0xffffff });
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aColour', new THREE.BufferAttribute(this.colours, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aShape', new THREE.BufferAttribute(this.shapes, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uScale: this.uScale },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  init(ctx: Layer3DContext): void {
    this.field = ctx.field;
    ctx.scene.add(this.points);
  }

  /** Turns the layer on or off (the ladder's map.effects step). Off clears what is showing. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.clear();
  }

  /** Plays a recipe at a tile. `sizeTiles` scales the burst (the brush radius for a brush power). */
  play(id: RecipeId, tileX: number, tileY: number, sizeTiles: number): void {
    if (!this.enabled) return;
    const reduceFlash = this.reduceFlash();
    for (const burst of burstsFor(id, this.reduceMotion())) {
      if (burst.flash && reduceFlash) continue;
      for (let i = 0; i < burst.count; i++) {
        const p = this.acquire();
        const angle = this.random() * Math.PI * 2;
        const reach = this.random() * burst.spread;
        p.shape = SHAPE_ID[burst.shape];
        p.tx = tileX;
        p.ty = tileY;
        p.ox = Math.cos(angle) * reach;
        p.oy = Math.sin(angle) * reach;
        p.age = -burst.delayMs;
        p.delayMs = burst.delayMs;
        p.lifeMs = burst.lifeMs;
        p.size0 = burst.size0;
        p.size1 = burst.size1;
        p.dy = burst.dy;
        p.flash = burst.flash === true;
        p.colour = burst.colour;
        p.sizeTiles = sizeTiles;
      }
    }
  }

  /** A stroke puff, at most one per STROKE_PUFF_MS, and none under reduce motion (as the 2D layer). */
  playStroke(id: RecipeId, tileX: number, tileY: number, sizeTiles: number): void {
    if (!this.enabled || this.reduceMotion()) return;
    if (this.clockMs - this.lastStrokePuffMs < STROKE_PUFF_MS) return;
    this.lastStrokePuffMs = this.clockMs;
    this.play(id, tileX, tileY, sizeTiles);
  }

  /** Particles alive now (the cap is MAX_PARTICLES). */
  liveCount(): number {
    return this.live;
  }

  /** Hides and frees every particle. */
  clear(): void {
    for (const p of this.slots) p.active = false;
    this.live = 0;
    this.write();
  }

  /** Ages the live particles by dtMs and writes the buffers. */
  update(dtMs: number): void {
    this.clockMs += dtMs;
    if (this.live > 0) {
      for (const p of this.slots) {
        if (!p.active) continue;
        p.age += dtMs;
        if (p.age >= p.lifeMs) {
          p.active = false;
          this.live--;
        }
      }
    }
    this.write();
  }

  frame(input: FrameInput, ctx: Layer3DContext): void {
    this.setEnabled(!input.degradedOff.has('map.effects'));
    // Converts a world size at distance 1 to device px: half the viewport height over tan(fov / 2).
    const half = Math.tan((ctx.camera.fov * Math.PI) / 360);
    this.uScale.value = half > 0 ? ctx.renderer.domElement.height / (2 * half) : 1;
    this.update(input.dtMs);
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.field = null;
  }

  /** Gets a free particle, or reuses the next slot when every one is busy. */
  private acquire(): Particle {
    for (let n = 0; n < MAX_PARTICLES; n++) {
      const candidate = this.slots[(this.next + n) % MAX_PARTICLES];
      if (candidate && !candidate.active) {
        this.next = (this.next + n + 1) % MAX_PARTICLES;
        candidate.active = true;
        this.live++;
        return candidate;
      }
    }
    const reused = this.slots[this.next];
    this.next = (this.next + 1) % MAX_PARTICLES;
    if (!reused) throw new Error('effects pool is empty');
    if (!reused.active) {
      reused.active = true;
      this.live++;
    }
    return reused;
  }

  /** Copies the particles into the buffers. Hidden or delayed slots draw nothing (zero alpha and size). */
  private write(): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.slots[i];
      const o3 = i * 3;
      const o4 = i * 4;
      if (!p || !p.active || p.age < 0) {
        this.colours[o4 + 3] = 0;
        this.sizes[i] = 0;
        continue;
      }
      const k = p.age / p.lifeMs;
      const grow = Math.min(3, Math.max(0.6, p.sizeTiles));
      const reach = 0.3 + 0.7 * k;
      const field: HeightField | null = this.field;
      const ground = field ? field.heightAt(p.tx + 0.5, p.ty + 0.5) : 0;
      this.positions[o3] = p.tx + 0.5 + (p.ox * reach * grow) / PX_PER_TILE;
      this.positions[o3 + 1] = ground + LIFT - (p.dy * k) / PX_PER_TILE;
      this.positions[o3 + 2] = p.ty + 0.5 + (p.oy * reach * grow) / PX_PER_TILE;
      const px = p.size0 + (p.size1 - p.size0) * k;
      this.sizes[i] = (px / PX_PER_TILE) * grow;
      this.shapes[i] = p.shape;
      this.colours[o4] = ((p.colour >> 16) & 255) / 255;
      this.colours[o4 + 1] = ((p.colour >> 8) & 255) / 255;
      this.colours[o4 + 2] = (p.colour & 255) / 255;
      this.colours[o4 + 3] = (p.flash ? 0.45 : 1) * (1 - k);
    }
    for (const name of ['position', 'aColour', 'size', 'aShape'] as const) {
      const attr = this.geometry.getAttribute(name);
      attr.needsUpdate = true;
    }
  }
}

registerLayer(() => new Effects3D());
