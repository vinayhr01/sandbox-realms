/**
 * Item registry (08 section 6): equipment kinds and modifiers as data. The ten unique weapons and
 * caster staffs use the ids and numbers of 08 section 6.2. The tier kinds are generated from the
 * material table of 08 section 6.2 (ids `<material>_<group>` for weapons, `<material>_<slot>` for
 * armour and jewelry). Stats the sim reads are typed (`ItemStats`); the rest of a spec row (aether,
 * endurance, tempo, crit multipliers, spells, projectiles) is kept as data in `extra` until its
 * mechanic exists.
 */

export const ITEM_SLOTS = ['weapon', 'helm', 'body', 'boots', 'ring', 'amulet'] as const;
export type ItemSlot = (typeof ITEM_SLOTS)[number];

export const ITEM_GROUPS = ['blade', 'cleaver', 'maul', 'pike', 'bow', 'staff', 'worn'] as const;
export type ItemGroup = (typeof ITEM_GROUPS)[number];

/** Stat keys an item can add. The flat keys are read by assembly.ts; `crit` is stored for combat. */
export interface ItemStats {
  might?: number;
  pace?: number;
  plating?: number;
  vitality?: number;
  wit?: number;
  rapport?: number;
  valor?: number;
  husbandry?: number;
  /** Crit chance bonus (08 section 6.2). Stored; combat does not read it yet. */
  crit?: number;
}

export interface ItemKindDef {
  id: string;
  name: string;
  slot: ItemSlot;
  group: ItemGroup;
  /** Material id from the table, or 'unique' for the named weapons. */
  material: string;
  tier: number;
  equipmentValue: number;
  rigidity: number;
  /** Maximum durability (08 section 7.4). */
  durability: number;
  /** 0..3 rarity (08 section 6.1). */
  quality: 0 | 1 | 2 | 3;
  stats: ItemStats;
  /** Built-in modifier ids (08 section 6.2 groups and unique weapons). */
  modifiers: string[];
  attack: 'melee' | 'ranged';
  /** Reach in tiles (basic melee reach is 1). */
  reach: number;
  targets: number;
  /** Spread multiplier of the attack (08 section 6.2 group table). */
  spread: number;
  unique: boolean;
  /** Spec values the sim does not read yet (aether, endurance, tempo, crit multiplier, spells, projectiles). */
  extra: Record<string, number | string | string[]>;
  /** Crafting cost (08 section 7.2). Data only until crafting exists. */
  cost: { coins: number; resources: { id: string; n: number }[] };
}

export type ModFamily = 'might' | 'eloquence' | 'swiftness' | 'poise' | 'vigor' | 'nimbleness' | 'command' | 'insight' | 'keenness' | 'guarding';

export interface ModDef {
  id: string;
  name: string;
  family: ModFamily | null;
  /** Rank 1..5 for family modifiers; 0 for explicit-only ones. */
  rank: number;
  stats: ItemStats;
  /** Effect text of explicit-only modifiers (08 section 6.3). Family ranks have none. */
  flags: string[];
  explicitOnly: boolean;
  /** Mod quality 0..3 (TUNE: rank based). */
  quality: 0 | 1 | 2 | 3;
}

export type ModPool = 'weapon' | 'armor' | 'accessory';

/** Pool weights of 08 section 6.3. `normal` is the wasted draw. */
export const MOD_POOLS: Readonly<Record<ModPool, Readonly<Partial<Record<ModFamily | 'normal', number>>>>> = {
  weapon: { normal: 5, might: 5, eloquence: 5, swiftness: 15, poise: 15, nimbleness: 5 },
  armor: { normal: 5, guarding: 5, swiftness: 15, poise: 15, vigor: 5 },
  accessory: { normal: 5, swiftness: 15, poise: 15, vigor: 5, nimbleness: 5, command: 5, insight: 5, keenness: 5 },
};

const FAMILY_NAMES: Readonly<Record<ModFamily, string>> = {
  might: 'Might',
  eloquence: 'Eloquence',
  swiftness: 'Swiftness',
  poise: 'Poise',
  vigor: 'Vigor',
  nimbleness: 'Nimbleness',
  command: 'Command',
  insight: 'Insight',
  keenness: 'Keenness',
  guarding: 'Guarding',
};

/** Family rank values (08 section 6.3), index 0 = rank 1. `stat` is the key each family writes. */
const FAMILY_RANKS: Readonly<Record<ModFamily, { stat: keyof ItemStats; values: readonly number[] }>> = {
  might: { stat: 'might', values: [1, 2, 3, 4, 5] },
  eloquence: { stat: 'rapport', values: [1, 2, 3, 4, 5] },
  swiftness: { stat: 'pace', values: [2, 3, 4, 5, 6] },
  poise: { stat: 'crit', values: [0.05, 0.15, 0.2, 0.25, 0.3] },
  vigor: { stat: 'vitality', values: [50, 100, 150, 200, 250] },
  nimbleness: { stat: 'pace', values: [0, 1, 1, 2, 3] },
  command: { stat: 'valor', values: [1, 2, 3, 4, 5] },
  insight: { stat: 'wit', values: [1, 2, 3, 4, 7] },
  keenness: { stat: 'might', values: [1, 2, 3, 5, 10] },
  guarding: { stat: 'plating', values: [3, 4, 5, 6, 7] },
};

/** Which pools a family draws from (08 section 6.3 table). */
const FAMILY_POOLS: Readonly<Record<ModFamily, readonly ModPool[]>> = {
  might: ['weapon'],
  eloquence: ['weapon'],
  swiftness: ['weapon', 'armor', 'accessory'],
  poise: ['weapon', 'armor', 'accessory'],
  vigor: ['armor', 'accessory'],
  nimbleness: ['weapon', 'accessory'],
  command: ['accessory'],
  insight: ['accessory'],
  keenness: ['accessory'],
  guarding: ['armor'],
};

const modQuality = (rank: number): 0 | 1 | 2 | 3 => (rank >= 5 ? 3 : rank >= 3 ? 2 : 1);

function buildMods(): ModDef[] {
  const out: ModDef[] = [];
  for (const family of Object.keys(FAMILY_RANKS) as ModFamily[]) {
    const spec = FAMILY_RANKS[family];
    spec.values.forEach((value, k) => {
      const rank = k + 1;
      const stats: ItemStats = {};
      stats[spec.stat] = value;
      out.push({ id: `${family}_${rank}`, name: `${FAMILY_NAMES[family]} ${rank}`, family, rank, stats, flags: [], explicitOnly: false, quality: modQuality(rank) });
    });
  }
  const explicit: [string, string, string[]][] = [
    ['blaze', 'Blaze', ['always burns on hit', 'immune to the fire tag']],
    ['rime_touch', 'Rime touch', ['20% chance of rimebound 300 on hit']],
    ['concussive', 'Concussive', ['20% chance of dazed 80 on hit']],
    ['sluggish', 'Sluggish', ['20% chance of sluggish 600 on hit']],
    ['venomous', 'Venomous', ['30% chance of venomed 1800 on skinned, non-immune victims']],
    ['everlasting', 'Everlasting', ['no wear', 'cannot be destroyed']],
    ['accursed', 'Accursed', ['cannot be removed or swapped', 'never crafted']],
    ['hallowed', 'Hallowed', ['cosmetic flag for Architect-gifted gear']],
  ];
  for (const [id, name, flags] of explicit) out.push({ id, name, family: null, rank: 0, stats: {}, flags, explicitOnly: true, quality: 2 });
  return out;
}

export const ITEM_MODS: readonly ModDef[] = buildMods();
export const ITEM_MOD_BY_ID: ReadonlyMap<string, ModDef> = new Map(ITEM_MODS.map((m) => [m.id, m]));

/** Families that can roll on a pool (08 section 6.3). */
export function familiesOfPool(pool: ModPool): readonly ModFamily[] {
  return (Object.keys(FAMILY_POOLS) as ModFamily[]).filter((f) => FAMILY_POOLS[f].includes(pool));
}

/** Material table (08 section 6.2). Plating and crit are absent where the spec row has none. */
interface Material {
  id: string;
  name: string;
  tier: number;
  equipmentValue: number;
  rigidity: number;
  /** Weapon damage of the blade, cleaver, maul and pike groups (0: no melee kinds). */
  weaponDamage: number;
  /** Bow damage and reach. */
  bow?: { damage: number; reach: number };
  /** Armour plating for each of helm, body and boots. */
  plating?: number;
  /** Ring and amulet crit chance. */
  crit?: number;
  /** Extra crit chance on weapons (08 table: iron, steel, starsteel +0.05; abyssal +0.15). */
  weaponCrit?: number;
  /** Pace bonus of the material (flint -2, steel +1, abyssal +1). */
  pace?: number;
  /** Resource id a craft spends (09 resources; 18d section 6.4 metals). */
  resource: string;
  /** Spec values the sim does not read yet. */
  extra?: Record<string, number>;
}

const MATERIALS: readonly Material[] = [
  { id: 'timber', name: 'Timber', tier: 1, equipmentValue: 1, rigidity: 1, weaponDamage: 1, bow: { damage: 1, reach: 6 }, resource: 'wood', extra: { aether: 5 } },
  { id: 'flint', name: 'Flint', tier: 2, equipmentValue: 10, rigidity: 2, weaponDamage: 3, pace: -2, resource: 'stone' },
  { id: 'hide', name: 'Hide', tier: 3, equipmentValue: 5, rigidity: 1, weaponDamage: 0, plating: 2, resource: 'hide' },
  { id: 'bone', name: 'Bone', tier: 3, equipmentValue: 5, rigidity: 1, weaponDamage: 0, crit: 0.02, resource: 'bones' },
  { id: 'copper', name: 'Copper', tier: 4, equipmentValue: 10, rigidity: 2, weaponDamage: 3, bow: { damage: 3, reach: 6 }, plating: 3, crit: 0.03, resource: 'copper', extra: { endurance: 10 } },
  { id: 'bronze', name: 'Bronze', tier: 5, equipmentValue: 15, rigidity: 3, weaponDamage: 4, bow: { damage: 4, reach: 7 }, plating: 4, crit: 0.04, resource: 'bronze' },
  { id: 'silver', name: 'Silver', tier: 6, equipmentValue: 20, rigidity: 2, weaponDamage: 5, bow: { damage: 5, reach: 8 }, plating: 5, crit: 0.05, resource: 'silver', extra: { aether: 12 } },
  { id: 'iron', name: 'Iron', tier: 7, equipmentValue: 30, rigidity: 4, weaponDamage: 7, bow: { damage: 7, reach: 9 }, plating: 7, crit: 0.07, weaponCrit: 0.05, resource: 'iron' },
  { id: 'steel', name: 'Steel', tier: 8, equipmentValue: 40, rigidity: 5, weaponDamage: 8, bow: { damage: 8, reach: 10 }, plating: 8, crit: 0.08, weaponCrit: 0.05, pace: 1, resource: 'iron' },
  { id: 'starsteel', name: 'Starsteel', tier: 9, equipmentValue: 50, rigidity: 6, weaponDamage: 9, bow: { damage: 9, reach: 11 }, plating: 9, crit: 0.09, weaponCrit: 0.05, resource: 'starmetal', extra: { aether: 25, endurance: 10 } },
  { id: 'abyssal', name: 'Abyssal', tier: 10, equipmentValue: 70, rigidity: 7, weaponDamage: 11, bow: { damage: 11, reach: 12 }, plating: 11, crit: 0.12, weaponCrit: 0.15, pace: 1, resource: 'adamant', extra: { aether: 35, endurance: 10 } },
];

/** Spread per group (08 section 6.2). Bare attacks use 0.5. */
const GROUP_SPREAD: Readonly<Record<ItemGroup, number>> = { blade: 0.8, cleaver: 0.6, maul: 0.1, pike: 0.7, bow: 0.6, staff: 0.5, worn: 0.5 };
const GROUP_LABEL: Readonly<Record<ItemGroup, string>> = { blade: 'blade', cleaver: 'cleaver', maul: 'maul', pike: 'pike', bow: 'bow', staff: 'staff', worn: 'worn' };
const SLOT_LABEL: Readonly<Record<ItemSlot, string>> = { weapon: 'weapon', helm: 'helm', body: 'body armour', boots: 'boots', ring: 'ring', amulet: 'amulet' };

/** Rarity by tier (TUNE): 0 common, 1 uncommon, 2 rare, 3 legendary. */
function tierQuality(tier: number): 0 | 1 | 2 | 3 {
  return tier <= 3 ? 0 : tier <= 6 ? 1 : tier <= 8 ? 2 : 3;
}

type KindInput = Pick<ItemKindDef, 'id' | 'name' | 'slot' | 'group' | 'material' | 'tier' | 'equipmentValue' | 'rigidity' | 'stats'> &
  Partial<Omit<ItemKindDef, 'id' | 'name' | 'slot' | 'group' | 'material' | 'tier' | 'equipmentValue' | 'rigidity' | 'stats'>>;

function kind(input: KindInput): ItemKindDef {
  return {
    durability: 100,
    quality: tierQuality(input.tier),
    modifiers: [],
    attack: 'melee',
    reach: 1,
    targets: 1,
    spread: 0.5,
    unique: false,
    extra: {},
    cost: { coins: 2, resources: [] },
    ...input,
  };
}

function generatedKinds(): ItemKindDef[] {
  const out: ItemKindDef[] = [];
  for (const m of MATERIALS) {
    const common = { material: m.id, tier: m.tier, equipmentValue: m.equipmentValue, rigidity: m.rigidity };
    const pace = m.pace ?? 0;
    const extra = { ...(m.extra ?? {}) };
    if (m.weaponDamage > 0) {
      const melee: ItemGroup[] = ['blade', 'cleaver', 'maul', 'pike'];
      if (m.id === 'timber') melee.push('staff');
      for (const group of melee) {
        out.push(
          kind({
            ...common,
            id: `${m.id}_${group}`,
            name: `${m.name} ${GROUP_LABEL[group]}`,
            slot: 'weapon',
            group,
            stats: { might: m.weaponDamage, crit: m.weaponCrit ?? 0, pace },
            spread: GROUP_SPREAD[group],
            targets: group === 'maul' ? 3 : 1,
            reach: group === 'pike' ? 2 : 1,
            modifiers: group === 'maul' ? ['concussive'] : [],
            extra,
            cost: { coins: 2, resources: [{ id: m.resource, n: 3 }] },
          }),
        );
      }
    }
    if (m.bow) {
      out.push(
        kind({
          ...common,
          id: `${m.id}_bow`,
          name: `${m.name} bow`,
          slot: 'weapon',
          group: 'bow',
          stats: { might: m.bow.damage, crit: 0.1, pace },
          attack: 'ranged',
          reach: m.bow.reach,
          spread: GROUP_SPREAD.bow,
          modifiers: [],
          extra: { ...extra, projectile: 'flint_dart', volley: 1, recoil: 1, critMult: 0.5 },
          cost: { coins: 2, resources: [{ id: m.resource, n: 3 }] },
        }),
      );
    }
    if (m.plating !== undefined) {
      for (const slot of ['helm', 'body', 'boots'] as const) {
        out.push(
          kind({
            ...common,
            id: `${m.id}_${slot}`,
            name: `${m.name} ${SLOT_LABEL[slot]}`,
            slot,
            group: 'worn',
            stats: { plating: m.plating, pace: slot === 'boots' && m.id === 'hide' ? 1 : pace },
            extra,
            cost: { coins: 2, resources: [{ id: m.resource, n: 4 }] },
          }),
        );
      }
    }
    if (m.crit !== undefined) {
      for (const slot of ['ring', 'amulet'] as const) {
        out.push(
          kind({
            ...common,
            id: `${m.id}_${slot}`,
            name: `${m.name} ${SLOT_LABEL[slot]}`,
            slot,
            group: 'worn',
            stats: { crit: m.crit, pace },
            extra,
            cost: { coins: 2, resources: [{ id: m.resource, n: 1 }] },
          }),
        );
      }
    }
  }
  return out;
}

/** The ten unique weapons and caster staffs of 08 section 6.2, ids exact. Tier 10, quality 3. */
function uniqueKinds(): ItemKindDef[] {
  const base = { material: 'unique', tier: 10, equipmentValue: 70, rigidity: 7, slot: 'weapon' as const, unique: true, quality: 3 as const };
  const staff = { aether: 40, critMult: 0.5 };
  return [
    kind({ ...base, id: 'energy_blaster', name: 'Energy blaster', group: 'bow', stats: { might: 30 }, attack: 'ranged', reach: 20, spread: GROUP_SPREAD.bow, extra: { projectile: 'arc_sphere' } }),
    kind({ ...base, id: 'scatter_gun', name: 'Scatter gun', group: 'bow', stats: { might: 10 }, attack: 'ranged', reach: 8, spread: GROUP_SPREAD.bow, extra: { volley: 12, projectile: 'flint_dart' } }),
    kind({ ...base, id: 'flame_maul', name: 'Flame maul', group: 'maul', stats: { might: 11 }, targets: 3, spread: GROUP_SPREAD.maul, modifiers: ['blaze'], extra: { damageSpec: 'not stated; TUNE' }, cost: { coins: 10, resources: [{ id: 'wyrm_scale', n: 3 }] } }),
    kind({ ...base, id: 'frost_maul', name: 'Frost maul', group: 'maul', stats: { might: 11 }, targets: 3, spread: GROUP_SPREAD.maul, modifiers: ['concussive', 'rime_touch'], extra: { damageSpec: 'not stated; TUNE' } }),
    kind({ ...base, id: 'flame_blade', name: 'Flame blade', group: 'blade', stats: { might: 33 }, targets: 2, spread: GROUP_SPREAD.blade }),
    kind({ ...base, id: 'bone_caller_staff', name: 'Bone-caller staff', group: 'staff', stats: { might: 30 }, attack: 'ranged', reach: 13, spread: GROUP_SPREAD.staff, extra: { ...staff, projectile: 'wail_skull', spells: ['raise_boneshambler', 'hex_cast'] } }),
    kind({ ...base, id: 'ember_staff', name: 'Ember staff', group: 'staff', stats: { might: 10 }, attack: 'ranged', spread: GROUP_SPREAD.staff, modifiers: ['blaze'], extra: { ...staff, projectile: 'ember_orb', volley: 20, spells: ['kindle'] } }),
    kind({ ...base, id: 'frost_staff', name: 'Frost staff', group: 'staff', stats: { might: 35 }, attack: 'ranged', reach: 18, spread: GROUP_SPREAD.staff, modifiers: ['rime_touch'], durability: 300, extra: { ...staff, projectile: 'rime_orb', spells: ['mending_rain', 'bolt_call'] } }),
    kind({ ...base, id: 'thicket_staff', name: 'Thicket staff', group: 'staff', stats: { might: 12 }, attack: 'ranged', reach: 20, spread: GROUP_SPREAD.staff, modifiers: ['sluggish'], extra: { aether: 40, critMult: 0.3, projectile: 'sap_orb', volley: 2, spells: ['mending_rain', 'overgrow'] } }),
    kind({ ...base, id: 'plague_healer_staff', name: "Plague healer's staff", group: 'staff', stats: { might: 35 }, targets: 3, spread: GROUP_SPREAD.staff, extra: { ...staff, spells: ['kindle', 'purify'] } }),
  ];
}

/** Every item kind: generated tiers first, then the uniques. Ids are stable: saves store them. */
export const ITEM_KINDS: readonly ItemKindDef[] = [...generatedKinds(), ...uniqueKinds()];
export const ITEM_KIND_BY_ID: ReadonlyMap<string, ItemKindDef> = new Map(ITEM_KINDS.map((k) => [k.id, k]));
