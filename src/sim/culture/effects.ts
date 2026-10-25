/**
 * Sim-side effects of the custom traits (11 sections 4 and 9.1). Each function is called from an existing hook:
 * the chat outcome and the chat partner (beings/system.ts), the child copy (beings/system.ts spawnCopy), the campaign
 * and war hooks (dominions/step.ts, dominions/founding.ts, dominions/adapter.ts) and the ruler step (dominions/rulers.ts).
 * Mood goes through addMood (beings/social.ts). Draws only from the `culture` stream. Pure rules are in trait-rules.ts.
 * Traits with no state behind them (xp, books, levels, conversion, divide, towers) are not here: they stay data.
 */
import type { Sim } from '../sim.ts';
import { PARCEL, YEAR_TICKS } from '../../shared/constants.ts';
import { addMood } from '../beings/social.ts';
import { dominionOwnerOf } from '../dominions/adapter.ts';
import { customOfGroup } from './culture.ts';
import { blocksWar, successionRuleOf } from './trait-rules.ts';

const NONE: readonly string[] = [];

/** Parcel index of a being's tile (hamlet.ts layout). */
function parcelOfSlot(sim: Sim, slot: number): number {
  const s = sim.beings.store;
  const perAxis = sim.realm.side / PARCEL;
  return Math.floor((s.y[slot] ?? 0) / PARCEL) * perAxis + Math.floor((s.x[slot] ?? 0) / PARCEL);
}

/** Trait ids of the custom of a group (a dominion id), or none. */
export function traitsOfGroup(sim: Sim, group: number): readonly string[] {
  return customOfGroup(sim.culture, group)?.traits ?? NONE;
}

/** Trait ids of the custom of the dominion holding the being's parcel, or none (no dominion, no custom). */
export function traitsOfSlot(sim: Sim, slot: number): readonly string[] {
  if (sim.culture.customs.length === 0) return NONE;
  const owner = dominionOwnerOf(sim);
  if (!owner) return NONE;
  const dom = owner[parcelOfSlot(sim, slot)] ?? 0;
  return dom === 0 ? NONE : traitsOfGroup(sim, dom);
}

/** Living Folk whose parcel the owner function gives to a dominion. Draws no rng. */
export function folkOf(sim: Sim, ownerAt: (parcel: number) => number, dominionId: number): number[] {
  const s = sim.beings.store;
  const out: number[] = [];
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    if (!sim.beings.species(s.species[slot] ?? 0).folk) continue;
    if (ownerAt(parcelOfSlot(sim, slot)) === dominionId) out.push(slot);
  }
  return out;
}

/** Whether a being is an adult (age at or above its adult age; adultA in years). */
function adult(sim: Sim, slot: number): boolean {
  const s = sim.beings.store;
  return (sim.tick - (s.born[slot] ?? 0)) / YEAR_TICKS >= (s.adultA[slot] ?? 1);
}

/**
 * A gift from an adult talker to a younger or older partner (childShelter: younger; elderRespect: older). 20% per
 * chat, +30 points when the two are parent and child (11 section 4.4). The sim has no items to give, so the gift is
 * the mood pair gift_given / gift_received.
 */
function gift(sim: Sim, giver: number, partner: number, traits: readonly string[], trait: string, younger: boolean): void {
  if (!traits.includes(trait) || !adult(sim, giver)) return;
  const s = sim.beings.store;
  const gb = s.born[giver] ?? 0;
  const pb = s.born[partner] ?? 0;
  if (younger ? pb <= gb : pb >= gb) return;
  const related = s.parent[partner] === giver || s.parent[giver] === partner;
  const chance = related ? 0.5 : 0.2;
  if (sim.rng('culture').next() < chance) {
    addMood(sim, giver, 'gift_given');
    addMood(sim, partner, 'gift_received');
  }
}

/**
 * Effects of one chat outcome between two Folk or a Folk and a beast (beings/system.ts chat): gossipers (each talker
 * whose custom holds it gets `gossiped`), chatterCircle (50%: both `inspired` when either custom holds it), and the
 * childShelter and elderRespect gifts. Called after the chat's own mood. Draws only from the `culture` stream.
 */
export function talkOutcome(sim: Sim, a: number, b: number): void {
  if (sim.culture.customs.length === 0) return;
  const ta = traitsOfSlot(sim, a);
  const tb = traitsOfSlot(sim, b);
  if (ta.length === 0 && tb.length === 0) return;
  if (ta.includes('gossipers')) addMood(sim, a, 'gossiped');
  if (tb.includes('gossipers')) addMood(sim, b, 'gossiped');
  if ((ta.includes('chatterCircle') || tb.includes('chatterCircle')) && sim.rng('culture').next() < 0.5) {
    addMood(sim, a, 'inspired');
    addMood(sim, b, 'inspired');
  }
  gift(sim, a, b, ta, 'childShelter', true);
  gift(sim, b, a, tb, 'childShelter', true);
  gift(sim, a, b, ta, 'elderRespect', false);
  gift(sim, b, a, tb, 'elderRespect', false);
}

/** Whether a being's custom lets it talk with animals (beastFriends, 11 section 9.1). */
export function talksWithBeasts(sim: Sim, slot: number): boolean {
  return traitsOfSlot(sim, slot).includes('beastFriends');
}

/**
 * Newborn attribute from the parent (heritageLore, 11 section 9.1: the newborn inherits the parent's best attribute
 * x0.5 + 1). Reading taken: the newborn's copy of the parent's best attribute is set to floor(best x 0.5) + 1. The
 * parent's custom decides. Draws no rng.
 */
export function heritageAttr(sim: Sim, parent: number, child: number): void {
  if (!traitsOfSlot(sim, parent).includes('heritageLore')) return;
  const s = sim.beings.store;
  let best = 0;
  for (let k = 1; k < 4; k++) if ((s.attrs[parent * 4 + k] ?? 0) > (s.attrs[parent * 4 + best] ?? 0)) best = k;
  const value = Math.floor(((s.attrs[parent * 4 + best] ?? 0) * 0.5)) + 1;
  s.attrs[child * 4 + best] = value;
}

/**
 * Campaign start and end moods for dominions whose custom holds warlikeJoy (11 section 9.1; 18e campaign events).
 * `start` gives campaign_started to the winner-side folk (the side that set the campaign); `end` gives campaign_won to
 * the winner and campaign_lost to the loser. Only dominions with warlikeJoy feel it.
 */
export function campaignMood(sim: Sim, kind: 'start' | 'end', winner: number, loser: number, ownerAt: (parcel: number) => number): void {
  if (sim.culture.customs.length === 0) return;
  const warlike = (id: number): boolean => traitsOfGroup(sim, id).includes('warlikeJoy');
  if (kind === 'start') {
    if (!warlike(winner)) return;
    for (const f of folkOf(sim, ownerAt, winner)) addMood(sim, f, 'campaign_started');
    return;
  }
  if (warlike(winner)) for (const f of folkOf(sim, ownerAt, winner)) addMood(sim, f, 'campaign_won');
  if (warlike(loser)) for (const f of folkOf(sim, ownerAt, loser)) addMood(sim, f, 'campaign_lost');
}

/** The war declaration is blocked for this dominion's custom (peaceable, serenity). Draws no rng. */
export function warBlocked(sim: Sim, dominionId: number): boolean {
  return blocksWar(traitsOfGroup(sim, dominionId));
}

/**
 * A blocked declaration (peaceable): the dominion's folk feel the love of peace, `peace_made`. Serenity blocks without a
 * mood. Draws no rng.
 */
export function blockedWarMood(sim: Sim, dominionId: number, ownerAt: (parcel: number) => number): void {
  if (!traitsOfGroup(sim, dominionId).includes('peaceable')) return;
  for (const f of folkOf(sim, ownerAt, dominionId)) addMood(sim, f, 'peace_made');
}

/**
 * A successor takes the crown (rulers.ts onInstall). Opposite-sex ruler under patriarchy or matriarchy: -50 (the loyalty
 * term of 11 section 9.1; the sim keeps no loyalty stat, so the ruler's own mood takes it). shatteredCrown: the folk of
 * the dominion outside the capital's parcels feel the lost crown (crown_lost; the split into new dominions is not built).
 * Draws no rng.
 */
export function rulerInstalled(sim: Sim, dominionId: number, slot: number, capitalParcels: ReadonlySet<number>, ownerAt: (parcel: number) => number): void {
  const traits = traitsOfGroup(sim, dominionId);
  if (traits.length === 0) return;
  const rule = successionRuleOf(traits);
  const s = sim.beings.store;
  if (rule.sex !== undefined && (s.female[slot] ?? 0) !== rule.sex) {
    s.mood[slot] = Math.max(-100, (s.mood[slot] ?? 0) - 50);
  }
  if (traits.includes('shatteredCrown')) {
    for (const f of folkOf(sim, ownerAt, dominionId)) {
      if (!capitalParcels.has(parcelOfSlot(sim, f))) addMood(sim, f, 'crown_lost');
    }
  }
}
