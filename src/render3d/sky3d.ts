/**
 * The sky in 3D (spec "3D sky", call 6): the three.js Sky add-on, a moon with a glow sprite, a star dome, and fog that takes
 * the horizon colour. The sun and moon directions, star opacity and fog colour are pure functions of the day phase
 * (src/shared/daytime.ts), so the sky, the lighting and the sim all agree.
 *
 * The drawn phase comes from DayClock (src/render/day-clock.ts), shared with the 2D view: the sim phase up to 2x, a
 * steady forward drift above it. Behaviour never uses the drawn phase.
 *
 * Key `map3d.stars` in FrameInput.degradedOff turns the stars and the moon glow off on weak devices.
 */
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { FrameInput } from '../render/world-renderer.ts';
import { light01 } from '../shared/daytime.ts';
import { DayClock, drawnPhase, phaseOf, stepPhase } from '../render/day-clock.ts';
import { registerLayer, type Layer3D, type Layer3DContext } from './layer.ts';

export type Vec3 = [number, number, number];

// Re-exported for the 3D layers and tests that read the clock from here.
export { DayClock, drawnPhase, phaseOf, stepPhase };

/** The Sky shader places its box on the far plane, so this size only needs to contain the camera. */
const SKY_SCALE = 450000;
/** Stars sit on a dome this far from the camera, inside the far plane. */
const SKY_RADIUS = 150;
const STAR_COUNT = 600;
/** The moon sits this far from the camera, on its sky direction. */
const MOON_DISTANCE = 140;
const MOON_RADIUS = 5;
const GLOW_SIZE = 40;
const FOG_DAY = new THREE.Color(0xbcd6ea);
const FOG_NIGHT = new THREE.Color(0x0b1220);
const FOG_WARM = new THREE.Color(0xf0a070);
const MOON_COLOUR = 0xf2f0e0;

/** Night amount in [0, 1]: 1 at deep night, 0 by day, ramping through dawn and dusk. */
export function nightAmount(phase: number): number {
  return 1 - light01(phase);
}

/**
 * Unit vector from the scene towards the sun. Phase 0.25 is sunrise in the east, 0.5 noon high, 0.75 sunset in the west, 0
 * midnight below the horizon. A slight southern tilt keeps shadows from lining up with the grid.
 */
export function sunDirection(phase: number): Vec3 {
  const a = 2 * Math.PI * (phase - 0.25);
  const x = Math.cos(a) * 0.6;
  const y = Math.sin(a);
  const z = 0.3;
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

/** The moon is opposite the sun. */
export function moonDirection(phase: number): Vec3 {
  const [x, y, z] = sunDirection(phase);
  return [-x, -y, -z];
}

/** Star opacity: 0 by day, 1 at deep night. */
export function starOpacity(phase: number): number {
  return nightAmount(phase);
}

/** Fog takes the horizon colour: night-dark by night, pale blue by day, a warm band where the sun crosses the horizon. */
export function fogColour(phase: number): THREE.Color {
  const base = FOG_NIGHT.clone().lerp(FOG_DAY, light01(phase));
  const elev = sunDirection(phase)[1];
  const warm = 0.5 * Math.max(0, 1 - Math.abs(elev) / 0.3);
  return base.lerp(FOG_WARM, warm);
}

/** Star positions on the upper dome, from a fixed xorshift seed so every load shows the same sky. */
function starPositions(count: number): Float32Array {
  const out = new Float32Array(count * 3);
  let seed = 0x9e3779b9;
  const rnd = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const y = 0.05 + 0.95 * rnd();
    const r = Math.sqrt(1 - y * y);
    const theta = 2 * Math.PI * rnd();
    out[i * 3] = SKY_RADIUS * r * Math.cos(theta);
    out[i * 3 + 1] = SKY_RADIUS * y;
    out[i * 3 + 2] = SKY_RADIUS * r * Math.sin(theta);
  }
  return out;
}

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

export class Sky3D implements Layer3D {
  readonly id = 'sky';
  private readonly clock = new DayClock();
  private readonly fog = new THREE.Fog(0xbcd6ea, 60, 300);
  private ctx: Layer3DContext | null = null;
  private sky: Sky | null = null;
  private stars: THREE.Points | null = null;
  private starMat: THREE.PointsMaterial | null = null;
  private moon: THREE.Mesh | null = null;
  private moonMat: THREE.MeshBasicMaterial | null = null;
  private glow: THREE.Sprite | null = null;
  private glowMat: THREE.SpriteMaterial | null = null;
  private glowTex: THREE.CanvasTexture | null = null;

  init(ctx: Layer3DContext): void {
    this.ctx = ctx;
    const { scene } = ctx;

    const sky = new Sky();
    sky.scale.setScalar(SKY_SCALE);
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    const uniforms = sky.material.uniforms;
    const tune = (name: string, value: number): void => {
      const u = uniforms[name];
      if (u) u.value = value;
    };
    tune('turbidity', 2);
    tune('rayleigh', 2.5);
    tune('mieCoefficient', 0.005);
    tune('mieDirectionalG', 0.8);
    this.sky = sky;

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions(STAR_COUNT), 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.4,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.frustumCulled = false;

    this.moonMat = new THREE.MeshBasicMaterial({ color: MOON_COLOUR, fog: false });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_RADIUS, 16, 12), this.moonMat);
    this.glowTex = glowTexture();
    this.glowMat = new THREE.SpriteMaterial({
      map: this.glowTex,
      color: 0xcfdcff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.glow = new THREE.Sprite(this.glowMat);
    this.glow.scale.setScalar(GLOW_SIZE);

    scene.add(sky, this.stars, this.moon, this.glow);
    scene.fog = this.fog;
  }

  frame(input: FrameInput, ctx: Layer3DContext): void {
    const phase = this.clock.update(input);
    const sunDir = sunDirection(phase);
    const moonDir = moonDirection(phase);
    const cam = ctx.camera.position;

    this.sky?.material.uniforms.sunPosition?.value.set(sunDir[0], sunDir[1], sunDir[2]);

    // Fog follows the camera height, so the overview (high above the map) is never fogged and ground level fades to the horizon.
    // The tilted overview looks across the map from up to ~2.5 heights away, so haze starts beyond that.
    const near = 4 * Math.max(0, cam.y) + 60;
    this.fog.near = near;
    this.fog.far = near + 200;
    this.fog.color.copy(fogColour(phase));

    const starsOn = !input.degradedOff.has('map3d.stars');
    const opacity = starsOn ? starOpacity(phase) : 0;
    const moonUp = moonDir[1] > -0.02;
    if (this.stars && this.starMat) {
      this.stars.position.copy(cam);
      this.starMat.opacity = opacity;
      this.stars.visible = opacity > 0;
    }
    if (this.moon) {
      this.moon.position.set(cam.x + moonDir[0] * MOON_DISTANCE, cam.y + moonDir[1] * MOON_DISTANCE, cam.z + moonDir[2] * MOON_DISTANCE);
      this.moon.visible = moonUp;
    }
    if (this.glow && this.glowMat && this.moon) {
      this.glow.position.copy(this.moon.position);
      this.glowMat.opacity = starsOn ? nightAmount(phase) * 0.8 : 0;
      this.glow.visible = moonUp && starsOn;
    }
  }

  dispose(): void {
    const ctx = this.ctx;
    if (ctx) {
      if (this.sky) ctx.scene.remove(this.sky);
      if (this.stars) ctx.scene.remove(this.stars);
      if (this.moon) ctx.scene.remove(this.moon);
      if (this.glow) ctx.scene.remove(this.glow);
      if (ctx.scene.fog === this.fog) ctx.scene.fog = null;
    }
    this.sky?.geometry.dispose();
    this.sky?.material.dispose();
    this.stars?.geometry.dispose();
    this.starMat?.dispose();
    this.moon?.geometry.dispose();
    this.moonMat?.dispose();
    this.glowMat?.dispose();
    this.glowTex?.dispose();
    this.sky = null;
    this.stars = null;
    this.starMat = null;
    this.moon = null;
    this.moonMat = null;
    this.glow = null;
    this.glowMat = null;
    this.glowTex = null;
    this.ctx = null;
  }
}

registerLayer(() => new Sky3D());
