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
  { id: 'win_power_catalogue', spec: null, title: 'Power catalogue' },
];

export const WINDOW_IDS: ReadonlySet<string> = new Set(WINDOW_CATALOG.map((w) => w.id));

export function windowTitle(id: string): string {
  return WINDOW_CATALOG.find((w) => w.id === id)?.title ?? '';
}
