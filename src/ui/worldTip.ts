/**
 * Cursor tooltips on the map (Insight tips, 13 section 12): a tile tooltip (dominion and hamlet of the parcel) and a Being
 * tooltip (group, size, mood, task), read from the latest snapshot only. Desktop only: the caller checks for a fine pointer.
 * Ground type and height are not in the snapshot, so the tile tip names the parcel's owners, not the terrain.
 */
import { plainName } from '../content/plain-names.ts';
import { decodeParcels } from '../shared/parcel-codec.ts';
import type { MapKind, MapKindGroup, Snapshot } from '../shared/protocol.ts';
import { hamletAtTile, parcelOfTile } from './powerSupport.ts';

const GROUP_LABEL: Readonly<Record<MapKindGroup, string>> = {
  folk: 'Folk',
  beast: 'Beast',
  sea: 'Sea creature',
  insect: 'Insect',
  undead: 'Undead',
  monster: 'Monster',
  divine: 'Divine',
};

/** Lines of the tile tooltip for tile (x, y), or null when the tile is off the realm or the snapshot has no parcels. Pure. */
export function tileTipLines(snap: Snapshot, x: number, y: number): string[] | null {
  const tiles = snap.mapTiles;
  if (!tiles) return null;
  const p = parcelOfTile(tiles, x, y);
  if (p < 0) return null;
  const dom = decodeParcels(tiles.dominion)[p] ?? -1;
  const name = dom >= 0 ? snap.dominions.find((d) => d.id === dom)?.name : undefined;
  const hamlet = hamletAtTile(tiles, x, y);
  return [`Tile ${x}, ${y}`, name !== undefined ? `Dominion: ${name}` : 'No dominion', hamlet >= 0 ? `Hamlet ${hamlet + 1}` : 'No hamlet'];
}

/**
 * Lines of the Being tooltip. With the Being's snapshot row: group, size, mood and task. Without one (the Being is
 * beyond the snapshot's 96 sampled rows): the species' plain name alone. Pure.
 */
export function beingTipLines(speciesName: string, kind: MapKind | undefined): string[] {
  if (!kind) return [speciesName];
  const lines = [`${GROUP_LABEL[kind.group]}, size ${kind.size}`];
  if (kind.mood !== undefined) lines.push(`Mood ${kind.mood}`);
  lines.push(`Task: ${kind.task ? plainName('decision', kind.task) : 'none'}`);
  return lines;
}

/** The tooltip element. Shown at a point of the map host, kept inside the viewport. */
export class WorldTip {
  private readonly el: HTMLElement;
  private last = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'insight-tip';
    this.el.setAttribute('role', 'tooltip');
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  /** Shows `lines` beside the viewport point (left, top). The text is rebuilt only when it changes. */
  show(lines: readonly string[], left: number, top: number): void {
    const text = lines.join('\n');
    if (text !== this.last) {
      this.last = text;
      this.el.replaceChildren(
        ...lines.map((line) => {
          const row = document.createElement('div');
          row.textContent = line;
          return row;
        }),
      );
    }
    const x = left + 14 + 200 > window.innerWidth ? left - 214 : left + 14;
    this.el.style.transform = `translate(${Math.max(0, x)}px, ${Math.max(0, top + 14)}px)`;
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
    this.last = '';
  }
}
