/**
 * Light in 3D (spec "Every map layer in 3D", "Settings visuals"): the sun and ambient light, shadow maps, night window glow
 * on buildings and a cursor light. The sun follows a cosmetic day cycle of DAY_TICKS sim ticks; the sim itself has no day
 * phase, so the cycle is drawn here only and never changes the sim.
 */
import * as THREE from 'three';
import type { MapBuilding } from '../shared/protocol.ts';
import type { FrameInput } from '../render/world-renderer.ts';
import type { HeightField } from './heights.ts';
import { registerLayer, type Layer3D, type Layer3DContext } from './layer.ts';

/** One cosmetic day, in sim ticks (2400 ticks at 20 Hz is two minutes). */
export const DAY_TICKS = 2400;
/** Shadow map edge in texels (spec: 1024 squared). */
const SHADOW_PX = 1024;
/** Shadows cover this many tiles either side of the camera. The spec asks for 64 tiles around the focus. */
const SHADOW_HALF_TILES = 32;
/** Distance of the sun from its target, in tiles. Only the direction matters for a directional light. */
const SUN_DISTANCE = 40;
/** The window glow sits this high above the ground, in tiles. */
const GLOW_HEIGHT = 0.7;
const CURSOR_HEIGHT = 1.2;

export interface SunState {
  /** Unit vector from the target towards the sun. */
  dir: [number, number, number];
  sunIntensity: number;
  ambient: number;
  /** 0 in full daylight, 1 at the darkest part of the night. */
  night: number;
}

/**
 * The sun for a sim tick. The cycle starts at noon at tick 0 of the cycle's quarter. `null` (no snapshot yet) is a fixed
 * noon. Pure: no three.js objects are built here.
 */
export function sunState(tick: number | null): SunState {
  const phase = tick === null ? 0.25 : (((tick % DAY_TICKS) + DAY_TICKS) % DAY_TICKS) / DAY_TICKS;
  const angle = 2 * Math.PI * phase;
  const elev = Math.sin(angle);
  const x = Math.cos(angle) * 0.6;
  const z = 0.3;
  const len = Math.hypot(x, elev, z);
  const night = Math.min(1, Math.max(0, -elev * 4));
  return {
    dir: [x / len, elev / len, z / len],
    sunIntensity: Math.max(0, elev) * 0.9,
    ambient: 0.2 + 0.35 * (1 - night),
    night,
  };
}

export class Lighting3D implements Layer3D {
  readonly id = 'lighting';
  private ctx: Layer3DContext | null = null;
  private readonly ambient = new THREE.AmbientLight(0xffffff, 0.55);
  private readonly sun = new THREE.DirectionalLight(0xffffff, 0.9);
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
    this.sun.shadow.mapSize.set(SHADOW_PX, SHADOW_PX);
    const cam = this.sun.shadow.camera;
    cam.left = -SHADOW_HALF_TILES;
    cam.right = SHADOW_HALF_TILES;
    cam.top = SHADOW_HALF_TILES;
    cam.bottom = -SHADOW_HALF_TILES;
    cam.near = 1;
    cam.far = SUN_DISTANCE * 2 + SHADOW_HALF_TILES;
    cam.updateProjectionMatrix();
    scene.add(this.ambient, this.sun, this.sun.target, this.cursor);
  }

  frame(input: FrameInput, ctx: Layer3DContext): void {
    const s = sunState(input.snapshot ? input.snapshot.tick : null);
    this.ambient.intensity = s.ambient;
    this.sun.intensity = s.sunIntensity;

    // Shadows follow the camera; the sun sits on the line from its target towards the sun direction.
    const shadows = input.map.shadows && !input.degradedOff.has('map3d.shadows');
    ctx.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    const cp = ctx.camera.position;
    this.sun.target.position.set(cp.x, 0, cp.z);
    this.sun.position.set(cp.x + s.dir[0] * SUN_DISTANCE, s.dir[1] * SUN_DISTANCE, cp.z + s.dir[2] * SUN_DISTANCE);
    this.sun.target.updateMatrixWorld();

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
    this.ctx?.scene.remove(this.ambient, this.sun, this.sun.target, this.cursor);
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
