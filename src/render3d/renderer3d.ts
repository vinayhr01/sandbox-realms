/**
 * The 3D world view behind WorldRenderer: one perspective camera driven by the rig (rig.ts), a height field mirror of the
 * realm (heights.ts), ray picking (pick.ts), and the Layer3D registry (layer.ts). three.js is imported only here and in
 * the other files under src/render3d/, so it loads as the lazy render3d chunk.
 */
import * as THREE from 'three';
import type { FrameRows, MapBoat, MapBuilding } from '../shared/protocol.ts';
import type { DrawBeing } from '../render/feed-interp.ts';
import type { RecipeId } from '../render/effectRecipes.ts';
import type { Atlas } from '../render/atlas.ts';
import type { CameraControl, FrameInput, ScreenPoint, TilePoint, WorldRenderer } from '../render/world-renderer.ts';
import { HeightField } from './heights.ts';
import { pickTile } from './pick.ts';
import { EYE_HEIGHT, isAtGround, overviewHeight, panRig, rigPose, rotateRig, walkRig, zoomRig, type RigState } from './rig.ts';
import { layerFactories, type Layer3D, type Layer3DContext } from './layer.ts';

// Layer modules register on import (layer.ts). Tasks 4-8 each add one import line here, for example:
// import './terrain3d.ts';
import './terrain3d.ts';
import './marks3d.ts';

const FOV_DEG = 50;
const NEAR = 0.1;
const FAR_MIN = 512;
const BACKGROUND = 0x17202b;
/** Ground walking speed, in tiles per second (1 tile = 2 m, so 2.5 tiles/s is 5 m/s). */
const WALK_TILES_PER_S = 2.5;
/** Look tilt limits, radians added to the ground pitch (-5 degrees). Negative looks down, positive up. */
const LOOK_PITCH_MIN = -0.9;
const LOOK_PITCH_MAX = 0.7;

/** What the camera control needs from the renderer. */
interface RigHost {
  rig(): RigState;
  setRig(s: RigState): void;
  side(): number;
  groundAt(x: number, y: number): number;
  viewport(): { w: number; h: number };
  screenToTile(sx: number, sy: number): TilePoint | null;
  walk(forward: number, strafe: number, dtMs: number): void;
  look(dyaw: number, dpitch: number): void;
  atGround(): boolean;
}

/** The one camera for both views, over the rig. 2D-only calls are the same shape; rotation is real here. */
class Rig3DCamera implements CameraControl {
  constructor(private readonly host: RigHost) {}

  /** Drag moves the map with the pointer: scale by the view height at the current rig height. */
  panBy(dxPx: number, dyPx: number): void {
    const v = this.host.viewport();
    if (v.h <= 0) return;
    const k = (2 * this.host.rig().height * Math.tan(degToRad(FOV_DEG) / 2)) / v.h;
    this.host.setRig(panRig(this.host.rig(), -dxPx * k, dyPx * k, this.host.side()));
  }

  /** Factor above 1 zooms in. The zoom is about the rig focus, not the pointer. */
  zoomAt(factor: number, _sx: number, _sy: number): void {
    const s = this.host.side();
    this.host.setRig(zoomRig(this.host.rig(), factor, s, (x, y) => this.host.groundAt(x, y)));
  }

  rotateBy(radians: number): void {
    this.host.setRig(rotateRig(this.host.rig(), radians));
  }

  centreOn(tile: TilePoint): void {
    const r = this.host.rig();
    this.host.setRig(panRig({ ...r, focus: { x: tile.x + 0.5, y: tile.y + 0.5 } }, 0, 0, this.host.side()));
  }

  /** Tile extents of the four screen corners. A corner that misses the map (sky) counts as the focus tile. */
  visibleTiles(): { x0: number; y0: number; x1: number; y1: number } {
    const v = this.host.viewport();
    const focus = this.host.rig().focus;
    const corners = [
      this.host.screenToTile(0, 0),
      this.host.screenToTile(v.w, 0),
      this.host.screenToTile(0, v.h),
      this.host.screenToTile(v.w, v.h),
    ].map((t) => t ?? { x: Math.floor(focus.x), y: Math.floor(focus.y) });
    const xs = corners.map((t) => t.x);
    const ys = corners.map((t) => t.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs) + 1, y1: Math.max(...ys) + 1 };
  }

  /** 0 at the overview height, 1 at eye height, on a log scale. */
  zoom01(): number {
    const side = this.host.side();
    if (side <= 0) return 0;
    const lo = Math.log(EYE_HEIGHT);
    const hi = Math.log(overviewHeight(side));
    const u = (Math.log(this.host.rig().height) - lo) / (hi - lo);
    return 1 - Math.min(Math.max(u, 0), 1);
  }

  centreTile(): TilePoint {
    const f = this.host.rig().focus;
    return { x: f.x, y: f.y };
  }

  walk(forward: number, strafe: number, dtMs: number): void {
    this.host.walk(forward, strafe, dtMs);
  }

  look(dyaw: number, dpitch: number): void {
    this.host.look(dyaw, dpitch);
  }

  atGround(): boolean {
    return this.host.atGround();
  }

  rig(): { height: number; focus: TilePoint; yaw: number } {
    const r = this.host.rig();
    return { height: r.height, focus: { x: r.focus.x, y: r.focus.y }, yaw: r.yaw };
  }
}

/** The 3D view: one camera, the rig, and the registered Layer3D modules. */
export class Renderer3D implements WorldRenderer {
  readonly kind = '3d' as const;
  readonly canvas: HTMLCanvasElement;
  readonly camera: CameraControl;
  private readonly host: HTMLElement;
  private readonly gl: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly cam: THREE.PerspectiveCamera;
  private readonly field = new HeightField(0);
  private readonly layers: Layer3D[];
  private readonly ctx: Layer3DContext;
  private side = 0;
  private rigState: RigState = { focus: { x: 0, y: 0 }, height: EYE_HEIGHT, yaw: 0 };
  /** Tilt added at ground level by look(), radians. Not applied above ground. */
  private lookPitch = 0;
  private lost = false;
  private renderScale = 1;
  private minFrameMs = 0;
  private lastFrameTs = -Infinity;
  private raf = 0;
  private readonly callbacks: Array<(dtMs: number) => void> = [];
  private buildings: readonly MapBuilding[] = [];
  private boats: readonly MapBoat[] = [];

  constructor(host: HTMLElement) {
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    try {
      this.gl = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, preserveDrawingBuffer: true });
    } catch (err) {
      this.canvas.remove();
      throw err;
    }
    host.appendChild(this.canvas);
    this.gl.setClearColor(BACKGROUND, 1);
    this.cam = new THREE.PerspectiveCamera(FOV_DEG, 1, NEAR, FAR_MIN);
    this.cam.rotation.order = 'YXZ';
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(0.4, 1, 0.3);
    this.scene.add(sun);

    this.camera = new Rig3DCamera({
      rig: () => this.rigState,
      setRig: (s) => {
        this.rigState = s;
        this.updateCamera();
      },
      side: () => this.side,
      groundAt: (x, y) => this.field.heightAt(x, y),
      viewport: () => ({ w: this.canvas.clientWidth, h: this.canvas.clientHeight }),
      screenToTile: (sx, sy) => this.screenToTile(sx, sy),
      walk: (forward, strafe, dtMs) => this.walk(forward, strafe, dtMs),
      look: (dyaw, dpitch) => this.look(dyaw, dpitch),
      atGround: () => this.atGround(),
    });

    this.ctx = {
      scene: this.scene,
      camera: this.cam,
      field: this.field,
      renderer: this.gl,
      toScreen: (x, y) => this.tileToScreen(x, y),
    };
    this.layers = layerFactories().map((make) => make());
    for (const layer of this.layers) layer.init(this.ctx);

    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.resize();
    this.raf = requestAnimationFrame(this.tick);
  }

  setSide(side: number): void {
    this.side = side;
    this.field.reset(side);
    this.cam.far = Math.max(FAR_MIN, overviewHeight(side) * 1.5);
    this.cam.updateProjectionMatrix();
    this.rigState = { focus: { x: side / 2, y: side / 2 }, height: overviewHeight(side), yaw: 0 };
    this.updateCamera();
    for (const layer of this.layers) layer.onSide?.(side);
  }

  applyRows(rows: FrameRows): void {
    const dirty = this.field.applyRows(rows);
    if (dirty.size === 0) return;
    for (const layer of this.layers) layer.onRows?.(dirty);
  }

  setBuildings(list: readonly MapBuilding[]): void {
    this.buildings = list;
  }

  setBoats(list: readonly MapBoat[]): void {
    this.boats = list;
  }

  playEffect(_id: RecipeId, _x: number, _y: number, _sizeTiles: number, _stroke: boolean): void {}

  liveEffects(): number {
    return 0;
  }

  screenToTile(sx: number, sy: number): TilePoint | null {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w <= 0 || h <= 0) return null;
    const ndcX = (sx / w) * 2 - 1;
    const ndcY = -(sy / h) * 2 + 1;
    const near = new THREE.Vector3(ndcX, ndcY, -1).unproject(this.cam);
    const far = new THREE.Vector3(ndcX, ndcY, 1).unproject(this.cam);
    const dir = far.sub(near);
    const o = this.cam.position;
    return pickTile([o.x, o.y, o.z], [dir.x, dir.y, dir.z], this.field);
  }

  /** Projects a tile centre at its height. Null when the point is behind the camera. */
  tileToScreen(x: number, y: number): ScreenPoint | null {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const p = new THREE.Vector3(x + 0.5, this.field.heightAt(x + 0.5, y + 0.5), y + 0.5);
    const view = p.clone().applyMatrix4(this.cam.matrixWorldInverse);
    if (view.z >= 0) return null;
    const ndc = p.project(this.cam);
    return { sx: ((ndc.x + 1) / 2) * w, sy: ((1 - ndc.y) / 2) * h };
  }

  /** Beings are drawn by the beings layer (Task 5); until then nothing is tappable. */
  beingAt(_sx: number, _sy: number, _slopPx: number): DrawBeing | null {
    return null;
  }

  frame(input: FrameInput): number {
    if (this.lost) return 0;
    const t0 = performance.now();
    for (const layer of this.layers) layer.frame(input, this.ctx);
    this.gl.render(this.scene, this.cam);
    return performance.now() - t0;
  }

  /** Percent of the device pixel ratio; the ladder forces 60. */
  setRenderScale(percent: number): void {
    this.renderScale = Math.min(Math.max(percent / 100, 0.1), 1);
    this.resize();
  }

  setFpsCap(fps: number): void {
    this.minFrameMs = fps > 0 ? 1000 / fps : 0;
  }

  onFrame(cb: (dtMs: number) => void): void {
    this.callbacks.push(cb);
  }

  /** Fits the drawing buffer to the host. The rig (focus tile and height) is kept. */
  resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (w <= 0 || h <= 0) return;
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * this.renderScale);
    this.gl.setSize(w, h, false);
    this.updateCamera();
  }

  stats(): { drawn: number; dots: number; atlas: ReturnType<Atlas['stats']> | null } {
    return { drawn: this.gl.info.render.calls, dots: 0, atlas: null };
  }

  /** Walks the focus at ground level: forward and strafe are -1..1 and dtMs the frame time. Keys and joystick call it. */
  walk(forward: number, strafe: number, dtMs: number): void {
    this.rigState = walkRig(this.rigState, forward, strafe, dtMs, WALK_TILES_PER_S, this.side);
    this.updateCamera();
  }

  /** Turns the view: dyaw turns it (positive is right), dpitch tilts it (positive looks up), both in radians. */
  look(dyaw: number, dpitch: number): void {
    this.rigState = rotateRig(this.rigState, dyaw);
    this.lookPitch = Math.min(Math.max(this.lookPitch + dpitch, LOOK_PITCH_MIN), LOOK_PITCH_MAX);
    this.updateCamera();
  }

  /** True at ground level (see isAtGround in rig.ts). */
  atGround(): boolean {
    return isAtGround(this.rigState.height, this.side);
  }

  /** A copy of the camera rig: height above the ground under the focus, focus tile, and yaw. */
  rig(): RigState {
    return { focus: { ...this.rigState.focus }, height: this.rigState.height, yaw: this.rigState.yaw };
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    for (const layer of this.layers) layer.dispose();
    this.gl.dispose();
    this.canvas.remove();
  }

  /** Writes the rig pose into the camera. Pitch is the X angle, and -yaw is the Y angle in YXZ order. */
  private updateCamera(): void {
    const pose = rigPose(this.rigState, this.side, (x, y) => this.field.heightAt(x, y));
    this.cam.position.set(pose.eye[0], pose.eye[1], pose.eye[2]);
    const tilt = this.atGround() ? this.lookPitch : 0;
    this.cam.rotation.set(pose.pitch + tilt, -this.rigState.yaw, 0, 'YXZ');
    this.cam.updateMatrixWorld(true);
  }

  private readonly onContextLost = (e: Event): void => {
    e.preventDefault();
    this.lost = true;
  };

  /** three.js restores its own GL state; the layers rebuild their meshes and textures for the current side. */
  private readonly onContextRestored = (): void => {
    this.lost = false;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * this.renderScale);
    this.resize();
    for (const layer of this.layers) layer.onSide?.(this.side);
    this.updateCamera();
  };

  private readonly tick = (now: number): void => {
    this.raf = requestAnimationFrame(this.tick);
    if (this.minFrameMs > 0 && now - this.lastFrameTs < this.minFrameMs - 1) return;
    const dt = Number.isFinite(this.lastFrameTs) ? now - this.lastFrameTs : 16;
    this.lastFrameTs = now;
    for (const cb of this.callbacks) cb(dt);
  };
}

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}
