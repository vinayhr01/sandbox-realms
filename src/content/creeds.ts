/**
 * Creed tenets (11 section 9.4, with the spell table of 08 section 9.2 and the rite table of 11 section 3). A creed holds
 * tenet ids: a founding draws them from the random pool (culture.ts foundCreed), and a schism copies them (culture.ts
 * splitCreed). The harmony tenets act through culture.ts harmonyBonus; the spell tenets through creedSpellsOfSlot
 * (culture/effects.ts, read by the casting path in sim/spells.ts); the rite tenets through the rite intrigues
 * (dominions/intrigue.ts). bloodSecrecy limits creed spells to clan members (culture/effects.ts). fireWard, insight and
 * the transformation tenets have no effect (locked, never drawn; DECISIONS.md "Accord close 7"). Rarity weights are
 * customs.ts CUSTOM_RARITY_WEIGHT (TUNE, 11 section 9).
 *
 * Harmony tenet ids take the stat name of 9.4. Spell tenets are `spell_<spell id>` (11 section 4.2; the spell ids are
 * spells.ts SPELLS). Rite tenet ids are the rite ids of 11 section 3 (rites.ts RITE_KINDS).
 */
import type { CustomRarity } from './customs.ts';
import { SPELLS } from './spells.ts';
import { RITE_KINDS } from './rites.ts';

export type CreedTenetKind = 'harmony' | 'fireWard' | 'bloodSecrecy' | 'insight' | 'transform' | 'spell' | 'rite';

export interface CreedTenetDef {
  id: string;
  kind: CreedTenetKind;
  rarity: CustomRarity;
  /** True when a founding may draw it. False for the locked tenets (9.4: transformation, insight, fireWard). */
  randomSpawn: boolean;
  /** Stat a harmony tenet gives +10 to (9.4). */
  stat?: 'intelligence' | 'warfare' | 'diplomacy' | 'stewardship';
}

const HARMONY: readonly CreedTenetDef[] = (['intelligence', 'warfare', 'diplomacy', 'stewardship'] as const).map((stat) => ({
  id: `harmony_${stat}`,
  kind: 'harmony' as const,
  rarity: 'uncommon' as const,
  randomSpawn: true,
  stat,
}));

/** The five transformation tenets (9.4): locked, never random. */
const TRANSFORM_IDS: readonly string[] = ['desert', 'shadow', 'void', 'infernal', 'ash'];

/** Every creed tenet in the table (9.4: 4 harmony, bloodSecrecy, fireWard, insight, 5 transformation, 18 spell, 15 rite). */
export const CREED_TENETS: readonly CreedTenetDef[] = [
  ...HARMONY,
  { id: 'bloodSecrecy', kind: 'bloodSecrecy', rarity: 'uncommon', randomSpawn: true },
  // 9.4 writes "fireWard (rare, locked)": rarity rare, and locked, so a founding never draws it.
  { id: 'fireWard', kind: 'fireWard', rarity: 'rare', randomSpawn: false },
  { id: 'insight', kind: 'insight', rarity: 'locked', randomSpawn: false },
  ...TRANSFORM_IDS.map((id) => ({ id, kind: 'transform' as const, rarity: 'locked' as const, randomSpawn: false })),
  ...SPELLS.map((spell) => ({ id: `spell_${spell.id}`, kind: 'spell' as const, rarity: 'uncommon' as const, randomSpawn: true })),
  ...RITE_KINDS.map((id) => ({ id, kind: 'rite' as const, rarity: 'rare' as const, randomSpawn: true })),
];

export const CREED_TENET_BY_ID: ReadonlyMap<string, CreedTenetDef> = new Map(CREED_TENETS.map((t) => [t.id, t]));
