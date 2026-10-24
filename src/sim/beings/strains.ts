/**
 * Strains (05 section 2 and 6): a sub-population of one species that shares a trait set and three
 * counters (born, newAdults, reproduced). Members keep the strain id in the store; the strain keeps
 * its traits and parent. Lineage codes (05 section 5) are not built.
 */
import { AWAKENING_TRAITS, STRAIN_MUTATION_POT, STRAIN_TRAIT_BY_ID, STRAIN_TRAITS } from '../../content/traits.ts';
import type { Rng } from '../../shared/rng.ts';

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

/** Removes a strain trait if held. Returns true when one was removed. */
export function removeStrainTrait(traits: string[], id: string): boolean {
  const k = traits.indexOf(id);
  if (k < 0) return false;
  traits.splice(k, 1);
  return true;
}

/** Groups whose traits are add-only in mutation (05 section 6.3): diet (DIE), reproduction method (RMT), brain (COG), gestation (GST), egg (EGG). */
const ADD_ONLY_GROUPS = new Set(['DIE', 'RMT', 'COG', 'GST', 'EGG']);

/** Remove pot (05 section 6.3): `-` traits outside the add-only groups, copies by rarity as the add pot. */
const STRAIN_REMOVE_POT: readonly string[] = STRAIN_TRAITS.flatMap((t) => {
  if (!t.pot.includes('-') || ADD_ONLY_GROUPS.has(t.group)) return [];
  const copies = t.rarity === 'C' ? 10 : t.rarity === 'U' ? 6 : t.rarity === 'R' ? 3 : 1;
  return Array.from({ length: copies }, () => t.id);
});

/**
 * New strain by mutation (05 section 6.3, `mutateFrom(parent)`): k = randInt(0, mutation) inclusive; k add
 * draws from the add pot (opposites swap out), then as many remove draws as adds that landed. The new
 * strain has generation parent + 1 and the parent as its parent. Returns null when the trait set comes out
 * unchanged: the spec would still found a copy, but a copy per birth would flood the registry, so the
 * newborn then joins the parent's strain (06 section 6.1). `rng` is the named stream `lineage`.
 */
export function mutateFrom(strains: Strains, parent: Strain, speciesName: string, rng: Rng): Strain | null {
  const k = rng.int(strainMutation(parent.traits) + 1);
  const traits = [...parent.traits];
  let ok = 0;
  for (let i = 0; i < k && STRAIN_MUTATION_POT.length > 0; i++) {
    const id = STRAIN_MUTATION_POT[rng.int(STRAIN_MUTATION_POT.length)] ?? '';
    if (addStrainTrait(traits, id)) ok++;
  }
  for (let i = 0; i < ok && STRAIN_REMOVE_POT.length > 0; i++) {
    removeStrainTrait(traits, STRAIN_REMOVE_POT[rng.int(STRAIN_REMOVE_POT.length)] ?? '');
  }
  const same = traits.length === parent.traits.length && traits.every((id) => parent.traits.includes(id));
  if (same) return null;
  return strains.create(parent.species, speciesName, parent.generation + 1, parent.id, traits);
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
