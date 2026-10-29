/**
 * Which deploy effect a power plays (UX redesign, spec F). Mapping by handler and tab; a power with no map effect (a toggle,
 * a window, a pick or a view change) maps to 'rule', which plays nothing on the map (the pill pulse is the shell's).
 * Pure data: no Pixi import, so the mapping is testable without a renderer.
 */
import type { PowerDef } from '../content/powers.ts';

export type RecipeId = 'spawn' | 'brush' | 'weather' | 'blast' | 'meteor' | 'bless' | 'curse' | 'rule';

/** Favour and havoc powers that curse rather than bless (strife, grudge, frenzy, hex, slumber, unweave, pestilence). */
const CURSE_POWERS: ReadonlySet<string> = new Set(['fav_strife', 'fav_grudge', 'fav_frenzy', 'fav_hex', 'fav_slumber', 'fav_unweave', 'hex_cast', 'havoc_pestilence']);

/** Handlers that change the view, the pause or the selection only: no map effect. */
const NO_MAP_HANDLERS: ReadonlySet<string> = new Set([
  'open_window',
  'cycle_speed',
  'set_pause',
  'toggle_hud',
  'follow',
  'possess',
  'lore',
  'arm_inspect',
  'cycle_option',
  'select_accord',
  'select_dominion',
  'select_hamlet',
]);

/** Handlers that blow something up on the map. */
const BLAST_HANDLERS: ReadonlySet<string> = new Set(['bomb', 'bolt', 'start_volcano', 'start_geyser']);

export function recipeFor(power: PowerDef): RecipeId {
  if (power.kind === 'toggle' || NO_MAP_HANDLERS.has(power.handler)) return 'rule';
  if (power.handler === 'spawn_being') return 'spawn';
  if (power.tab === 'sky') return 'weather';
  if (power.handler === 'calamity') return power.params['calamity'] === 'skyfall' ? 'meteor' : 'blast';
  if (BLAST_HANDLERS.has(power.handler)) return 'blast';
  if (CURSE_POWERS.has(power.id)) return 'curse';
  if (power.handler === 'paint_ground' || power.handler.startsWith('terraform_')) return 'brush';
  if (power.tab === 'grow') return 'spawn';
  if (power.tab === 'favour') return 'bless';
  return 'rule';
}
