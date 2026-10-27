/**
 * 2D camera over the tile grid. Units are CSS pixels; `zoom` is CSS px per tile and
 * (offX, offY) is the on-screen position of tile (0,0)'s top-left corner.
 * Pure: no DOM, so it is unit-tested directly.
 */

/** Keep at least this many tiles of map visible at the edges when panned (13 section 9). */
const EDGE_MARGIN_PX = 16;
/** Zoom range relative to the fit-to-screen zoom (13 section 9: 0.4x..8x of base; TUNE). */
const MIN_FACTOR = 0.5;
const MAX_FACTOR = 8;
/** Absolute upper limit in CSS px per tile: at this zoom a creature icon is at its largest (creatures.ts). */
const MAX_ZOOM_PX = 96;

export interface TilePoint {
  x: number;
  y: number;
}

export class Camera {
  zoom = 1;
  offX = 0;
  offY = 0;
  private fitZoom = 1;

  constructor(
    readonly side: number,
    private viewW: number,
    private viewH: number,
  ) {
    this.fit(viewW, viewH);
  }

  /** Sets the viewport size and re-clamps; zoom is kept unless it falls outside the new range. */
  resize(viewW: number, viewH: number): void {
    this.viewW = viewW;
    this.viewH = viewH;
    this.fitZoom = Math.min(viewW, viewH) / this.side;
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);
    this.clampOffset();
  }

  /** Shows the whole grid, centred. */
  fit(viewW: number, viewH: number): void {
    this.viewW = viewW;
    this.viewH = viewH;
    this.fitZoom = Math.min(viewW, viewH) / this.side;
    this.zoom = this.fitZoom;
    this.offX = (viewW - this.side * this.zoom) / 2;
    this.offY = (viewH - this.side * this.zoom) / 2;
  }

  get minZoom(): number {
    return this.fitZoom * MIN_FACTOR;
  }

  get maxZoom(): number {
    return Math.min(this.fitZoom * MAX_FACTOR, MAX_ZOOM_PX);
  }

  /** Continuous tile coordinates under a screen point (not floored). */
  screenToTile(sx: number, sy: number): TilePoint {
    return { x: (sx - this.offX) / this.zoom, y: (sy - this.offY) / this.zoom };
  }

  /** Multiplies zoom by `factor`, keeping the tile under (sx, sy) fixed on screen. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const next = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    const ratio = next / this.zoom;
    this.offX = sx - (sx - this.offX) * ratio;
    this.offY = sy - (sy - this.offY) * ratio;
    this.zoom = next;
    this.clampOffset();
  }

  panBy(dx: number, dy: number): void {
    this.offX += dx;
    this.offY += dy;
    this.clampOffset();
  }

  private clampOffset(): void {
    const mapPx = this.side * this.zoom;
    this.offX = clampAxis(this.offX, mapPx, this.viewW);
    this.offY = clampAxis(this.offY, mapPx, this.viewH);
  }
}

/** Centres a map smaller than the view; otherwise keeps a small margin of map on screen. */
function clampAxis(off: number, mapPx: number, viewPx: number): number {
  if (mapPx + 2 * EDGE_MARGIN_PX <= viewPx) return (viewPx - mapPx) / 2;
  return clamp(off, viewPx - mapPx - EDGE_MARGIN_PX, EDGE_MARGIN_PX);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
