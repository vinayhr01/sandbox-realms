/**
 * Mood, sleep and bonds (06 sections 4 and 5; bonds are a round 6 addition, see DECISIONS.md "Beings round 6").
 * Everything here reads and writes per-Being fields in the store and the strain registry; the decision and
 * life-cycle code in system.ts calls these.
 */
import { MOOD_VALUE, type MoodEvent } from '../../content/moods.ts';
import { STRAIN_TRAIT_BY_ID } from '../../content/traits.ts';
import type { Rng } from '../../shared/rng.ts';
import type { Sim } from '../sim.ts';
import { YEAR_TICKS } from '../../shared/constants.ts';
import { ROUND6, ROUND8, ROUND9 } from './tuning.ts';
import { breedMode, dreamsAlways, needsPartner, recoversFully, sleepScale, wakeEnduranceScale } from './trait-hooks.ts';

/** Mood bounds (06 section 4.1). */
const MOOD_MIN = -100;
const MOOD_MAX = 100;

/**
 * The strain trait that grants the `emotions` tag (06 section 4.1: only strains with it feel mood). The spec
 * names the tag but no trait grants it. From the 18b data, `fear_organ` ("Gains fear/flee responses") is the
 * only trait whose text is an emotional capacity; every awakened strain holds it, so the awakened set is a
 * subset of this one. Change this constant to move the grant.
 */
export const EMOTIONS_TRAIT = 'fear_organ';

/** Whether a Being's strain feels mood (06 section 4.1, the `emotions` tag). */
export function feelsMood(sim: Sim, slot: number): boolean {
  const strain = sim.beings.strains.get(sim.beings.store.strain[slot] ?? 0);
  return strain !== undefined && strain.traits.includes(EMOTIONS_TRAIT);
}

/** Applies one mood event (06 section 4.1, `changeMood`): mood = clamp(mood + value + extra). */
export function addMood(sim: Sim, slot: number, event: MoodEvent, extra = 0): void {
  if (!feelsMood(sim, slot)) return;
  const s = sim.beings.store;
  const next = (s.mood[slot] ?? 0) + MOOD_VALUE[event] + extra;
  s.mood[slot] = Math.min(MOOD_MAX, Math.max(MOOD_MIN, next));
}

/** Sleep kinds the decision layer starts (06 section 5 decisions: idle_nap, polyphasic, monophasic). */
export type SleepKind = 'nap' | 'poly' | 'mono';

/** Whether the strain holds a sleep-cycle trait (18b group SLP). */
function hasSleepCycle(traits: readonly string[]): boolean {
  return traits.some((id) => STRAIN_TRAIT_BY_ID.get(id)?.group === 'SLP');
}

/**
 * Length of a sleep in ticks (06 section 5): monophasic 800 to 1800; a strain with no sleep-cycle trait 400;
 * otherwise uniform 400 to 1200. The era-linked durations (2000) are not built: no era-to-trait mapping
 * exists in the data.
 */
export function sleepTicks(sim: Sim, slot: number, kind: SleepKind, rng: Rng): number {
  let ticks: number;
  if (kind === 'mono') {
    ticks = ROUND6.monoMin + rng.int(ROUND6.monoMax - ROUND6.monoMin + 1);
  } else {
    const strain = sim.beings.strains.get(sim.beings.store.strain[slot] ?? 0);
    ticks =
      !strain || !hasSleepCycle(strain.traits) ? ROUND6.sleepPlain : ROUND6.sleepMin + rng.int(ROUND6.sleepMax - ROUND6.sleepMin + 1);
  }
  // Round 8 trait hooks: `unquiet` sleeps less, `long_sleeper` sleeps longer (18b).
  return Math.max(1, Math.round(ticks * sleepScale(sim, slot)));
}

/**
 * The dream roll of a natural wake (06 section 5): a 23-entry pot with one good dream (+15), one bad dream (-15),
 * one nightmare (-30) and twenty empty rolls. The 1800-tick dream effect is not built; the mood event is applied at
 * the wake. `dream_gland` makes every sleeper dream: good or bad, one fair roll (18b COG, mood +/-15).
 */
function dream(sim: Sim, slot: number): void {
  const rng = sim.rng('beings');
  if (dreamsAlways(sim, slot)) {
    addMood(sim, slot, rng.next() < 0.5 ? 'good_dream' : 'bad_dream');
    return;
  }
  const roll = rng.int(ROUND8.dreamPot);
  if (roll === 0) addMood(sim, slot, 'good_dream');
  else if (roll === 1) addMood(sim, slot, 'bad_dream');
  else if (roll === 2) addMood(sim, slot, 'nightmare');
}

/** Starts a sleep (06 section 5). The Being stops deciding and moving until it wakes. */
export function beginSleep(sim: Sim, slot: number, kind: SleepKind): void {
  const s = sim.beings.store;
  s.sleepUntil[slot] = sim.tick + sleepTicks(sim, slot, kind, sim.rng('beings'));
  s.sleepVit[slot] = s.vit[slot] ?? 0;
  sim.beings.stats.sleeps++;
}

/**
 * Sleep check, once per tick for a sleeping Being. Returns true while it still sleeps. Damage of any source
 * ends the sleep early with no mood and no endurance (06 section 5: early removal gives none of these).
 * A natural wake restores 20% of max endurance, gives the `slept` mood event, then rolls the dream pot (round 8).
 */
export function sleepCheck(sim: Sim, slot: number): boolean {
  const s = sim.beings.store;
  if ((s.sleepUntil[slot] ?? 0) === 0) return false;
  const vit = s.vit[slot] ?? 0;
  if (vit < (s.sleepVit[slot] ?? 0)) {
    s.sleepUntil[slot] = 0;
    s.sleepVit[slot] = vit;
    return false;
  }
  s.sleepVit[slot] = vit;
  if (sim.tick < (s.sleepUntil[slot] ?? 0)) return true;
  s.sleepUntil[slot] = 0;
  const max = sim.beings.species(s.species[slot] ?? 0).endurance;
  if (recoversFully(sim, slot)) {
    s.endurance[slot] = max;
  } else {
    const gain = Math.round(max * ROUND6.sleepEndurance * wakeEnduranceScale(sim, slot));
    s.endurance[slot] = Math.min(max, (s.endurance[slot] ?? 0) + gain);
  }
  addMood(sim, slot, 'slept');
  dream(sim, slot);
  return false;
}

/** A Being is asleep (06 section 5). */
export function isAsleep(sim: Sim, slot: number): boolean {
  return (sim.beings.store.sleepUntil[slot] ?? 0) !== 0;
}

/**
 * Bond check for one Being (round 6, bonds). Two Beings of one strain that stay within `bondRadius` tiles for
 * `bondTicks` ticks, both unbonded, become bonded: each gets the `bonded` mood event. A bond lasts until one
 * partner dies (killBeing, which gives the survivor `friend_died`).
 */
export function bondCheck(sim: Sim, slot: number): void {
  const b = sim.beings;
  const s = b.store;
  if ((s.bondWith[slot] ?? -1) !== -1) return;
  const strain = s.strain[slot] ?? 0;
  const cand = b.nearest(slot, (o) => (s.strain[o] ?? 0) === strain && (s.bondWith[o] ?? -1) === -1, ROUND6.bondRadius);
  if (cand < 0) {
    s.closeWith[slot] = -1;
    return;
  }
  const gen = s.generation[cand] ?? 0;
  if (s.closeWith[slot] !== cand || s.closeGen[slot] !== gen) {
    s.closeWith[slot] = cand;
    s.closeGen[slot] = gen;
    s.closeSince[slot] = sim.tick;
    return;
  }
  if (sim.tick - (s.closeSince[slot] ?? 0) < ROUND6.bondTicks) return;
  s.bondWith[slot] = cand;
  s.bondGen[slot] = gen;
  s.closeWith[slot] = -1;
  s.bondWith[cand] = slot;
  s.bondGen[cand] = s.generation[slot] ?? 0;
  s.closeWith[cand] = -1;
  addMood(sim, slot, 'bonded');
  addMood(sim, cand, 'bonded');
  b.stats.bonds++;
}

/**
 * The live partner a Being links to through `withArr` / `genArr` (lover or best friend), or -1. A link whose partner has
 * died or been replaced (generation moved on) counts for nothing.
 */
function liveLink(sim: Sim, slot: number, withArr: Int32Array, genArr: Uint32Array): number {
  const o = withArr[slot] ?? -1;
  if (o < 0) return -1;
  return sim.beings.store.isCurrent(o, genArr[slot] ?? 0) ? o : -1;
}

/** The live lover of a Being (06 section 4.4), or -1. */
export function loverOf(sim: Sim, slot: number): number {
  const s = sim.beings.store;
  return liveLink(sim, slot, s.loverWith, s.loverGen);
}

/** The live best friend of a Being (06 section 4.4), or -1. */
export function friendOf(sim: Sim, slot: number): number {
  const s = sim.beings.store;
  return liveLink(sim, slot, s.friendWith, s.friendGen);
}

/** Lover and best friend that are alive now (the partners who take up a Being's quarrel, 07 section 10.4). */
export function bondPartners(sim: Sim, slot: number): number[] {
  const out: number[] = [];
  const lo = loverOf(sim, slot);
  const fr = friendOf(sim, slot);
  if (lo >= 0) out.push(lo);
  if (fr >= 0 && fr !== lo) out.push(fr);
  return out;
}

/** Adult by the current age against the adult age (06 section 3.2). */
function adultNow(sim: Sim, slot: number): boolean {
  const s = sim.beings.store;
  return (sim.tick - (s.born[slot] ?? 0)) / YEAR_TICKS >= (s.adultA[slot] ?? 1);
}

/** The live parent of a Being, or -1. */
function liveParent(sim: Sim, slot: number): number {
  const s = sim.beings.store;
  return s.hasLiveParent(slot) ? (s.parent[slot] ?? -1) : -1;
}

/** Parent, child or sibling (06 section 4.4 "not related"; a family is at least this close). */
export function related(sim: Sim, a: number, o: number): boolean {
  const pa = liveParent(sim, a);
  const po = liveParent(sim, o);
  if (pa === o || po === a) return true;
  return pa >= 0 && pa === po;
}

/** Whether the Being's strain breeds in pairs (06 section 6.3: the partner modes need a needsMate strain, 06 section 4.4). */
function pairedBreeder(sim: Sim, slot: number): boolean {
  const strain = sim.beings.strains.get(sim.beings.store.strain[slot] ?? 0);
  return needsPartner(breedMode(strain?.traits ?? []));
}

/**
 * Lover check for one Being (06 section 4.4, beings build 3). Two adults of one species, opposite sexes, both paired
 * breeders, neither with a lover, not related, within the partner radius, become lovers at ROUND9.loveChance. Lovers get
 * the `bonded` mood event (+40, the spec's smitten mood) and the `smitten` effect (3600 ticks, 08 section 5.3). The lover
 * link itself outlives the effect; the hearts are a render concern.
 */
export function loveCheck(sim: Sim, slot: number): void {
  const b = sim.beings;
  const s = b.store;
  if (loverOf(sim, slot) >= 0) return;
  if (!adultNow(sim, slot) || !pairedBreeder(sim, slot)) return;
  const sp = s.species[slot] ?? 0;
  const female = s.female[slot] ?? 0;
  const cand = b.nearest(
    slot,
    (o) =>
      s.species[o] === sp &&
      (s.female[o] ?? 0) !== female &&
      adultNow(sim, o) &&
      pairedBreeder(sim, o) &&
      loverOf(sim, o) < 0 &&
      !related(sim, slot, o),
    ROUND6.partnerRadius,
  );
  if (cand < 0) return;
  if (sim.rng('beings').next() >= ROUND9.loveChance) return;
  s.loverWith[slot] = cand;
  s.loverGen[slot] = s.generation[cand] ?? 0;
  s.loverWith[cand] = slot;
  s.loverGen[cand] = s.generation[slot] ?? 0;
  sim.effects.add(slot, 'smitten', sim.tick);
  sim.effects.add(cand, 'smitten', sim.tick);
  addMood(sim, slot, 'bonded');
  addMood(sim, cand, 'bonded');
  b.stats.lovers++;
}

/** Mood ratio of a Being in 0..1 for the friendship chance (06 section 4.4 `ratio`; TUNE: mood mapped from -100..100). */
function moodRatio(sim: Sim, slot: number): number {
  return ((sim.beings.store.mood[slot] ?? 0) + 100) / 200;
}

/**
 * Best-friend roll after a good chat (06 section 4.4). Neither may have a best friend, and a child does not befriend an
 * adult. Chance = 0.25 * (1 - |ratio difference|) when both feel mood, + 0.1 for family, - 0.5 when they are foes.
 * The likeability term of the spec is not modelled (the marks carry no likeability data). Success gives both `made_friend`.
 */
export function tryFriend(sim: Sim, a: number, o: number, foes: boolean): void {
  const s = sim.beings.store;
  if (friendOf(sim, a) >= 0 || friendOf(sim, o) >= 0) return;
  if ((s.baby[a] ?? 0) !== (s.baby[o] ?? 0)) return;
  let chance = 0;
  if (feelsMood(sim, a) && feelsMood(sim, o)) chance += ROUND9.friendBase * (1 - Math.abs(moodRatio(sim, a) - moodRatio(sim, o)));
  if (related(sim, a, o)) chance += ROUND9.friendFamily;
  if (foes) chance -= ROUND9.friendFoe;
  if (chance <= 0) return;
  if (sim.rng('beings').next() >= chance) return;
  s.friendWith[a] = o;
  s.friendGen[a] = s.generation[o] ?? 0;
  s.friendWith[o] = a;
  s.friendGen[o] = s.generation[a] ?? 0;
  addMood(sim, a, 'made_friend');
  addMood(sim, o, 'made_friend');
  sim.beings.stats.friends++;
}
