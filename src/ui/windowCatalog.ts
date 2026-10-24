/**
 * Windows the UI can open today (13 section 7.1 ids). The spec lists 62 window types; only the ones
 * whose data the screen already has are here. `power_catalogue` is not a spec id: it is the power
 * list the brief asked for and it opens from the Insight tab.
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
  { id: 'win_figures', spec: null, title: 'Figures' },
  { id: 'win_stats_lifetime', spec: null, title: 'Lifetime stats' },
  { id: 'list_codex', spec: null, title: 'Codex' },
  { id: 'list_dominions', spec: null, title: 'Dominions' },
  { id: 'list_hamlets', spec: null, title: 'Hamlets' },
  { id: 'win_culture', spec: null, title: 'Culture' },
];

export const WINDOW_IDS: ReadonlySet<string> = new Set(WINDOW_CATALOG.map((w) => w.id));

export function windowTitle(id: string): string {
  return WINDOW_CATALOG.find((w) => w.id === id)?.title ?? '';
}
