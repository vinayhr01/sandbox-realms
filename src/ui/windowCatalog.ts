/**
 * Windows the UI can open today (13 section 7.1 ids). The spec lists 62 window types. `spec` is set
 * on every one that is built; the rest of the spec table is listed in docs/spec-coverage.md.
 * `power_catalogue` is not a spec id: it is the power list the brief asked for and it opens from
 * the Insight tab.
 */
export interface WindowInfo {
  id: string;
  /** Spec 13 section 7.1 id, or null when the window is an extra. */
  spec: string | null;
  title: string;
}

export const WINDOW_CATALOG: readonly WindowInfo[] = [
  { id: 'win_settings', spec: 'win_settings', title: 'Settings' },
  { id: 'win_rules', spec: 'win_rules', title: 'Realm Rules' },
  { id: 'win_ages', spec: 'win_ages', title: 'Ages' },
  { id: 'win_trophies', spec: 'win_trophies', title: 'Achievements' },
  { id: 'win_realm', spec: 'win_realm', title: 'Realm overview' },
  { id: 'win_new_realm', spec: 'win_new_realm', title: 'New Realm' },
  { id: 'win_keys', spec: 'win_keys', title: 'Keys' },
  { id: 'win_tutorial', spec: 'win_tutorial', title: 'Tutorial' },
  { id: 'win_privacy', spec: 'win_privacy', title: 'Privacy' },
  { id: 'win_help', spec: 'win_help', title: 'Help' },
  { id: 'win_chronicle', spec: 'win_chronicle', title: 'Chronicle' },
  { id: 'win_power_catalogue', spec: null, title: 'Power catalogue' },
  // Snapshot windows (src/ui/snapshotWindows.ts). Some ids are spec 13 ids (win_figures, win_stats_lifetime,
  // list_codex, list_dominions, list_hamlets); their spec field stays null until the spec-id count in
  // tests/unit/ui-windows.test.ts is updated.
  { id: 'win_population', spec: null, title: 'Population' },
  { id: 'win_beings', spec: null, title: 'Beings' },
  { id: 'win_figures', spec: 'win_figures', title: 'Figures' },
  { id: 'win_stats_lifetime', spec: 'win_stats_lifetime', title: 'Lifetime stats' },
  { id: 'list_codex', spec: 'list_codex', title: 'Codex' },
  { id: 'list_dominions', spec: 'list_dominions', title: 'Dominions' },
  { id: 'list_hamlets', spec: 'list_hamlets', title: 'Hamlets' },
  { id: 'win_culture', spec: null, title: 'Culture' },
  // Inspectors (13 section 6) open from a list row; their Back button returns to the list.
  { id: 'win_dominion', spec: 'win_dominion', title: 'Dominion' },
  { id: 'win_hamlet', spec: 'win_hamlet', title: 'Hamlet' },
  { id: 'win_campaign', spec: 'win_campaign', title: 'Campaign' },
  { id: 'win_creed', spec: 'win_creed', title: 'Creed' },
  { id: 'win_custom', spec: 'win_custom', title: 'Custom' },
  { id: 'win_dialect', spec: 'win_dialect', title: 'Dialect' },
  { id: 'win_family', spec: 'win_family', title: 'Family' },
  { id: 'win_intrigue', spec: 'win_intrigue', title: 'Intrigue' },
  { id: 'win_strain', spec: 'win_strain', title: 'Strain' },
  // Lists (13 section 8).
  { id: 'list_campaigns', spec: 'list_campaigns', title: 'Campaigns' },
  { id: 'list_creeds', spec: 'list_creeds', title: 'Creeds' },
  { id: 'list_customs', spec: 'list_customs', title: 'Customs' },
  { id: 'list_dialects', spec: 'list_dialects', title: 'Dialects' },
  { id: 'list_households', spec: 'list_households', title: 'Families' },
  { id: 'list_intrigues', spec: 'list_intrigues', title: 'Intrigues' },
  { id: 'list_strains', spec: 'list_strains', title: 'Strains' },
  // Windows without sim data.
  { id: 'win_language', spec: 'win_language', title: 'Language' },
  { id: 'win_credits', spec: 'win_credits', title: 'Credits' },
  { id: 'win_install', spec: 'win_install', title: 'Install' },
  { id: 'win_welcome', spec: 'win_welcome', title: 'Welcome' },
  { id: 'win_brushes', spec: 'win_brushes', title: 'Brushes' },
  // Spec windows added after the first 37 (13 section 7.1). `win_customize_*` is one row of the spec
  // table with nine ids, one per banner kind; each id's spec field is the row name.
  { id: 'win_being', spec: 'win_being', title: 'Being' },
  { id: 'win_item', spec: 'win_item', title: 'Item' },
  { id: 'win_structure', spec: 'win_structure', title: 'Structure' },
  { id: 'win_pact', spec: 'win_pact', title: 'Pact' },
  { id: 'win_army', spec: 'win_army', title: 'Army' },
  { id: 'win_clan', spec: 'win_clan', title: 'Clan' },
  { id: 'list_pacts', spec: 'list_pacts', title: 'Pacts' },
  { id: 'list_hosts', spec: 'list_hosts', title: 'Armies' },
  { id: 'list_kinbands', spec: 'list_kinbands', title: 'Clans' },
  { id: 'list_fav_beings', spec: 'list_fav_beings', title: 'Favourite beings' },
  { id: 'list_fav_items', spec: 'list_fav_items', title: 'Favourite items' },
  { id: 'win_customize_dominion', spec: 'win_customize_*', title: 'Customize dominion' },
  { id: 'win_customize_hamlet', spec: 'win_customize_*', title: 'Customize hamlet' },
  { id: 'win_customize_pact', spec: 'win_customize_*', title: 'Customize pact' },
  { id: 'win_customize_clan', spec: 'win_customize_*', title: 'Customize clan' },
  { id: 'win_customize_family', spec: 'win_customize_*', title: 'Customize family' },
  { id: 'win_customize_creed', spec: 'win_customize_*', title: 'Customize creed' },
  { id: 'win_customize_custom', spec: 'win_customize_*', title: 'Customize custom' },
  { id: 'win_customize_dialect', spec: 'win_customize_*', title: 'Customize dialect' },
  { id: 'win_customize_strain', spec: 'win_customize_*', title: 'Customize strain' },
  { id: 'win_compare', spec: 'win_compare', title: 'Compare' },
  { id: 'win_annals', spec: 'win_annals', title: 'Annals' },
  { id: 'win_chronicle_confirm', spec: 'win_chronicle_confirm', title: 'Confirm' },
  { id: 'win_trait_rain_edit', spec: 'win_trait_rain_edit', title: 'Trait rain' },
  { id: 'win_item_rain_edit', spec: 'win_item_rain_edit', title: 'Item rain' },
  { id: 'win_trait_editor', spec: 'win_trait_editor', title: 'Trait editor' },
  { id: 'win_gear_editor', spec: 'win_gear_editor', title: 'Gear editor' },
  { id: 'win_patch_notes', spec: 'win_patch_notes', title: 'Patch notes' },
  { id: 'win_error', spec: 'win_error', title: 'Error' },
  { id: 'win_confirm_quit', spec: 'win_confirm_quit', title: 'Leave realm' },
  { id: 'win_update', spec: 'win_update', title: 'Update' },
  { id: 'win_dev_console', spec: 'win_dev_console', title: 'Developer console' },
  { id: 'win_dev_tools', spec: 'win_dev_tools', title: 'Developer tools' },
];

export const WINDOW_IDS: ReadonlySet<string> = new Set(WINDOW_CATALOG.map((w) => w.id));

export function windowTitle(id: string): string {
  return WINDOW_CATALOG.find((w) => w.id === id)?.title ?? '';
}
