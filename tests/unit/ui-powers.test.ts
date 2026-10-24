import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POWERS, POWER_BY_ID } from '../../src/content/powers.ts';
import { SIM_HANDLERS, UI_HANDLERS, cooldownSecondsLeft, linePoints, powerStatus, strokeOp } from '../../src/ui/powerSupport.ts';

describe('power support', () => {
  it('SIM_HANDLERS matches the cases executePower switches on', () => {
    const src = readFileSync(new URL('../../src/sim/powers/handlers.ts', import.meta.url), 'utf8');
    const executeBody = src.slice(src.indexOf('export function executePower'), src.indexOf('export function usePowerById'));
    const cases = [...executeBody.matchAll(/case '([a-z_]+)'/g)].map((m) => m[1] ?? '');
    expect(cases.length).toBeGreaterThan(0);
    expect([...new Set(cases)].sort()).toEqual([...SIM_HANDLERS].sort());
  });

  it('raise and lower are stroke powers; other brushes are not', () => {
    expect(strokeOp(POWER_BY_ID.get('shape_raise') ?? null)).toBe('raise');
    expect(strokeOp(POWER_BY_ID.get('shape_lower') ?? null)).toBe('lower');
    expect(strokeOp(POWER_BY_ID.get('shape_deepmere') ?? null)).toBeNull();
    expect(strokeOp(null)).toBeNull();
  });

  it('the powers the brief names are enabled: raise, lower, a ground paint, a spawn, bomb, bolt, an omen', () => {
    for (const id of ['shape_raise', 'shape_lower', 'shape_deepmere', 'spawn_beast_thistlehart', 'havoc_bomb', 'havoc_bolt', 'omen_whirlwind']) {
      const def = POWER_BY_ID.get(id);
      expect(def, id).toBeDefined();
      expect(powerStatus(def!).enabled, id).toBe(true);
    }
  });

  it('powers without a handler stay disabled with a note', () => {
    const unhandled = { ...POWERS[0]!, handler: 'no_such_handler', name: 'Test power' };
    const status = powerStatus(unhandled);
    expect(status.enabled).toBe(false);
    expect(status.note).toContain('Test power');
    expect(status.note).toContain('not available yet');
  });

  it('open_window powers are enabled only for windows that exist', () => {
    expect(powerStatus(POWER_BY_ID.get('realm_rules')!).enabled).toBe(true);
    expect(powerStatus(POWER_BY_ID.get('realm_ages')!).enabled).toBe(true);
    expect(powerStatus(POWER_BY_ID.get('realm_chronicle')!).enabled).toBe(true);
    expect(powerStatus(POWER_BY_ID.get('insight_lore')!).enabled).toBe(true);
  });

  it('every power is either enabled or carries a note; UI handlers are enabled', () => {
    for (const def of POWERS) {
      const status = powerStatus(def);
      if (status.enabled) expect(status.note).toBe('');
      else expect(status.note.length).toBeGreaterThan(0);
      if (UI_HANDLERS.includes(def.handler) && def.handler !== 'open_window') expect(status.enabled, def.id).toBe(true);
    }
  });

  it('linePoints includes both ends and steps one tile at a time', () => {
    expect(linePoints(2, 2, 2, 2)).toEqual([[2, 2]]);
    expect(linePoints(0, 0, 3, 0)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    const diag = linePoints(0, 0, 3, 3);
    expect(diag[0]).toEqual([0, 0]);
    expect(diag[diag.length - 1]).toEqual([3, 3]);
    expect(diag.length).toBe(4);
    const back = linePoints(5, 1, 1, 1);
    expect(back[0]).toEqual([5, 1]);
    expect(back[back.length - 1]).toEqual([1, 1]);
  });

  it('cooldown seconds round up and stop at zero', () => {
    expect(cooldownSecondsLeft(0, 3000)).toBe(3);
    expect(cooldownSecondsLeft(2500, 3000)).toBe(1);
    expect(cooldownSecondsLeft(3000, 3000)).toBe(0);
  });
});
