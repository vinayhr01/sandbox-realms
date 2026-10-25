/**
 * Decision layer (07 sections 3.3 to 3.5, round 8). The layers of a Being's behaviour, outermost first:
 *
 *   1. override  (system.ts decide): a flight from a hunter, or an engaged fight with an aggro target, takes over
 *      any running task except its own kind (07 section 4.2).
 *   2. task      (system.ts TASKS): the running decision's task runs one step per cadence until it returns false.
 *   3. decision  (this file): candidates are filtered (cooldown, flags, eligibility), the tier rule applies, and a
 *      softmax roulette picks one (07 sections 3.3 to 3.5).
 *
 * This module holds only the decision layer. It takes its inputs as data and callbacks, so it does not depend on the
 * life-cycle code and cannot form an import cycle with system.ts.
 */
import type { DecisionRow } from '../../content/decisions.ts';
import type { Rng } from '../../shared/rng.ts';

/** A decision that passed the filters: its row index, urgency tier and weight (07 section 3.4). */
export interface Candidate {
  k: number;
  tier: number;
  w: number;
}

/** Callbacks for the candidate filter (07 section 3.3). */
export interface CandidateContext {
  /** Tick now. */
  tick: number;
  /** Tick the decision is eligible again (cooldown table). */
  cooldownOf(k: number): number;
  /** Whether the row's flags allow it now (onlyHungry, onlySafe, onlyAdult). */
  flagsOk(row: DecisionRow): boolean;
  /** Whether the row's precondition holds. Called only when the flags pass, in row order. */
  eligible(row: DecisionRow): boolean;
  /** Weight of the row for this Being (07 section 3.4; a function of the Being, e.g. mate under its cap). */
  weight(row: DecisionRow): number;
}

/**
 * The candidate layer (07 section 3.3): every row whose cooldown has passed, whose flags allow it, and whose
 * precondition holds. Rows are visited in index order, so the callbacks draw random numbers in a fixed order.
 */
export function candidates(rows: readonly DecisionRow[], ctx: CandidateContext): Candidate[] {
  const pool: Candidate[] = [];
  for (let k = 0; k < rows.length; k++) {
    const row = rows[k];
    if (!row) continue;
    if (ctx.cooldownOf(k) > ctx.tick) continue;
    if (!ctx.flagsOk(row)) continue;
    if (!ctx.eligible(row)) continue;
    pool.push({ k, tier: row.tier, w: ctx.weight(row) });
  }
  return pool;
}

/**
 * The tier rule (07 section 3.5). A critical candidate forces the highest-tier rule. Otherwise the rule applies 80% of
 * the time, and 20% of the time every candidate competes by weight. Returns the set that competes.
 */
export function competing(pool: readonly Candidate[], rng: Rng): Candidate[] {
  if (pool.length === 0) return [];
  const critical = pool.some((p) => p.tier === 4);
  if (!critical && rng.next() >= 0.8) return [...pool];
  const top = Math.max(...pool.map((p) => p.tier));
  return pool.filter((p) => p.tier === top);
}

/**
 * Softmax roulette (07 section 3.4): P(i) = exp(w_i) / sum exp(w_j). Returns null for an empty set.
 * One uniform draw is taken from `rng` for a non-empty set.
 */
export function softmaxPick(set: readonly Candidate[], rng: Rng): Candidate | null {
  if (set.length === 0) return null;
  let sum = 0;
  for (const p of set) sum += Math.exp(p.w);
  let r = rng.next() * sum;
  let pick: Candidate | undefined = set[set.length - 1];
  for (const p of set) {
    r -= Math.exp(p.w);
    if (r <= 0) {
      pick = p;
      break;
    }
  }
  return pick ?? null;
}

/** The whole decision layer for one Being: candidates, tiers, then the pick. Null when nothing is eligible. */
export function chooseDecision(rows: readonly DecisionRow[], rng: Rng, ctx: CandidateContext): Candidate | null {
  const pool = candidates(rows, ctx);
  if (pool.length === 0) return null;
  return softmaxPick(competing(pool, rng), rng);
}
