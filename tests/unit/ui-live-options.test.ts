import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, SETTING_BY_ID, SETTINGS, setOption } from '../../src/ui/panels/options.ts';

describe('live options (13 section 15)', () => {
  it('edge pan and confirm-before-leaving are live and default as the spec says', () => {
    expect(SETTING_BY_ID.get('input.edgePan')?.live).toBe(true);
    expect(SETTING_BY_ID.get('game.confirmQuit')?.live).toBe(true);
    expect(DEFAULT_OPTIONS['input.edgePan']).toBe(false);
    expect(DEFAULT_OPTIONS['game.confirmQuit']).toBe(true);
  });

  it('the table still has 72 rows and the live count is recorded', () => {
    // 72 spec 13 rows plus three audio options from spec 16 (audio.mono, audio.visualCues, audio.reduceLoud).
    expect(SETTINGS.length).toBe(75);
    expect(SETTINGS.filter((s) => s.live).length).toBeGreaterThanOrEqual(22);
  });

  it('a live toggle changes its value and leaves the rest alone', () => {
    const next = setOption(DEFAULT_OPTIONS, 'input.edgePan', true);
    expect(next['input.edgePan']).toBe(true);
    expect(next['game.confirmQuit']).toBe(true);
  });
});
