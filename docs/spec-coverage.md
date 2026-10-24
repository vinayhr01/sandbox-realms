# Spec coverage review

Checked against `game/Spec/` (read-only source of truth) and the code at the time of this review. Status values:
DONE (works in the running game and has tests), PARTIAL (some of it works), MISSING (no code), UNWIRED (code exists but nothing in the running game calls it).

The review was static reading of the code and test titles. No new browser or soak runs were done for it; the test results recorded in `DECISIONS.md` are from the last full run.

## Summary by milestone

| Milestone | Status | Main gaps |
|---|---|---|
| M0 Shell, worker, protocol | Mostly DONE | Heartbeat never posted; no watchdog; no degradation ladder; no error isolation in the worker pump |
| M1 Terrain painter | PARTIAL | 512 px realm not offered in the UI (192, 256, 320 only); no hold-to-raise; no undo; full-texture upload per change; long-press and hover missing |
| M2 Worldgen, clock, flora, water, fire | PARTIAL | Rivers, lakes, replace rules, Chessboard/Cells/Warren layouts missing; Sleeping Crater has no volcano; biome spread rate 1.5% (spec 5%) |
| M3 Beings and ecosystem | PARTIAL, exit test not met | 8 species, not the spec roster; no traits, genes or lineage; ecosystem unstable |
| M4 Combat, statuses, weather | PARTIAL | 24 of 56 statuses; blasts lack hardness and chains; heat sources missing |
| M5 Chronicle saves | DONE for the sim state | No autosave, slots, import or export UI; IndexedDB not used |
| M6 Settlements | PARTIAL, wired | 6 buildings; no jobs, trade, or beings query |
| M7 Dominions | PARTIAL, wired | Tension has no effect; no recruitment, boats, or borders |
| M8 Culture | PARTIAL, wired | Tuning values are placeholders |
| M9 Powers and calamities | PARTIAL | 64 powers (spec about 300); most have no UI path; calamity hamlet gate fixed in the latest round |
| M10 UI | PARTIAL | Options: 2 of 65 settings; windows: 0 of 62; virtual list and tutorial not wired to the DOM |
| M11 Audio, stats, achievements | PARTIAL | Audio model not connected to WebAudio; 24 of 63 achievements |
| M12 Checks | PARTIAL | Only Chromium; no device runs; no legal review; no Lighthouse run |

## Milestones 0 to 2 and platform (detail)

- DONE: sim in the worker with the 8 ms budget and edits while paused (`src/sim/worker.ts`); determinism lint and golden replay (`tests/unit/golden.test.ts`); crash journal and fatal dialog (`src/app/recovery.ts`); shell with 44 px targets, safe areas, dvh and reduced motion (`src/ui/styles.css`); hidden tab pauses the sim (`src/app/main.ts`); calendar and catch-up clamp (`src/sim/clock.ts`).
- PARTIAL: protocol per spec 17 (contentHash and quality fields unused, heartbeat never sent); pinch, pan and wheel zoom (only wheel is browser-tested); brushes (no spray shape; raise is uncapped); layout classes use 900 px and landscape breakpoints only.
- MISSING: 512x512 realm in the UI; hold-to-raise; dirty-rect upload (the whole 576x576 texture is re-uploaded); undo; long-press and double-tap; hover tips; watchdog; degradation ladder; quality tiers; error isolation (one pump exception ends the loop); Firefox and WebKit; screenshot diffs; Lighthouse; hierarchical pathfinding; benchmark-scene perf gate.
- UNWIRED: audio model, tutorial, virtual list (no importers outside their tests); `ticksForFrame` (no caller).
- Build budget: `scripts/check-budgets.mjs` is not in `ci.yml`. The script allows 350 KB; PERFORMANCE-PLAN says 250 KB for the core.

## Milestones 3 to 5 (detail)

Counts over 55 checked items: DONE 15, PARTIAL 16, MISSING 17, UNWIRED 7.

- DONE: age rotation, Veiled and durations (`src/sim/ages.ts`); cloud weights, drops and lightning (`src/sim/weather.ts`); worldgen determinism, edge ring and round edges; hollows, sea refill and rain fill (`src/sim/terrain/water.ts`); freeze, thaw and shoal spread; magma flow and cooling; fire spread and burnout; rule defaults and parley-off.
- PARTIAL: biome spread (1.5% per attempt, spec 5%); scar stage (5 to 15, spec 6 to 15); blast falloff uses radius+1, no hardness or chains; flora spread ignores tree, plant and fungus spread rules; starting beasts lack the region gate, 300 cap and spacing rule; calamity roll (hamlet gate fixed; live effects still need a test).
- MISSING: patch and parcel partitions; frozen display (`effectiveKind`); night ramp, age biome boosts, chaos and magic flags; behaviours fieldDecay, pathDecay, mineralSeeding, beastSpawning, vermin, creepDecay, shoreErosion; rivers, lakes and replace rules; volcano, geyser, quakes, meteors, acid, slime, creep and minerals.
- UNWIRED: connectivity regions and their scheduler (run at generation only); age speed multiplier (set but never changed by the sim); heat sources (none exist; decay is 2 per tick, spec says 1 per 20 ticks); terraform and tool catalogue handlers (the UI sends only stroke); 28 of 49 rule ids have no consumer.
- Ecosystem: the M3 exit test (all 8 species alive for 10 years on 3 seeds) is not met: 7, 8 and 7 species alive on the three soak seeds with current defaults. Sweeps did not meet it (see `DECISIONS.md`).
- Beast stats now match the 18a roster for the 8 species the sim uses (test: `tests/unit/beast-roster.test.ts`). The sim still has 8 species, not the roster's full set; no traits or lineage.
- Litter follows 06 section 6.4 (brood = litter value). The 06 section 6.1 cap on living children is not built (no parent links).
- Speed follows 07 section 7.1 (pace * 0.2 / 20 per tick). Terrain `tileMult` is not applied.

## Milestones 6 to 12 (headline findings)

These come from the M6-9 and M10-12 audits. The per-item detail was not recorded in this file; re-run the audit for line references.

- M6-M8: wired into the sim (settlements once per sim-second, dominions and culture from `Sim.step`). Missing: jobs, trade, tension effects, recruitment, borders, and the spec's full custom and intrigue catalogue.
- M9: 64 powers (spec about 300). Only raise and lower are reachable from the UI; the others arm and do nothing. Calamity effects run from the 80-tick roll.
- M10: options 2 of 65 settings; windows 0 of 62; the power bar is wired.
- M11: achievements 24 of 63; the stats events feed them. Audio is not connected.
- M12: no device, Firefox, WebKit, legal, or Lighthouse runs.

## Open items

- M3 exit test (all 8 species alive on 3 seeds for 10 years): not met.
- Terrain `tileMult` not applied to movement.
- Litter cap (06 section 6.1) needs parent links.
- The counts above were re-checked against the code on this review; re-count after each change.
