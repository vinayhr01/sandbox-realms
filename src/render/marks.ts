/**
 * Map mark layer: beings as dots (folk and wild) and item marks on the map, drawn from the latest
 * snapshot only. Reads no sim memory. Positions are tile coordinates from the snapshot; the layer
 * converts them with the camera (CSS px per tile, offset of tile (0,0)). It redraws only when the
 * snapshot, the toggles or the camera change.
 *
 * Mark types with no position in the snapshot (armies, battles, boats, intrigues, campaigns, pacts)
 * are not drawn here: the snapshot carries no tile for them yet.
 */
import { Application, Container, Graphics } from 'pixi.js';
import type { Snapshot } from '../shared/protocol.ts';

const FOLK_COLOUR = 0xf2d18b;
const WILD_COLOUR = 0x8fd3a4;
const ITEM_COLOUR = 0xffb020;
const FAVOURITE_COLOUR = 0xff5fd2;
const BEING_RADIUS_PX = 1.5;
const ITEM_RADIUS_PX = 4;

/** The `marks.*` toggles this layer reads. */
export interface MarkToggles {
  items: boolean;
  favourites: boolean;
}

/** The camera state the layer needs. */
export interface MarkView {
  offX: number;
  offY: number;
  zoom: number;
}

export class MarkLayer {
  private readonly root = new Container();
  private readonly graphics = new Graphics();
  private key = '';

  constructor(app: Application) {
    this.root.addChild(this.graphics);
    app.stage.addChild(this.root);
  }

  /** Redraws when something it shows has changed; otherwise does nothing. */
  update(snap: Snapshot | null, toggles: MarkToggles, view: MarkView): void {
    const key = [snap?.tick ?? -1, snap?.mapPoints?.length ?? 0, toggles.items, toggles.favourites, view.offX, view.offY, view.zoom].join('|');
    if (key === this.key) return;
    this.key = key;
    const g = this.graphics;
    g.clear();
    if (!snap) return;
    const toScreen = (x: number, y: number): { sx: number; sy: number } => ({
      sx: view.offX + (x + 0.5) * view.zoom,
      sy: view.offY + (y + 0.5) * view.zoom,
    });

    // Beings: a dot each, by species group.
    const points = snap.mapPoints ?? [];
    const byId = new Map<number, { sx: number; sy: number }>();
    for (const p of points) {
      const { sx, sy } = toScreen(p.x, p.y);
      byId.set(p.id, { sx, sy });
      g.circle(sx, sy, BEING_RADIUS_PX).fill(p.folk ? FOLK_COLOUR : WILD_COLOUR);
    }

    // Items: a ring on each worn item whose holder has a position. Stored items have no tile.
    for (const item of snap.items?.rows ?? []) {
      if (item.holder !== 'worn') continue;
      const shown = toggles.items || (toggles.favourites && item.favourite);
      if (!shown) continue;
      const at = byId.get(item.at);
      if (!at) continue;
      const colour = toggles.favourites && item.favourite ? FAVOURITE_COLOUR : ITEM_COLOUR;
      g.circle(at.sx, at.sy, ITEM_RADIUS_PX).stroke({ width: 1.5, color: colour });
    }
  }
}
