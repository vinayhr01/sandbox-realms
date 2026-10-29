import { describe, expect, it } from 'vitest';
import { WINDOW_CATALOG } from '../../src/ui/windowCatalog.ts';
import { devSections, isModalKind, routeOf, sectionsOf } from '../../src/ui/shell/atlasRoutes.ts';

describe('Atlas routes', () => {
  it('every catalogue kind has a route', () => {
    expect(WINDOW_CATALOG.length).toBe(74);
    for (const w of WINDOW_CATALOG) expect(routeOf(w.id), w.id).not.toBeNull();
  });

  it('an unknown kind has no route', () => {
    expect(routeOf('win_missing')).toBeNull();
  });

  it('the developer kinds route to dev', () => {
    for (const id of ['win_dev_console', 'win_dev_tools', 'win_error', 'win_update']) expect(routeOf(id), id).toEqual({ dev: true });
  });

  it('the confirmations route to modal and stay modal dialogs', () => {
    expect(routeOf('win_chronicle_confirm')).toEqual({ modal: true });
    expect(routeOf('win_confirm_quit')).toEqual({ modal: true });
    expect(isModalKind('win_confirm_quit')).toBe(true);
    expect(isModalKind('win_realm')).toBe(false);
  });

  it('the named kinds land on their tabs', () => {
    expect(routeOf('win_population')).toEqual({ tab: 'world' });
    for (const id of ['list_dominions', 'list_hamlets', 'list_creeds']) expect(routeOf(id), id).toEqual({ tab: 'peoples' });
    expect(routeOf('win_chronicle')).toEqual({ tab: 'history' });
    expect(routeOf('win_trophies')).toEqual({ tab: 'discoveries' });
    expect(routeOf('win_settings')).toEqual({ tab: 'settings' });
  });

  it('the people and thing pages that need a target are card routes', () => {
    expect(routeOf('win_being')).toEqual({ tab: 'peoples', card: true });
    expect(routeOf('win_dominion')).toEqual({ tab: 'peoples', card: true });
  });

  it('each non-modal, non-dev, non-card kind is listed in exactly one tab, except Settings', () => {
    const listed = ['world', 'peoples', 'history', 'discoveries'].flatMap((tab) => sectionsOf(tab as 'world').map((w) => w.id));
    expect(new Set(listed).size).toBe(listed.length);
    const expected = WINDOW_CATALOG.filter((w) => {
      const r = routeOf(w.id);
      return r !== null && 'tab' in r && r.card !== true && w.id !== 'win_settings';
    }).map((w) => w.id);
    expect([...listed].sort()).toEqual([...expected].sort());
    expect(sectionsOf('settings')).toEqual([]);
  });

  it('the developer windows are the four dev kinds', () => {
    expect(devSections().map((w) => w.id).sort()).toEqual(['win_dev_console', 'win_dev_tools', 'win_error', 'win_update']);
  });
});
