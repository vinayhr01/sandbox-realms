/**
 * Map mark layer: item marks, armies, campaigns, battles, pact links, intrigues and hamlet nameplates, drawn from
 * the latest snapshot only. Reads no sim memory. Positions are tile coordinates from the snapshot; the layer converts
 * them with the camera (CSS px per tile, offset of tile (0,0)). It redraws only when the snapshot, the toggles or the
 * camera change. Beings, hamlet buildings and boats are drawn by the creature layer (creatures.ts).
 *
 * Intrigues are drawn at the tile of the dominion or hamlet they target, for running intrigues only.
 */
import { Application, Container, Graphics, Text } from 'pixi.js';
import type { MapIntrigue, MapMarks, Snapshot } from '../shared/protocol.ts';

const ITEM_COLOUR = 0xffb020;
const FAVOURITE_COLOUR = 0xff5fd2;
const ARMY_COLOUR = 0xff8c42;
const CAMPAIGN_COLOUR = 0xff3b3b;
const BATTLE_COLOUR = 0xffffff;
const LINK_COLOUR = 0x9fb6ff;
const HAMLET_COLOUR = 0xffe9a8;
const REBELLION_COLOUR = 0xff4d6d;
const SCHEME_COLOUR = 0xb388ff;
const ITEM_RADIUS_PX = 4;
const ARMY_HALF_PX = 3;
const CAMPAIGN_RADIUS_PX = 6;
const BATTLE_HALF_PX = 4;
const INTRIGUE_HALF_PX = 5;
const HAMLET_DOT_PX = 2.5;
const LABEL_OFFSET_PX = 5;
/** Nameplate font size at `ui.scaleNames` 100 percent (CSS px). The spec default of 70 gives 11.2 px, about today's size. */
const LABEL_BASE_PX = 16;
const NAME_SCALE_MIN = 30;
const NAME_SCALE_MAX = 160;

/** The `marks.*` and `map.*` toggles this layer reads. */
export interface MarkToggles {
  items: boolean;
  favourites: boolean;
  armies: boolean;
  campaigns: boolean;
  battles: boolean;
  /** `marks.intrigues`: running intrigues at their target. */
  intrigues: boolean;
  /** `map.names`: full draws the name, banner draws only the dot, off draws nothing. */
  names: 'full' | 'banner' | 'off';
  /** `map.favouritesOnlyNames`: only favourites get a name. No hamlet is a favourite, so hamlet names are hidden. */
  favouritesOnlyNames: boolean;
  /** `ui.scaleNames`: nameplate text size in percent (30 to 160). */
  nameScale: number;
}

/** Axis-aligned box in screen px, for the nameplate overlap test. */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Nameplate font size (CSS px) for a `ui.scaleNames` percentage, clamped to its range. */
export function nameFontPx(percent: number): number {
  const p = Math.min(NAME_SCALE_MAX, Math.max(NAME_SCALE_MIN, percent));
  return (LABEL_BASE_PX * p) / 100;
}

/** The camera state the layer needs. */
export interface MarkView {
  offX: number;
  offY: number;
  zoom: number;
  /** Viewport size in CSS px (for culling sprites to the screen). */
  viewW: number;
  viewH: number;
}

/** Screen position of a tile centre under the camera. */
function toScreen(view: MarkView, x: number, y: number): { sx: number; sy: number } {
  return { sx: view.offX + (x + 0.5) * view.zoom, sy: view.offY + (y + 0.5) * view.zoom };
}

export class MarkLayer {
  private readonly root = new Container();
  private readonly graphics = new Graphics();
  private readonly labels = new Container();
  private readonly labelPool: Text[] = [];
  private key = '';

  constructor(app: Application) {
    // The mark graphics under the labels.
    this.root.addChild(this.graphics);
    this.root.addChild(this.labels);
    app.stage.addChild(this.root);
  }

  /** Redraws when something it shows has changed; otherwise does nothing. */
  update(snap: Snapshot | null, toggles: MarkToggles, view: MarkView): void {
    const key = [
      snap?.tick ?? -1,
      snap?.mapPoints?.length ?? 0,
      snap?.mapMarks ? 1 : 0,
      toggles.items,
      toggles.favourites,
      toggles.armies,
      toggles.campaigns,
      toggles.battles,
      toggles.intrigues,
      toggles.names,
      toggles.favouritesOnlyNames,
      toggles.nameScale,
      view.offX,
      view.offY,
      view.zoom,
      view.viewW,
      view.viewH,
    ].join('|');
    if (key === this.key) return;
    this.key = key;
    const g = this.graphics;
    g.clear();
    this.hideLabels();
    if (!snap) return;

    // Items need the tile of their holder on screen, so the sampled Beings' ids are mapped here.
    const points = snap.mapPoints ?? [];
    const byId = new Map<number, { sx: number; sy: number }>();
    for (const p of points) byId.set(p.id, toScreen(view, p.x, p.y));

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

    if (toggles.intrigues && snap.mapIntrigues) this.drawIntrigues(snap.mapIntrigues, view);

    const marks = snap.mapMarks;
    if (marks) this.drawMarks(marks, toggles, view);
  }

  private drawMarks(marks: MapMarks, toggles: MarkToggles, view: MarkView): void {
    const g = this.graphics;
    const toScreenAt = (x: number, y: number): { sx: number; sy: number } => toScreen(view, x, y);

    // Pact links sit under the army squares. They are drawn with the armies toggle (pacts have no toggle of their own).
    if (toggles.armies) {
      for (const [x1, y1, x2, y2] of marks.pactLinks) {
        const a = toScreenAt(x1, y1);
        const b = toScreenAt(x2, y2);
        g.moveTo(a.sx, a.sy).lineTo(b.sx, b.sy).stroke({ width: 1, color: LINK_COLOUR, alpha: 0.6 });
      }
      for (const army of marks.armies) {
        const { sx, sy } = toScreenAt(army.x, army.y);
        g.rect(sx - ARMY_HALF_PX, sy - ARMY_HALF_PX, ARMY_HALF_PX * 2, ARMY_HALF_PX * 2).fill(ARMY_COLOUR);
      }
    }

    if (toggles.campaigns) {
      for (const c of marks.campaigns) {
        const { sx, sy } = toScreenAt(c.x, c.y);
        g.circle(sx, sy, CAMPAIGN_RADIUS_PX).stroke({ width: 1.5, color: CAMPAIGN_COLOUR });
      }
    }

    if (toggles.battles) {
      for (const b of marks.battles) {
        const { sx, sy } = toScreenAt(b.x, b.y);
        g.moveTo(sx - BATTLE_HALF_PX, sy - BATTLE_HALF_PX).lineTo(sx + BATTLE_HALF_PX, sy + BATTLE_HALF_PX).stroke({ width: 1.5, color: BATTLE_COLOUR });
        g.moveTo(sx + BATTLE_HALF_PX, sy - BATTLE_HALF_PX).lineTo(sx - BATTLE_HALF_PX, sy + BATTLE_HALF_PX).stroke({ width: 1.5, color: BATTLE_COLOUR });
      }
    }

    // Hamlet names. Hamlets carry no favourite flag, so favourites-only names show none.
    if (toggles.names === 'off' || toggles.favouritesOnlyNames) return;
    const showText = toggles.names === 'full';
    const fontPx = nameFontPx(toggles.nameScale);
    // Names are placed in order and a name that would overlap one already placed is hidden (its dot stays).
    const placed: Box[] = [];
    let used = 0;
    for (const h of marks.hamlets) {
      const { sx, sy } = toScreenAt(h.x, h.y);
      g.circle(sx, sy, HAMLET_DOT_PX).fill(HAMLET_COLOUR);
      if (!showText) continue;
      const label = this.labelAt(used);
      label.text = h.name;
      if (label.style.fontSize !== fontPx) label.style.fontSize = fontPx;
      const x0 = sx + LABEL_OFFSET_PX;
      const y0 = sy - LABEL_OFFSET_PX;
      const box: Box = { x0, y0, x1: x0 + label.width, y1: y0 + label.height };
      if (placed.some((other) => boxesOverlap(box, other))) continue;
      placed.push(box);
      label.position.set(x0, y0);
      label.visible = true;
      used++;
    }
  }

  /** Running intrigues at their target tile (x, y of -1 is unplaced and skipped). Rebellions are drawn as squares, schemes as diamonds. */
  private drawIntrigues(intrigues: readonly MapIntrigue[], view: MarkView): void {
    const g = this.graphics;
    for (const it of intrigues) {
      if (!it.active || it.x < 0 || it.y < 0) continue;
      const { sx, sy } = toScreen(view, it.x, it.y);
      const colour = it.kind === 'rebellion' ? REBELLION_COLOUR : SCHEME_COLOUR;
      const r = INTRIGUE_HALF_PX;
      if (it.kind === 'rebellion') {
        g.rect(sx - r, sy - r, r * 2, r * 2).stroke({ width: 1.5, color: colour });
      } else {
        g.moveTo(sx, sy - r).lineTo(sx + r, sy).lineTo(sx, sy + r).lineTo(sx - r, sy).closePath().stroke({ width: 1.5, color: colour });
      }
    }
  }

  /** The pooled label at index i, created on first use. */
  private labelAt(i: number): Text {
    let label = this.labelPool[i];
    if (!label) {
      label = new Text({
        text: '',
        style: { fontFamily: 'system-ui, sans-serif', fontSize: nameFontPx(70), fill: HAMLET_COLOUR, stroke: { color: 0x000000, width: 3 } },
      });
      this.labelPool.push(label);
      this.labels.addChild(label);
    }
    return label;
  }

  private hideLabels(): void {
    for (const label of this.labelPool) label.visible = false;
  }
}
