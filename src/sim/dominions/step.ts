import type { Dominion, DominionContext, RelationMatrix, UnitGuard } from './types.ts';
import { HAMLET_CAPTURE } from './capture.ts';

/** Ticks between campaign decisions and strength exchanges (TUNE). */
export const CAMPAIGN_INTERVAL = 20;
/** Fraction of the weaker side's strength lost per exchange (TUNE). */
export const CASUALTY_RATE = 0.1;

/**
 * One dominion step: declares campaigns against bordering enemies, resolves fights as strength
 * exchanges, and takes parcels from a defeated neighbour when `border_creep` is on (not with HAMLET_CAPTURE, see capture.ts).
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
    // Each border pair is one unit (17 section 9, `border:a-b`): a throw in one leaves the other pairs their exchange.
    const guard: UnitGuard = ctx.borderUnit ?? ((_, run) => run());
    for (const [a, b] of ctx.borders) {
      guard(`${a}-${b}`, () => {
        if (relations.get(a, b) !== 'war') return;
        const da = byId(ctx, a);
        const db = byId(ctx, b);
        if (!da || !db) return;
        if (!armies && (da.strength <= 0 || db.strength <= 0)) return;
        if (!inContact(ctx, a, b)) return;
        exchange(ctx, da, db, relations);
      });
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
 * Campaign joining and leaving for pact-level wars (10 section 12), over the war border pairs of this build.
 * For each war pair, every other member of the attacker's pact joins against the defender, and every other
 * member of the defender's pact joins against the attacker (a pact joins that side as a whole). A member that is
 * already on the opposite side (at war with its own pact's leader) leaves its pact instead of joining (the spec's
 * "leave"). Joining sets the member's relation to the foe to war. Draws no randomness.
 */
function joinCampaigns(ctx: DominionContext, relations: RelationMatrix): void {
  if (!ctx.pacts) return;
  // Each border pair is one unit (17 section 9, `border:a-b`), as in dominionStep.
  const guard: UnitGuard = ctx.borderUnit ?? ((_, run) => run());
  for (const [a, b] of ctx.borders) {
    guard(`${a}-${b}`, () => {
      if (relations.get(a, b) !== 'war') return;
      joinSide(ctx, relations, a, b);
      joinSide(ctx, relations, b, a);
    });
  }
}

function joinSide(ctx: DominionContext, relations: RelationMatrix, leader: number, foe: number): void {
  const own = ctx.pacts?.find((p) => p.memberIds.includes(leader));
  if (!own) return;
  for (const m of [...own.memberIds]) {
    if (m === leader || m === foe) continue;
    if (relations.get(m, leader) === 'war') {
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

/** Trades casualties; the weaker side loses more. A defeated side yields one parcel only without HAMLET_CAPTURE (border_creep). */
function exchange(ctx: DominionContext, a: Dominion, b: Dominion, relations: RelationMatrix): void {
  const loser = a.strength === b.strength ? (ctx.rng.next() < 0.5 ? a : b) : a.strength < b.strength ? a : b;
  const winner = loser === a ? b : a;
  const hit = Math.max(1, Math.floor(loser.strength * CASUALTY_RATE));
  winner.strength = Math.max(0, winner.strength - Math.floor(hit / 2));
  loser.strength = Math.max(0, loser.strength - hit);
  winner.target = loser.id;
  if (winner.campaignSince < 0) {
    winner.campaignSince = ctx.tick;
    ctx.onCampaign?.('start', winner.id, loser.id);
  }
  if (loser.strength === 0) {
    relations.set(a.id, b.id, 'peace');
    // With HAMLET_CAPTURE on, the defeat moves no parcel: the hamlets change hands by capture (capture.ts, 10 section 7).
    if (ctx.isOn('border_creep') && !HAMLET_CAPTURE) takeParcel(ctx, winner, loser);
    ctx.onDefeat?.(winner.id);
    ctx.onCampaign?.('end', winner.id, loser.id);
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
