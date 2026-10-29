/**
 * Where each window kind lives in the Atlas (UX redesign, spec C). `routeOf` is the one table `openWindow` reads:
 * a kind is either a Confirmation (a modal dialog), a developer window (listed in Settings only while the developer
 * switch is on), or a page under one of the five Atlas tabs. A `card` page needs a target (a being, a hamlet, a
 * dominion ...), so it opens from a list or the info card and is not listed as a section.
 */
import { WINDOW_CATALOG, type WindowInfo } from '../windowCatalog.ts';
import type { AtlasTab } from './store.ts';

export type Route = { tab: AtlasTab; card?: true } | { modal: true } | { dev: true };

/** Confirmations keep the modal dialog (and its focus return). */
const MODAL: readonly string[] = ['win_chronicle_confirm', 'win_confirm_quit'];

/** Developer windows: listed in Settings only when the developer switch (`dev.enabled`) is on. */
const DEV: readonly string[] = ['win_dev_console', 'win_dev_tools', 'win_error', 'win_update'];

const TAB_KINDS: Readonly<Record<AtlasTab, readonly string[]>> = {
  world: [
    'win_realm',
    'win_rules',
    'win_ages',
    'win_population',
    'win_beings',
    'win_stats_lifetime',
    'list_codex',
    'list_strains',
    'win_power_catalogue',
    'win_trait_rain_edit',
    'win_item_rain_edit',
    'win_trait_editor',
    'win_gear_editor',
    'win_new_realm',
    'win_brushes',
    'win_keys',
    'win_tutorial',
    'win_welcome',
    'win_install',
    'win_language',
    'win_privacy',
    'win_help',
    'win_credits',
    'win_patch_notes',
  ],
  peoples: [
    'win_figures',
    'win_culture',
    'list_dominions',
    'list_hamlets',
    'list_creeds',
    'list_customs',
    'list_dialects',
    'list_households',
    'list_intrigues',
    'list_campaigns',
    'list_hosts',
    'list_pacts',
    'list_kinbands',
    'list_fav_beings',
    'list_fav_items',
    'win_compare',
  ],
  history: ['win_chronicle', 'win_annals'],
  discoveries: ['win_trophies'],
  settings: ['win_settings'],
};

/** Pages that need a target. They open from a list row, the info card or "More", and are not listed as sections. */
const CARD_KINDS: readonly string[] = [
  'win_being',
  'win_item',
  'win_structure',
  'win_pact',
  'win_army',
  'win_clan',
  'win_hamlet',
  'win_dominion',
  'win_campaign',
  'win_creed',
  'win_custom',
  'win_dialect',
  'win_family',
  'win_intrigue',
  'win_strain',
  'win_customize_dominion',
  'win_customize_hamlet',
  'win_customize_pact',
  'win_customize_clan',
  'win_customize_family',
  'win_customize_creed',
  'win_customize_custom',
  'win_customize_dialect',
  'win_customize_strain',
];

const ROUTES: ReadonlyMap<string, Route> = (() => {
  const map = new Map<string, Route>();
  for (const id of MODAL) map.set(id, { modal: true });
  for (const id of DEV) map.set(id, { dev: true });
  for (const tab of Object.keys(TAB_KINDS) as AtlasTab[]) {
    for (const id of TAB_KINDS[tab]) map.set(id, { tab });
  }
  // Card pages are people, places and things: they sit under Peoples when opened from the Atlas.
  for (const id of CARD_KINDS) map.set(id, { tab: 'peoples', card: true });
  return map;
})();

/** The route of a window kind, or null for a kind the catalogue does not have. */
export function routeOf(kind: string): Route | null {
  return ROUTES.get(kind) ?? null;
}

/** True when the kind is a confirmation that keeps the modal dialog. */
export function isModalKind(kind: string): boolean {
  const route = routeOf(kind);
  return route !== null && 'modal' in route;
}

/** The section buttons of one Atlas tab, in catalogue order. Card pages and the Settings root are not sections. */
export function sectionsOf(tab: AtlasTab): WindowInfo[] {
  return WINDOW_CATALOG.filter((w) => {
    const route = routeOf(w.id);
    return route !== null && 'tab' in route && route.tab === tab && route.card !== true && w.id !== 'win_settings';
  });
}

/** The developer windows that Settings lists while the developer switch is on. */
export function devSections(): WindowInfo[] {
  return WINDOW_CATALOG.filter((w) => DEV.includes(w.id));
}

