/**
 * Beings, hamlet buildings, boats, footfall dust and cover trees in the 3D view (part 1, Task 5). Beings, buildings and
 * trees are cylindrical billboards that face the camera's yaw, drawn instanced: one InstancedBufferGeometry per atlas
 * page (or per procedural texture), so a page of frames is one draw call. Frames come from the same atlas as 2D
 * (render/atlas.ts frameRect / buildingRect), with the same walking frames (anim.ts) and crowd rules (creatures.ts). A
 * being past FAR_TILES is a coloured point. The insight icons (O03 happiness, O04 tasks) are small billboards over the
 * head. Dust is a point cloud at the feet, capped at DUST_MAX.
 *
 * Night window lights on buildings are the lighting layer's (Task 7). It reads `buildingBillboards()` for the positions.
 */
import * as THREE from 'three';
import { SPECIES } from '../content/beasts.ts';
import { speciesGroup } from '../content/species-group.ts';
import { SPECIES_GAIT, type SpeciesGait } from '../art/gaits.ts';
import { BeingState } from '../shared/being-feed.ts';
import type { DrawBeing } from '../render/feed-interp.ts';
import type { FrameInput } from '../render/world-renderer.ts';
import type { MapKind, MapPoint, MapSizeClass, Snapshot } from '../shared/protocol.ts';
import { Atlas, type AtlasRect } from '../render/atlas.ts';
import { BOAT_COLOUR, CROWD_LIMIT, animStep, buildingHeightPx, framePxFor, worldHeightPx } from '../render/creatures.ts';
import { PhaseByKey, frameIndex, framesOf, gaitFor, type PhaseEntry, type Pose } from '../render/anim.ts';
import { GROUP_COLOUR } from '../render/sprites.ts';
import { HAPPY_COLOUR, HAPPY_MOOD, UNHAPPY_COLOUR, hashKey, keyColour } from '../render/insight-layers.ts';
import { DUST_LIFE_MS, DUST_MAX } from '../render/dust.ts';
import { billboardSize, nearestFirst, nearestHit, type ProjectedBeing } from './billboard.ts';
import { registerLayer, type Layer3D, type Layer3DContext } from './layer.ts';

/** The tile size a billboard is drawn at: its size class at the 2D reference zoom, so a being is the same height as in 2D. */
const REF_ZOOM = 32;
/** Beings, trees and dust past this many tiles from the camera: beings become coloured points, trees are not drawn. */
const FAR_TILES = 160;
const FAR2 = FAR_TILES * FAR_TILES;
const DOT_TILES = 0.35;
const BOAT_TILES = 0.3;
const ICON_TILES = 0.2;
/** Icons float this far above a being's head, and the task square sits this far to the side of the happiness disc. */
const ICON_LIFT_TILES = 0.1;
const TASK_OFFSET_TILES = 0.25;
const TREE_TILES = 1.4;
/** Most tree billboards drawn in one frame. */
const TREE_MAX = 6000;
/** One cover tile in four holds a tree: a hash of its tile position picks them, so the same tiles always do. */
const TREE_HASH_MASK = 3;
/** Vertex sway amplitude, as a fraction of a tree's height at its crown. */
const SWAY_AMPLITUDE = 0.04;
const BUILDING_SILHOUETTE = 0xb9b0a0;
const DUST_COLOUR = 0xd8c8a0;
const DUST_BACKGROUND = 0x17202b;
const DUST_DRIFT_TILES = 0.1;
const DUST_RISE_TILES = 0.05;
const DUST_SIZE_TILES = 0.07;
const DUST_LIFT_TILES = 0.02;
const BOAT_LIFT_TILES = 0.05;
const TREE_ASPECT = 64 / 96;

const VERTEX = /* glsl */ `
attribute vec4 aPos;
attribute vec2 aSize;
attribute vec4 aUv;
attribute vec4 aTint;
uniform vec3 uRight;
uniform float uTime;
uniform float uSway;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vec2 c = position.xy + vec2(0.5);
  float h = aSize.x;
  float w = aPos.w;
  vec3 p = aPos.xyz + uRight * ((c.x - 0.5) * w * aSize.y) + vec3(0.0, c.y * h, 0.0);
  if (uSway > 0.0) {
    float s = sin(uTime * 1.6 + aPos.x * 0.7 + aPos.z * 1.1) * uSway * c.y * c.y;
    p += uRight * (s * h);
  }
  vUv = mix(aUv.xy, aUv.zw, c);
  vTint = aTint;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.25) discard;
  gl_FragColor = vec4(t.rgb * vTint.rgb, t.a * vTint.a);
}
`;

/** Uniforms every batch shares: the camera's right vector on the ground plane and the clock. */
interface SharedUniforms {
  uRight: { value: THREE.Vector3 };
  uTime: { value: number };
}

/**
 * One instanced draw of billboards that share a texture. Each instance is: position and width (aPos), height and facing
 * (aSize), the UV rect (aUv, bottom-left then top-right, in texture space) and a tint with alpha (aTint). The arrays grow
 * on demand and are kept between frames.
 */
class BillboardBatch {
  readonly mesh: THREE.Mesh;
  private readonly geom = new THREE.InstancedBufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private cap = 0;
  private n = 0;
  private pos = new Float32Array(0);
  private size = new Float32Array(0);
  private uv = new Float32Array(0);
  private tint = new Float32Array(0);
  private attrs: THREE.InstancedBufferAttribute[] = [];

  constructor(tex: THREE.Texture, shared: SharedUniforms, plane: THREE.BufferGeometry) {
    this.geom.index = plane.index;
    this.geom.setAttribute('position', plane.getAttribute('position'));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { map: { value: tex }, uRight: shared.uRight, uTime: shared.uTime, uSway: { value: 0 } },
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geom, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.grow(64);
  }

  /** Sets the sway amplitude (0 is still). Only tree batches sway. */
  setSway(amplitude: number): void {
    this.mat.uniforms.uSway!.value = amplitude;
  }

  begin(): void {
    this.n = 0;
  }

  /** Adds one billboard. `facing` is 1 or -1 (mirrors the frame). The UVs are (u0, v0, u1, v1) in texture space. */
  add(x: number, y: number, z: number, w: number, h: number, facing: number, uv: readonly [number, number, number, number], tint: readonly [number, number, number, number]): void {
    if (this.n === this.cap) this.grow(this.cap * 2);
    const i = this.n++;
    this.pos[i * 4] = x;
    this.pos[i * 4 + 1] = y;
    this.pos[i * 4 + 2] = z;
    this.pos[i * 4 + 3] = w;
    this.size[i * 2] = h;
    this.size[i * 2 + 1] = facing;
    this.uv[i * 4] = uv[0];
    this.uv[i * 4 + 1] = uv[1];
    this.uv[i * 4 + 2] = uv[2];
    this.uv[i * 4 + 3] = uv[3];
    this.tint[i * 4] = tint[0];
    this.tint[i * 4 + 1] = tint[1];
    this.tint[i * 4 + 2] = tint[2];
    this.tint[i * 4 + 3] = tint[3];
  }

  /** Makes the frame's instances the ones drawn. */
  end(): void {
    this.geom.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n === 0) return;
    for (const a of this.attrs) a.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geom.dispose();
    this.mat.dispose();
  }

  private grow(cap: number): void {
    const copy = (old: Float32Array<ArrayBuffer>, stride: number): Float32Array<ArrayBuffer> => {
      const next = new Float32Array(cap * stride);
      next.set(old.subarray(0, Math.min(old.length, next.length)));
      return next;
    };
    this.pos = copy(this.pos, 4);
    this.size = copy(this.size, 2);
    this.uv = copy(this.uv, 4);
    this.tint = copy(this.tint, 4);
    this.cap = cap;
    const attr = (arr: Float32Array, stride: number): THREE.InstancedBufferAttribute => new THREE.InstancedBufferAttribute(arr, stride).setUsage(THREE.DynamicDrawUsage);
    this.attrs = [attr(this.pos, 4), attr(this.size, 2), attr(this.uv, 4), attr(this.tint, 4)];
    this.geom.setAttribute('aPos', this.attrs[0]!);
    this.geom.setAttribute('aSize', this.attrs[1]!);
    this.geom.setAttribute('aUv', this.attrs[2]!);
    this.geom.setAttribute('aTint', this.attrs[3]!);
  }
}

/** Footfall dust: a ring of DUST_MAX points at the feet. An emit over the cap recycles the oldest puff. */
class DustField {
  readonly points: THREE.Points;
  private readonly geom = new THREE.BufferGeometry();
  private readonly mat = new THREE.PointsMaterial({ size: DUST_SIZE_TILES, vertexColors: true, sizeAttenuation: true });
  private readonly pos = new Float32Array(DUST_MAX * 3);
  private readonly col = new Float32Array(DUST_MAX * 3);
  private readonly base = new Float32Array(DUST_MAX * 3);
  private readonly dir = new Float32Array(DUST_MAX);
  private readonly age = new Float32Array(DUST_MAX);
  private next = 0;
  private dirty = false;

  constructor(scene: THREE.Scene) {
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geom.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(this.geom, this.mat);
    this.points.frustumCulled = false;
    this.age.fill(DUST_LIFE_MS);
    this.clear();
    scene.add(this.points);
  }

  /** Starts a puff at the feet (x, y, z) that drifts away from the way the being faces. */
  emit(x: number, y: number, z: number, facing: number): void {
    const i = this.next;
    this.next = (this.next + 1) % DUST_MAX;
    this.base[i * 3] = x;
    this.base[i * 3 + 1] = y;
    this.base[i * 3 + 2] = z;
    this.dir[i] = facing;
    this.age[i] = 0;
    this.dirty = true;
  }

  /** Ages the live puffs by dtMs, moving and fading them, and parks those past their life. */
  update(dtMs: number): void {
    if (!this.dirty) return;
    let live = false;
    for (let i = 0; i < DUST_MAX; i++) {
      const a = this.age[i]!;
      if (a >= DUST_LIFE_MS) continue;
      const next = a + dtMs;
      this.age[i] = next;
      if (next >= DUST_LIFE_MS) {
        this.park(i);
        continue;
      }
      live = true;
      const k = next / DUST_LIFE_MS;
      this.pos[i * 3] = this.base[i * 3]! - this.dir[i]! * DUST_DRIFT_TILES * k;
      this.pos[i * 3 + 1] = this.base[i * 3 + 1]! + DUST_RISE_TILES * k;
      this.pos[i * 3 + 2] = this.base[i * 3 + 2]!;
      const c = mixColour(DUST_COLOUR, DUST_BACKGROUND, k);
      this.col[i * 3] = c[0];
      this.col[i * 3 + 1] = c[1];
      this.col[i * 3 + 2] = c[2];
    }
    this.dirty = live;
    this.geom.attributes.position!.needsUpdate = true;
    this.geom.attributes.color!.needsUpdate = true;
  }

  /** Hides every puff, e.g. when the setting turns off. */
  clear(): void {
    for (let i = 0; i < DUST_MAX; i++) this.park(i);
    this.dirty = false;
    this.geom.attributes.position!.needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geom.dispose();
    this.mat.dispose();
  }

  private park(i: number): void {
    this.age[i] = DUST_LIFE_MS;
    this.pos[i * 3] = 0;
    this.pos[i * 3 + 1] = -1e4;
    this.pos[i * 3 + 2] = 0;
  }
}

/** A drawn being, with the world position of its feet and its height, for the hit test. */
interface Drawn {
  being: DrawBeing;
  x: number;
  y: number;
  z: number;
  h: number;
}

interface Info {
  gait: SpeciesGait | undefined;
  size: MapSizeClass;
  requested: boolean;
}

function uvOf(r: AtlasRect): [number, number, number, number] {
  // The page canvas is uploaded with flipY, so canvas rows (v down) are texture rows (v up).
  return [r.u0, 1 - r.v1, r.u1, 1 - r.v0];
}

const FULL_UV: [number, number, number, number] = [0, 0, 1, 1];
const WHITE: [number, number, number, number] = [1, 1, 1, 1];

function rgbaOf(colour: number, alpha: number): [number, number, number, number] {
  return [((colour >> 16) & 0xff) / 255, ((colour >> 8) & 0xff) / 255, (colour & 0xff) / 255, alpha];
}

function mixColour(a: number, b: number, k: number): [number, number, number] {
  const ch = (shift: number): number => {
    const x = (a >> shift) & 0xff;
    const y = (b >> shift) & 0xff;
    return (x + (y - x) * k) / 255;
  };
  return [ch(16), ch(8), ch(0)];
}

/** A tree's tint from its cover id: deterministic greens, so the same cover always looks the same. */
function treeTint(cover: number): [number, number, number, number] {
  return [0.3 + 0.07 * (cover % 4), 0.5 + 0.07 * ((cover * 3) % 4), 0.25 + 0.05 * (cover % 3), 1];
}

/** Projects a world point to canvas CSS px, or null when it is behind the camera. */
function project(camera: THREE.PerspectiveCamera, w: number, h: number, x: number, y: number, z: number): { sx: number; sy: number } | null {
  const p = new THREE.Vector3(x, y, z);
  const view = p.clone().applyMatrix4(camera.matrixWorldInverse);
  if (view.z >= 0) return null;
  p.project(camera);
  return { sx: ((p.x + 1) / 2) * w, sy: ((1 - p.y) / 2) * h };
}

/** A canvas texture drawn once with `draw`. */
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g);
  return new THREE.CanvasTexture(c);
}

/** Footfall dust is kicked up by walkers and runners on the ground: not by swimmers, flyers or static art (as in 2D). */
function kicksDust(state: BeingState, gait: string): boolean {
  return (state === BeingState.Walk || state === BeingState.Run) && gait !== 'flyer' && gait !== 'static';
}

class Beings3D implements Layer3D {
  readonly id = 'beings';
  private ctx: Layer3DContext | null = null;
  private atlas: Atlas | null = null;
  private dust: DustField | null = null;
  private plane: THREE.PlaneGeometry | null = null;
  private readonly shared: SharedUniforms = { uRight: { value: new THREE.Vector3(1, 0, 0) }, uTime: { value: 0 } };
  private readonly batches = new Map<string, BillboardBatch>();
  private readonly pageTex = new Map<HTMLCanvasElement, THREE.CanvasTexture>();
  private readonly procedural = new Map<string, THREE.CanvasTexture>();
  private phases = new PhaseByKey();
  private readonly infos: (Info | undefined)[] = [];
  private trees = new Int32Array(0);
  private treeCount = 0;
  private cand = new Int32Array(0);
  private candD2 = new Float64Array(0);
  private drawn: Drawn[] = [];
  private frameNo = 0;
  private pointSource: Snapshot | null = null;
  private points = new Map<number, MapPoint>();
  private kinds = new Map<number, MapKind>();

  init(ctx: Layer3DContext): void {
    this.ctx = ctx;
    this.plane = new THREE.PlaneGeometry(1, 1);
    this.atlas = new Atlas({ canvas: ctx.renderer.domElement });
    this.atlas.onPageFlush((page) => this.onPageFlush(page));
    this.dust = new DustField(ctx.scene);
  }

  onRows(): void {
    this.rebuildTrees();
  }

  onSide(): void {
    this.dropBatches();
    this.dropTextures();
    this.phases = new PhaseByKey();
    this.pointSource = null;
    this.dust?.clear();
    this.rebuildTrees();
  }

  frame(input: FrameInput, ctx: Layer3DContext): void {
    if (!this.atlas || !this.dust || !this.plane) return;
    const cam = ctx.camera;
    const e = cam.matrixWorld.elements;
    const rx = e[0] ?? 1;
    const rz = e[2] ?? 0;
    const len = Math.hypot(rx, rz) || 1;
    this.shared.uRight.value.set(rx / len, 0, rz / len);
    this.shared.uTime.value = input.nowMs / 1000;
    this.syncPoints(input.snapshot, ctx.field.side);
    for (const b of this.batches.values()) b.begin();
    this.drawn = [];
    const viewH = ctx.renderer.domElement.clientHeight;
    const pxPerTile = (dist: number): number => viewH / (2 * Math.max(dist, 0.5) * Math.tan((cam.fov * Math.PI) / 360));
    const dustOn = input.map.particles && input.map.dust;
    this.drawBeings(input, ctx, pxPerTile, dustOn);
    this.drawBuildings(ctx, pxPerTile);
    if (input.map.boats) this.drawBoats(ctx);
    this.drawTrees(ctx, input.map.treeSway);
    if (dustOn) this.dust.update(input.dtMs);
    else this.dust.clear();
    for (const b of this.batches.values()) b.end();
    this.phases.endFrame();
    this.frameNo++;
  }

  beingAt(sx: number, sy: number, slopPx: number, ctx: Layer3DContext): DrawBeing | null {
    const w = ctx.renderer.domElement.clientWidth;
    const h = ctx.renderer.domElement.clientHeight;
    const items: (ProjectedBeing & { being: DrawBeing })[] = [];
    for (const d of this.drawn) {
      const f = project(ctx.camera, w, h, d.x, d.y, d.z);
      const t = project(ctx.camera, w, h, d.x, d.y + d.h, d.z);
      if (!f || !t) continue;
      items.push({ fx: f.sx, fy: f.sy, hx: t.sx, hy: t.sy, being: d.being });
    }
    return nearestHit(items, sx, sy, slopPx)?.being ?? null;
  }

  /** The buildings' billboard positions of the latest frame (feet, width and height in tiles): for the lighting layer's window lights. */
  buildingBillboards(ctx: Layer3DContext): readonly { x: number; y: number; z: number; h: number }[] {
    return ctx.buildings().map((b) => ({ x: b.x + 0.5, y: ctx.field.heightAt(b.x + 0.5, b.y + 0.5), z: b.y + 0.5, h: buildingHeightPx(REF_ZOOM) / REF_ZOOM }));
  }

  dispose(): void {
    this.atlas?.dispose();
    this.dropBatches();
    this.dropTextures();
    this.dust?.dispose();
    this.plane?.dispose();
    this.atlas = null;
    this.dust = null;
    this.plane = null;
  }

  private drawBeings(input: FrameInput, ctx: Layer3DContext, pxPerTile: (dist: number) => number, dustOn: boolean): void {
    const count = Math.min(input.beingCount, input.beings.length);
    if (this.cand.length < count) {
      this.cand = new Int32Array(count * 2);
      this.candD2 = new Float64Array(count * 2);
    }
    const cx = ctx.camera.position.x;
    const cz = ctx.camera.position.z;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const b = input.beings[i]!;
      if (!(b.alpha > 0)) continue;
      const dx = b.x + 0.5 - cx;
      const dz = b.y + 0.5 - cz;
      this.cand[n] = i;
      this.candD2[n] = dx * dx + dz * dz;
      n++;
    }
    const limit = input.degradedOff.has('map3d.billboards') ? Math.floor(CROWD_LIMIT / 2) : CROWD_LIMIT;
    const order = nearestFirst(this.candD2, n, limit);
    for (let rank = 0; rank < order.length; rank++) {
      const ci = order[rank]!;
      const b = input.beings[this.cand[ci]!]!;
      const d2 = this.candD2[ci]!;
      const tx = b.x + 0.5;
      const tz = b.y + 0.5;
      const ty = ctx.field.heightAt(tx, tz);
      const dist = Math.sqrt(d2);
      if (dist > FAR_TILES) {
        this.batchFor(this.procTex('disc')).add(tx, ty + DUST_LIFT_TILES, tz, DOT_TILES, DOT_TILES, 1, FULL_UV, rgbaOf(GROUP_COLOUR[speciesGroup(b.species)], b.alpha));
        continue;
      }
      const info = this.infoOf(b.species);
      const height = worldHeightPx(info.size, REF_ZOOM, b.child) / REF_ZOOM;
      const [w, h] = billboardSize(height, 1);
      const sg = info.gait;
      let fast = false;
      let pose: Pose | null = null;
      let phase = 0;
      if (sg) {
        const entry = this.phases.entry(b.key, b.x, b.y);
        fast = entry.fast;
        const stepped = this.stepPhase(entry, b, sg, animStep(rank, n, input.map.crowdAnim), input.dtMs);
        pose = gaitFor(sg, b.state, fast);
        if (fast && dustOn && input.map.creatureAnim && entry.wrapped && kicksDust(b.state, pose.gait)) {
          this.dust!.emit(tx, ty + DUST_LIFT_TILES, tz, b.facing);
        }
        phase = input.map.creatureAnim ? stepped : 0;
      }
      const framePx = framePxFor(height * pxPerTile(dist));
      if (!info.requested) {
        info.requested = true;
        this.atlas!.request(b.species);
      }
      const rect = pose ? this.atlas!.frameRect(b.species, pose.gait, pose.mode, frameIndex(phase, framesOf(pose.gait, pose.mode)), framePx) : null;
      if (rect) this.batchFor(this.pageTexture(rect.page)).add(tx, ty, tz, w, h, b.facing, uvOf(rect), rgbaOf(0xffffff, b.alpha));
      else this.batchFor(this.procTex('disc')).add(tx, ty, tz, w, h, b.facing, FULL_UV, rgbaOf(GROUP_COLOUR[speciesGroup(b.species)], b.alpha));
      this.drawn.push({ being: b, x: tx, y: ty, z: tz, h: height });
      this.drawIcons(input, b, tx, ty + height + ICON_LIFT_TILES, tz, ctx.field.side);
    }
  }

  /** O03 happiness and O04 task icons over a being: the map point on its tile carries the mood and the task. */
  private drawIcons(input: FrameInput, b: DrawBeing, tx: number, top: number, tz: number, side: number): void {
    const p = this.points.get(b.y * side + b.x);
    if (!p) return;
    const kind = this.kinds.get(p.id);
    const mood = kind?.mood;
    if (input.insight.happiness && p.folk && mood !== undefined && Math.abs(mood) >= HAPPY_MOOD) {
      this.batchFor(this.procTex('disc')).add(tx, top, tz, ICON_TILES, ICON_TILES, 1, FULL_UV, rgbaOf(mood > 0 ? HAPPY_COLOUR : UNHAPPY_COLOUR, b.alpha));
    }
    if (input.insight.tasks && kind?.task) {
      this.batchFor(this.procTex('square')).add(tx + TASK_OFFSET_TILES, top, tz, ICON_TILES, ICON_TILES, 1, FULL_UV, rgbaOf(keyColour(hashKey(kind.task)), b.alpha));
    }
  }

  private drawBuildings(ctx: Layer3DContext, pxPerTile: (dist: number) => number): void {
    if (!this.atlas) return;
    const cx = ctx.camera.position.x;
    const cz = ctx.camera.position.z;
    const height = buildingHeightPx(REF_ZOOM) / REF_ZOOM;
    const [w, h] = billboardSize(height, 1);
    for (const bl of ctx.buildings()) {
      const tx = bl.x + 0.5;
      const tz = bl.y + 0.5;
      const ty = ctx.field.heightAt(tx, tz);
      const dist = Math.hypot(tx - cx, tz - cz);
      this.atlas.requestBuilding(bl.kind);
      const rect = this.atlas.buildingRect(bl.kind, framePxFor(height * pxPerTile(dist)));
      if (rect) this.batchFor(this.pageTexture(rect.page)).add(tx, ty, tz, w, h, 1, uvOf(rect), WHITE);
      else this.batchFor(this.procTex('square')).add(tx, ty, tz, w, h, 1, FULL_UV, rgbaOf(BUILDING_SILHOUETTE, 1));
    }
  }

  private drawBoats(ctx: Layer3DContext): void {
    for (const bo of ctx.boats()) {
      const tx = bo.x + 0.5;
      const tz = bo.y + 0.5;
      const ty = ctx.field.heightAt(tx, tz) + BOAT_LIFT_TILES;
      this.batchFor(this.procTex('disc')).add(tx, ty, tz, BOAT_TILES, BOAT_TILES, 1, FULL_UV, rgbaOf(BOAT_COLOUR[bo.kind], 1));
    }
  }

  /** Cover billboards: one tree per hashed cover tile within FAR_TILES of the camera, swaying when `map.treeSway` is on. */
  private drawTrees(ctx: Layer3DContext, sway: boolean): void {
    const batch = this.batchFor(this.procTex('tree'), true);
    batch.setSway(sway ? SWAY_AMPLITUDE : 0);
    const side = ctx.field.side;
    const cover = ctx.field.cover;
    const cx = ctx.camera.position.x;
    const cz = ctx.camera.position.z;
    const [w, h] = billboardSize(TREE_TILES, TREE_ASPECT);
    let drawn = 0;
    for (let k = 0; k < this.treeCount && drawn < TREE_MAX; k++) {
      const idx = this.trees[k]!;
      const tx = (idx % side) + 0.5;
      const tz = Math.floor(idx / side) + 0.5;
      const dx = tx - cx;
      const dz = tz - cz;
      if (dx * dx + dz * dz > FAR2) continue;
      batch.add(tx, ctx.field.heightAt(tx, tz), tz, w, h, 1, FULL_UV, treeTint(cover[idx] ?? 0));
      drawn++;
    }
  }

  /** The trees' tile indices: every cover tile the hash picks. Rebuilt when rows change or the realm changes. */
  private rebuildTrees(): void {
    const field = this.ctx?.field;
    if (!field) return;
    const side = field.side;
    if (this.trees.length < side * side) this.trees = new Int32Array(side * side);
    let n = 0;
    for (let i = 0; i < side * side; i++) {
      if ((field.cover[i] ?? 0) === 0) continue;
      const x = i % side;
      const y = Math.floor(i / side);
      if (((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) & TREE_HASH_MASK) !== 0) continue;
      this.trees[n++] = i;
    }
    this.treeCount = n;
  }

  private stepPhase(e: PhaseEntry, b: DrawBeing, sg: SpeciesGait, rate: 1 | 2 | 0, dtMs: number): number {
    if (rate === 0 || (rate === 2 && ((this.frameNo + b.key) & 1) !== 0)) {
      e.wrapped = false;
      return e.phase;
    }
    return this.phases.advance(e, b.state, b.x, b.y, sg.strideTiles, dtMs * rate);
  }

  private infoOf(species: number): Info {
    let info = this.infos[species];
    if (!info) {
      const id = SPECIES[species]?.id;
      info = { gait: id === undefined ? undefined : SPECIES_GAIT[id], size: SPECIES[species]?.size ?? 'S', requested: false };
      this.infos[species] = info;
    }
    return info;
  }

  /** The point and kind maps of the latest snapshot, keyed by tile. Rebuilt when the snapshot object changes. */
  private syncPoints(snapshot: Snapshot | null, side: number): void {
    if (snapshot === this.pointSource) return;
    this.pointSource = snapshot;
    this.points.clear();
    this.kinds.clear();
    for (const p of snapshot?.mapPoints ?? []) this.points.set(p.y * side + p.x, p);
    for (const k of snapshot?.mapKinds ?? []) this.kinds.set(k.id, k);
  }

  private batchFor(tex: THREE.Texture, sway = false): BillboardBatch {
    const key = `${tex.uuid}${sway ? ':sway' : ''}`;
    let b = this.batches.get(key);
    if (!b) {
      b = new BillboardBatch(tex, this.shared, this.plane!);
      this.batches.set(key, b);
    }
    return b;
  }

  /** The CanvasTexture of an atlas page, made when the page is first flushed (see onPageFlush). */
  private pageTexture(page: HTMLCanvasElement): THREE.CanvasTexture {
    let t = this.pageTex.get(page);
    if (!t) {
      t = new THREE.CanvasTexture(page);
      this.pageTex.set(page, t);
    }
    return t;
  }

  private onPageFlush(page: HTMLCanvasElement): void {
    this.pageTexture(page).needsUpdate = true;
  }

  private procTex(kind: 'disc' | 'square' | 'tree'): THREE.CanvasTexture {
    let t = this.procedural.get(kind);
    if (!t) {
      if (kind === 'disc') {
        t = canvasTexture(64, 64, (g) => {
          g.fillStyle = '#ffffff';
          g.beginPath();
          g.arc(32, 32, 32, 0, Math.PI * 2);
          g.fill();
        });
      } else if (kind === 'square') {
        t = canvasTexture(8, 8, (g) => {
          g.fillStyle = '#ffffff';
          g.fillRect(0, 0, 8, 8);
        });
      } else {
        t = canvasTexture(64, 96, (g) => {
          g.fillStyle = '#8c8c8c';
          g.fillRect(28, 50, 8, 46);
          g.fillStyle = '#ffffff';
          g.beginPath();
          g.ellipse(32, 36, 27, 34, 0, 0, Math.PI * 2);
          g.fill();
        });
      }
      this.procedural.set(kind, t);
    }
    return t;
  }

  /** Frees the GPU copies of the page and procedural textures; they are made again on next use (after a restore too). */
  private dropTextures(): void {
    for (const t of this.pageTex.values()) t.dispose();
    for (const t of this.procedural.values()) t.dispose();
    this.pageTex.clear();
    this.procedural.clear();
  }

  private dropBatches(): void {
    for (const b of this.batches.values()) b.dispose();
    this.batches.clear();
  }
}

registerLayer(() => new Beings3D());
