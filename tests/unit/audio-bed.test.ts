import { describe, expect, it } from 'vitest';
import { OPEN_CUTOFF_HZ, OVERVIEW_CUTOFF_HZ, PAUSE_CUTOFF_HZ, STEM_BY_ID, musicCutoffHz, silentMusicState, stemTargets, variantFor } from '../../src/audio/music.ts';
import { ageBedLevelDb } from '../../src/audio/sounds.ts';

describe('bed A/B alternation (16 B8)', () => {
  it('the bed has a B voicing that differs from the A voicing', () => {
    const bed = STEM_BY_ID.get('bed_a');
    expect(bed?.alt).toBeDefined();
    expect(bed?.alt?.wave).not.toBe(bed?.wave);
  });

  it('the bed stays at full gain on every loop, whichever voicing plays', () => {
    expect(stemTargets(silentMusicState())['bed_a']).toBe(1);
  });

  it('the voicing changes between loops, and both voicings occur', () => {
    const seen = new Set<number>();
    let changes = 0;
    let prev = variantFor(0, 'bed_a');
    for (let loop = 0; loop < 32; loop++) {
      const v = variantFor(loop, 'bed_a');
      seen.add(v);
      if (v !== prev) changes++;
      prev = v;
    }
    expect(seen).toEqual(new Set([0, 1]));
    expect(changes).toBeGreaterThan(0);
  });

  it('the choice is deterministic for a loop index', () => {
    expect(variantFor(7, 'bed_a')).toBe(variantFor(7, 'bed_a'));
  });
});

describe('music bus low-pass (16 B5 and B8 rule 5)', () => {
  it('open music is not filtered, overview is at 6 kHz, and paused is at 1.2 kHz', () => {
    const open = silentMusicState();
    expect(musicCutoffHz(open)).toBe(OPEN_CUTOFF_HZ);
    expect(musicCutoffHz({ ...open, isOverview: true })).toBe(OVERVIEW_CUTOFF_HZ);
    expect(OVERVIEW_CUTOFF_HZ).toBe(6000);
    expect(musicCutoffHz({ ...open, paused: true })).toBe(PAUSE_CUTOFF_HZ);
    expect(PAUSE_CUTOFF_HZ).toBe(1200);
  });

  it('pause wins over overview', () => {
    expect(musicCutoffHz({ paused: true, isOverview: true })).toBe(PAUSE_CUTOFF_HZ);
  });
});

describe('loudness by Age (16 "Audio loudness by Age")', () => {
  it('gloomy Ages sit 6 dB below the reference and desolate Ages 12 dB below', () => {
    expect(ageBedLevelDb('dawn')).toBe(0);
    expect(ageBedLevelDb('gloom')).toBe(-6);
    expect(ageBedLevelDb('cinder')).toBe(-12);
    expect(ageBedLevelDb('no_such_age')).toBe(0);
  });
});
