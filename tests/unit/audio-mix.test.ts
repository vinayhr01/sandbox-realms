import { describe, expect, it } from 'vitest';
import { dbToGain, distanceGain, distanceScale, duckEnvelopeDb, panFor, smoothGain } from '../../src/audio/mix.ts';
import { DEFAULT_AUDIO_OPTIONS, optionOfCategory, parseAudioOptions, sliderToGain, spatialScale } from '../../src/audio/options.ts';

describe('mix maths (16 section B4, B5)', () => {
  it('converts decibels to gain', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 2);
    expect(dbToGain(-20)).toBeCloseTo(0.1, 6);
  });

  it('pans by position relative to the centre, clamped and scaled', () => {
    expect(panFor(0, 0, 20)).toBe(0);
    expect(panFor(12, 0, 10)).toBeCloseTo(0.8, 6);
    expect(panFor(-1000, 0, 10)).toBeCloseTo(-0.8, 6);
    expect(panFor(5, 0, 0)).toBe(0);
    expect(panFor(12, 0, 10, 'low')).toBeCloseTo(0.4, 6);
    expect(panFor(1000, 0, 10, 'high')).toBeLessThanOrEqual(1);
  });

  it('uses d0 of 8 tiles zoomed in and 40 zoomed out', () => {
    expect(distanceScale(1)).toBe(8);
    expect(distanceScale(0)).toBe(40);
    expect(distanceScale(0.5)).toBe(24);
    expect(distanceGain(0, 8)).toBe(1);
    expect(distanceGain(8, 8)).toBeCloseTo(0.5, 6);
  });

  it('smooths with the attack constant on the way up and the release constant on the way down', () => {
    const tau = 2;
    const up = smoothGain(0, 1, tau, tau, 4);
    expect(up).toBeCloseTo(1 - Math.exp(-1), 6);
    const down = smoothGain(1, 0, tau, 2, tau);
    expect(down).toBeCloseTo(Math.exp(-1), 6);
    expect(smoothGain(0, 1, 1, 0, 0)).toBe(1);
  });

  it('ducks music down fast and recovers slowly, then returns to zero', () => {
    expect(duckEnvelopeDb(-5, 5)).toBe(0);
    expect(duckEnvelopeDb(0, 5)).toBe(0);
    expect(duckEnvelopeDb(40, 5)).toBeCloseTo(-2.5, 6);
    expect(duckEnvelopeDb(80, 5)).toBeCloseTo(-5, 6);
    expect(duckEnvelopeDb(80 + 300, 5)).toBeCloseTo(-2.5, 6);
    expect(duckEnvelopeDb(80 + 600, 5)).toBe(0);
    expect(duckEnvelopeDb(10000, 5)).toBe(0);
    expect(duckEnvelopeDb(10, 0)).toBe(0);
  });
});

describe('audio options (16 section B9)', () => {
  it('uses the B9 defaults', () => {
    expect(DEFAULT_AUDIO_OPTIONS.volumes).toEqual({ master: 80, music: 60, effects: 90, voices: 70, ambience: 70, ui: 80 });
    expect(DEFAULT_AUDIO_OPTIONS.musicFrequency).toBe('often');
    expect(DEFAULT_AUDIO_OPTIONS.muteWhenHidden).toBe(true);
    expect(DEFAULT_AUDIO_OPTIONS.reduceLoudSounds).toBe(false);
    expect(DEFAULT_AUDIO_OPTIONS.spatialIntensity).toBe('normal');
  });

  it('maps sliders with the perceptual law and clamps the input', () => {
    expect(sliderToGain(100)).toBe(1);
    expect(sliderToGain(50)).toBeCloseTo(0.25, 6);
    expect(sliderToGain(-5)).toBe(0);
    expect(sliderToGain(250)).toBe(1);
    expect(sliderToGain(Number.NaN)).toBe(0);
  });

  it('routes each category to its option', () => {
    expect(optionOfCategory('voices')).toBe('voices');
    expect(optionOfCategory('ambience')).toBe('ambience');
    expect(optionOfCategory('ui')).toBe('ui');
    expect(optionOfCategory('stingers')).toBe('music');
    expect(optionOfCategory('combat')).toBe('effects');
    expect(optionOfCategory('work')).toBe('effects');
  });

  it('reads saved options, keeps valid values and falls back on bad ones', () => {
    const got = parseAudioOptions(JSON.stringify({ volumes: { master: 40, music: 'loud', voices: 130 }, musicFrequency: 'occasional', mono: true, spatialIntensity: 'huge' }));
    expect(got.volumes.master).toBe(40);
    expect(got.volumes.music).toBe(DEFAULT_AUDIO_OPTIONS.volumes.music);
    expect(got.volumes.voices).toBe(100);
    expect(got.musicFrequency).toBe('occasional');
    expect(got.mono).toBe(true);
    expect(got.spatialIntensity).toBe('normal');
  });

  it('never throws on damaged input and returns the defaults', () => {
    expect(parseAudioOptions('{not json').volumes).toEqual(DEFAULT_AUDIO_OPTIONS.volumes);
    expect(parseAudioOptions(null).haptics).toBe(true);
    expect(parseAudioOptions([1, 2]).musicFrequency).toBe('often');
  });

  it('scales pan for the spatial intensity option', () => {
    expect(spatialScale('low')).toBeLessThan(spatialScale('normal'));
    expect(spatialScale('high')).toBeGreaterThan(spatialScale('normal'));
  });
});
