/**
 * Strains (05 section 2 and 6): a sub-population of one species that shares a trait set and three
 * counters (born, newAdults, reproduced). Members keep the strain id in the store; the strain keeps
 * its traits and parent. Lineage codes (05 section 5) are not built.
 */
import { AWAKENING_TRAITS, STRAIN_TRAIT_BY_ID, STRAIN_TRAITS } from '../../content/traits.ts';

export interface StrainCounters {
  /** Newborn children (06 section 6.6). */
  born: number;
  /** Adults spawned into the strain (05 section 2). */
  newAdults: number;
  /** Births where a member was the bearer (06 section 6.6 `strain.counters.reproduced`). */
  reproduced: number;
}

export interface Strain {
  id: number;
  name: string;
  /** Species index into SPECIES. */
  species: number;
  generation: number;
  /** Parent strain id, or 0 for a founding strain. */
  parent: number;
  /** Strain trait ids (18b section 2). */
  traits: string[];
  counters: StrainCounters;
}

/** Strain trait ids that share an exclusion group with `id` (18b section 2, xg column). */
function exclusionMates(id: string): string[] {
  const xg = STRAIN_TRAIT_BY_ID.get(id)?.xg ?? '';
  if (xg === '') return [];
  return STRAIN_TRAITS.filter((t) => t.xg === xg && t.id !== id).map((t) => t.id);
}

/**
 * Adds a strain trait, removing any trait of the same exclusion group (18b section 0: "same-xg
 * members are opposites"). Returns false for an unknown id or when the trait is already held.
 */
export function addStrainTrait(traits: string[], id: string): boolean {
  if (!STRAIN_TRAIT_BY_ID.has(id) || traits.includes(id)) return false;
  const mates = new Set(exclusionMates(id));
  for (let k = traits.length - 1; k >= 0; k--) if (mates.has(traits[k] ?? '')) traits.splice(k, 1);
  traits.push(id);
  return true;
}

/** Mutation capacity of a trait set (05 section 2 meta.mutation, floored at 0). */
export function strainMutation(traits: readonly string[]): number {
  let m = 0;
  for (const id of traits) m += STRAIN_TRAIT_BY_ID.get(id)?.fx?.meta?.mutation ?? 0;
  return Math.max(0, m);
}

/** Awakened strains hold all four brain organs (18b section 0 sapience rule); they can found Hamlets. */
export function isAwakened(traits: readonly string[]): boolean {
  return AWAKENING_TRAITS.every((id) => traits.includes(id));
}

/** Strain registry for one Sim. Ids start at 1; 0 means no strain. */
export class Strains {
  private readonly byId = new Map<number, Strain>();
  private nextId = 1;

  get size(): number {
    return this.byId.size;
  }

  get(id: number): Strain | undefined {
    return this.byId.get(id);
  }

  /** Creates a strain; the name is the species name and the id (no lineage naming yet). */
  create(species: number, speciesName: string, generation: number, parent: number, traits: readonly string[]): Strain {
    const id = this.nextId++;
    const strain: Strain = {
      id,
      name: `${speciesName} ${id}`,
      species,
      generation,
      parent,
      traits: [...traits],
      counters: { born: 0, newAdults: 0, reproduced: 0 },
    };
    this.byId.set(id, strain);
    return strain;
  }

  /** Saved form (chronicle section 17). */
  snapshot(): { next: number; list: Strain[] } {
    return { next: this.nextId, list: [...this.byId.values()].sort((a, b) => a.id - b.id) };
  }

  /** Restores a snapshot; the caller has validated the records. */
  restore(data: { next: number; list: Strain[] }): void {
    this.byId.clear();
    for (const s of data.list) this.byId.set(s.id, s);
    this.nextId = data.next;
  }
}
