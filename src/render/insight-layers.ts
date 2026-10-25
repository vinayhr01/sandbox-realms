/**
 * Insight map layers and overlays (12 section 8.8, 13 section 15). One layer (L01..L10, `map.layer`) is drawn at a
 * time, in one of three modes (`map.layerMode`):
 *  - borders: a group layer (dominion, hamlet, custom, dialect, pact, army) tints its parcels and draws the group
 *    edges; a being layer (creed, family, clan, strain) colours each Being by its own key.
 *  - being: each Being takes the colour of its group (group layers) or its own key (being layers).
 *  - parent: parcels and Beings take the colour of the dominion that owns the parcel.
 * Overlays: O03 happiness icons (folk with mood beyond +-40), O04 task icons (a square on each Being with a running
 * task) and O08 army target lines (`marks.armyLines`). The hamlet picked by Hamlet Select is outlined.
 *
 * Reads the latest snapshot only (no sim memory). Redraws when the snapshot, the toggles or the camera change. It is
 * drawn over the beings at low alpha, so the tint shows on the terrain and the Beings alike.
 */
import type { Application } from 'pixi.js';
import { Graphics } from 'pixi.js';
import { decodeParcels } from '../shared/parcel-codec.ts';
import type { MapGroup, MapKind, MapTiles, Snapshot } from '../shared/protocol.ts';

/** Layers keyed by each Being (its creed, family, clan or strain). The others key on the parcel's group. */
const BEING_LAYERS: ReadonlySet<string> = new Set(['L03', 'L06', 'L07', 'L08']);
const PALETTE: readonly number[] = [
  0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231, 0x911eb4, 0x46f0f0, 0xf032e6, 0xbcf60c, 0xfabebe, 0x008080, 0xe6beff,
];
const TINT_ALPHA = 0.28;
const EDGE_COLOUR = 0xffffff;
const SELECT_COLOUR = 0xffffff;
/** Mood beyond this (either way) draws a happiness icon (06 section 4.1 scale is -100..+100). */
const HAPPY_MOOD = 40;
const HAPPY_COLOUR = 0x7be07b;
const UNHAPPY_COLOUR = 0xff6b6b;
const ARMY_LINE_COLOUR = 0xff8c42;
const RING_PX = 5;
const ICON_PX = 2.5;
const ICON_LIFT_PX = 9;
const TASK_PX = 3;
const TASK_OFFSET_PX = 6;

/** The toggles this layer reads (from the option store, every frame). */
export interface InsightToggles {
  /** `map.layer`: 'off' or 'L01'..'L10'. */
  layer: string;
  /** `map.layerMode`: 'borders', 'being' or 'parent'. */
  mode: string;
  /** `ui.happinessIcons` (O03). */
  happiness: boolean;
  /** `ui.taskIcons` (O04). */
  tasks: boolean;
  /** `marks.armyLines` (O08). */
  armyLines: boolean;
  /** Hamlet index (hamletsOf order) outlined by Hamlet Select, or -1. */
  selectedHamlet: number;
}

/** The camera state the layer needs. */
export interface InsightView {
  offX: number;
  offY: number;
  zoom: number;
}

/** Positive key of a word or task id (colour choice). Equal words give equal keys. */
export function hashKey(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 9973) + 1;
}

/** Colour of a positive key. */
export function keyColour(key: number): number {
  return PALETTE[(key - 1) % PALETTE.length] ?? 0xffffff;
}

interface Decoded {
  size: number;
  perAxis: number;
  /** Dominion id per parcel, or -1. */
  dominion: number[];
  /** Hamlet index per parcel, or -1. */
  hamlet: number[];
  groups: Map<number, MapGroup>;
}

function decodeTiles(tiles: MapTiles): Decoded {
  const groups = new Map<number, MapGroup>();
  for (const g of tiles.groups) groups.set(g.id, g);
  return { size: tiles.size, perAxis: tiles.perAxis, dominion: decodeParcels(tiles.dominion), hamlet: decodeParcels(tiles.hamlet), groups };
}

/** Parcel holding tile (x, y), or -1 off the realm. */
function parcelAt(d: Decoded, x: number, y: number): number {
  const col = Math.floor(x / d.size);
  const row = Math.floor(y / d.size);
  if (col < 0 || row < 0 || col >= d.perAxis || row >= d.perAxis) return -1;
  return row * d.perAxis + col;
}

/** Key of the dominion owning a parcel (0 when none). */
function dominionKey(d: Decoded, parcel: number): number {
  if (parcel < 0) return 0;
  const dom = d.dominion[parcel] ?? -1;
  return dom >= 0 ? dom + 1 : 0;
}

/** Key of a parcel for a group layer (0 when the parcel has none). */
function groupKey(layer: string, d: Decoded, parcel: number): number {
  if (parcel < 0) return 0;
  if (layer === 'L02') {
    const h = d.hamlet[parcel] ?? -1;
    return h >= 0 ? h + 1 : 0;
  }
  if (layer === 'L01') return dominionKey(d, parcel);
  const dom = d.dominion[parcel] ?? -1;
  const group = dom >= 0 ? d.groups.get(dom) : undefined;
  if (!group) return 0;
  if (layer === 'L04') return group.custom >= 0 ? group.custom + 1 : 0;
  if (layer === 'L05') return group.dialect !== '' ? hashKey(group.dialect) : 0;
  if (layer === 'L09') return group.pact >= 0 ? group.pact + 1 : 0;
  if (layer === 'L10') return group.army ? 1 : 0;
  return 0;
}

/** Key of a Being from its own record (creed, family, clan or strain). */
function ownKey(layer: string, kind: MapKind | undefined): number {
  if (!kind) return 0;
  const v = layer === 'L03' ? kind.creed : layer === 'L06' ? kind.family : layer === 'L07' ? kind.clan : kind.strain;
  return v !== undefined && v >= 0 ? v + 1 : 0;
}

/** Colour key of a Being for the layer and mode (0 = no colour). */
function beingKey(layer: string, mode: string, d: Decoded, parcel: number, kind: MapKind | undefined): number {
  if (BEING_LAYERS.has(layer)) return mode === 'parent' ? dominionKey(d, parcel) : ownKey(layer, kind);
  if (mode === 'being') return groupKey(layer, d, parcel);
  if (mode === 'parent') return dominionKey(d, parcel);
  return 0;
}

export class InsightLayer {
  private readonly g = new Graphics();
  private key = '';
  private cache: { snap: Snapshot; decoded: Decoded } | null = null;

  constructor(app: Application) {
    app.stage.addChild(this.g);
  }

  /** Redraws when something it shows has changed; otherwise does nothing. */
  update(snap: Snapshot | null, t: InsightToggles, view: InsightView): void {
    const key = [
      snap?.tick ?? -1,
      snap?.mapPoints?.length ?? 0,
      t.layer,
      t.mode,
      t.happiness,
      t.tasks,
      t.armyLines,
      t.selectedHamlet,
      view.offX,
      view.offY,
      view.zoom,
    ].join('|');
    if (key === this.key) return;
    this.key = key;
    const g = this.g;
    g.clear();
    if (!snap) return;
    const layerOn = t.layer !== 'off';
    if (!layerOn && !t.happiness && !t.tasks && !t.armyLines && t.selectedHamlet < 0) return;

    const d = snap.mapTiles ? this.decodedOf(snap, snap.mapTiles) : null;
    if (layerOn && d) this.drawParcels(t, d, view);
    if (d && t.selectedHamlet >= 0) this.drawHamletOutline(t.selectedHamlet, d, view);

    const kinds = new Map<number, MapKind>();
    for (const k of snap.mapKinds ?? []) kinds.set(k.id, k);
    for (const p of snap.mapPoints ?? []) {
      const kind = kinds.get(p.id);
      const sx = view.offX + (p.x + 0.5) * view.zoom;
      const sy = view.offY + (p.y + 0.5) * view.zoom;
      if (layerOn && d) {
        const colour = beingKey(t.layer, t.mode, d, parcelAt(d, p.x, p.y), kind);
        if (colour > 0) g.circle(sx, sy, RING_PX).stroke({ width: 1.5, color: keyColour(colour), alpha: 0.9 });
      }
      const mood = kind?.mood;
      if (t.happiness && p.folk && mood !== undefined && Math.abs(mood) >= HAPPY_MOOD) {
        g.circle(sx, sy - ICON_LIFT_PX, ICON_PX).fill(mood > 0 ? HAPPY_COLOUR : UNHAPPY_COLOUR);
      }
      if (t.tasks && kind?.task) g.rect(sx + TASK_OFFSET_PX, sy - TASK_OFFSET_PX, TASK_PX, TASK_PX).fill(keyColour(hashKey(kind.task)));
    }

    if (t.armyLines && snap.mapMarks?.armyLines) {
      for (const [x1, y1, x2, y2] of snap.mapMarks.armyLines) {
        g.moveTo(view.offX + (x1 + 0.5) * view.zoom, view.offY + (y1 + 0.5) * view.zoom)
          .lineTo(view.offX + (x2 + 0.5) * view.zoom, view.offY + (y2 + 0.5) * view.zoom);
      }
      g.stroke({ width: 1, color: ARMY_LINE_COLOUR, alpha: 0.8 });
    }
  }

  private decodedOf(snap: Snapshot, tiles: MapTiles): Decoded {
    if (this.cache && this.cache.snap === snap) return this.cache.decoded;
    const decoded = decodeTiles(tiles);
    this.cache = { snap, decoded };
    return decoded;
  }

  /** Parcel tints for the layer's keys, and the group edges in borders mode. */
  private drawParcels(t: InsightToggles, d: Decoded, view: InsightView): void {
    const g = this.g;
    const n = d.perAxis;
    const size = d.size * view.zoom;
    const groupLayer = !BEING_LAYERS.has(t.layer);
    const keys = new Int32Array(n * n);
    for (let p = 0; p < n * n; p++) {
      if (t.mode === 'parent') keys[p] = dominionKey(d, p);
      else if (t.mode === 'borders' && groupLayer) keys[p] = groupKey(t.layer, d, p);
    }
    for (let p = 0; p < n * n; p++) {
      const k = keys[p] ?? 0;
      if (k === 0) continue;
      const x0 = view.offX + (p % n) * size;
      const y0 = view.offY + Math.floor(p / n) * size;
      g.rect(x0, y0, size, size).fill({ color: keyColour(k), alpha: TINT_ALPHA });
    }
    if (t.mode !== 'borders' || !groupLayer) return;
    for (let p = 0; p < n * n; p++) {
      const k = keys[p] ?? 0;
      const col = p % n;
      const x0 = view.offX + col * size;
      const y0 = view.offY + Math.floor(p / n) * size;
      if (col + 1 < n && (keys[p + 1] ?? 0) !== k) g.moveTo(x0 + size, y0).lineTo(x0 + size, y0 + size);
      if (p + n < n * n && (keys[p + n] ?? 0) !== k) g.moveTo(x0, y0 + size).lineTo(x0 + size, y0 + size);
    }
    g.stroke({ width: 1, color: EDGE_COLOUR, alpha: 0.6 });
  }

  /** Outline around each parcel of the selected hamlet. */
  private drawHamletOutline(hamlet: number, d: Decoded, view: InsightView): void {
    const n = d.perAxis;
    const size = d.size * view.zoom;
    for (let p = 0; p < n * n; p++) {
      if (d.hamlet[p] !== hamlet) continue;
      const x0 = view.offX + (p % n) * size;
      const y0 = view.offY + Math.floor(p / n) * size;
      this.g.rect(x0 + 0.5, y0 + 0.5, size - 1, size - 1).stroke({ width: 1.5, color: SELECT_COLOUR });
    }
  }
}
