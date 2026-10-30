/**
 * The 3D terrain layer: chunked height-field meshes with per-vertex ground colours, per-tile water, the insight layer
 * tint and the brush ring. Registers itself with the Layer3D registry (layer.ts).
 *
 * The insight tint is one side x side float texture, one texel per tile (linear RGB, alpha = the 2D tint strength).
 * It is filled from the snapshot's parcel ids with the same keys the 2D insight layer uses (src/render/insight-keys.ts,
 * which both views import).
 *
 * There is no age overlay: the 2D view has no age tint (`map.ageEffects` is declared in options.ts but nothing reads it),
 * so the 3D terrain does not draw one either.
 */
import * as THREE from 'three';
import type { BrushShape, MapGroup, MapTiles } from '../shared/protocol.ts';
import { decodeParcels } from '../shared/parcel-codec.ts';
import type { FrameInput } from '../render/world-renderer.ts';
import { registerLayer, type Layer3D, type Layer3DContext } from './layer.ts';
import { CHUNK, buildChunk, chunkLod, hexToLinear } from './terrain-mesh.ts';
import { buildWaterChunk } from './water3d.ts';
import { BEING_LAYERS, dominionKey, groupKey, PALETTE, TINT_ALPHA, type ParcelOwners } from '../render/insight-keys.ts';

/** Insight palette, linear RGB for the tint texture. */
const INSIGHT_LINEAR: readonly (readonly [number, number, number])[] = PALETTE.map(hexToLinear);
/** The close-detail degrade removes the LOD detail beyond this many tiles. */
const CLOSE_TILES = 24;
const SHAPE_CODE: Record<BrushShape, number> = { circle: 0, square: 1, diamond: 2 };
/** Brush outline width in tiles. */
const RING_WIDTH = 0.06;

const VERT_HEAD = `#include <common>
varying vec3 vWorldPos;`;
const VERT_WORLD = `#include <project_vertex>
  vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`;

const FRAG_HEAD = `#include <common>
varying vec3 vWorldPos;
uniform sampler2D uInsight;
uniform float uInsightOn;
uniform float uSide;
uniform vec4 uCursor;`;

/** Insight tint, then the brush outline, on the lit base colour (before lighting). */
const FRAG_TINT = `#include <color_fragment>
  vec2 tileF = vWorldPos.xz;
  if (uInsightOn > 0.5) {
    vec4 tint = texture(uInsight, (floor(tileF) + 0.5) / uSide);
    diffuseColor.rgb = mix(diffuseColor.rgb, tint.rgb, tint.a);
  }
  if (uCursor.w >= 0.0) {
    vec2 delta = tileF - (uCursor.xy + 0.5);
    float dist;
    if (uCursor.w < 0.5) {
      dist = length(delta);
    } else if (uCursor.w < 1.5) {
      dist = max(abs(delta.x), abs(delta.y));
    } else {
      dist = abs(delta.x) + abs(delta.y);
    }
    float ringAt = uCursor.z + 0.5;
    float ring = 1.0 - smoothstep(${RING_WIDTH.toFixed(3)} * 0.5, ${RING_WIDTH.toFixed(3)}, abs(dist - ringAt));
    float fill = dist < ringAt ? 0.10 : 0.0;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), fill);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.95, 0.6), ring * 0.9);
  }`;

interface ChunkMeshes {
  cx: number;
  cy: number;
  lod: 1 | 2 | 4;
  terrain: THREE.Mesh | null;
  water: THREE.Mesh | null;
}

function makeInsightTexture(n: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Float32Array(n * n * 4), n, n, THREE.RGBAFormat, THREE.FloatType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Fills the tint texture: one texel per tile, linear RGB and TINT_ALPHA, or zero where the parcel has no key. */
function fillInsightTint(data: Float32Array, side: number, tiles: MapTiles, layer: string, mode: string): void {
  data.fill(0);
  const n = tiles.perAxis;
  const size = tiles.size;
  if (n <= 0 || size <= 0) return;
  const groups = new Map<number, MapGroup>();
  for (const g of tiles.groups) groups.set(g.id, g);
  const owners: ParcelOwners = { dominion: decodeParcels(tiles.dominion), hamlet: decodeParcels(tiles.hamlet), groups };
  const keys = new Int32Array(n * n);
  for (let p = 0; p < n * n; p++) {
    if (mode === 'parent') keys[p] = dominionKey(owners, p);
    else if (mode === 'borders' && !BEING_LAYERS.has(layer)) keys[p] = groupKey(layer, owners, p);
  }
  for (let y = 0; y < side; y++) {
    const row = Math.floor(y / size);
    if (row >= n) break;
    for (let x = 0; x < side; x++) {
      const col = Math.floor(x / size);
      if (col >= n) break;
      const k = keys[row * n + col] ?? 0;
      if (k === 0) continue;
      const c = INSIGHT_LINEAR[(k - 1) % INSIGHT_LINEAR.length] ?? [1, 1, 1];
      const o = (y * side + x) * 4;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = TINT_ALPHA;
    }
  }
}

export class Terrain3D implements Layer3D {
  readonly id = 'terrain';
  private side = 0;
  private cols = 0;
  private chunks: ChunkMeshes[] = [];
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly waterMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.82, depthWrite: false });
  private insight: THREE.DataTexture = makeInsightTexture(1);
  private insightKey = '';
  private detailMedium = true;
  private detailClose = true;
  private readonly uniforms = {
    uInsight: { value: this.insight as THREE.Texture },
    uInsightOn: { value: 0 },
    uSide: { value: 1 },
    uCursor: { value: new THREE.Vector4(0, 0, 0, -1) },
  };
  private ctx: Layer3DContext | null = null;

  constructor() {
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', VERT_HEAD).replace('#include <project_vertex>', VERT_WORLD);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', FRAG_HEAD).replace('#include <color_fragment>', FRAG_TINT);
    };
  }

  init(ctx: Layer3DContext): void {
    this.ctx = ctx;
  }

  onSide(side: number): void {
    if (!this.ctx) return;
    this.disposeChunks();
    this.side = side;
    this.cols = Math.ceil(side / CHUNK);
    const rows = this.cols;
    this.setInsightSize(side);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const chunk: ChunkMeshes = { cx, cy, lod: 1, terrain: null, water: null };
        chunk.lod = this.lodFor(cx, cy);
        this.chunks.push(chunk);
        this.build(chunk);
      }
    }
  }

  onRows(dirty: ReadonlySet<number>): void {
    // A tile row y touches corner rows y and y + 1, and a corner on a chunk edge belongs to both chunks.
    const chunkRows = new Set<number>();
    for (const y of dirty) {
      chunkRows.add(Math.floor(y / CHUNK));
      chunkRows.add(Math.floor((y + 1) / CHUNK));
    }
    for (const c of this.chunks) if (chunkRows.has(c.cy)) this.build(c);
  }

  frame(input: FrameInput, ctx: Layer3DContext): void {
    this.ctx = ctx;
    this.detailMedium = !input.degradedOff.has('map.terrainMedium');
    this.detailClose = !input.degradedOff.has('map.terrainClose');
    const c = input.cursor;
    if (c.tile) this.uniforms.uCursor.value.set(c.tile.x, c.tile.y, c.radius, SHAPE_CODE[c.shape]);
    else this.uniforms.uCursor.value.set(0, 0, 0, -1);
    this.updateInsight(input);
    for (const chunk of this.chunks) {
      const lod = this.lodFor(chunk.cx, chunk.cy);
      if (lod !== chunk.lod) {
        chunk.lod = lod;
        this.build(chunk);
      }
    }
  }

  dispose(): void {
    this.disposeChunks();
    this.material.dispose();
    this.waterMaterial.dispose();
    this.insight.dispose();
    this.ctx = null;
  }

  private updateInsight(input: FrameInput): void {
    const t = input.insight;
    const tiles = input.snapshot?.mapTiles;
    const on = t.layer !== 'off' && tiles !== undefined && (t.mode === 'parent' || t.mode === 'borders');
    this.uniforms.uInsightOn.value = on ? 1 : 0;
    if (!on || !tiles) return;
    const key = `${input.snapshot?.tick ?? -1}|${t.layer}|${t.mode}|${this.side}`;
    if (key === this.insightKey) return;
    this.insightKey = key;
    fillInsightTint(this.insight.image.data as Float32Array, this.side, tiles, t.layer, t.mode);
    this.insight.needsUpdate = true;
  }

  private setInsightSize(side: number): void {
    this.insight.dispose();
    const n = Math.max(1, side);
    this.insight = makeInsightTexture(n);
    this.uniforms.uInsight.value = this.insight;
    this.uniforms.uSide.value = n;
    this.insightKey = '';
  }

  /** Level of detail of a chunk from its distance to the camera, with the quality-ladder steps applied. */
  private lodFor(cx: number, cy: number): 1 | 2 | 4 {
    if (!this.ctx) return 1;
    const cam = this.ctx.camera.position;
    const x = cx * CHUNK + CHUNK / 2;
    const y = cy * CHUNK + CHUNK / 2;
    const d = Math.hypot(x - cam.x, y - cam.z);
    let lod = chunkLod(d);
    if (!this.detailMedium && lod < 2) lod = 2;
    if (!this.detailClose && d > CLOSE_TILES) lod = 4;
    return lod;
  }

  /** Rebuilds the terrain and water meshes of one chunk from the field at its current level of detail. */
  private build(c: ChunkMeshes): void {
    if (!this.ctx) return;
    this.dropChunk(c);
    const field = this.ctx.field;
    const land = buildChunk(field, c.cx, c.cy, c.lod);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(land.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(land.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(land.indices, 1));
    geometry.computeVertexNormals();
    const terrain = new THREE.Mesh(geometry, this.material);
    terrain.name = 'terrain';
    terrain.userData = { kind: 'terrain', cx: c.cx, cy: c.cy };
    this.ctx.scene.add(terrain);
    c.terrain = terrain;

    const w = buildWaterChunk(field, c.cx, c.cy);
    if (w) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.BufferAttribute(w.positions, 3));
      wg.setAttribute('color', new THREE.BufferAttribute(w.colors, 3));
      wg.setIndex(new THREE.BufferAttribute(w.indices, 1));
      wg.computeVertexNormals();
      const water = new THREE.Mesh(wg, this.waterMaterial);
      water.name = 'water';
      water.userData = { kind: 'water', cx: c.cx, cy: c.cy };
      this.ctx.scene.add(water);
      c.water = water;
    }
  }

  private dropChunk(c: ChunkMeshes): void {
    for (const m of [c.terrain, c.water]) {
      if (!m) continue;
      m.removeFromParent();
      m.geometry.dispose();
    }
    c.terrain = null;
    c.water = null;
  }

  private disposeChunks(): void {
    for (const c of this.chunks) this.dropChunk(c);
    this.chunks = [];
  }
}

registerLayer(() => new Terrain3D());
