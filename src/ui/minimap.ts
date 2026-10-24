/**
 * Minimap (13 section 11): one pixel per tile, coloured by ground, with the camera's view as a
 * rectangle. It keeps its own copy of the ground ids, taken from the sim frame rows as they arrive,
 * so it never reads the renderer's texture. A tap or drag on it moves the camera.
 */
import { GROUNDS } from '../content/grounds.ts';
import type { FrameRows } from '../shared/protocol.ts';

/** The visible part of the map, in tile coordinates. */
export interface MinimapView {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class Minimap {
  private side = 0;
  private cells = new Uint8Array(0);
  private image: ImageData | null = null;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly colours = new Uint8Array(256 * 3);
  private readonly onJump: (tileX: number, tileY: number) => void;

  constructor(
    readonly canvas: HTMLCanvasElement,
    onJump: (tileX: number, tileY: number) => void,
  ) {
    this.onJump = onJump;
    this.ctx = canvas.getContext('2d');
    for (const g of GROUNDS) {
      const hex = parseInt(g.color.slice(1), 16);
      this.colours[g.id * 3] = (hex >> 16) & 0xff;
      this.colours[g.id * 3 + 1] = (hex >> 8) & 0xff;
      this.colours[g.id * 3 + 2] = hex & 0xff;
    }
    const jump = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      if (this.side === 0 || rect.width === 0) return;
      const tx = Math.floor(((e.clientX - rect.left) / rect.width) * this.side);
      const ty = Math.floor(((e.clientY - rect.top) / rect.height) * this.side);
      this.onJump(tx, ty);
    };
    canvas.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      canvas.setPointerCapture(e.pointerId);
      jump(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.buttons !== 0) jump(e);
    });
  }

  /** Starts a new realm of `side` tiles. */
  reset(side: number): void {
    this.side = side;
    this.cells = new Uint8Array(side * side);
    this.canvas.width = side;
    this.canvas.height = side;
    this.image = this.ctx ? this.ctx.createImageData(side, side) : null;
  }

  /** Copies the ground id (channel R) of each row in a frame. Rows are packed RGBA, `side` tiles each. */
  applyRows(rows: FrameRows, side: number): void {
    if (side !== this.side) return;
    const rowBytes = side * 4;
    for (let y = rows.y0; y <= rows.y1; y++) {
      const src = (y - rows.y0) * rowBytes;
      const dst = y * side;
      for (let x = 0; x < side; x++) this.cells[dst + x] = rows.data[src + x * 4] ?? 0;
    }
  }

  /** Paints the ground colours and, when given, the view rectangle. */
  draw(view: MinimapView | null): void {
    const ctx = this.ctx;
    if (!ctx || !this.image || this.side === 0) return;
    const px = this.image.data;
    for (let i = 0; i < this.cells.length; i++) {
      const g = (this.cells[i] ?? 0) * 3;
      px[i * 4] = this.colours[g] ?? 0;
      px[i * 4 + 1] = this.colours[g + 1] ?? 0;
      px[i * 4 + 2] = this.colours[g + 2] ?? 0;
      px[i * 4 + 3] = 255;
    }
    ctx.putImageData(this.image, 0, 0);
    if (view) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1, this.side / 128);
      const x0 = Math.max(0, view.x0);
      const y0 = Math.max(0, view.y0);
      const x1 = Math.min(this.side, view.x1);
      const y1 = Math.min(this.side, view.y1);
      ctx.strokeRect(x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
    }
  }
}
