import { describe, expect, it } from 'vitest';
import { BIOMES } from '../../src/content/biomes.ts';
import { AGE_IDS, BIOME_FAMILIES, MOOD_KEYS, silentMusicState } from '../../src/audio/music.ts';
import { BIOME_FAMILY_BY_ID, MusicFeed, biomeFamilyOf, biomeShares, rawMood, smoothMood, type FeedSnapshot } from '../../src/audio/feed.ts';

const snap = (patch: Partial<FeedSnapshot> & { tick: number }): FeedSnapshot => ({
  population: { total: 100 },
  counters: {},
  dominions: [],
  ...patch,
});

describe('biome families (16 B8 biome stems)', () => {
  it('maps every biome of the content table to one of the seven families', () => {
    for (const b of BIOMES) {
      expect(BIOME_FAMILY_BY_ID[b.id], b.id).toBeDefined();
      expect(BIOME_FAMILIES).toContain(BIOME_FAMILY_BY_ID[b.id]);
    }
    expect(Object.keys(BIOME_FAMILY_BY_ID)).toHaveLength(BIOMES.length);
  });

  it('plays an unknown biome as temperate', () => {
    expect(biomeFamilyOf('no_such_biome')).toBe('temperate');
  });

  it('turns tile counts into shares that sum to one', () => {
    const shares = biomeShares({ verdant_reach: 3, amberveldt: 1 });
    expect(shares.temperate).toBeCloseTo(0.75, 10);
    expect(shares.arid).toBeCloseTo(0.25, 10);
    const total = Object.values(shares).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('gives all zeros when there are no tiles', () => {
    expect(Object.values(biomeShares({})).every((v) => v === 0)).toBe(true);
  });
});

describe('mood smoothing (16 B8 mood scoring)', () => {
  it('rises with a 4 second time constant', () => {
    expect(smoothMood(0, 1, 4)).toBeCloseTo(1 - Math.exp(-1), 10);
  });

  it('falls with a 20 second half-life', () => {
    expect(smoothMood(1, 0, 20)).toBeCloseTo(0.5, 10);
  });

  it('holds still with no time passed and clamps inputs to 0..1', () => {
    expect(smoothMood(0.3, 1, 0)).toBe(0.3);
    expect(smoothMood(5, 0, 0)).toBe(1);
  });

  it('raw scores: war from dominions at war, calm is the rest', () => {
    const none = rawMood({ population: 100, deathsInWindow: 0, birthsInWindow: 0, dominionsAtWar: 0, tensionShare: 0, activeIntrigues: 0, magicalShare: 0 });
    expect(none.war).toBe(0);
    expect(none.calm).toBe(1);
    const war = rawMood({ population: 100, deathsInWindow: 0, birthsInWindow: 0, dominionsAtWar: 4, tensionShare: 0, activeIntrigues: 0, magicalShare: 0 });
    expect(war.war).toBeCloseTo(1, 10);
    expect(war.calm).toBe(0);
    for (const k of MOOD_KEYS) expect(war[k]).toBeGreaterThanOrEqual(0);
  });
});

describe('MusicFeed', () => {
  it('starts silent, with no Age and every share at zero', () => {
    const feed = new MusicFeed();
    const p = feed.partial();
    expect(p.ageId).toBeNull();
    expect(p.biomeShare).toEqual(silentMusicState().biomeShare);
    expect(p.mood).toEqual(silentMusicState().mood);
  });

  it('takes the Age id and biome shares from the snapshot', () => {
    const feed = new MusicFeed();
    feed.ingest(snap({ tick: 0, age: 'marvels', biomes: { skyhaven: 2, verdant_reach: 2 } }));
    const p = feed.partial();
    expect(p.ageId).toBe('marvels');
    expect(p.biomeShare.magical).toBeCloseTo(0.5, 10);
    expect(p.biomeShare.temperate).toBeCloseTo(0.5, 10);
    expect(AGE_IDS).toContain('marvels');
  });

  it('a burst of deaths in the 20 second window raises grief, and it fades once the window has passed', () => {
    const feed = new MusicFeed();
    feed.ingest(snap({ tick: 0, age: 'dawn', counters: { deaths: 0 } }));
    feed.ingest(snap({ tick: 400, age: 'dawn', counters: { deaths: 30 } }));
    const burst = feed.partial().mood;
    expect(burst.grief).toBeGreaterThan(0.9);
    expect(burst.calm).toBeLessThan(0.1);
    feed.ingest(snap({ tick: 1600, age: 'dawn', counters: { deaths: 30 } }));
    expect(feed.partial().mood.grief).toBeLessThan(0.2);
  });

  it('a snapshot with an earlier tick (a new or loaded realm) starts the windows again', () => {
    const feed = new MusicFeed();
    feed.ingest(snap({ tick: 1000, counters: { deaths: 50 } }));
    expect(() => feed.ingest(snap({ tick: 10, counters: { deaths: 0 } }))).not.toThrow();
    expect(feed.partial().mood.grief).toBeLessThanOrEqual(1);
  });
});
