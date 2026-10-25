import { YEAR_TICKS } from '../../shared/constants.ts';
import { TRUCE_TICKS, type Truce } from './founding.ts';
import type { Dominion, RelationMatrix } from './types.ts';
import { pairKey } from './types.ts';
import type { RulerStats } from './rulers.ts';
import { opinionTerm } from '../culture/trait-rules.ts';

/**
 * Ruler diplomacy stand-in, used for a dominion with no living ruler (10 section 10, TUNE). With a ruler, the term is the
 * ruler's rapport times OPINION_PER_RAPPORT (rulers.ts), and the ruler's mood adds OPINION_MOOD_DIVISOR-th of itself to
 * the opinion held by that dominion (the spec's "a's ruler opinion stat"; the sim keeps no separate opinion stat).
 */
export const OPINION_RULER_STAND_IN = 25;
/** Opinion per point of a ruler's rapport (TUNE). Folk aptitudes run 1 to 7, so a typical ruler lands near the stand-in. */
export const OPINION_PER_RAPPORT = 5;
/** A ruler's mood is divided by this before it joins the opinion of its dominion (TUNE; mood is -100..100). */
export const OPINION_MOOD_DIVISOR = 10;
/** Opinion term when b is the supreme dominion and there are at least three dominions (10 section 10). */
export const OPINION_SUPREME = -100;
/** Opinion when the pair shares a border (close), and when it does not (far) (10 section 10, TUNE). */
export const OPINION_BORDER_CLOSE = -25;
export const OPINION_BORDER_FAR = 25;
/** Opinion while the pair is at war (10 section 10). */
export const OPINION_WAR = -500;
/** Opinion between members of one pact (10 section 10). */
export const OPINION_SAME_PACT = 30;
/** Opinion inside a truce, that is, within five years of a declaration (10 section 10). */
export const OPINION_TRUCE = 100;
/** Parcel-count penalty cap (10 section 10: clamp(diff / 5, -20, 0)). */
export const OPINION_PARCEL_CAP = 20;
/** Peace-time bonus cap, earned per year after the first five (10 section 10, TUNE). */
export const OPINION_PEACE_CAP = 20;

/**
 * Custom and strain of each dominion, for the custom opinion terms (culture/trait-rules.ts): the trait ids of its custom
 * and the majority strain of its folk. Built by the dominion adapter; optional, without it the custom terms are 0.
 */
export interface DominionLens {
  traitsOf(dominionId: number): readonly string[];
  strainOf(dominionId: number): number | undefined;
}

/** The state the opinion terms read. Plain data: no sim, no rng. */
export interface OpinionContext {
  dominions: readonly Dominion[];
  borders: readonly [number, number][];
  relations: RelationMatrix;
  truce: ReadonlyMap<string, Truce>;
  /** Pact member lists (pacts.ts Pact.memberIds); only membership is read. */
  pacts: readonly { memberIds: readonly number[] }[];
  tick: number;
  /** Ruler stats of a dominion, or undefined without a living ruler (rulers.ts). Optional: without it the stand-in holds. */
  rulerOf?: (dominionId: number) => RulerStats | undefined;
  /** Custom and strain lens (DominionLens). Optional. */
  lens?: DominionLens;
}

/** The supreme dominion id (most strength, ties to the lower id), or -1. */
export function supremeOf(dominions: readonly Dominion[]): number {
  let best: Dominion | undefined;
  for (const d of dominions) {
    if (!best || d.strength > best.strength || (d.strength === best.strength && d.id < best.id)) best = d;
  }
  return best?.id ?? -1;
}

/**
 * Opinion of dominion `a` toward dominion `b` (10 section 10): a sum of terms, no randomness, no cache.
 * Terms with no state behind them are cut (see DECISIONS.md): ruler traits, lineage, custom, creed,
 * dialect, strain, clans, child rulers, ages, and the same-side term.
 * Not symmetric: the parcel and power terms read a's view of b.
 */
export function opinion(ctx: OpinionContext, a: number, b: number): number {
  const da = ctx.dominions.find((d) => d.id === a);
  const db = ctx.dominions.find((d) => d.id === b);
  if (!da || !db || a === b) return 0;
  // Ruler terms (rulers.ts): b's ruler's rapport replaces the stand-in, and a's ruler's mood adds to a's opinion.
  const rulerB = ctx.rulerOf?.(b);
  let sum = rulerB ? rulerB.diplomacy * OPINION_PER_RAPPORT : OPINION_RULER_STAND_IN;
  const rulerA = ctx.rulerOf?.(a);
  if (rulerA) sum += Math.trunc(rulerA.mood / OPINION_MOOD_DIVISOR);
  if (ctx.dominions.length >= 3 && supremeOf(ctx.dominions) === b) sum += OPINION_SUPREME;
  const bordering = ctx.borders.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  sum += bordering ? OPINION_BORDER_CLOSE : OPINION_BORDER_FAR;
  const rel = ctx.relations.get(a, b);
  if (rel === 'war') sum += OPINION_WAR;
  // Parcel count: a is put off by a neighbour with more parcels, up to the cap.
  const parcelDiff = da.parcels.size - db.parcels.size;
  sum += Math.max(-OPINION_PARCEL_CAP, Math.min(0, Math.trunc(parcelDiff / 5)));
  // Power gap: a stronger b adds opinion (the spec's "+diff/10" when positive).
  const powerDiff = db.strength - da.strength;
  if (powerDiff > 0) sum += Math.trunc(powerDiff / 10);
  // Truce and peace time: the truce entry stamps the last declaration (until = declared tick + TRUCE_TICKS).
  const t = ctx.truce.get(pairKey(a, b));
  if (t && rel !== 'war') {
    if (t.until > ctx.tick) sum += OPINION_TRUCE;
    else {
      const years = (ctx.tick - (t.until - TRUCE_TICKS)) / YEAR_TICKS;
      if (years > 5) sum += Math.min(OPINION_PEACE_CAP, Math.trunc(years - 5));
    }
  }
  if (ctx.pacts.some((p) => p.memberIds.includes(a) && p.memberIds.includes(b))) sum += OPINION_SAME_PACT;
  // Custom terms (insular, welcoming, kinGuard): a's custom against the strains of a and b (culture/trait-rules.ts).
  const lens = ctx.lens;
  if (lens) {
    const traits = lens.traitsOf(a);
    if (traits.length > 0) sum += opinionTerm(traits, lens.strainOf(a), lens.strainOf(b));
  }
  return sum;
}

/** True when `a` holds a good opinion (>= 0) of every listed dominion. */
export function goodOpinionOfAll(ctx: OpinionContext, a: number, members: readonly number[]): boolean {
  return members.every((m) => opinion(ctx, a, m) >= 0);
}
