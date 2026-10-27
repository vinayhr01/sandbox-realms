/**
 * Gait families and the species gait table for the creature art (map-graphics, Task 5). Pure data and maths:
 * no Pixi, no DOM, so it unit-tests in Node.
 *
 * A pose is per named part: `rot` in degrees around the part's `data-pivot`, and `dx`/`dy` as fractions of the
 * sprite size. `phase` runs 0 to 1 over one stride; every wave is a sine of 2 pi (f * phase + ph), so a gait
 * loops seamlessly at phase 1.
 */

export type GaitId =
  | 'quad' | 'biped' | 'bird' | 'flyer' | 'fish' | 'insect' | 'snake' | 'hover' | 'crab' | 'tentacle'
  | 'pulse' | 'squish' | 'undulate' | 'waddle' | 'static';

export type PoseMode = 'idle' | 'walk' | 'run';

export interface Pose {
  rot: number;
  dx: number;
  dy: number;
}

export interface GaitDef {
  parts: readonly string[];
  frames: { idle: number; walk: number; run: number };
  pose(part: string, phase: number, mode: PoseMode): Pose;
}

/** Walk amplitudes of one part. `ph` is a phase offset in cycles, `f` a frequency multiplier (default 1), and
 *  `idle` the share of the amplitude that moves while standing (0 or unset: the part holds still). */
interface Limb {
  rot?: number;
  dx?: number;
  dy?: number;
  ph?: number;
  f?: number;
  idle?: number;
}

const RUN_GAIN = 1.6;
const TAU = 2 * Math.PI;
const ZERO: Pose = { rot: 0, dx: 0, dy: 0 };

function poseOf(limb: Limb | undefined, phase: number, mode: PoseMode): Pose {
  if (!limb) return ZERO;
  const gain = mode === 'run' ? RUN_GAIN : mode === 'walk' ? 1 : (limb.idle ?? 0);
  if (gain === 0) return ZERO;
  const s = Math.sin(TAU * ((limb.f ?? 1) * phase + (limb.ph ?? 0))) * gain;
  return { rot: (limb.rot ?? 0) * s, dx: (limb.dx ?? 0) * s, dy: (limb.dy ?? 0) * s };
}

function gait(parts: Record<string, Limb>, walk: number, run: number): GaitDef {
  return {
    parts: Object.keys(parts),
    frames: { idle: 2, walk, run },
    pose: (part, phase, mode) => poseOf(parts[part], phase, mode),
  };
}

/** Eight or fewer tentacles spread evenly around the stride. */
function tentacles(count: number, limb: Omit<Limb, 'ph'>): Record<string, Limb> {
  const out: Record<string, Limb> = {};
  for (let i = 0; i < count; i++) out[`tent-${i + 1}`] = { ...limb, ph: i / count };
  return out;
}

export const GAITS: Record<GaitId, GaitDef> = {
  quad: gait({
    body: { dy: 0.012, idle: 0.3 },
    head: { rot: 3, ph: 0.25, idle: 0.5 },
    tail: { rot: 12, ph: 0.25, idle: 1 },
    'leg-fl': { rot: 25 },
    'leg-br': { rot: 25 },
    'leg-fr': { rot: 25, ph: 0.5 },
    'leg-bl': { rot: 25, ph: 0.5 },
  }, 4, 4),

  biped: gait({
    body: { dy: 0.015, f: 2, idle: 0.3 },
    head: { rot: 2, f: 2, idle: 0.2 },
    'arm-l': { rot: 20, ph: 0.5, idle: 0.2 },
    'arm-r': { rot: 20, idle: 0.2 },
    'leg-l': { rot: 25 },
    'leg-r': { rot: 25, ph: 0.5 },
  }, 4, 4),

  bird: gait({
    body: { dy: 0.02, f: 2, idle: 0.3 },
    head: { dx: 0.01, f: 2, idle: 0.2 },
    'wing-l': { rot: 4 },
    'wing-r': { rot: 4, ph: 0.5 },
    'leg-l': { rot: 20 },
    'leg-r': { rot: 20, ph: 0.5 },
    tail: { rot: 6, ph: 0.25, idle: 1 },
  }, 4, 4),

  flyer: gait({
    body: { dy: 0.03, idle: 0.2 },
    'wing-l': { rot: 40, idle: 0.2 },
    'wing-r': { rot: 40, idle: 0.2 },
    tail: { rot: 4, ph: 0.25, idle: 1 },
  }, 4, 4),

  fish: gait({
    'seg-1': { rot: 6, idle: 0.3 },
    'seg-2': { rot: 10, ph: 0.15, idle: 0.3 },
    'seg-3': { rot: 14, ph: 0.3 },
    tail: { rot: 22, ph: 0.45 },
    fin: { rot: 12, ph: 0.25, idle: 1 },
  }, 4, 4),

  insect: gait({
    body: { dy: 0.01, f: 2, idle: 0.3 },
    head: { rot: 3, ph: 0.25, idle: 0.5 },
    'leg-fl': { rot: 30 },
    'leg-mr': { rot: 30 },
    'leg-bl': { rot: 30 },
    'leg-fr': { rot: 30, ph: 0.5 },
    'leg-ml': { rot: 30, ph: 0.5 },
    'leg-br': { rot: 30, ph: 0.5 },
  }, 6, 6),

  snake: gait({
    head: { rot: 8, idle: 0.5 },
    'seg-1': { rot: 14, ph: 0.1 },
    'seg-2': { rot: 14, ph: 0.2 },
    'seg-3': { rot: 14, ph: 0.3 },
    'seg-4': { rot: 14, ph: 0.4 },
    tail: { rot: 14, ph: 0.5 },
  }, 4, 4),

  hover: gait({
    body: { dy: 0.04, idle: 1 },
    tail: { rot: 10, ph: 0.25, idle: 1 },
  }, 4, 4),

  crab: gait({
    body: { dx: 0.02, dy: 0.005, idle: 0.3 },
    'claw-l': { rot: 12, idle: 0.5 },
    'claw-r': { rot: 12, ph: 0.5, idle: 0.5 },
    'leg-l': { rot: 15 },
    'leg-r': { rot: 15, ph: 0.5 },
  }, 4, 4),

  tentacle: gait({
    body: { dy: 0.015, idle: 0.5 },
    ...tentacles(8, { rot: 20, idle: 0.4 }),
  }, 4, 4),

  pulse: gait({
    bell: { dy: 0.04, idle: 1 },
    ...tentacles(4, { rot: 8, idle: 0.5 }),
  }, 4, 4),

  squish: gait({
    body: { dx: 0.02, dy: -0.03, idle: 1 },
  }, 4, 4),

  undulate: gait({
    head: { rot: 4, idle: 0.3 },
    body: { rot: 6, ph: 0.2 },
    'seg-1': { rot: 8, ph: 0.4 },
    'seg-2': { rot: 8, ph: 0.6 },
    tail: { rot: 18, ph: 0.5 },
    fin: { rot: 14, ph: 0.25, idle: 0.5 },
  }, 4, 4),

  waddle: gait({
    body: { rot: 6, ph: 0.5, idle: 0.3 },
    cap: { dy: 0.02, f: 2, idle: 0.5 },
    'leg-l': { rot: 18 },
    'leg-r': { rot: 18, ph: 0.5 },
  }, 4, 4),

  static: gait({
    body: { dy: 0.008, idle: 1 },
  }, 1, 1),
};

export interface SpeciesGait {
  land: GaitId;
  water: GaitId | null;
  air: GaitId | null;
  /** Tiles covered by one full stride cycle (phase 0 to 1). */
  strideTiles: number;
}

const sp = (land: GaitId, strideTiles: number, water: GaitId | null = null, air: GaitId | null = null): SpeciesGait =>
  ({ land, water, air, strideTiles });

/** Keyed by species id (src/content/beasts.ts), one entry per species. Plain names are in the trailing comments. */
export const SPECIES_GAIT: Record<string, SpeciesGait> = {
  // Hand-authored beasts
  thistlehart: sp('quad', 0.6), // Deer
  burrfleece: sp('quad', 0.4), // Sheep
  plowhorn: sp('quad', 0.9), // Ox
  mossback: sp('quad', 0.9), // Tortoise
  cluckling: sp('bird', 0.25), // Chicken
  nectarbuzz: sp('flyer', 0.25), // Bee
  mudsnuffler: sp('quad', 0.6), // Pig
  gloamfang: sp('quad', 0.6), // Wolf
  // Beasts
  dustgallop: sp('quad', 0.6), // Horse
  reedgnaw: sp('quad', 0.4, 'undulate'), // Beaver
  cragscrambler: sp('quad', 0.4), // Goat
  frostbuffer: sp('quad', 0.9), // Yak
  bramblehop: sp('quad', 0.25), // Rabbit
  plateroll: sp('quad', 0.4), // Armadillo
  skyneck: sp('quad', 1.3), // Giraffe
  mirelope: sp('quad', 0.6), // Antelope
  sandhump: sp('quad', 0.9), // Camel
  capstroll: sp('waddle', 0.4), // Walking Mushroom
  ridgeprowler: sp('quad', 0.9), // Tiger
  dapplestalker: sp('quad', 0.6), // Leopard
  cacklehound: sp('quad', 0.6), // Hyena
  frostmaul: sp('quad', 1.3, 'undulate'), // Polar Bear
  cinderfox: sp('quad', 0.4), // Fox
  mudjaw: sp('quad', 0.9, 'undulate'), // Crocodile
  hissweaver: sp('snake', 0.4), // Snake
  stingtail: sp('insect', 0.4), // Scorpion
  shadepard: sp('quad', 0.6), // Panther
  thornboar: sp('quad', 0.6), // Boar
  slinkmaw: sp('quad', 0.25), // Weasel
  stormhound: sp('quad', 0.6), // Wild Dog
  ashmane: sp('quad', 0.9), // Lion
  // Birds
  cloudrook: sp('bird', 0.25, null, 'flyer'), // Crow
  emberwing: sp('bird', 0.4, null, 'flyer'), // Swallow
  hornbeak: sp('bird', 0.4, null, 'flyer'), // Hornbill
  talonkite: sp('bird', 0.6, null, 'flyer'), // Eagle
  dawnchirp: sp('bird', 0.25, null, 'flyer'), // Sparrow
  fenstork: sp('bird', 0.6, null, 'flyer'), // Stork
  waddlefin: sp('bird', 0.4, 'fish'), // Penguin
  stridebird: sp('bird', 0.6), // Ostrich
  hushowl: sp('bird', 0.4, null, 'flyer'), // Owl
  aegiswing: sp('bird', 0.6, null, 'flyer'), // Angel
  // Sea
  clawscuttler: sp('crab', 0.25), // Crab
  shoalglint: sp('fish', 0.25), // Sardine
  lanternjaw: sp('fish', 0.6), // Anglerfish
  inkreaver: sp('tentacle', 0.9), // Octopus
  gliderray: sp('fish', 0.6), // Stingray
  driftleviathan: sp('undulate', 2.0), // Whale
  brineback: sp('fish', 0.6), // Sea Turtle
  pelthaul: sp('quad', 0.6, 'undulate'), // Seal
  glowbell: sp('pulse', 0.4), // Jellyfish
  razorfin: sp('fish', 0.9), // Shark
  // Insects and small creatures
  mothlet: sp('flyer', 0.25), // Moth
  gemshell: sp('squish', 0.25), // Snail
  leafchomper: sp('insect', 0.25), // Grasshopper
  gnatveil: sp('flyer', 0.25), // Mosquito
  tunnelworm: sp('snake', 0.4), // Worm
  sporeant: sp('insect', 0.25), // Ant
  silkweaver: sp('insect', 0.4), // Spider
  gleambug: sp('flyer', 0.25), // Firefly
  gnawrill: sp('quad', 0.25), // Rat
  // Undead
  boneshambler: sp('biped', 0.6), // Skeleton
  rotstride: sp('biped', 0.6), // Zombie
  wailwisp: sp('hover', 0.4), // Ghost
  cairnwarden: sp('biped', 0.9), // Mummy
  bonehound: sp('quad', 0.4), // Skeleton Hound
  mireghast: sp('hover', 0.9), // Wraith
  gravecaller: sp('biped', 0.6), // Necromancer
  duskflit: sp('flyer', 0.4), // Vampire Bat
  voidmoth: sp('flyer', 0.6), // Shadow Moth
  // Monsters and divine
  stormwyrm: sp('quad', 2.0, null, 'flyer'), // Dragon
  cairnbrute: sp('biped', 1.3), // Stone Golem
  magmaling: sp('biped', 0.9), // Lava Golem
  rimecolossus: sp('biped', 2.0), // Frost Giant
  trimaw: sp('snake', 1.3), // Hydra
  hollowtroll: sp('biped', 1.3), // Troll
  lootmaw: sp('waddle', 0.6), // Mimic
  skyskiff: sp('hover', 0.9), // Flying Ship
  tideclaw: sp('crab', 2.0), // Giant Crab
  gazeserpent: sp('snake', 1.3), // Basilisk
  rootwarden: sp('static', 1.3), // Living Tree
  gooblet: sp('squish', 0.4), // Slime
  stormroc: sp('bird', 1.3, null, 'flyer'), // Giant Eagle
  patchbeast: sp('quad', 0.9), // Abomination
  phantom_hand: sp('hover', 0.6), // Phantom Hand
  // Folk
  hearthborn: sp('biped', 0.6), // Lowlanders
  fenmarr: sp('biped', 0.6), // Marsh Folk
  emberkin: sp('biped', 0.6), // Fire Folk
  rimeborn: sp('biped', 0.9), // Snow Folk
  dunari: sp('biped', 0.6), // Desert Folk
  thornling: sp('biped', 0.4), // Forest Folk
};
