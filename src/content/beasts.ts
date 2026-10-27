/**
 * Species roster of the beings sim: the 84 beasts of 18a section 2 and the six Folk lineages of 18a
 * section 1 (90 entries). The first eight are hand-authored and keep their indices; the rest come from
 * species-roster.ts and species-folk.ts. Stats are the 18a roster values (vitality, might, pace,
 * plating, span); hunters, prey, litter and gestation are the sim's food-web simplification.
 *
 * Diets: 18a tags map to the sim's four feeding classes (`grass`, `nectar`, `flesh`, `omni`) plus
 * `none` for beings that need no food (18a `none`, `mana`). Insect eaters count as `omni` (no insect
 * food web yet); detritus, photo, browse, frugivore, granivore, plankton and filter feed as `grass`.
 *
 * `pace` is the roster pace stat: movement is pace * 0.2 / 20 tiles per tick (07 section 7.1).
 * `span` is lifespan in Years (06 section 3.1); 0 never dies of age.
 */
import { BIOMES } from './biomes.ts';
import { FOLK_ROWS } from './species-folk.ts';
import { ROSTER_ROWS } from './species-roster.ts';
import { plainName } from './plain-names.ts';

export type SizeClass = 'T' | 'S' | 'M' | 'L' | 'H' | 'C';
/** Order of size classes from smallest to largest. */
export const SIZE_RANK: Record<SizeClass, number> = { T: 0, S: 1, M: 2, L: 3, H: 4, C: 5 };

/** Feeding classes of the sim. `none` never gets hungry (06 section 2.1). */
export type Diet = 'grass' | 'flesh' | 'nectar' | 'omni' | 'none';

/** The four Folk aptitudes (05 section 1, canonical keys). */
export interface Aptitudes {
  rapport: number;
  valor: number;
  husbandry: number;
  wit: number;
}

export interface SpeciesDef {
  id: string;
  /** Roster size class (18a): a flesh eater only hunts prey of its own size class or smaller (07 section 2.2). */
  size: SizeClass;
  name: string;
  diet: Diet;
  vitality: number;
  might: number;
  pace: number;
  /** Natural armour (18a `plating`, 05 `plating`). */
  plating: number;
  /** Natural lifespan in Years; 0 never dies of age (05 `span`). */
  span: number;
  /** Maximum stamina (05 `endurance`). */
  endurance: number;
  /** Maximum brood size (06 section 6.4) and the living-children cap (06 section 6.1). */
  litter: number;
  /** Months from mating to birth when the strain has no gestation trait (06 section 6.3). */
  gestationMonths: number;
  /** Species that flee this one (07 section 9). */
  hunters: readonly string[];
  /** Prey for flesh eaters. */
  prey: readonly string[];
  /** Herd animals gather in groups. */
  herding: boolean;
  /** Biome ids where wild spawns appear (18c biome ids; `any` expanded to every biome). */
  biomes: readonly string[];
  /** Ground ids the 18a row names that are not biomes (sea and coast rows: shoal, midmere, ...). Not seeded on land. */
  grounds: readonly string[];
  /** 18a group letter (A to H); the 8 hand-authored species carry theirs too. */
  group: string;
  /** Spawned by wild seeding and the spawn powers (false for Folk, aquatic and Architect-bound rows). */
  wild: boolean;
  /** Folk lineage: aptitudes and starting traits from 18a section 1 (null for beasts). */
  folk: boolean;
  aptitudes: Aptitudes | null;
  startTraits: { being: readonly string[]; strain: readonly string[] } | null;
}

const ALL_BIOMES: readonly string[] = BIOMES.map((b) => b.id);

/** 18a diet tag to the sim's feeding class (see the header). */
const DIET_TAG: Record<string, Diet> = {
  graze: 'grass',
  browse: 'grass',
  frugivore: 'grass',
  granivore: 'grass',
  photo: 'grass',
  detritus: 'grass',
  plankton: 'grass',
  filter: 'grass',
  insect: 'omni',
  nectar: 'nectar',
  carn: 'flesh',
  scav: 'flesh',
  pisc: 'flesh',
  blood: 'flesh',
  omni: 'omni',
  none: 'none',
  mana: 'none',
};

/** Litter and gestation defaults by size for roster rows that give none (OPEN: 18a has no column). */
const LITTER_BY_SIZE: Record<SizeClass, number> = { T: 4, S: 3, M: 2, L: 1, H: 1, C: 1 };
const GESTATION_BY_SIZE: Record<SizeClass, number> = { T: 2, S: 3, M: 4, L: 6, H: 8, C: 10 };

/** The eight hand-authored species (the sim's first roster, indices 0 to 7). */
const HAND: readonly SpeciesDef[] = [
  hand('thistlehart', 'M', 'grass', 85, 8, 17, 1, 28, 3, 4, ['gloamfang', 'mudsnuffler'], [], true, ['verdant_reach', 'russetwood', 'heathermoor'], 'A'),
  hand('burrfleece', 'S', 'grass', 60, 5, 6, 0, 35, 2, 3, ['gloamfang'], [], true, ['verdant_reach', 'trefoil_lea'], 'A'),
  hand('plowhorn', 'L', 'grass', 140, 11, 7, 2, 45, 1, 6, ['gloamfang'], [], false, ['amberveldt', 'verdant_reach'], 'A'),
  hand('mossback', 'L', 'grass', 165, 9, 5, 7, 110, 2, 5, ['gloamfang'], [], false, ['verdant_reach', 'paleglen'], 'A'),
  hand('cluckling', 'T', 'omni', 16, 1, 8, 0, 10, 4, 2, ['gloamfang', 'mudsnuffler'], [], true, ['verdant_reach', 'trefoil_lea'], 'C'),
  hand('nectarbuzz', 'T', 'nectar', 9, 3, 20, 0, 5, 4, 1, ['cluckling'], [], true, ['bloomfield', 'trefoil_lea', 'verdant_reach'], 'E'),
  hand('mudsnuffler', 'M', 'omni', 95, 10, 9, 1, 30, 2, 3, [], ['cluckling', 'thistlehart'], false, ['sodden_hollow', 'bambooveil', 'verdant_reach'], 'A'),
  hand('gloamfang', 'M', 'flesh', 110, 19, 15, 2, 18, 2, 4, [], ['burrfleece', 'thistlehart', 'plowhorn', 'mossback', 'cluckling'], false, ['paleglen', 'verdant_reach', 'rimewaste'], 'B'),
];

function hand(
  id: string,
  size: SizeClass,
  diet: Diet,
  vitality: number,
  might: number,
  pace: number,
  plating: number,
  span: number,
  litter: number,
  gestationMonths: number,
  hunters: string[],
  prey: string[],
  herding: boolean,
  biomes: string[],
  group: string,
): SpeciesDef {
  return {
    id,
    size,
    name: plainName('species', id, titleCase(id)),
    diet,
    vitality,
    might,
    pace,
    plating,
    span,
    endurance: 50,
    litter,
    gestationMonths,
    hunters,
    prey,
    herding,
    biomes,
    grounds: [],
    group,
    wild: true,
    folk: false,
    aptitudes: null,
    startTraits: null,
  };
}

function titleCase(id: string): string {
  return id
    .split('_')
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Roster rows beyond the hand-authored eight: id|size|vit|might|pace|plating|span|diet|group|biomes. */
function fromRoster(line: string): SpeciesDef {
  const [id = '', size = 'T', vit = '0', might = '0', pace = '0', plating = '0', span = '0', tag = 'none', group = 'A', biomes = ''] = line.split('|');
  const sz = size as SizeClass;
  const diet = DIET_TAG[tag] ?? 'none';
  const tokens = biomes.split(',');
  const list = tokens.flatMap((b) => (b === 'any' ? ALL_BIOMES : ALL_BIOMES.includes(b) ? [b] : []));
  const grounds = tokens.filter((b) => b !== 'any' && !ALL_BIOMES.includes(b));
  // Aquatic and Architect-bound rows (groups D and H) are not wild on land; clawscuttler walks the strand.
  const wild = (group !== 'D' && group !== 'H') || id === 'clawscuttler';
  return {
    id,
    size: sz,
    name: plainName('species', id, titleCase(id)),
    diet,
    vitality: Number(vit),
    might: Number(might),
    pace: Number(pace),
    plating: Number(plating),
    span: Number(span),
    endurance: 50,
    litter: LITTER_BY_SIZE[sz],
    gestationMonths: GESTATION_BY_SIZE[sz],
    hunters: [],
    prey: [],
    herding: false,
    biomes: [...new Set(list)],
    grounds,
    group,
    wild,
    folk: false,
    aptitudes: null,
    startTraits: null,
  };
}

/** Folk row: id|size|vit|might|pace|plating|span|endurance|litter|diet|rapport|valor|husbandry|wit|biomes|being|strain. */
function fromFolk(line: string): SpeciesDef {
  const c = line.split('|');
  const sz = (c[1] ?? 'M') as SizeClass;
  const list = (c[15] ?? '').split(',').filter((t) => t.length > 0);
  const strain = (c[16] ?? '').split(',').filter((t) => t.length > 0);
  const id = c[0] ?? '';
  return {
    id,
    size: sz,
    name: plainName('species', id, titleCase(id)),
    diet: DIET_TAG[(c[9] ?? 'omni').split(',')[0] ?? 'omni'] ?? 'omni',
    vitality: Number(c[2]),
    might: Number(c[3]),
    pace: Number(c[4]),
    plating: Number(c[5]),
    span: Number(c[6]),
    endurance: Number(c[7]),
    litter: Number(c[8]),
    gestationMonths: strain.includes('gestation_brief') ? 2 : strain.includes('gestation_extended') ? 7 : 4,
    hunters: [],
    prey: [],
    herding: false,
    biomes: (c[14] ?? '').split(','),
    grounds: [],
    group: 'folk',
    wild: false,
    folk: true,
    aptitudes: { rapport: Number(c[10]), valor: Number(c[11]), husbandry: Number(c[12]), wit: Number(c[13]) },
    startTraits: { being: list, strain },
  };
}

const ROSTER: readonly SpeciesDef[] = ROSTER_ROWS.split('\n').map(fromRoster);
const FOLK: readonly SpeciesDef[] = FOLK_ROWS.split('\n').map(fromFolk);

/** Diet-class groups used to derive food webs for the rows without hand-authored lists. */
const PLANT_EATERS: ReadonlySet<Diet> = new Set<Diet>(['grass', 'nectar', 'omni']);

/**
 * Prey and hunters for the derived rows (07 section 2.2): a flesh eater hunts every wild plant or
 * omnivore-class species of its own size class or smaller. Hunters are the flesh eaters that list a
 * species as prey, so the two lists agree. Hand-authored lists are kept as written.
 */
function deriveWebs(all: SpeciesDef[], handCount: number): SpeciesDef[] {
  const hunted = (p: SpeciesDef): string[] =>
    p.diet === 'flesh' && p.wild
      ? all
          .filter((t) => t.id !== p.id && t.wild && !t.folk && PLANT_EATERS.has(t.diet) && SIZE_RANK[t.size] <= SIZE_RANK[p.size])
          .map((t) => t.id)
      : [];
  return all.map((def, k) => {
    if (k < handCount) return def;
    const prey = hunted(def);
    const hunters = all.filter((p, j) => j !== k && j >= handCount && hunted(p).includes(def.id)).map((p) => p.id);
    const handHunters = all.filter((p, j) => j < handCount && p.prey.includes(def.id)).map((p) => p.id);
    return { ...def, prey, hunters: [...new Set([...hunters, ...handHunters])] };
  });
}

export const SPECIES: readonly SpeciesDef[] = deriveWebs([...HAND, ...ROSTER, ...FOLK], HAND.length);

export const SPECIES_BY_ID = new Map(SPECIES.map((s, k) => [s.id, k]));

export function speciesIndex(id: string): number {
  const k = SPECIES_BY_ID.get(id);
  if (k === undefined) throw new RangeError(`unknown species ${id}`);
  return k;
}
