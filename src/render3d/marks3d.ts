/**
 * The 3D map marks: nameplates, armies and army lines, battles, campaigns, pact links, intrigues, item marks, money flow,
 * talk bubbles, Ties and Accord lines, the selected hamlet outline, and cursor arrows. It is the 3D twin of marks.ts and
 * insight-layers.ts, drawn over the terrain. Lines are draped: one sample per tile, at the height field plus a lift.
 * Labels are camera-facing sprites (labels3d.ts). Rebuilt only when the snapshot, the toggles, the hovered Being or the
 * height field changes. Registered as the `marks` layer.
 */
import * as THREE from 'three';
import { decodeParcels } from '../shared/parcel-codec.ts';
import type { MapKind, MapMarks, MapTies, MapTiles, Snapshot } from '../shared/protocol.ts';
import { nameFontPx, type MarkToggles } from '../render/marks.ts';
import { accordViewOf, type InsightToggles } from '../render/insight-layers.ts';
import type { FrameInput } from '../render/world-renderer.ts';
import type { HeightField } from './heights.ts';
import { registerLayer, type Layer3D, type Layer3DContext } from './layer.ts';
import { LabelPool } from './labels3d.ts';

type P3 = [number, number, number];
type Track = <T extends { dispose(): void }>(o: T) => T;

/** Lines lie this far above the height field (spec: heightAt + 0.1). */
export const DRAPE_LIFT = 0.1;
/** Arrows and their heads float a little above the ground, at the height of a Being's body. */
const ARROW_LIFT = 0.6;
const RING_SEGMENTS = 16;

const ITEM_COLOUR = 0xffb020;
const FAVOURITE_COLOUR = 0xff5fd2;
const ARMY_COLOUR = 0xff8c42;
const CAMPAIGN_COLOUR = 0xff3b3b;
const BATTLE_COLOUR = 0xffffff;
const LINK_COLOUR = 0x9fb6ff;
const HAMLET_COLOUR = 0xffe9a8;
const REBELLION_COLOUR = 0xff4d6d;
const SCHEME_COLOUR = 0xb388ff;
const ARMY_LINE_COLOUR = 0xff8c42;
const SELECT_COLOUR = 0xffffff;
const OPINION_GOOD_COLOUR = 0x7be07b;
const OPINION_BAD_COLOUR = 0xff6b6b;
const OPINION_FULL = 100;
const ACCORD_COLOUR = 0xffd166;
const TAX_COLOUR = 0xf4c542;
const BUBBLE_COLOUR = 0xffffff;
const BUBBLE_DOT_COLOUR = 0x333333;

/** Sizes in tiles (2D uses px; a tile is about 16 px at the default overview zoom). */
const ITEM_RING_R = 0.3;
const ITEM_LIFT = 0.9;
const ARMY_SIDE = 0.5;
const CAMPAIGN_R = 0.35;
const BATTLE_HALF = 0.3;
const INTRIGUE_HALF = 0.35;
const HAMLET_DOT_R = 0.15;
const NAME_LIFT = 2.5;
const ACCORD_RING_R = 0.45;
const OPINION_MARK_SIDE = 0.25;
const ARROW_HEAD_LEN = 0.35;
const ARROW_HEAD_R = 0.15;
const BUBBLE_OFFSET_X = 0.3;
const BUBBLE_LIFT = 1.5;
const BUBBLE_W = 0.5;
const BUBBLE_H = 0.3;
const BUBBLE_DOT = 0.07;

/** Arrow colour per kind (A01..A07). Mirrors ARROW_COLOUR and ARROW_KINDS in insight-layers.ts (not exported there). */
const ARROW_COLOUR: Readonly<Record<string, number>> = {
  'arrow.destination': 0xffd166,
  'arrow.home': 0x8ecae6,
  'arrow.partner': 0xff77a9,
  'arrow.family': 0xb5e48c,
  'arrow.parents': 0x90dbf4,
  'arrow.children': 0xcdb4db,
  'arrow.attack': 0xff4d4d,
};
const ARROW_KINDS: ReadonlyArray<readonly [string, 'dest' | 'home' | 'partner' | 'family' | 'parents' | 'children' | 'foes']> = [
  ['arrow.destination', 'dest'],
  ['arrow.home', 'home'],
  ['arrow.partner', 'partner'],
  ['arrow.family', 'family'],
  ['arrow.parents', 'parents'],
  ['arrow.children', 'children'],
  ['arrow.attack', 'foes'],
];

/**
 * Samples the straight line from (x0, y0) to (x1, y1) in tile space, one point per tile (at least one segment). Each point
 * is [x, heightAt + lift, y] in world space, so the line follows the terrain. A line of 10 tiles has 11 points.
 */
export function drapeLine(field: HeightField, x0: number, y0: number, x1: number, y1: number, lift = DRAPE_LIFT): P3[] {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  const out: P3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const z = y0 + (y1 - y0) * t;
    out.push([x, field.heightAt(x, z) + lift, z]);
  }
  return out;
}

interface Bin {
  colour: number;
  alpha: number;
  pos: number[];
}

/** Line segments grouped by colour and alpha, so each group is one LineSegments draw call. */
class SegmentBatch {
  private readonly bins = new Map<string, Bin>();

  constructor(private readonly field: HeightField) {}

  /** A draped straight line between two tile-space points. */
  draped(colour: number, alpha: number, a: readonly [number, number], b: readonly [number, number], lift = DRAPE_LIFT): void {
    const pts = drapeLine(this.field, a[0], a[1], b[0], b[1], lift);
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      if (p && q) this.seg(colour, alpha, p, q);
    }
  }

  /** A draped open polyline through tile-space points. */
  loop(colour: number, alpha: number, pts: ReadonlyArray<readonly [number, number]>, lift = DRAPE_LIFT): void {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a && b) this.draped(colour, alpha, a, b, lift);
    }
  }

  /** A draped circle of radius r (tiles) around a tile-space centre. */
  ring(colour: number, alpha: number, cx: number, cy: number, r: number, lift = DRAPE_LIFT): void {
    const pts: Array<[number, number]> = [];
    for (let k = 0; k <= RING_SEGMENTS; k++) {
      const a = (2 * Math.PI * k) / RING_SEGMENTS;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    this.loop(colour, alpha, pts, lift);
  }

  /** Adds the batches to `group`. Each geometry and material is registered with `track` so the owner can free it. */
  build(group: THREE.Group, track: Track): void {
    for (const bin of this.bins.values()) {
      const geometry = track(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(bin.pos, 3));
      const material = track(
        new THREE.LineBasicMaterial({ color: bin.colour, transparent: bin.alpha < 1, opacity: bin.alpha, depthWrite: false }),
      );
      group.add(new THREE.LineSegments(geometry, material));
    }
  }

  private seg(colour: number, alpha: number, a: P3, b: P3): void {
    const key = `${colour}|${alpha}`;
    let bin = this.bins.get(key);
    if (!bin) {
      bin = { colour, alpha, pos: [] };
      this.bins.set(key, bin);
    }
    bin.pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
}

/** Decoded hamlet index per parcel, cached per tiles object (the same decode the 2D Insight layer does). */
interface HamletParcels {
  tiles: MapTiles;
  hamlet: number[];
}

export class Marks3D implements Layer3D {
  readonly id = 'marks';
  private readonly group = new THREE.Group();
  private readonly labels = new LabelPool();
  private readonly owned: Array<{ dispose(): void }> = [];
  private readonly matCache = new Map<string, { dispose(): void }>();
  private readonly track: Track = (o) => {
    this.owned.push(o);
    return o;
  };
  private readonly boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly dotGeo = new THREE.SphereGeometry(HAMLET_DOT_R, 8, 6);
  private readonly coneGeo = new THREE.ConeGeometry(ARROW_HEAD_R, ARROW_HEAD_LEN, 6);
  private ctx: Layer3DContext | null = null;
  private key = '';
  private version = 0;
  private hamletParcels: HamletParcels | null = null;

  init(ctx: Layer3DContext): void {
    this.ctx = ctx;
    ctx.scene.add(this.group);
  }

  /** Terrain changed under the marks: rebuild on the next frame. */
  onRows(): void {
    this.version++;
  }

  onSide(): void {
    this.version++;
  }

  frame(input: FrameInput, ctx: Layer3DContext): void {
    const key = this.keyOf(input);
    if (key === this.key) return;
    this.key = key;
    this.rebuild(input, ctx);
  }

  dispose(): void {
    this.clear();
    this.labels.dispose();
    this.boxGeo.dispose();
    this.dotGeo.dispose();
    this.coneGeo.dispose();
    this.group.removeFromParent();
    this.ctx = null;
  }

  private keyOf(input: FrameInput): string {
    const snap = input.snapshot;
    const m = input.marks;
    const i = input.insight;
    return [
      this.version,
      snap?.tick ?? -1,
      snap?.mapPoints?.length ?? 0,
      snap?.mapMarks ? 1 : 0,
      snap?.mapTiles ? 1 : 0,
      snap?.mapKinds?.length ?? 0,
      snap?.mapLinks?.length ?? 0,
      snap?.mapIntrigues?.length ?? 0,
      snap?.mapTaxFlows?.length ?? 0,
      snap?.mapTies?.opinions.length ?? 0,
      snap?.items?.rows.length ?? 0,
      m.items,
      m.favourites,
      m.armies,
      m.campaigns,
      m.battles,
      m.intrigues,
      m.names,
      m.favouritesOnlyNames,
      m.nameScale,
      i.armyLines,
      i.selectedHamlet,
      i.talkBubbles,
      [...i.arrows].join(','),
      i.hoverId,
      i.moneyFlow,
      i.selectedDominion,
      i.accordDominion,
    ].join('|');
  }

  private rebuild(input: FrameInput, ctx: Layer3DContext): void {
    this.clear();
    const snap = input.snapshot;
    if (!snap) return;
    const field = ctx.field;
    const batch = new SegmentBatch(field);
    const pointAt = new Map<number, { x: number; y: number }>();
    for (const p of snap.mapPoints ?? []) pointAt.set(p.id, p);
    const kinds = new Map<number, MapKind>();
    for (const k of snap.mapKinds ?? []) kinds.set(k.id, k);

    this.drawItems(snap, input.marks, pointAt, batch);
    if (snap.mapMarks) this.drawMarks(snap.mapMarks, input.marks, batch);
    if (input.marks.intrigues && snap.mapIntrigues) {
      for (const it of snap.mapIntrigues) {
        if (!it.active || it.x < 0 || it.y < 0) continue;
        const cx = it.x + 0.5;
        const cy = it.y + 0.5;
        const h = INTRIGUE_HALF;
        const colour = it.kind === 'rebellion' ? REBELLION_COLOUR : SCHEME_COLOUR;
        const corners: Array<[number, number]> =
          it.kind === 'rebellion'
            ? [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h], [cx - h, cy - h]]
            : [[cx, cy - h], [cx + h, cy], [cx, cy + h], [cx - h, cy], [cx, cy - h]];
        batch.loop(colour, 1, corners, 0.3);
      }
    }
    this.drawInsight(snap, input.insight, pointAt, batch, ctx);
    batch.build(this.group, this.track);
    this.drawBubbles(snap, input.insight, kinds, field);
  }

  /** Items: a ring over each worn item's holder. Stored items have no tile. */
  private drawItems(snap: Snapshot, m: MarkToggles, pointAt: Map<number, { x: number; y: number }>, batch: SegmentBatch): void {
    for (const item of snap.items?.rows ?? []) {
      if (item.holder !== 'worn') continue;
      const shown = m.items || (m.favourites && item.favourite);
      if (!shown) continue;
      const at = pointAt.get(item.at);
      if (!at) continue;
      const colour = m.favourites && item.favourite ? FAVOURITE_COLOUR : ITEM_COLOUR;
      batch.ring(colour, 1, at.x + 0.5, at.y + 0.5, ITEM_RING_R, ITEM_LIFT);
    }
  }

  /** Armies, pact links, battles, campaigns, and the hamlet dots and nameplates. */
  private drawMarks(marks: MapMarks, m: MarkToggles, batch: SegmentBatch): void {
    if (m.armies) {
      for (const [x1, y1, x2, y2] of marks.pactLinks) batch.draped(LINK_COLOUR, 0.6, [x1 + 0.5, y1 + 0.5], [x2 + 0.5, y2 + 0.5]);
      for (const army of marks.armies) {
        const box = new THREE.Mesh(this.boxGeo, this.basic(ARMY_COLOUR));
        box.scale.setScalar(ARMY_SIDE);
        box.position.set(army.x + 0.5, this.heightOf(army.x + 0.5, army.y + 0.5) + ARMY_SIDE / 2, army.y + 0.5);
        this.group.add(box);
      }
    }
    if (m.campaigns) {
      for (const c of marks.campaigns) batch.ring(CAMPAIGN_COLOUR, 1, c.x + 0.5, c.y + 0.5, CAMPAIGN_R, 0.15);
    }
    if (m.battles) {
      for (const b of marks.battles) {
        const cx = b.x + 0.5;
        const cy = b.y + 0.5;
        batch.draped(BATTLE_COLOUR, 1, [cx - BATTLE_HALF, cy - BATTLE_HALF], [cx + BATTLE_HALF, cy + BATTLE_HALF], 0.2);
        batch.draped(BATTLE_COLOUR, 1, [cx + BATTLE_HALF, cy - BATTLE_HALF], [cx - BATTLE_HALF, cy + BATTLE_HALF], 0.2);
      }
    }
    // Hamlet names: favourites-only hides every hamlet, dot included. Names that overlap are not hidden in 3D (see report).
    if (m.names === 'off' || m.favouritesOnlyNames) return;
    const fontPx = nameFontPx(m.nameScale);
    for (const h of marks.hamlets) {
      const cx = h.x + 0.5;
      const cy = h.y + 0.5;
      const y = this.heightOf(cx, cy);
      const dot = new THREE.Mesh(this.dotGeo, this.basic(HAMLET_COLOUR));
      dot.position.set(cx, y + HAMLET_DOT_R, cy);
      this.group.add(dot);
      if (m.names === 'full') {
        const label = this.labels.acquire(h.name, fontPx, HAMLET_COLOUR);
        label.position.set(cx, y + NAME_LIFT, cy);
        this.group.add(label);
      }
    }
  }

  /** Insight lines: army lines, the selected hamlet, Ties, Accord, money flow and cursor arrows. */
  private drawInsight(
    snap: Snapshot,
    ins: InsightToggles,
    pointAt: Map<number, { x: number; y: number }>,
    batch: SegmentBatch,
    ctx: Layer3DContext,
  ): void {
    if (ins.armyLines && snap.mapMarks?.armyLines) {
      for (const [x1, y1, x2, y2] of snap.mapMarks.armyLines) batch.draped(ARMY_LINE_COLOUR, 0.8, [x1 + 0.5, y1 + 0.5], [x2 + 0.5, y2 + 0.5]);
    }
    if (ins.selectedHamlet >= 0 && snap.mapTiles) this.drawHamletOutline(snap.mapTiles, ins.selectedHamlet, batch);
    if (ins.selectedDominion >= 0 && snap.mapTies) this.drawTies(snap.mapTies, ins.selectedDominion, batch);
    if (ins.accordDominion >= 0 && snap.mapTies) this.drawAccord(snap.mapTies, ins.accordDominion, batch);
    if (ins.moneyFlow && snap.mapTaxFlows) {
      for (const f of snap.mapTaxFlows) {
        const from = { x: f.x + 0.5, y: f.y + 0.5 };
        const to = { x: f.to[0] + 0.5, y: f.to[1] + 0.5 };
        batch.ring(TAX_COLOUR, 0.8, from.x, from.y, 0.2 + Math.min(f.loot, 100) / 400);
        if (f.toRuler > 0) this.arrow(batch, ctx, from, to, TAX_COLOUR);
      }
    }
    if (ins.arrows.size > 0 && ins.hoverId >= 0) this.drawArrows(snap, ins, pointAt, batch, ctx);
  }

  /** Selected hamlet: a white outline around each of its parcels. */
  private drawHamletOutline(tiles: MapTiles, hamlet: number, batch: SegmentBatch): void {
    const parcels = this.hamletOf(tiles);
    const n = tiles.perAxis;
    const size = tiles.size;
    for (let p = 0; p < n * n; p++) {
      if (parcels[p] !== hamlet) continue;
      const x0 = (p % n) * size;
      const y0 = Math.floor(p / n) * size;
      const x1 = x0 + size;
      const y1 = y0 + size;
      batch.loop(SELECT_COLOUR, 1, [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]);
    }
  }

  /** Ties: half lines from each dominion centre to the midpoint of the pair. A square marks a bad view. */
  private drawTies(ties: MapTies, only: number, batch: SegmentBatch): void {
    const centre = new Map<number, { x: number; y: number }>();
    for (const [id, x, y] of ties.centres) centre.set(id, { x: x + 0.5, y: y + 0.5 });
    for (const [a, b, value] of ties.opinions) {
      if (a !== only && b !== only) continue;
      const from = centre.get(a);
      const to = centre.get(b);
      if (!from || !to) continue;
      const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      const bad = value < 0;
      const colour = bad ? OPINION_BAD_COLOUR : OPINION_GOOD_COLOUR;
      const strength = Math.min(Math.abs(value), OPINION_FULL) / OPINION_FULL;
      batch.draped(colour, 0.35 + 0.6 * strength, [from.x, from.y], [mid.x, mid.y]);
      if (bad) {
        const sq = new THREE.Mesh(this.boxGeo, this.basic(colour));
        sq.scale.setScalar(OPINION_MARK_SIDE);
        sq.position.set(mid.x, this.heightOf(mid.x, mid.y) + OPINION_MARK_SIDE / 2, mid.y);
        this.group.add(sq);
      }
    }
  }

  /** Accord Finder: gold lines to the pacts the selected dominion could form or join, and rings on the joiners. */
  private drawAccord(ties: MapTies, only: number, batch: SegmentBatch): void {
    const centre = new Map<number, { x: number; y: number }>();
    for (const [id, x, y] of ties.centres) centre.set(id, { x: x + 0.5, y: y + 0.5 });
    const from = centre.get(only);
    if (!from) return;
    const view = accordViewOf(ties, only);
    for (const partner of view.formPact) {
      const to = centre.get(partner);
      if (to) batch.draped(ACCORD_COLOUR, 0.9, [from.x, from.y], [to.x, to.y]);
    }
    for (const member of view.joinable) {
      const to = centre.get(member);
      if (to) batch.draped(ACCORD_COLOUR, 0.5, [from.x, from.y], [to.x, to.y]);
    }
    if (view.canJoin) batch.ring(ACCORD_COLOUR, 0.9, from.x, from.y, ACCORD_RING_R);
    for (const id of view.joiners) {
      const c = centre.get(id);
      if (!c) continue;
      batch.draped(ACCORD_COLOUR, 0.5, [c.x, c.y], [from.x, from.y]);
      batch.ring(ACCORD_COLOUR, 0.9, c.x, c.y, ACCORD_RING_R);
    }
  }

  /** Cursor arrows: from the hovered Being to each of its links, one colour per kind. Off-sample links are skipped. */
  private drawArrows(
    snap: Snapshot,
    ins: InsightToggles,
    pointAt: Map<number, { x: number; y: number }>,
    batch: SegmentBatch,
    ctx: Layer3DContext,
  ): void {
    const link = snap.mapLinks?.find((l) => l.id === ins.hoverId);
    if (!link) return;
    const from = pointAt.get(ins.hoverId);
    if (!from) return;
    const origin = { x: from.x + 0.5, y: from.y + 0.5 };
    for (const [flag, key] of ARROW_KINDS) {
      if (!ins.arrows.has(flag)) continue;
      const colour = ARROW_COLOUR[flag] ?? 0xffffff;
      const v = link[key];
      const targets: Array<{ x: number; y: number }> = [];
      if ((key === 'home' || key === 'dest') && Array.isArray(v)) {
        const [x, y] = v as [number, number];
        targets.push({ x: x + 0.5, y: y + 0.5 });
      } else if (typeof v === 'number') {
        const p = pointAt.get(v);
        if (p) targets.push({ x: p.x + 0.5, y: p.y + 0.5 });
      } else if (Array.isArray(v)) {
        for (const id of v as number[]) {
          const p = pointAt.get(id);
          if (p) targets.push({ x: p.x + 0.5, y: p.y + 0.5 });
        }
      }
      for (const to of targets) this.arrow(batch, ctx, origin, to, colour);
    }
  }

  /** One arrow: a draped shaft and a cone head at its end, pointing along the shaft. */
  private arrow(batch: SegmentBatch, ctx: Layer3DContext, from: { x: number; y: number }, to: { x: number; y: number }, colour: number): void {
    batch.draped(colour, 0.85, [from.x, from.y], [to.x, to.y], ARROW_LIFT);
    const a = new THREE.Vector3(from.x, this.heightOf(from.x, from.y) + ARROW_LIFT, from.y);
    const b = new THREE.Vector3(to.x, ctx.field.heightAt(to.x, to.y) + ARROW_LIFT, to.y);
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 0.05) return;
    dir.divideScalar(len);
    const head = new THREE.Mesh(this.coneGeo, this.basic(colour));
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    head.position.copy(b).addScaledVector(dir, -ARROW_HEAD_LEN / 2);
    this.group.add(head);
  }

  /** Talk bubbles: a white box with three dots above and to the right of each Being whose task is `chat`. */
  private drawBubbles(
    snap: Snapshot,
    ins: InsightToggles,
    kinds: Map<number, MapKind>,
    field: HeightField,
  ): void {
    if (!ins.talkBubbles) return;
    for (const p of snap.mapPoints ?? []) {
      if (kinds.get(p.id)?.task !== 'chat') continue;
      const cx = p.x + 0.5;
      const cy = p.y + 0.5;
      const bubble = new THREE.Group();
      bubble.position.set(cx + BUBBLE_OFFSET_X, field.heightAt(cx, cy) + BUBBLE_LIFT, cy);
      const box = new THREE.Sprite(this.sprite(BUBBLE_COLOUR));
      box.scale.set(BUBBLE_W, BUBBLE_H, 1);
      bubble.add(box);
      for (let i = 0; i < 3; i++) {
        const dot = new THREE.Sprite(this.sprite(BUBBLE_DOT_COLOUR));
        dot.scale.set(BUBBLE_DOT, BUBBLE_DOT, 1);
        dot.position.set(-BUBBLE_W / 4 + (i * BUBBLE_W) / 4, 0, 0);
        bubble.add(dot);
      }
      this.group.add(bubble);
    }
  }

  private heightOf(x: number, y: number): number {
    return this.ctx?.field.heightAt(x, y) ?? 0;
  }

  private hamletOf(tiles: MapTiles): number[] {
    if (this.hamletParcels?.tiles !== tiles) this.hamletParcels = { tiles, hamlet: decodeParcels(tiles.hamlet) };
    return this.hamletParcels.hamlet;
  }

  private basic(colour: number): THREE.MeshBasicMaterial {
    return this.cached(`b${colour}`, () => new THREE.MeshBasicMaterial({ color: colour }));
  }

  private sprite(colour: number): THREE.SpriteMaterial {
    return this.cached(`s${colour}`, () => new THREE.SpriteMaterial({ color: colour, transparent: true, depthWrite: false }));
  }

  private cached<T extends { dispose(): void }>(key: string, make: () => T): T {
    let m = this.matCache.get(key) as T | undefined;
    if (!m) {
      m = this.track(make());
      this.matCache.set(key, m);
    }
    return m;
  }

  /** Drops every mesh, line and label of the last rebuild. */
  private clear(): void {
    this.labels.releaseAll();
    this.group.clear();
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
    this.matCache.clear();
  }
}

registerLayer(() => new Marks3D());
