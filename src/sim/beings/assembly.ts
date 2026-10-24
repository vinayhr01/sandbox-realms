/**
 * Stat assembly (05 section 3): species base, then strain and being sources, then the Folk
 * aptitudes, then the multipliers (05 section 3.1, summed then applied once), then the clamps and the
 * baby halving. Pure: the caller stores the result. Only the stat keys the sim reads are assembled
 * here; the rest of the registry (05 section 1) is data until its mechanic exists.
 */
import type { Aptitudes, SpeciesDef } from '../../content/beasts.ts';
import { BEING_TRAIT_BY_ID, STRAIN_TRAIT_BY_ID, type TraitFx } from '../../content/traits.ts';
import { TUNING } from './tuning.ts';

/** Assembled values of one Being (or of a strain's members before babies are halved). */
export interface Assembled {
  vitality: number;
  might: number;
  pace: number;
  span: number;
  /** Living-children cap (06 section 6.1) and the extra-baby brood size (06 section 6.4). */
  litter: number;
  brood: number;
  metabolism: number;
  plating: number;
  /** Years to adulthood (06 section 3.1), after the strain's maturation meta. */
  adultYears: number;
  /** Pregnancy length in Months (06 section 6.3): the strain's gestation trait, else the species value. */
  gestationMonths: number;
  /** Strain mutation capacity (05 section 2 meta.mutation). */
  mutation: number;
  /** Clamped aptitudes as stored on the Being (0..999). */
  rapport: number;
  valor: number;
  husbandry: number;
  wit: number;
}

export interface AssemblyInput {
  species: SpeciesDef;
  /** Strain trait ids (empty for a strain with none). */
  strainTraits: readonly string[];
  /** Strain generation (fading_line shrinks litter per generation, 18b). */
  generation: number;
  /** Mark ids of the Being (18b being traits). */
  beingTraits: readonly string[];
  /** Stored aptitudes (05 section 4). */
  attrs: Aptitudes;
  /** True while the Being is a child (06 section 3.2): vitality and might are halved. */
  baby: boolean;
}

type FlatKey = 'wit' | 'rapport' | 'valor' | 'husbandry' | 'plating' | 'litter' | 'brood';
type MultKey = 'vitality' | 'might' | 'pace' | 'span' | 'metabolism' | 'litter';

const MULT_KEYS: readonly MultKey[] = ['vitality', 'might', 'pace', 'span', 'metabolism', 'litter'];

/** Adult age in Years from span (06 section 3.1 for non-sapient strains). Span 0 gives the floor of 1. */
export function adultYearsFor(span: number): number {
  return Math.max(1, Math.min(16, Math.pow(Math.max(0, span), 0.55) * 1.1));
}

function addFx(fx: TraitFx | undefined, flat: Record<FlatKey, number>, mult: Record<MultKey, number>): void {
  if (!fx) return;
  for (const [key, value] of Object.entries(fx.flat ?? {}) as [FlatKey, number][]) flat[key] += value;
  for (const [key, value] of Object.entries(fx.mult ?? {}) as [MultKey, number][]) mult[key] += value;
}

/** Assembles the stat block (05 section 3, steps 1 to 15 for the stats the sim reads). */
export function assemble(input: AssemblyInput): Assembled {
  const def = input.species;
  const flat: Record<FlatKey, number> = { wit: 0, rapport: 0, valor: 0, husbandry: 0, plating: 0, litter: 0, brood: 0 };
  const mult: Record<MultKey, number> = { vitality: 0, might: 0, pace: 0, span: 0, metabolism: 0, litter: 0 };

  // Step 1: the species base (no strain: the species fallback block, 05 section 3 step 1).
  const base = {
    vitality: def.vitality,
    might: def.might,
    pace: def.pace,
    span: def.span,
    litter: def.litter,
    brood: def.litter,
    metabolism: def.diet === 'flesh' ? TUNING.predatorMetabolism : 1,
    plating: def.plating,
  };

  // Step 2 and step 4 sources: strain traits, then being traits.
  let gestationMonths = def.gestationMonths;
  let mutation = 0;
  let maturation = 1;
  for (const id of input.strainTraits) {
    const trait = STRAIN_TRAIT_BY_ID.get(id);
    if (!trait) continue;
    addFx(trait.fx, flat, mult);
    if (trait.fx?.meta?.gestationMonths !== undefined) gestationMonths = trait.fx.meta.gestationMonths;
    mutation += trait.fx?.meta?.mutation ?? 0;
    maturation *= trait.fx?.meta?.maturation ?? 1;
  }
  if (input.strainTraits.includes('fading_line')) base.litter -= input.generation;
  for (const id of input.beingTraits) {
    const trait = BEING_TRAIT_BY_ID.get(id);
    if (trait) addFx(trait.fx, flat, mult);
  }

  // Step 3: Attributes (the four aptitudes are stored and added as sources).
  flat.rapport += input.attrs.rapport;
  flat.valor += input.attrs.valor;
  flat.husbandry += input.attrs.husbandry;
  flat.wit += input.attrs.wit;

  // Steps 12 and 13: flat sums, then each multiplier once (add, not compound; 05 section 3.1).
  const scale = (key: MultKey, value: number): number => {
    const m = mult[key];
    // A multiplier of -1 or less reduces the parent to its clamp minimum.
    return m <= -1 ? 0 : value + value * m;
  };
  let vitality = scale('vitality', base.vitality);
  // Step 14 (Folk): might += valor / 5.
  let might = scale('might', base.might + (def.folk ? flat.valor / 5 : 0));
  let pace = scale('pace', base.pace);
  let span = scale('span', base.span);
  let metabolism = scale('metabolism', base.metabolism);
  let litter = scale('litter', base.litter + flat.litter);
  const brood = Math.max(0, base.brood + flat.brood);

  // Clamps (05 section 1 table and 3 step 12). A mult that empties a stat leaves the clamp minimum.
  vitality = Math.max(1, Math.floor(vitality));
  might = Math.max(1, might);
  pace = Math.max(1, pace);
  span = Math.max(0, span);
  metabolism = Math.max(1, metabolism);
  litter = Math.max(0, Math.floor(litter));
  const plating = Math.min(99, Math.max(0, base.plating + flat.plating));

  // Step 14: babies halve vitality and might, floored at the clamp minimum (05 section 1.1).
  if (input.baby) {
    vitality = Math.max(1, Math.floor(vitality / 2));
    might = Math.max(1, Math.floor(might / 2));
  }

  return {
    vitality,
    might,
    pace,
    span,
    litter,
    brood: Math.floor(brood),
    metabolism,
    plating,
    adultYears: Math.max(1, adultYearsFor(span) * maturation),
    gestationMonths: Math.max(1, gestationMonths),
    mutation: Math.max(0, mutation),
    rapport: clampAttr(flat.rapport),
    valor: clampAttr(flat.valor),
    husbandry: clampAttr(flat.husbandry),
    wit: clampAttr(flat.wit),
  };
}

/** Aptitudes stay in 0..999 (18a section 0, 05 section 4). */
function clampAttr(v: number): number {
  return Math.min(999, Math.max(0, Math.floor(v)));
}
