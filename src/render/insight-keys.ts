/**
 * Insight colour keys and palette, as pure functions and data. No renderer import, so the 2D insight layer
 * (insight-layers.ts) and the 3D terrain and marks (src/render3d/) share one set of keys and colours without pulling the renderer
 * into the 3D chunk. insight-layers.ts re-exports the names it used to define.
 */
import type { MapGroup, MapLink, MapTies } from '../shared/protocol.ts';

/** Layers keyed by each Being (its creed, family, clan or strain). The others key on the parcel's group. */
export const BEING_LAYERS: ReadonlySet<string> = new Set(['L03', 'L06', 'L07', 'L08']);
export const PALETTE: readonly number[] = [
  0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231, 0x911eb4, 0x46f0f0, 0xf032e6, 0xbcf60c, 0xfabebe, 0x008080, 0xe6beff,
];
/** Tint strength of a parcel under a group or dominion layer. */
export const TINT_ALPHA = 0.28;
/** Mood beyond this (either way) draws a happiness icon (06 section 4.1 scale is -100..+100). */
export const HAPPY_MOOD = 40;
export const HAPPY_COLOUR = 0x7be07b;
export const UNHAPPY_COLOUR = 0xff6b6b;
/** Arrow colour per kind (A01..A07), keyed by the flag name in src/ui/powerSupport.ts VIEW_FLAGS_ON_BY_DEFAULT. */
export const ARROW_COLOUR: Readonly<Record<string, number>> = {
  'arrow.destination': 0xffd166,
  'arrow.home': 0x8ecae6,
  'arrow.partner': 0xff77a9,
  'arrow.family': 0xb5e48c,
  'arrow.parents': 0x90dbf4,
  'arrow.children': 0xcdb4db,
  'arrow.attack': 0xff4d4d,
};
/** A kind's links are drawn from the hovered Being to these targets. */
export const ARROW_KINDS: ReadonlyArray<readonly [string, keyof MapLink]> = [
  ['arrow.destination', 'dest'],
  ['arrow.home', 'home'],
  ['arrow.partner', 'partner'],
  ['arrow.family', 'family'],
  ['arrow.parents', 'parents'],
  ['arrow.children', 'children'],
  ['arrow.attack', 'foes'],
];

/**
 * The Accord Finder rows of one selected dominion (12 section 8.8), read from the ties feed. `formPact` are the partners a
 * formPact could join it to. `joinable` are the members of each pact it could join now. `joiners` are the dominions that
 * could join a pact the selected dominion is in. Draws nothing: the caller picks the lines.
 */
export interface AccordView {
  formPact: number[];
  joinable: number[];
  joiners: number[];
  canJoin: boolean;
}

/** The candidates of one dominion out of the whole Accord feed (the feed holds every pair; this narrows it). Reads only. */
export function accordViewOf(ties: MapTies, only: number): AccordView {
  const formPact: number[] = [];
  for (const [a, b] of ties.formPact) {
    if (a === only) formPact.push(b);
    else if (b === only) formPact.push(a);
  }
  const pactsOfOnly = new Set<number>();
  for (const [pactId, members] of ties.pactMembers) if (members.includes(only)) pactsOfOnly.add(pactId);
  const joinIds = new Set<number>();
  const joiners = new Set<number>();
  for (const [d, pactId] of ties.joinPact) {
    if (d === only) joinIds.add(pactId);
    else if (pactsOfOnly.has(pactId)) joiners.add(d);
  }
  const joinable = new Set<number>();
  for (const [pactId, members] of ties.pactMembers) {
    if (!joinIds.has(pactId)) continue;
    for (const m of members) if (m !== only) joinable.add(m);
  }
  return { formPact, joinable: [...joinable], joiners: [...joiners], canJoin: joinIds.size > 0 };
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

/** The parcel ownership a key reads: dominion and hamlet per parcel (-1 for none), and each dominion's group record. */
export interface ParcelOwners {
  /** Dominion id per parcel, or -1. */
  dominion: readonly number[];
  /** Hamlet index per parcel, or -1. */
  hamlet: readonly number[];
  groups: ReadonlyMap<number, MapGroup>;
}

/** Key of the dominion owning a parcel (0 when none). */
export function dominionKey(owners: ParcelOwners, parcel: number): number {
  if (parcel < 0) return 0;
  const dom = owners.dominion[parcel] ?? -1;
  return dom >= 0 ? dom + 1 : 0;
}

/** Key of a parcel for a group layer (0 when the parcel has none). */
export function groupKey(layer: string, owners: ParcelOwners, parcel: number): number {
  if (parcel < 0) return 0;
  if (layer === 'L02') {
    const h = owners.hamlet[parcel] ?? -1;
    return h >= 0 ? h + 1 : 0;
  }
  if (layer === 'L01') return dominionKey(owners, parcel);
  const dom = owners.dominion[parcel] ?? -1;
  const group = dom >= 0 ? owners.groups.get(dom) : undefined;
  if (!group) return 0;
  if (layer === 'L04') return group.custom >= 0 ? group.custom + 1 : 0;
  if (layer === 'L05') return group.dialect !== '' ? hashKey(group.dialect) : 0;
  if (layer === 'L09') return group.pact >= 0 ? group.pact + 1 : 0;
  if (layer === 'L10') return group.army ? 1 : 0;
  return 0;
}
