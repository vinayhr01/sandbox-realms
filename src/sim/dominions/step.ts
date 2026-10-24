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
    joinCampaigns(ctx, relations);
    for (const [a, b] of ctx.borders) {
      if (relations.get(a, b) !== 'war') continue;
      const da = byId(ctx, a);
      const db = byId(ctx, b);
      if (!da || !db) continue;
      if (!armies && (da.strength <= 0 || db.strength <= 0)) continue;
      if (!inContact(ctx, a, b)) continue;
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

/**
 * Campaign joining (10 section 11-12, simplified): for each war border pair, the other members of the
 * attacker's pact join against the defender, and the other members of the defender's pact join against the
 * attacker. A member at peace with the foe leaves its pact instead of joining (the spec's "leave"). Pacts are
 * disjoint in this build, so a member that joins the enemy side always leaves the pact it had. Draws no randomness.
 */
function joinCampaigns(ctx: DominionContext, relations: RelationMatrix): void {
  if (!ctx.pacts) return;
  for (const [a, b] of ctx.borders) {
    if (relations.get(a, b) !== 'war') continue;
    joinSide(ctx, relations, a, b);
    joinSide(ctx, relations, b, a);
  }
}

function joinSide(ctx: DominionContext, relations: RelationMatrix, leader: number, foe: number): void {
  const own = ctx.pacts?.find((p) => p.memberIds.includes(leader));
  if (!own) return;
  for (const m of [...own.memberIds]) {
    if (m === leader || m === foe) continue;
    if (relations.get(m, foe) === 'peace') {
      own.memberIds = own.memberIds.filter((x) => x !== m);
      continue;
    }
    relations.set(m, foe, 'war');
  }
}

/** Two armies are in contact when their parcels are adjacent (8 neighbours) or equal. Without army positions, always in contact. */
function inContact(ctx: DominionContext, a: number, b: number): boolean {
  const pa = ctx.armyParcel?.get(a);
  const pb = ctx.armyParcel?.get(b);
  if (pa === undefined || pb === undefined || !ctx.perAxis) return true;
  const dx = Math.abs((pa % ctx.perAxis) - (pb % ctx.perAxis));
  const dy = Math.abs(Math.floor(pa / ctx.perAxis) - Math.floor(pb / ctx.perAxis));
  return Math.max(dx, dy) <= 1;
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
    ctx.onDefeat?.(winner.id);
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
