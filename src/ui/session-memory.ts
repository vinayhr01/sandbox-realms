/**
 * Choices the windows keep for this page session only: favourite beings, banner colours and icons,
 * and trait rain slots. The sim does not store any of them yet, so none is saved or sent. Each
 * window says so. The state holds no sim data beyond copies of rows the snapshot sent.
 */
import type { BeingRow, Snapshot } from '../shared/protocol.ts';

export type BannerKind = 'dominion' | 'hamlet' | 'pact' | 'clan' | 'family' | 'creed' | 'custom' | 'dialect' | 'strain';
export type RainSlot = 'A' | 'B' | 'C';

export interface Banner {
  colour: string;
  icon: string;
}

/** A favourited being and the last row the snapshot sent for it. */
export interface FavouriteBeing {
  id: number;
  row: BeingRow;
  /** Tick of the snapshot that sent `row`. */
  seenTick: number;
}

const favouriteBeings = new Map<number, FavouriteBeing>();
const banners = new Map<string, Banner>();
const traitRain = new Map<RainSlot, string[]>();

export function favouriteBeingList(): readonly FavouriteBeing[] {
  return [...favouriteBeings.values()];
}

export function favouriteBeing(id: number): FavouriteBeing | undefined {
  return favouriteBeings.get(id);
}

/** Stars or unstars a being. Starring keeps the row so the favourite still lists after the being dies. */
export function setFavouriteBeing(row: BeingRow, tick: number, on: boolean): void {
  if (on) favouriteBeings.set(row.id, { id: row.id, row, seenTick: tick });
  else favouriteBeings.delete(row.id);
}

/** Refreshes the kept rows of favourites that the snapshot still lists. */
export function syncFavouriteBeings(snap: Snapshot): void {
  for (const b of snap.detail?.notable?.beings ?? []) {
    if (favouriteBeings.has(b.id)) favouriteBeings.set(b.id, { id: b.id, row: b, seenTick: snap.tick });
  }
}

export function bannerKey(kind: BannerKind, id: number | string): string {
  return `${kind}:${id}`;
}

export function bannerOf(kind: BannerKind, id: number | string): Banner | undefined {
  return banners.get(bannerKey(kind, id));
}

export function setBanner(kind: BannerKind, id: number | string, banner: Banner): void {
  banners.set(bannerKey(kind, id), banner);
}

export function traitRainOf(slot: RainSlot): readonly string[] {
  return traitRain.get(slot) ?? [];
}

export function setTraitRain(slot: RainSlot, traits: readonly string[]): void {
  traitRain.set(slot, [...new Set(traits)]);
}

/** Clears every choice (tests and a new realm of the same page). */
export function resetSessionMemory(): void {
  favouriteBeings.clear();
  banners.clear();
  traitRain.clear();
}
