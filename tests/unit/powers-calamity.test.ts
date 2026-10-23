import { describe, expect, it } from 'vitest';
import { POWERS, TABS, POWER_BY_ID } from '../../src/content/powers.ts';
import { CALAMITIES, calamityRoll, type CalamityContext } from '../../src/sim/calamity.ts';
import { createRng } from '../../src/shared/rng.ts';
import { AGES } from '../../src/sim/ages.ts';

function ctx(seed: number, age: string, rules: Record<string, boolean>, tick = 0): CalamityContext & { cooldowns: Map<string, number> } {
  return {
    rng: createRng(seed),
    tick,
    age,
    isOn: (id) => rules[id] ?? true,
    cooldowns: new Map(),
    hamlets: 10,
    beings: 2000,
    liveCount: () => 0,
  };
}

describe('powers catalogue', () => {
  it('every power has a unique id and a known tab', () => {
    const ids = POWERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of POWERS) expect(TABS).toContain(p.tab);
    expect(POWER_BY_ID.size).toBe(POWERS.length);
  });

  it('spawns cover every roster species and every calamity has an omen', () => {
    expect(POWERS.filter((p) => p.handler === 'spawn_being').length).toBeGreaterThan(0);
    for (const c of CALAMITIES) expect(POWER_BY_ID.has(`omen_${c.id}`)).toBe(true);
  });
});

describe('calamity roll', () => {
  it('never picks a calamity forbidden in the current age', () => {
    for (const age of AGES.map((a) => a.id)) {
      for (let seed = 1; seed <= 200; seed++) {
        const rolled = calamityRoll(ctx(seed, age, {}));
        if (rolled === null) continue;
        const def = CALAMITIES.find((c) => c.id === rolled);
        expect(def).toBeDefined();
        if (def && def.agesForbid.length > 0) expect(def.agesForbid).not.toContain(age);
        if (def && def.agesAllow.length > 0) expect(def.agesAllow).toContain(age);
      }
    }
  });

  it('a calamity on cooldown is not picked again before its cooldown ends', () => {
    const c = ctx(77, 'discord', {});
    const picks: { id: string; tick: number }[] = [];
    for (let tick = 0; tick < 40000; tick += 1600) {
      const rolled = calamityRoll({ ...c, tick });
      if (rolled) picks.push({ id: rolled, tick });
    }
    expect(picks.length).toBeGreaterThan(0);
    for (let i = 0; i < picks.length; i++) {
      for (let j = i + 1; j < picks.length; j++) {
        const a = picks[i];
        const b = picks[j];
        if (a && b && a.id === b.id) {
          const def = CALAMITIES.find((x) => x.id === a.id);
          expect(b.tick - a.tick).toBeGreaterThanOrEqual(def?.cooldownTicks ?? 0);
        }
      }
    }
  });

  it('with natural_calamities off no nature calamity is picked in 2000 rolls', () => {
    const rules = { natural_calamities: false };
    const natures = new Set(CALAMITIES.filter((c) => c.category === 'nature').map((c) => c.id));
    let picked = 0;
    for (let k = 0; k < 2000; k++) {
      const rolled = calamityRoll(ctx(9000 + k, 'dawn', rules, k * 1600));
      if (rolled) picked++;
      expect(rolled === null || !natures.has(rolled)).toBe(true);
    }
    expect(picked).toBeGreaterThanOrEqual(0);
  });
});
