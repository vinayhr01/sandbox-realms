/**
 * Decision catalogue of the beast layer (07 section 3.6, TUNE). Row order is the decision index: a Being's
 * cooldown table is keyed by it, so new rows go at the end. Weights are the spec's numbers; `cooldown` is in
 * ticks (06 uses ticks throughout; 07 section 3.6 states ticks in its format line). Tasks are in
 * src/sim/beings/system.ts (TASKS), keyed by `id`.
 *
 * Flags (07 section 3.3): `onlyHungry` needs food and fuel at or below 50 (06 section 2.1); `onlySafe` needs no
 * hunter within the flee radius; `onlyAdult` needs an adult. Preconditions live with the task code.
 */
export type DecisionFlag = 'onlyHungry' | 'onlySafe' | 'onlyAdult';

export interface DecisionRow {
  id: string;
  /** Urgency tier 0 (minimal) to 4 (critical), 07 section 3.5. */
  tier: 0 | 1 | 2 | 3 | 4;
  /** Utility weight (07 section 3.4). Mate uses 2, or 0.1 once the being has its living-children cap. */
  weight: number;
  /** Ticks the decision is ineligible after it is picked (07 section 3.4). */
  cooldown: number;
  flags: readonly DecisionFlag[];
}

export const DECISION_ROWS: readonly DecisionRow[] = [
  { id: 'wander', tier: 0, weight: 0.2, cooldown: 0, flags: [] },
  { id: 'pause5', tier: 0, weight: 0.1, cooldown: 0, flags: [] },
  { id: 'idle_nap', tier: 0, weight: 0.05, cooldown: 1800, flags: ['onlySafe'] },
  { id: 'polyphasic', tier: 1, weight: 0.8, cooldown: 1800, flags: ['onlySafe'] },
  { id: 'monophasic', tier: 1, weight: 0.75, cooldown: 4000, flags: ['onlySafe'] },
  { id: 'herd_follow', tier: 2, weight: 0.7, cooldown: 0, flags: [] },
  { id: 'chat', tier: 2, weight: 0.5, cooldown: 600, flags: [] },
  { id: 'flee', tier: 3, weight: 3.1, cooldown: 0, flags: [] },
  { id: 'eat_grass', tier: 3, weight: 1, cooldown: 400, flags: ['onlyHungry', 'onlySafe'] },
  { id: 'eat_nectar', tier: 3, weight: 1, cooldown: 200, flags: ['onlyHungry', 'onlySafe'] },
  { id: 'eat_hunt', tier: 3, weight: 0.96, cooldown: 1100, flags: ['onlyHungry', 'onlySafe'] },
  { id: 'mate', tier: 3, weight: 2, cooldown: 800, flags: ['onlyAdult'] },
  // Round 8 (07 section 8 to 10): a fight with a hostile in sight or an aggro target (07 section 9.2 relations).
  // Appended, so the earlier rows keep their indices in the cooldown table.
  { id: 'fight', tier: 3, weight: 1.5, cooldown: 0, flags: [] },
  // Folk brawl (08 section 2.5, 07 section 10.3): a Folk starts a fight with a Folk in sight when the fight row found no
  // hostile. Appended as row 13. Runs the fight task, with the brawl stop rule on Folk-on-Folk blows.
  { id: 'brawl', tier: 3, weight: 1, cooldown: 600, flags: [] },
  // Beings build 3 (07 section 3.6): a child follows its live parent (`follow_parent`, tier 2 weight 0.2) and a scorched
  // Being runs to the nearest shore to douse itself (`douse_self`, tier 4 weight 5). Appended as rows 14 and 15.
  { id: 'follow_parent', tier: 2, weight: 0.2, cooldown: 0, flags: [] },
  { id: 'douse_self', tier: 4, weight: 5, cooldown: 200, flags: [] },
];

/** Decision index by id. */
export const DECISION_INDEX = new Map(DECISION_ROWS.map((row, k) => [row.id, k]));

/** Ticks a fill-in pause lasts when no decision is eligible (07 section 15: `pause(20)`). */
export const EMPTY_PAUSE = 20;
