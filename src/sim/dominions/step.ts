import type { Dominion, DominionContext, RelationMatrix } from './types.ts';

/** Ticks between campaign decisions and strength exchanges (TUNE). */
export const CAMPAIGN_INTERVAL = 20;
/** Fraction of the weaker side's strength lost per exchange (TUNE). */
export const CASUALTY_RATE = 0.1;

/**
 * One dominion step: declares campaigns against bordering enemies, resolves fights as strength
 * exchanges, and takes parcels from a defeated neighbour when `border_creep` is on.
 * `parley` off stops every campaign at once (10 section 3). `standing_armies` off raises no armies.
 */
export function dominionStep(ctx: DominionContext, relations: RelationMatrix): void {
  const parley = ctx.isOn('parley');
  const armies = ctx.isOn('standing_armies');
  if (!parley) {
    for (const d of ctx.dominions) {
      d.target = -1;
      d.campaignSince = -1;
    }
    return;
  }
  if (ctx.tick % CAMPAIGN_INTERVAL === 0) {
    for (const [a, b] of ctx.borders) {
      if (relations.get(a, b) !== 'war') continue;
      const da = byId(ctx, a);
      const db = byId(ctx, b);
      if (!da || !db) continue;
      if (!armies && (da.strength <= 0 || db.strength <= 0)) continue;
      exchange(ctx, da, db, relations);
    }
  }
  for (const d of ctx.dominions) {
    if (d.target >= 0 && relations.get(d.id, d.target) !== 'war') {
      d.target = -1;
      d.campaignSince = -1;
    }
  }
}

function byId(ctx: DominionContext, id: number): Dominion | undefined {
  return ctx.dominions.find((d) => d.id === id);
}

/** Trades casualties; the weaker side loses more and a defeated side yields one parcel. */
function exchange(ctx: DominionContext, a: Dominion, b: Dominion, relations: RelationMatrix): void {
  const loser = a.strength === b.strength ? (ctx.rng.next() < 0.5 ? a : b) : a.strength < b.strength ? a : b;
  const winner = loser === a ? b : a;
  const hit = Math.max(1, Math.floor(loser.strength * CASUALTY_RATE));
  winner.strength = Math.max(0, winner.strength - Math.floor(hit / 2));
  loser.strength = Math.max(0, loser.strength - hit);
  winner.target = loser.id;
  if (winner.campaignSince < 0) winner.campaignSince = ctx.tick;
  if (loser.strength === 0) {
    relations.set(a.id, b.id, 'peace');
    if (ctx.isOn('border_creep')) takeParcel(ctx, winner, loser);
  }
}

/** Moves one parcel from the defeated dominion to the victor (border_creep on). */
function takeParcel(ctx: DominionContext, winner: Dominion, loser: Dominion): void {
  const first = [...loser.parcels].sort((x, y) => x - y)[0];
  if (first === undefined) return;
  loser.parcels.delete(first);
  winner.parcels.add(first);
  ctx.owner.set(first, winner.id);
}

/** Signs a peace pact: ends the war between two dominions and stops their campaigns (10 section 5). */
export function signPeace(ctx: DominionContext, relations: RelationMatrix, a: number, b: number): void {
  endWar(ctx.dominions, relations, a, b);
}

/** Sets a pair to peace and clears any campaign between them. Shared by signPeace and the yearly pass. */
export function endWar(dominions: readonly Dominion[], relations: RelationMatrix, a: number, b: number): void {
  relations.set(a, b, 'peace');
  for (const d of dominions) {
    if ((d.id === a && d.target === b) || (d.id === b && d.target === a)) {
      d.target = -1;
      d.campaignSince = -1;
    }
  }
}
