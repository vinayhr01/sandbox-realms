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
import { Application, Container, Graphics, Sprite, Text } from 'pixi.js';
import type { MapKind, MapMarks, Snapshot } from '../shared/protocol.ts';
import { buildingKindOf, SpriteFactory, type SpriteTex } from './sprites.ts';

const ITEM_COLOUR = 0xffb020;
const FAVOURITE_COLOUR = 0xff5fd2;
const ARMY_COLOUR = 0xff8c42;
const CAMPAIGN_COLOUR = 0xff3b3b;
const BATTLE_COLOUR = 0xffffff;
const LINK_COLOUR = 0x9fb6ff;
const HAMLET_COLOUR = 0xffe9a8;
/** Sprites this far outside the viewport (CSS px) are not placed: keeps a sprite whose anchor is off screen. */
const SPRITE_MARGIN_PX = 16;
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
  private readonly buildings = new Container();
  private readonly beings = new Container();
  private readonly graphics = new Graphics();
  private readonly labels = new Container();
  private readonly labelPool: Text[] = [];
  private readonly beingPool: Sprite[] = [];
  private readonly buildingPool: Sprite[] = [];
  private readonly sprites: SpriteFactory;
  private key = '';

  constructor(app: Application) {
    // Buildings under beings, beings under the mark graphics and the labels.
    this.root.addChild(this.buildings);
    this.root.addChild(this.beings);
    this.root.addChild(this.graphics);
    this.root.addChild(this.labels);
    app.stage.addChild(this.root);
    this.sprites = new SpriteFactory(app.renderer);
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
      view.viewW,
      view.viewH,
    ].join('|');
    if (key === this.key) return;
    this.key = key;
    const g = this.graphics;
    g.clear();
    this.hideLabels();
    // Sprites are rebuilt from the snapshot and only repositioned on a camera change: no texture work per frame.
    this.placeSprites(snap, view);
    if (!snap) return;

    // Beings have a sprite (placeSprites). Items below need their tile on screen, so the ids are mapped here.
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

    const marks = snap.mapMarks;
    if (marks) this.drawMarks(marks, toggles, view);
  }

  /**
   * Places the building and being sprites that fall inside the viewport (plus SPRITE_MARGIN_PX). Pools grow
   * to the largest count seen and extra sprites are hidden, not destroyed. Beings with no MapKind use the
   * Folk flag (folk) or the beast group (wild), and size S.
   */
  private placeSprites(snap: Snapshot | null, view: MarkView): void {
    let nb = 0;
    let nbeing = 0;
    if (snap) {
      for (const b of snap.mapBuildings ?? []) {
        const { sx, sy } = toScreen(view, b.x, b.y);
        if (!this.onScreen(sx, sy, view)) continue;
        const tex = this.sprites.building(buildingKindOf(b.kind));
        this.place(this.buildingPool, this.buildings, nb++, tex, sx, sy);
      }
      const kinds = new Map<number, MapKind>();
      for (const k of snap.mapKinds ?? []) kinds.set(k.id, k);
      for (const p of snap.mapPoints ?? []) {
        const { sx, sy } = toScreen(view, p.x, p.y);
        if (!this.onScreen(sx, sy, view)) continue;
        const kind = kinds.get(p.id);
        const tex = this.sprites.being(kind?.group ?? (p.folk ? 'folk' : 'beast'), kind?.size ?? 'S');
        this.place(this.beingPool, this.beings, nbeing++, tex, sx, sy);
      }
    }
    for (let i = nb; i < this.buildingPool.length; i++) this.buildingPool[i]!.visible = false;
    for (let i = nbeing; i < this.beingPool.length; i++) this.beingPool[i]!.visible = false;
  }

  private onScreen(sx: number, sy: number, view: MarkView): boolean {
    return sx >= -SPRITE_MARGIN_PX && sy >= -SPRITE_MARGIN_PX && sx <= view.viewW + SPRITE_MARGIN_PX && sy <= view.viewH + SPRITE_MARGIN_PX;
  }

  /** Puts sprite i of a pool on (sx, sy), creating it on first use. */
  private place(pool: Sprite[], parent: Container, i: number, tex: SpriteTex, sx: number, sy: number): void {
    let sprite = pool[i];
    if (!sprite) {
      sprite = new Sprite();
      pool.push(sprite);
      parent.addChild(sprite);
    }
    sprite.texture = tex.texture;
    sprite.anchor.set(tex.anchorX, tex.anchorY);
    sprite.position.set(sx, sy);
    sprite.visible = true;
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
    let used = 0;
    for (const h of marks.hamlets) {
      const { sx, sy } = toScreenAt(h.x, h.y);
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
