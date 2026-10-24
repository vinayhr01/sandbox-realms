/**
 * Map mark layer: beings as dots (folk and wild), item marks, armies, campaigns, battles, pact links
 * and hamlet nameplates, drawn from the latest snapshot only. Reads no sim memory. Positions are tile
 * coordinates from the snapshot; the layer converts them with the camera (CSS px per tile, offset of
 * tile (0,0)). It redraws only when the snapshot, the toggles or the camera change.
 *
 * Not drawn here: intrigues (the group is a plain id that can be a dominion or a hamlet, and no intrigue
 * is started in play, so no position is carried) and boats (the sim has no boat entity). Both rows stay
 * non-live in the Settings table.
 */
import { Application, Container, Graphics, Text } from 'pixi.js';
import type { MapMarks, Snapshot } from '../shared/protocol.ts';

const FOLK_COLOUR = 0xf2d18b;
const WILD_COLOUR = 0x8fd3a4;
const ITEM_COLOUR = 0xffb020;
const FAVOURITE_COLOUR = 0xff5fd2;
const ARMY_COLOUR = 0xff8c42;
const CAMPAIGN_COLOUR = 0xff3b3b;
const BATTLE_COLOUR = 0xffffff;
const LINK_COLOUR = 0x9fb6ff;
const HAMLET_COLOUR = 0xffe9a8;
const BEING_RADIUS_PX = 1.5;
const ITEM_RADIUS_PX = 4;
const ARMY_HALF_PX = 3;
const CAMPAIGN_RADIUS_PX = 6;
const BATTLE_HALF_PX = 4;
const HAMLET_DOT_PX = 2.5;
const LABEL_OFFSET_PX = 5;
const LABEL_FONT_PX = 11;

/** The `marks.*` and `map.*` toggles this layer reads. */
export interface MarkToggles {
  items: boolean;
  favourites: boolean;
  armies: boolean;
  campaigns: boolean;
  battles: boolean;
  /** `map.names`: full draws the name, banner draws only the dot, off draws nothing. */
  names: 'full' | 'banner' | 'off';
  /** `map.favouritesOnlyNames`: only favourites get a name. No hamlet is a favourite, so hamlet names are hidden. */
  favouritesOnlyNames: boolean;
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
  private readonly labels = new Container();
  private readonly labelPool: Text[] = [];
  private key = '';

  constructor(app: Application) {
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
      toggles.names,
      toggles.favouritesOnlyNames,
      view.offX,
      view.offY,
      view.zoom,
    ].join('|');
    if (key === this.key) return;
    this.key = key;
    const g = this.graphics;
    g.clear();
    this.hideLabels();
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

    const marks = snap.mapMarks;
    if (marks) this.drawMarks(marks, toggles, toScreen);
  }

  private drawMarks(marks: MapMarks, toggles: MarkToggles, toScreen: (x: number, y: number) => { sx: number; sy: number }): void {
    const g = this.graphics;

    // Pact links sit under the army squares. They are drawn with the armies toggle (pacts have no toggle of their own).
    if (toggles.armies) {
      for (const [x1, y1, x2, y2] of marks.pactLinks) {
        const a = toScreen(x1, y1);
        const b = toScreen(x2, y2);
        g.moveTo(a.sx, a.sy).lineTo(b.sx, b.sy).stroke({ width: 1, color: LINK_COLOUR, alpha: 0.6 });
      }
      for (const army of marks.armies) {
        const { sx, sy } = toScreen(army.x, army.y);
        g.rect(sx - ARMY_HALF_PX, sy - ARMY_HALF_PX, ARMY_HALF_PX * 2, ARMY_HALF_PX * 2).fill(ARMY_COLOUR);
      }
    }

    if (toggles.campaigns) {
      for (const c of marks.campaigns) {
        const { sx, sy } = toScreen(c.x, c.y);
        g.circle(sx, sy, CAMPAIGN_RADIUS_PX).stroke({ width: 1.5, color: CAMPAIGN_COLOUR });
      }
    }

    if (toggles.battles) {
      for (const b of marks.battles) {
        const { sx, sy } = toScreen(b.x, b.y);
        g.moveTo(sx - BATTLE_HALF_PX, sy - BATTLE_HALF_PX).lineTo(sx + BATTLE_HALF_PX, sy + BATTLE_HALF_PX).stroke({ width: 1.5, color: BATTLE_COLOUR });
        g.moveTo(sx + BATTLE_HALF_PX, sy - BATTLE_HALF_PX).lineTo(sx - BATTLE_HALF_PX, sy + BATTLE_HALF_PX).stroke({ width: 1.5, color: BATTLE_COLOUR });
      }
    }

    // Hamlet names. Hamlets carry no favourite flag, so favourites-only names show none.
    if (toggles.names === 'off' || toggles.favouritesOnlyNames) return;
    const showText = toggles.names === 'full';
    let used = 0;
    for (const h of marks.hamlets) {
      const { sx, sy } = toScreen(h.x, h.y);
      g.circle(sx, sy, HAMLET_DOT_PX).fill(HAMLET_COLOUR);
      if (!showText) continue;
      const label = this.labelAt(used++);
      label.text = h.name;
      label.position.set(sx + LABEL_OFFSET_PX, sy - LABEL_OFFSET_PX);
      label.visible = true;
    }
  }

  /** The pooled label at index i, created on first use. */
  private labelAt(i: number): Text {
    let label = this.labelPool[i];
    if (!label) {
      label = new Text({
        text: '',
        style: { fontFamily: 'system-ui, sans-serif', fontSize: LABEL_FONT_PX, fill: HAMLET_COLOUR, stroke: { color: 0x000000, width: 3 } },
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
