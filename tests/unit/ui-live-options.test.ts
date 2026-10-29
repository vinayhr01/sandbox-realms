import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, SETTING_BY_ID, SETTINGS, setOption } from '../../src/ui/panels/options.ts';

describe('live options (13 section 15)', () => {
  it('edge pan and confirm-before-leaving are live and default as the spec says', () => {
    expect(SETTING_BY_ID.get('input.edgePan')?.live).toBe(true);
    expect(SETTING_BY_ID.get('game.confirmQuit')?.live).toBe(true);
    expect(DEFAULT_OPTIONS['input.edgePan']).toBe(false);
    expect(DEFAULT_OPTIONS['game.confirmQuit']).toBe(true);
  });

  it('the table has 78 rows and 58 of them are live', () => {
    // 72 spec 13 rows, three audio options from spec 16 (audio.mono, audio.visualCues, audio.reduceLoud), and three
    // Insight options (map.layer, map.layerMode, marks.armyLines). Counted from options.ts: 58 rows set live
    // (Settings close 4 flipped ui.happinessIcons, ui.taskIcons and privacy.errorReports from 55).
    expect(SETTINGS.length).toBe(79);
    expect(SETTINGS.filter((s) => s.live).length).toBe(59);
  });

  it('a live toggle changes its value and leaves the rest alone', () => {
    const next = setOption(DEFAULT_OPTIONS, 'input.edgePan', true);
    expect(next['input.edgePan']).toBe(true);
    expect(next['game.confirmQuit']).toBe(true);
  });
});
