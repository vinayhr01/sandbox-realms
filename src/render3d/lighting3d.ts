/**
 * Light in 3D (spec "3D lighting", "Tone and colour"): the sun, a cool moonlight, a hemisphere light for sky and ground,
 * shadow maps, night window glow on buildings and a cursor light. The sun, moon and night amount come from the sim's day
 * phase (src/shared/daytime.ts, via DayClock in sky3d.ts), so the light always agrees with the sky and the sim.
 */
import * as THREE from 'three';
import type { MapBuilding } from '../shared/protocol.ts';
import type { FrameInput } from '../render/world-renderer.ts';
import type { HeightField } from './heights.ts';
import { DayClock, fogColour, moonDirection, nightAmount, sunDirection, type Vec3 } from './sky3d.ts';
import { registerLayer, type Layer3D, type Layer3DContext } from './layer.ts';

/** Shadow map edge in texels (spec: 1024 squared). */
const SHADOW_PX = 1024;
/** Shadows cover this many tiles either side of the camera. The spec asks for 64 tiles around the focus. */
const SHADOW_HALF_TILES = 32;
/** Distance of the sun from its target, in tiles. Only the direction matters for a directional light. */
const SUN_DISTANCE = 40;
/** The window glow sits this high above the ground, in tiles. */
const GLOW_HEIGHT = 0.7;
const CURSOR_HEIGHT = 1.2;
/** Sun colour: warm at the horizon, white by noon. */
const SUN_WARM: Vec3 = [1, 0.62, 0.36];
const SUN_WHITE: Vec3 = [1, 0.96, 0.9];
const MOON_COLOUR = 0xa8c0ff;
const GROUND_COLOUR = 0x3d3526;

export interface LightState {
  /** Unit vector from the target towards the sun. */
  sunDir: Vec3;
  /** Linear-ish RGB of the sun, 0..1. */
  sunColour: Vec3;
  sunIntensity: number;
  moonIntensity: number;
  hemiIntensity: number;
  /** 0 by day, 1 at the darkest part of the night. */
  night: number;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** The light for a day phase. Pure: no three.js objects are built here. */
export function lightState(phase: number): LightState {
  const sunDir = sunDirection(phase);
  const elev = sunDir[1];
  const noon = clamp01(elev / 0.5);
  const [wr, wg, wb] = SUN_WARM;
  const [hr, hg, hb] = SUN_WHITE;
  const sunColour: Vec3 = [wr + (hr - wr) * noon, wg + (hg - wg) * noon, wb + (hb - wb) * noon];
  const night = nightAmount(phase);
  return {
    sunDir,
    sunColour,
    sunIntensity: Math.max(0, elev) * 0.9,
    moonIntensity: 0.3 * night * clamp01(-elev / 0.2),
    hemiIntensity: 0.25 + 0.4 * (1 - night),
    night,
  };
}

export class Lighting3D implements Layer3D {
  readonly id = 'lighting';
  private ctx: Layer3DContext | null = null;
  private readonly clock = new DayClock();
  private readonly hemi = new THREE.HemisphereLight(0xbcd6ea, GROUND_COLOUR, 0.65);
  /** Named so the sea mirror (terrain3d.ts) can follow it without importing this module. */
  private readonly sun = Object.assign(new THREE.DirectionalLight(0xffffff, 0.9), { name: 'sun' });
  private readonly moon = new THREE.DirectionalLight(MOON_COLOUR, 0);
  private readonly cursor = new THREE.PointLight(0xffe2a0, 0, 8);
  private readonly glowMat = new THREE.PointsMaterial({
    color: 0xffc860,
    size: 0.35,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  private glow: THREE.Points | null = null;
  private glowSource: readonly MapBuilding[] | null | undefined = undefined;

  init(ctx: Layer3DContext): void {
    this.ctx = ctx;
    const { scene } = ctx;
    ctx.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sun.shadow.mapSize.set(SHADOW_PX, SHADOW_PX);
    const cam = this.sun.shadow.camera;
    cam.left = -SHADOW_HALF_TILES;
    cam.right = SHADOW_HALF_TILES;
    cam.top = SHADOW_HALF_TILES;
    cam.bottom = -SHADOW_HALF_TILES;
    cam.near = 1;
    cam.far = SUN_DISTANCE * 2 + SHADOW_HALF_TILES;
    cam.updateProjectionMatrix();
    // The moon shares the sun's target: both lights aim at the same spot on the ground.
    this.moon.target = this.sun.target;
    scene.add(this.hemi, this.sun, this.sun.target, this.moon, this.cursor);
  }

  frame(input: FrameInput, ctx: Layer3DContext): void {
    const phase = this.clock.update(input);
    const s = lightState(phase);
    this.hemi.color.copy(fogColour(phase));
    this.hemi.intensity = s.hemiIntensity;
    this.sun.color.setRGB(s.sunColour[0], s.sunColour[1], s.sunColour[2]);
    this.sun.intensity = s.sunIntensity;
    this.moon.intensity = s.moonIntensity;

    // Shadows follow the camera; the sun sits on the line from its target towards the sun direction. The moon sits on the
    // opposite line, with no shadows.
    const shadows = input.map.shadows && !input.degradedOff.has('map3d.shadows');
    ctx.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    const cp = ctx.camera.position;
    this.sun.target.position.set(cp.x, 0, cp.z);
    this.sun.target.updateMatrixWorld();
    const sd = s.sunDir;
    this.sun.position.set(cp.x + sd[0] * SUN_DISTANCE, sd[1] * SUN_DISTANCE, cp.z + sd[2] * SUN_DISTANCE);
    const md = moonDirection(phase);
    this.moon.position.set(cp.x + md[0] * SUN_DISTANCE, md[1] * SUN_DISTANCE, cp.z + md[2] * SUN_DISTANCE);

    const buildings = input.snapshot?.mapBuildings;
    if (buildings !== this.glowSource) {
      this.glowSource = buildings;
      this.rebuildGlow(buildings ?? [], ctx);
    }
    const glowOn = input.map.nightLights && s.night > 0 && this.glow !== null;
    if (this.glow) this.glow.visible = glowOn;
    this.glowMat.opacity = input.map.nightLights ? s.night * 0.9 : 0;

    const tile = input.cursor.tile;
    if (input.map.cursorLights && tile) {
      this.cursor.position.set(tile.x + 0.5, ctx.field.heightAt(tile.x + 0.5, tile.y + 0.5) + CURSOR_HEIGHT, tile.y + 0.5);
      this.cursor.intensity = 2;
    } else {
      this.cursor.intensity = 0;
    }
  }

  dispose(): void {
    this.ctx?.scene.remove(this.hemi, this.sun, this.sun.target, this.moon, this.cursor);
    this.dropGlow();
    this.glowMat.dispose();
    this.sun.shadow.dispose();
    this.ctx = null;
  }

  /** One warm point per building, drawn at night. Rebuilt when the snapshot's building list changes. */
  private rebuildGlow(list: readonly MapBuilding[], ctx: Layer3DContext): void {
    this.dropGlow();
    if (list.length === 0) return;
    const field: HeightField = ctx.field;
    const positions = new Float32Array(list.length * 3);
    list.forEach((b, i) => {
      positions[i * 3] = b.x + 0.5;
      positions[i * 3 + 1] = field.heightAt(b.x + 0.5, b.y + 0.5) + GLOW_HEIGHT;
      positions[i * 3 + 2] = b.y + 0.5;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.glow = new THREE.Points(geometry, this.glowMat);
    this.glow.frustumCulled = false;
    ctx.scene.add(this.glow);
  }

  private dropGlow(): void {
    if (!this.glow) return;
    this.glow.removeFromParent();
    this.glow.geometry.dispose();
    this.glow = null;
  }
}

registerLayer(() => new Lighting3D());
