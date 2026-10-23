import type { Rng } from '../../shared/rng.ts';

/** Diplomatic state between two dominions (10 section 2, reduced to three levels). */
export type Relation = 'peace' | 'tension' | 'war';

/** A dominion: parcels it holds, its army strength and its campaign target (plain ids). */
export interface Dominion {
  id: number;
  /** Parcel ids owned by this dominion. */
  parcels: Set<number>;
  /** Army strength; the campaign fights with it. */
  strength: number;
  /** Dominion id of the current campaign target, or -1. */
  target: number;
  /** Tick the current campaign started, or -1. */
  campaignSince: number;
}

/** Structural context for dominionStep (no Sim import). */
export interface DominionContext {
  rng: Rng;
  tick: number;
  /** Realm Rule lookup (`rules.isOn`). */
  isOn(id: string): boolean;
  dominions: Dominion[];
  /** Border adjacency: pairs of dominion ids that share a border (symmetric). */
  borders: [number, number][];
  /** Parcel owner lookup used when a parcel changes hands. */
  owner: Map<number, number>;
}

/** Symmetric relation store keyed by the sorted pair of dominion ids. */
export class RelationMatrix {
  private readonly map = new Map<string, Relation>();

  private key(a: number, b: number): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  get(a: number, b: number): Relation {
    return this.map.get(this.key(a, b)) ?? 'peace';
  }

  set(a: number, b: number, r: Relation): void {
    this.map.set(this.key(a, b), r);
  }
}
