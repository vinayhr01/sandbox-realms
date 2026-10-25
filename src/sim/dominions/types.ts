import type { Rng } from '../../shared/rng.ts';

/** Diplomatic state between two dominions (10 section 2, reduced to three levels). */
export type Relation = 'peace' | 'tension' | 'war';

/** Rank of a dominion by power (10 section 4, rank.ts): the highest is supreme, the second is second. */
export type Rank = 'supreme' | 'second';

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
  /** Dominion traits that set tax rates (tax.ts: highLocal, lowLocal, highTribute, lowTribute). Optional: none by default. */
  traits?: string[];
  /** Tax receipts from the ruler's share (tax.ts), cumulative. Optional: 0 until a hamlet pays. */
  taxRaised?: number;
  /** The ruler, a Being in the leading hamlet (rulers.ts). Optional: absent while the dominion has none. */
  ruler?: { slot: number; gen: number };
  /** Tick before which no successor is sought after a ruler's death (rulers.ts). Optional: absent when no wait runs. */
  rulerWaitUntil?: number;
  /** Rank by power, set every RANK_PERIOD_TICKS (rank.ts). Optional: absent for a dominion that is neither supreme nor second. */
  rank?: Rank;
  /** Tick the dominion was founded (founding.ts, adapter.ts addDominion). Optional: absent in saves made before it was recorded (10 section 5 dominion age). */
  foundedTick?: number;
  /** Tick the current ruler was installed (rulers.ts). Optional: absent until a ruler is installed after it was recorded (10 section 5 ruler tenure). */
  rulerSinceTick?: number;
  /** Tick a hamlet of this dominion was last taken from another dominion (10 section 1 newConquestTick; adapter.ts trackHolds). Optional: absent until a capture. */
  newConquestTick?: number;
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
  /** Called once when a strength exchange defeats a dominion (its strength reaches 0). Optional. */
  onDefeat?(winnerId: number): void;
  /** Campaign hooks: `start` when the winner's campaign begins, `end` when the loser's strength reaches 0. Optional. */
  onCampaign?(kind: 'start' | 'end', winnerId: number, loserId: number): void;
  /** Pact member lists for campaign joining (pacts.ts). Optional: without it no pact joins a war. */
  pacts?: { id: number; memberIds: number[] }[];
  /** Army parcel per dominion id (armies.ts). Optional: without it every border war pair is in contact. */
  armyParcel?: Map<number, number>;
  /** Parcels per side of the realm, for the army contact test. Optional, with armyParcel. */
  perAxis?: number;
}

/** Key of an unordered pair of dominion ids: the lower id first. */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Symmetric relation store keyed by the sorted pair of dominion ids. */
export class RelationMatrix {
  private readonly map = new Map<string, Relation>();

  get(a: number, b: number): Relation {
    return this.map.get(pairKey(a, b)) ?? 'peace';
  }

  set(a: number, b: number, r: Relation): void {
    this.map.set(pairKey(a, b), r);
  }
}
