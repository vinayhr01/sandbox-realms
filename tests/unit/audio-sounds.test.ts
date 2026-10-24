import { describe, expect, it } from 'vitest';
import { ageBedLevelDb, AGE_BED_LEVEL_DB, CLASS_DEFAULTS, canStart, SOUND_BY_ID, SOUNDS, type SoundDef } from '../../src/audio/sounds.ts';
import { renderSound } from '../../src/audio/synth.ts';
import { CATEGORY_BUS, busForCategory, CATEGORY_CAPS } from '../../src/audio/model.ts';

const RATE = 8000;

describe('sound definitions (16 section B2, B3)', () => {
  it('has unique ids and known categories', () => {
    expect(new Set(SOUNDS.map((s) => s.id)).size).toBe(SOUNDS.length);
    for (const s of SOUNDS) expect(CLASS_DEFAULTS[s.category]).toBeDefined();
    expect(SOUND_BY_ID.size).toBe(SOUNDS.length);
  });

  it('gives every category the B3 priority and cap', () => {
    expect(CLASS_DEFAULTS['ui']).toMatchObject({ priority: 0, cooldownMs: 30, maxInstances: 6 });
    expect(CLASS_DEFAULTS['stingers']).toMatchObject({ priority: 0, cooldownMs: 1000, maxInstances: 2 });
    expect(CLASS_DEFAULTS['calamity']).toMatchObject({ priority: 1, cooldownMs: 150, maxInstances: 4 });
    expect(CLASS_DEFAULTS['combat']).toMatchObject({ priority: 2, cooldownMs: 60, maxInstances: 8 });
    expect(CLASS_DEFAULTS['voices']).toMatchObject({ priority: 3, maxInstances: 6 });
    expect(CLASS_DEFAULTS['work']).toMatchObject({ priority: 3, maxInstances: 6 });
    expect(CLASS_DEFAULTS['ambience']).toMatchObject({ priority: 4, loop: true });
  });

  it('keeps the B3 voice caps in the model in step with the class table', () => {
    expect(CATEGORY_CAPS['ui']).toBe(CLASS_DEFAULTS['ui']?.maxInstances);
    expect(CATEGORY_CAPS['stingers']).toBe(CLASS_DEFAULTS['stingers']?.maxInstances);
    expect(CATEGORY_CAPS['combat']).toBe(CLASS_DEFAULTS['combat']?.maxInstances);
  });

  it('marks ambience beds as seamless loops and every other sound as a one-shot', () => {
    for (const s of SOUNDS) expect(s.loop).toBe(s.category === 'ambience');
  });

  it('gives every sound at least one layer with finite parameters inside sane ranges', () => {
    for (const s of SOUNDS) {
      expect(s.layers.length).toBeGreaterThan(0);
      expect(s.durationMs).toBeGreaterThan(0);
      expect(s.gainDb).toBeLessThanOrEqual(0);
      for (const l of s.layers) {
        expect(Number.isFinite(l.gain)).toBe(true);
        expect(l.gain).toBeGreaterThan(0);
        expect(l.gain).toBeLessThanOrEqual(1);
        if (l.kind === 'tone') {
          expect(l.from).toBeGreaterThan(0);
          expect(l.to).toBeGreaterThan(0);
        } else {
          expect(l.freq).toBeGreaterThan(0);
          // Recipes are authored for 32 kHz and up (the phone profile); 16 kHz is the Nyquist limit.
          expect(l.freq).toBeLessThan(16000);
        }
      }
    }
  });

  it('maps every category to a bus the model knows', () => {
    for (const cat of Object.keys(CLASS_DEFAULTS)) expect(['master', 'music', 'sfx', 'ui']).toContain(busForCategory(cat));
    expect(busForCategory('stingers')).toBe('music');
    expect(busForCategory('ui')).toBe('ui');
    expect(busForCategory('something_new')).toBe('sfx');
    expect(Object.keys(CATEGORY_BUS).length).toBeGreaterThan(0);
  });
});

describe('synthesis (16 section B7 offline, no WebAudio)', () => {
  it('renders every sound to finite samples within the peak limit', () => {
    for (const s of SOUNDS) {
      const pcm = renderSound(s, RATE);
      expect(pcm.length).toBe(Math.round((s.durationMs / 1000) * RATE));
      let peak = 0;
      let finite = true;
      for (const x of pcm) {
        if (!Number.isFinite(x)) finite = false;
        peak = Math.max(peak, Math.abs(x));
      }
      expect(finite, s.id).toBe(true);
      expect(peak, s.id).toBeLessThanOrEqual(0.9 + 1e-6);
      expect(peak, s.id).toBeGreaterThan(0.01);
    }
  }, 60_000);

  it('is deterministic for a given definition', () => {
    const s = SOUND_BY_ID.get('cal_storm_peak');
    if (!s) throw new Error('missing');
    expect(Array.from(renderSound(s, RATE))).toEqual(Array.from(renderSound(s, RATE)));
  });

  it('different sounds with the same layers do not share noise', () => {
    const base = SOUND_BY_ID.get('cmb_arrow');
    if (!base) throw new Error('missing');
    const other: SoundDef = { ...base, id: 'cmb_arrow_copy' };
    expect(Array.from(renderSound(base, RATE))).not.toEqual(Array.from(renderSound(other, RATE)));
  });

  it('ambience beds start and end at the same level (seamless loop seam)', () => {
    // Low-passed beds are smooth, so the sample across the seam must be close to its neighbours.
    for (const id of ['amb_wind_low', 'amb_surf', 'amb_lava_bubble', 'amb_cave_drone']) {
      const s = SOUND_BY_ID.get(id);
      if (!s) throw new Error(`missing ${id}`);
      const pcm = renderSound(s, RATE);
      const n = pcm.length;
      const seam = Math.abs((pcm[n - 1] ?? 0) - (pcm[0] ?? 0));
      let worst = 0;
      for (let i = 1; i < 200; i++) worst = Math.max(worst, Math.abs((pcm[i] ?? 0) - (pcm[i - 1] ?? 0)));
      expect(seam).toBeLessThanOrEqual(Math.max(worst * 4, 0.02));
    }
  });
});

describe('start rules (16 section B3)', () => {
  const ui = SOUND_BY_ID.get('ui_click');
  const stg = SOUND_BY_ID.get('stg_peace');
  if (!ui || !stg) throw new Error('missing');

  it('honours the cooldown', () => {
    expect(canStart(ui, undefined, 0, 0)).toBe(true);
    expect(canStart(ui, 0, 0, 29)).toBe(false);
    expect(canStart(ui, 0, 0, 30)).toBe(true);
  });

  it('honours the instance cap', () => {
    expect(canStart(stg, undefined, 1, 0)).toBe(true);
    expect(canStart(stg, undefined, 2, 0)).toBe(false);
  });

  it('a stinger cannot repeat inside its one-second cooldown', () => {
    expect(canStart(stg, 5000, 0, 5999)).toBe(false);
    expect(canStart(stg, 5000, 0, 6000)).toBe(true);
  });
});

describe('loudness by Age (16)', () => {
  it('uses the three levels from the brief', () => {
    const levels = new Set(Object.values(AGE_BED_LEVEL_DB));
    expect([...levels].sort((a, b) => b - a)).toEqual([0, -6, -12]);
  });

  it('puts the desolate Ages 12 dB below the bright ones, and defaults unknown Ages to the reference', () => {
    expect(ageBedLevelDb('frostbound') - ageBedLevelDb('dawn')).toBe(-12);
    expect(ageBedLevelDb('not_an_age')).toBe(0);
  });
});
