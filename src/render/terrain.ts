import { Application, BufferImageSource, Geometry, Mesh, Shader, UniformGroup } from 'pixi.js';
import { GROUNDS } from '../content/grounds.ts';
import type { BrushShape, FrameRows } from '../shared/protocol.ts';
import { detailWeights } from './terrain-detail.ts';
import { TERRAIN_FRAG, TERRAIN_VERT } from './terrain-shader.ts';

/** Cursor shape codes used by the fragment shader (uCursor.w). */
const SHAPE_CODE: Record<BrushShape, number> = { circle: 0, square: 1, diamond: 2 };
/** One column per ground id. Ids run 0..GROUNDS.length-1 (33 kinds), so the row must hold at least that many. */
const PALETTE_WIDTH = 64;
/** Row 0: ground colours. Row 1: R = 255 for water and sea grounds, 0 for land. */
const PALETTE_HEIGHT = 2;
/**
 * Largest grid side (Titan, 576; 01 section 1). The index texture is allocated once at this size
 * so one shader serves every Realm; the shader's uView.w carries the live side.
 */
export const MAX_SIDE = 576;

export interface ViewState {
  /** Camera offset of tile (0,0) in CSS px. */
  offX: number;
  offY: number;
  /** CSS px per tile. */
  zoom: number;
  /** Device pixels per CSS pixel (Pixi resolution). */
  dpr: number;
}

export interface CursorState {
  /** Tile under the pointer, or null to hide the brush outline. */
  tile: { x: number; y: number } | null;
  radius: number;
  shape: BrushShape;
}

/**
 * Terrain renderer: one full-screen mesh whose fragment shader reads an RGBA8 index texture
 * (R ground id, G cover id, B elevation, A flags) and a palette texture (01 section 3, 17 section 12).
 * Sim frames carry packed rows of the index texture; they are copied in and uploaded.
 */
export class TerrainRenderer {
  readonly app: Application;
  private side = 0;
  private readonly indexData = new Uint8Array(MAX_SIDE * MAX_SIDE * 4);
  private readonly indexSource: BufferImageSource;
  private readonly paletteSource: BufferImageSource;
  private readonly uView = new Float32Array(4);
  private readonly uRes = new Float32Array(2);
  private readonly uCursor = new Float32Array(4);
  private readonly uDetail = new Float32Array(2);
  private readonly startedAt = performance.now();
  private readonly uniforms: UniformGroup;
  private pendingView: ViewState | null = null;
  private pendingCursor: CursorState | null = null;
  /** Quality-ladder gates on the two detail ramps (map.terrainMedium, map.terrainClose): off drops that weight to 0. */
  private detailMedium = true;
  private detailClose = true;

  private constructor(app: Application) {
    this.app = app;
    this.indexSource = new BufferImageSource({
      resource: this.indexData,
      width: MAX_SIDE,
      height: MAX_SIDE,
      format: 'rgba8unorm',
      // The A channel holds flags, not opacity: premultiplying on upload would zero the RGB.
      alphaMode: 'no-premultiply-alpha',
      scaleMode: 'nearest',
    });
    const palette = new Uint8Array(PALETTE_WIDTH * PALETTE_HEIGHT * 4);
    for (const g of GROUNDS) {
      const hex = parseInt(g.color.slice(1), 16);
      palette[g.id * 4] = (hex >> 16) & 0xff;
      palette[g.id * 4 + 1] = (hex >> 8) & 0xff;
      palette[g.id * 4 + 2] = hex & 0xff;
      palette[g.id * 4 + 3] = 255;
      if (g.layer === 'water' || g.sea) palette[(PALETTE_WIDTH + g.id) * 4] = 255;
    }
    this.paletteSource = new BufferImageSource({
      resource: palette,
      width: PALETTE_WIDTH,
      height: PALETTE_HEIGHT,
      format: 'rgba8unorm',
      alphaMode: 'no-premultiply-alpha',
      scaleMode: 'nearest',
    });
    this.uniforms = new UniformGroup({
      uView: { value: this.uView, type: 'vec4<f32>' },
      uRes: { value: this.uRes, type: 'vec2<f32>' },
      uCursor: { value: this.uCursor, type: 'vec4<f32>' },
      uDetail: { value: this.uDetail, type: 'vec2<f32>' },
      uTime: { value: 0, type: 'f32' },
    });
  }

  static async create(host: HTMLElement): Promise<TerrainRenderer> {
    const app = new Application();
    await app.init({
      preference: 'webgl',
      resizeTo: host,
      backgroundColor: 0x12141a,
      antialias: false,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    host.appendChild(app.canvas);
    app.canvas.style.touchAction = 'none';

    const renderer = new TerrainRenderer(app);
    const geometry = new Geometry({
      attributes: {
        aPosition: {
          buffer: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
          format: 'float32x2',
        },
      },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    });
    const shader = Shader.from({
      gl: { vertex: TERRAIN_VERT, fragment: TERRAIN_FRAG },
      resources: {
        uIndex: renderer.indexSource,
        uIndexSampler: renderer.indexSource.style,
        uPalette: renderer.paletteSource,
        uPaletteSampler: renderer.paletteSource.style,
        terrainUniforms: renderer.uniforms,
      },
    });
    app.stage.addChild(new Mesh<Geometry, Shader>({ geometry, shader }));
    app.ticker.add(() => renderer.syncUniforms());
    return renderer;
  }

  /**
   * Applies the Performance render scale (50 to 100 percent) to the Pixi resolution: the device-pixel
   * ratio (capped at 2, as in create) times the scale. Uses the renderer resize call with a resolution
   * argument (Pixi v8). UNVERIFIED: written from the v8 documented API, not run or checked against typings.
   */
  setRenderScale(percent: number): void {
    const scale = Math.min(100, Math.max(50, percent)) / 100;
    const next = Math.min(window.devicePixelRatio || 1, 2) * scale;
    const renderer = this.app.renderer;
    if (Math.abs(renderer.resolution - next) < 1e-6) return;
    renderer.resize(this.app.screen.width, this.app.screen.height, next);
  }

  /** Sets the live grid side for the next draw. The texture itself is fixed at MAX_SIDE. */
  setSide(side: number): void {
    if (side > MAX_SIDE) throw new RangeError(`grid side ${side} exceeds ${MAX_SIDE}`);
    this.side = side;
    this.indexData.fill(0);
    this.indexSource.update();
  }

  /** Copies packed rows from a sim frame into the index texture and uploads it. */
  applyRows(rows: FrameRows): void {
    const rowBytes = this.side * 4;
    for (let y = rows.y0; y <= rows.y1; y++) {
      const src = (y - rows.y0) * rowBytes;
      this.indexData.set(rows.data.subarray(src, src + rowBytes), y * MAX_SIDE * 4);
    }
    this.indexSource.update();
  }

  /** Turns the medium and close detail ramps on or off (the quality ladder). */
  setDetailToggles(medium: boolean, close: boolean): void {
    this.detailMedium = medium;
    this.detailClose = close;
  }

  /** Current camera and cursor state for the next draw. */
  setView(view: ViewState, cursor: CursorState): void {
    this.pendingView = view;
    this.pendingCursor = cursor;
  }

  private syncUniforms(): void {
    const v = this.pendingView;
    const c = this.pendingCursor;
    const dpr = v?.dpr ?? 1;
    // gl_FragCoord is in device pixels, so use the backing store size.
    this.uView.set([(v?.offX ?? 0) * dpr, (v?.offY ?? 0) * dpr, (v?.zoom ?? 1) * dpr, this.side]);
    this.uRes.set([this.app.canvas.width, this.app.canvas.height]);
    if (c?.tile) {
      this.uCursor.set([c.tile.x, c.tile.y, c.radius, SHAPE_CODE[c.shape]]);
    } else {
      this.uCursor.set([0, 0, 0, -1]);
    }
    // The detail ramps take CSS px per tile; uView.z is in device px, so divide by dpr.
    const detail = detailWeights(this.uView[2]! / dpr);
    this.uDetail.set([detail.medium * (this.detailMedium ? 1 : 0), detail.close * (this.detailClose ? 1 : 0)]);
    this.uniforms.uniforms.uTime = (performance.now() - this.startedAt) / 1000;
    this.uniforms.update();
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }
}
