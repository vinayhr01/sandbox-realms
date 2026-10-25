/**
 * Sim-side effects of the custom traits (11 sections 4 and 9.1). Each function is called from an existing hook:
 * the chat outcome and the chat partner (beings/system.ts), the child copy (beings/system.ts spawnCopy), the campaign
 * and war hooks (dominions/step.ts, dominions/founding.ts, dominions/adapter.ts) and the ruler step (dominions/rulers.ts).
 * Mood goes through addMood (beings/social.ts). Draws only from the `culture` stream. Pure rules are in trait-rules.ts.
 * The study traits (xp, levels), the book traits and the fight conversion (convertOrElse, rooted) keep their state in
 * CultureState (culture.ts); their hooks are here too. The keepers guard is splitCustom in culture.ts, and the split
 * preconditions are splitAllowed (trait-rules.ts); the split intrigues call both (dominions/intrigue.ts, adapter.ts
 * splitHooksOf). bookLovers and eagerReaders are applied in readBook (the `read` decision, beings close 5). The child
 * flag reaches jobs through the settlements workforce (childMayWork). towerPride is read by the watchspire limit
 * (settlements/custom-rules.ts).
 */
import type { Sim } from '../sim.ts';
import { PARCEL, PATCH, YEAR_TICKS } from '../../shared/constants.ts';
import { addMood } from '../beings/social.ts';
import { MAX_BEINGS } from '../beings/store.ts';
import { vitalityRatio } from '../beings/trait-hooks.ts';
import { CUSTOM_TRAIT_BY_ID } from '../../content/customs.ts';
import { dominionOwnerOf, dominionsOfSim } from '../dominions/adapter.ts';
import { hamletsOf } from '../settlements/adapter.ts';
import { addCustomTrait, addXp, customOfGroup, readBookEffects, type Book } from './culture.ts';
import { blocksConversion, blocksWar, childMayWork, CONVERT_CHANCE, CONVERT_HP_RATIO, MENTOR_XP, successionRuleOf } from './trait-rules.ts';

const NONE: readonly string[] = [];

/** Parcel index of a being's tile (hamlet.ts layout). */
function parcelOfSlot(sim: Sim, slot: number): number {
  const s = sim.beings.store;
  const perAxis = sim.realm.side / PARCEL;
  return Math.floor((s.y[slot] ?? 0) / PARCEL) * perAxis + Math.floor((s.x[slot] ?? 0) / PARCEL);
}

/** Culture key of a being (generation * MAX_BEINGS + slot, as adapter.ts writes it). */
function keyOfSlot(sim: Sim, slot: number): number {
  return (sim.beings.store.generation[slot] ?? 0) * MAX_BEINGS + slot;
}

/** Whether a slot is a living Folk (the civil side of convertOrElse). */
function isFolkSlot(sim: Sim, slot: number): boolean {
  const b = sim.beings;
  return b.species(b.store.species[slot] ?? 0).folk;
}

/** Trait ids of the custom of a group (a dominion id), or none. */
export function traitsOfGroup(sim: Sim, group: number): readonly string[] {
  return customOfGroup(sim.culture, group)?.traits ?? NONE;
}

/**
 * Dominion group a being follows: its defection (convertOrElse) when it has one, else the dominion holding its parcel.
 * 0 when neither. Draws no rng.
 */
export function groupOfSlot(sim: Sim, slot: number): number {
  const defected = sim.culture.allegiance?.[String(keyOfSlot(sim, slot))];
  if (defected !== undefined) return defected;
  const owner = dominionOwnerOf(sim);
  if (!owner) return 0;
  return owner[parcelOfSlot(sim, slot)] ?? 0;
}

/** Trait ids of the custom of the dominion a being follows (groupOfSlot), or none (no dominion, no custom). */
export function traitsOfSlot(sim: Sim, slot: number): readonly string[] {
  if (sim.culture.customs.length === 0) return NONE;
  const dom = groupOfSlot(sim, slot);
  return dom === 0 ? NONE : traitsOfGroup(sim, dom);
}

/** Adds xp to a being from a source (a good chat, a book); its custom's study traits decide the gain (culture.ts addXp). */
export function grantXp(sim: Sim, slot: number, amount: number): void {
  addXp(sim.culture, keyOfSlot(sim, slot), traitsOfSlot(sim, slot), amount);
}

/**
 * A reader takes a book (11 section 5): xp through readBookEffects (eagerReaders, then the reader's study traits), the
 * conversion lottery, and the ruler or leader copy. Returns the mood the reading gives (bookLovers), for the caller to
 * apply. Called by the `read` decision (system.ts). Not built, the sim has no state for them: the author's mind trait
 * (the book keeps no author), the reading-effect traits and the dialect and creed copies (no dialect or creed holds traits),
 * the mana and the attribute gains (the book keeps no type). See DECISIONS.md "Beings close 6".
 */
export function readBook(sim: Sim, reader: number, book: Book): number {
  const mood = readBookEffects(sim.culture, keyOfSlot(sim, reader), traitsOfSlot(sim, reader), book);
  bookConversion(sim, reader, book);
  bookCopy(sim, reader, book);
  return mood;
}

/**
 * Book conversion lottery (11 section 5): the reader's current meta and the book's meta hold three tickets each, and the
 * winner is the meta the reader follows. The book's meta wins 50%, which converts the reader (allegiance, as talkSpread
 * does). `stylish` adds to its dialect's side and no dialect holds traits here. Needs a custom on both sides; a `rooted`
 * custom of the reader blocks it. Draws from `culture` only when every condition holds.
 */
function bookConversion(sim: Sim, reader: number, book: Book): void {
  const current = groupOfSlot(sim, reader);
  if (current === 0 || current === book.group) return;
  if (!customOfGroup(sim.culture, current) || !customOfGroup(sim.culture, book.group)) return;
  if (blocksConversion(traitsOfSlot(sim, reader))) return;
  if (sim.rng('culture').next() >= 0.5) return;
  const allegiance: Record<string, number> = sim.culture.allegiance ?? {};
  allegiance[String(keyOfSlot(sim, reader))] = book.group;
  sim.culture.allegiance = allegiance;
}

/**
 * Ruler or leader copy (11 section 5): a reader who rules a dominion or leads a hamlet copies one tradable trait of the
 * book's custom onto its dominion's custom, with 50%. The book's custom is the writer's current custom (the book keeps no
 * trait list: a substitution), and the hamlet meta is the dominion's (hamlet customs are not modelled, as in talkSpread).
 * Draws from `culture` only when the reader rules or leads and both customs exist.
 */
function bookCopy(sim: Sim, reader: number, book: Book): void {
  if (!rulesOrLeads(sim, reader)) return;
  const group = groupOfSlot(sim, reader);
  const target = customOfGroup(sim.culture, group);
  const source = customOfGroup(sim.culture, book.group);
  if (!target || !source) return;
  if (sim.rng('culture').next() >= 0.5) return;
  // The catalogue has no canBeInBook column (11 section 9), so a trait is tradable unless it is locked (customs.ts).
  const tradable = source.traits.filter((id) => {
    const def = CUSTOM_TRAIT_BY_ID.get(id);
    return def !== undefined && def.rarity !== 'locked';
  });
  if (tradable.length === 0) return;
  const id = tradable[sim.rng('culture').int(tradable.length)];
  if (id !== undefined) addCustomTrait(target.traits, id);
}

/** Whether a Being is the living ruler of a dominion or the leader of a hamlet (11 section 5 `ruler/leader`). */
function rulesOrLeads(sim: Sim, slot: number): boolean {
  const s = sim.beings.store;
  if (dominionsOfSim(sim).some((d) => d.ruler !== undefined && d.ruler.slot === slot && s.isCurrent(slot, d.ruler.gen))) return true;
  return hamletsOf(sim).some((h) => h.leader === slot);
}

/**
 * Architect talk (07 section 13): the Being spoken to takes the custom of the controlled Being's dominion. This is the
 * talkSpread result without the draw, since the Architect's word is the winner. Both must be Folk, in different dominions,
 * and the controlled Being's dominion must hold a custom; a `rooted` custom of the listener blocks it. Creed and dialect
 * imposition are not built (no creed or dialect holds traits in the sim). Draws no rng.
 */
export function imposeCustom(sim: Sim, speaker: number, listener: number): void {
  if (sim.culture.customs.length === 0) return;
  if (!isFolkSlot(sim, speaker) || !isFolkSlot(sim, listener)) return;
  const group = groupOfSlot(sim, speaker);
  if (group === 0 || groupOfSlot(sim, listener) === group) return;
  if (!customOfGroup(sim.culture, group) || blocksConversion(traitsOfSlot(sim, listener))) return;
  const allegiance: Record<string, number> = sim.culture.allegiance ?? {};
  allegiance[String(keyOfSlot(sim, listener))] = group;
  sim.culture.allegiance = allegiance;
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
 * Meta spread by talk (11 section 4.4, custom side). Both speakers must be Folk (the memory the spec asks for), belong to
 * different dominions, and each dominion must hold a custom. Six tickets: three for each speaker's meta. One draw
 * decides the winner; the loser speaker's meta is replaced, which here means the loser's allegiance moves to the
 * winner's dominion group (the same record convertByFight writes). A loser whose custom holds `rooted` keeps it.
 * Substitutions: the +1 tickets of the hamlet and dominion matches (hamlet customs are not modelled, and the speaker's
 * dominion is the meta here). Creed and dialect spread are group-level, across contacts (culture.ts spreadCreeds and
 * spreadDialects), so talk does not move them. Draws from `culture` only when every condition holds.
 */
function talkSpread(sim: Sim, a: number, b: number): void {
  if (!isFolkSlot(sim, a) || !isFolkSlot(sim, b)) return;
  const ga = groupOfSlot(sim, a);
  const gb = groupOfSlot(sim, b);
  if (ga === 0 || gb === 0 || ga === gb) return;
  if (!customOfGroup(sim.culture, ga) || !customOfGroup(sim.culture, gb)) return;
  const aWins = sim.rng('culture').next() < 0.5;
  const loser = aWins ? b : a;
  const winner = aWins ? ga : gb;
  if (blocksConversion(traitsOfSlot(sim, loser))) return;
  const allegiance: Record<string, number> = sim.culture.allegiance ?? {};
  allegiance[String(keyOfSlot(sim, loser))] = winner;
  sim.culture.allegiance = allegiance;
}

/** Whether a Being's lineage holds a trait at birth (11 section 3 `hasSpeech`, `hasMemory`; species startTraits). */
export function lineageHas(sim: Sim, slot: number, trait: string): boolean {
  const def = sim.beings.species(sim.beings.store.species[slot] ?? 0);
  return def.startTraits?.being.includes(trait) ?? false;
}

/**
 * Converts a being and the same-lineage Beings within patch radius 1 of it to `group` (11 section 2, the split's unit
 * conversion): the actor's patch and the eight patches around it, Beings of the actor's species. Written to the allegiance
 * record (convertByFight and talkSpread use the same one), so groupOfSlot reads the new group. Returns the count converted.
 * Draws no rng.
 */
export function convertLineageUnits(sim: Sim, actor: number, group: number): number {
  const s = sim.beings.store;
  const species = s.species[actor] ?? 0;
  const ax = Math.floor((s.x[actor] ?? 0) / PATCH);
  const ay = Math.floor((s.y[actor] ?? 0) / PATCH);
  // Two patches away is at most 31 tiles (Chebyshev); the patch test below narrows it to radius 1.
  const near = sim.beings
    .within(actor, (o) => (s.species[o] ?? 0) === species, 2 * PATCH - 1)
    .filter((o) => Math.abs(Math.floor((s.x[o] ?? 0) / PATCH) - ax) <= 1 && Math.abs(Math.floor((s.y[o] ?? 0) / PATCH) - ay) <= 1);
  const allegiance: Record<string, number> = sim.culture.allegiance ?? {};
  for (const slot of [actor, ...near]) allegiance[String(keyOfSlot(sim, slot))] = group;
  sim.culture.allegiance = allegiance;
  return near.length + 1;
}

/**
 * Child flag (11 section 9.1 childLabour): a Being is a child while it is under its adult age. Read from the Being's age
 * only. Draws no rng.
 */
export function isChild(sim: Sim, slot: number): boolean {
  return !adult(sim, slot);
}

/**
 * Whether a Being may take a job (childLabour, 11 section 9.1). Adults always may. A child may only when its dominion's
 * custom holds `childLabour`. For the jobs step to call; jobs.ts does not call it yet. Draws no rng.
 */
export function mayTakeJob(sim: Sim, slot: number): boolean {
  if (!isChild(sim, slot)) return true;
  return childMayWork(traitsOfSlot(sim, slot));
}

/**
 * Effects of one chat outcome between two Folk or a Folk and a beast (beings/system.ts chat): gossipers (each talker
 * whose custom holds it gets `gossiped`), chatterCircle (50%: both `inspired` when either custom holds it), and the
 * childShelter and elderRespect gifts. Called after the chat's own mood. Draws only from the `culture` stream.
 * mentorTrade (11 section 4.4: +10 xp both): on a good talk (`good`, the 70% outcome), when either custom holds it, each
 * talker gains MENTOR_XP through its own study traits. The meta spread (talkSpread) runs on every chat, good or bad, as
 * 11 section 4.4 states it, and is where `rooted` blocks a conversion.
 */
export function talkOutcome(sim: Sim, a: number, b: number, good: boolean): void {
  if (sim.culture.customs.length === 0) return;
  talkSpread(sim, a, b);
  const ta = traitsOfSlot(sim, a);
  const tb = traitsOfSlot(sim, b);
  if (ta.length === 0 && tb.length === 0) return;
  if (good && (ta.includes('mentorTrade') || tb.includes('mentorTrade'))) {
    grantXp(sim, a, MENTOR_XP);
    grantXp(sim, b, MENTOR_XP);
  }
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

/** A conquered unit keeps the wasConquered stamp for this many ticks (10 section 7: the last 400 s = 8000 ticks). */
export const CONQUERED_WINDOW = 8000;

/** Living Folk, in slot order. Draws no rng. */
function folkSlots(sim: Sim): number[] {
  const s = sim.beings.store;
  const out: number[] = [];
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    if (sim.beings.species(s.species[slot] ?? 0).folk) out.push(slot);
  }
  return out;
}

/**
 * Capture moods (10 section 7, finishCapture), applied after the owner bytes pass the hamlet to `winner`. The Folk standing on
 * the hamlet's parcels were conquered: they feel `conquered` (wasConquered, -20) and keep the stamp in `conqueredAt`. The
 * winner's other Folk feel `hamlet_conquered` (+30). The loser's other Folk feel `hamlet_lost` (-15), or `home_lost` (-30)
 * when the hamlet was its capital. A unit stamped within CONQUERED_WINDOW feels none of these. Reads the stamps before any is
 * written. Draws no rng.
 */
export function captureMood(
  sim: Sim,
  winner: number,
  loser: number,
  capital: boolean,
  hamletParcels: ReadonlySet<number>,
  ownerAt: (parcel: number) => number,
  conqueredAt: Map<number, number>,
  tick: number,
): void {
  const recent = (slot: number): boolean => {
    const t = conqueredAt.get(keyOfSlot(sim, slot));
    return t !== undefined && tick - t < CONQUERED_WINDOW;
  };
  const folk = folkSlots(sim);
  const inHamlet = (slot: number): boolean => hamletParcels.has(parcelOfSlot(sim, slot));
  const onOther = (dominion: number): number[] => folk.filter((f) => !inHamlet(f) && ownerAt(parcelOfSlot(sim, f)) === dominion);
  const winners = onOther(winner);
  const losers = onOther(loser);
  const conquered = folk.filter(inHamlet);
  for (const f of winners) if (!recent(f)) addMood(sim, f, 'hamlet_conquered');
  for (const f of losers) if (!recent(f)) addMood(sim, f, capital ? 'home_lost' : 'hamlet_lost');
  for (const f of conquered) {
    if (recent(f)) continue;
    addMood(sim, f, 'conquered');
    conqueredAt.set(keyOfSlot(sim, f), tick);
  }
}

/**
 * Raze moods (10 section 7, the raze check): the Folk among the beings evicted from a razed hamlet feel `razed` (-20), or
 * `razed_capital` (-35) when it was the loser's capital. A unit stamped within CONQUERED_WINDOW feels neither (as captureMood).
 * Reads the stamps. Draws no rng.
 */
export function razedMood(sim: Sim, slots: readonly number[], capital: boolean, conqueredAt: Map<number, number>, tick: number): void {
  for (const f of slots) {
    if (!sim.beings.species(sim.beings.store.species[f] ?? 0).folk) continue;
    const t = conqueredAt.get(keyOfSlot(sim, f));
    if (t !== undefined && tick - t < CONQUERED_WINDOW) continue;
    addMood(sim, f, capital ? 'razed_capital' : 'razed');
  }
}

/**
 * convertOrElse (11 section 9.1): after a blow that did not kill (beings/system.ts strike), a civil attacker (a Folk whose
 * custom holds the trait) below 30% vitality converts a weak non-mind target (not Folk, below 30% vitality) with 30%: the
 * victim follows the attacker's dominion (culture allegiance). A target whose current custom holds `rooted` is never
 * converted. Draws from the `culture` stream only when every condition holds.
 */
export function convertByFight(sim: Sim, attacker: number, victim: number): void {
  if (sim.culture.customs.length === 0) return;
  if (!traitsOfSlot(sim, attacker).includes('convertOrElse')) return;
  if (!isFolkSlot(sim, attacker) || isFolkSlot(sim, victim)) return;
  if (vitalityRatio(sim, attacker) >= CONVERT_HP_RATIO || vitalityRatio(sim, victim) >= CONVERT_HP_RATIO) return;
  const to = groupOfSlot(sim, attacker);
  if (to === 0 || groupOfSlot(sim, victim) === to) return;
  if (blocksConversion(traitsOfSlot(sim, victim))) return;
  if (sim.rng('culture').next() >= CONVERT_CHANCE) return;
  const allegiance: Record<string, number> = sim.culture.allegiance ?? {};
  allegiance[String(keyOfSlot(sim, victim))] = to;
  sim.culture.allegiance = allegiance;
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
