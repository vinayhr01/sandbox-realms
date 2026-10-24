# Spec coverage (rewritten against main at 0172ff0)

Source of truth: `../Spec/` (read-only, outside this repo). Milestone-to-spec mapping: `../Spec/ROADMAP.md`, with 18a to 18e assigned as in `../BUILD-PLAN.md`.

Status values (latest code wins; every claim re-checked by grep and file reads in this review):

- **DONE**: the spec's required behaviour is implemented, reachable from the running game (imported from `src/app/main.ts` or the sim worker chain), and covered by a test or check.
- **PARTIAL**: some of it is implemented, or it is implemented but not reachable from the running game, or only a subset of the spec's items exist.
- **MISSING**: no code for it.

"Reachable" matters here. Several modules have full unit tests but no caller outside tests. They are called out as UNWIRED in the reasons.

## Summary by milestone

Rows below are (milestone, spec file) pairs. A spec file can appear under more than one milestone, as ROADMAP splits it.

| Milestone | Rows | DONE | PARTIAL | MISSING | Exit test |
|---|---|---|---|---|---|
| M0 Shell, worker, protocol | 2 | 0 | 2 | 0 | Not checked on a device |
| M1 Terrain painter | 4 | 0 | 4 | 0 | 512x512 not offered; no hold-to-raise or undo |
| M2 Worldgen, clock, flora, water, fire | 4 | 0 | 4 | 0 | Templates generate; fire deterministic (tests exist) |
| M3 Beings | 6 | 0 | 6 | 0 | NOT MET (see Notes) |
| M4 Combat, statuses, weather | 2 | 0 | 2 | 0 | Scripted fight tests exist; statuses never applied in play |
| M5 Chronicle saves, panels | 3 | 0 | 3 | 0 | NOT MET: running game never writes or loads a save |
| M6 Hamlets and economy | 3 | 0 | 3 | 0 | NOT MET: no hamlet grows to a town |
| M7 Dominions | 1 | 0 | 1 | 0 | NOT MET: dominions inert in play |
| M8 Culture | 1 | 0 | 1 | 0 | NOT MET: culture inert in play |
| M9 Powers, rules, ages, calamities | 4 | 0 | 2 | 2 | Not met: favour and insight tabs empty |
| M10 Full UI | 3 | 0 | 2 | 1 | Not met: 12 of 62 window types |
| M11 Audio, achievements, stats | 3 | 0 | 2 | 1 | Not met: audio never plays |
| M12 Checks and hardening | 5 | 0 | 5 | 0 | Not met: no device, Lighthouse or chaos runs |
| Cross-cutting (00, 01, 02) | 3 | 1 | 1 | 0 | 00 is authoring rules (N/A) |

Totals: 41 milestone rows (37 PARTIAL, 4 MISSING) and 3 cross-cutting rows (1 DONE, 1 PARTIAL, 1 N/A). That is 38 PARTIAL, 4 MISSING, 1 DONE and 1 N/A across 44 rows. No milestone exit test is met.

## M0 Shell, worker, protocol

| Spec | Status | Reason | Source |
|---|---|---|---|
| 17 engine-runtime | PARTIAL | MessageChannel pump, fixed-step `planPump`, budget stop and seeded RNG exist. The worker never posts `Ev.Heartbeat`, there is no watchdog, no contentHash handshake, no degradation ladder. | `src/sim/worker.ts`, `src/sim/scheduler.ts`, `src/shared/protocol.ts`, `src/app/sim-client.ts` |
| 19 crash-reporting | PARTIAL | Global error handlers, unclean-exit sentinel, localStorage journal and fatal dialog are wired in `main.ts`. No IndexedDB record, consent, export or "not responding" dialog. | `src/app/recovery.ts`, `src/app/main.ts` |

## M1 Terrain painter

| Spec | Status | Reason | Source |
|---|---|---|---|
| 01 world-grid | PARTIAL | Grid side is 64 x sizeStep (192, 256, 320 offered). Typed-array realm, ground table and biome spread exist. No Patch/Parcel partitions, counters or connectivity scheduler. | `src/sim/realm.ts`, `src/shared/constants.ts`, `src/content/grounds.ts`, `src/sim/terrain/biome-spread.ts` |
| 04 terrain-fluids | PARTIAL | Water, magma, freeze, slime, heat and biome spread run in `Sim.step` and are tested. Blast hardness, charge chains and the connectivity layer are missing. | `src/sim/terrain/water.ts`, `src/sim/terrain/magma.ts`, `src/sim/terrain/fire.ts`, `src/sim/explosions.ts` |
| 12 powers (M1 slice) | PARTIAL | Raise, lower and ground paints run through `executePower`. Other catalogue powers are covered under M9. | `src/sim/powers/handlers.ts`, `src/content/powers.ts` |
| 13 ui-ux | PARTIAL | Pointer arbitration, pinch and wheel zoom, edge pan, window host and tutorial exist. Missing: hold-to-raise, undo (a second finger ends a stroke without undo), long-press, double-tap, the 512 px realm. | `src/ui/input.ts`, `src/ui/edgePan.ts`, `src/ui/windowHost.ts`, `src/app/main.ts` |

## M2 Worldgen, clock, flora, water, fire

| Spec | Status | Reason | Source |
|---|---|---|---|
| 02 clock-ages-calamities | PARTIAL | Clock, age rotation, cloud weather and the 16-entry calamity roll run in play. Speed set is 0.5 to 10 (spec x05 to x40). Frame clamp `MAX_CATCHUP_MS` is 250 ms, not the spec's 100 ms. `ticksForFrame` has no runtime caller. | `src/sim/ages.ts`, `src/sim/clock.ts`, `src/shared/constants.ts`, `src/sim/calamity.ts`, `src/sim/weather.ts` |
| 03 worldgen | PARTIAL | All 12 templates, Chessboard, Cells and Warren layouts, rivers, lakes, replace rules and starting beasts exist and are tested. No resumable jobs or progress events. | `src/sim/worldgen.ts`, `src/sim/worldgen/layouts.ts`, `src/sim/worldgen/water.ts`, `src/sim/worldgen/replace.ts` |
| 04 terrain-fluids (M2 slice) | PARTIAL | Fire spread, burnout, scars, sea refill and rain run in play. Connectivity scheduler and acceptance tests 6 and 7 missing. | `src/sim/terrain/fire.ts`, `src/sim/terrain/water.ts` |
| 18d flora-resources | PARTIAL | 14 flora entries (10 vegetation, 4 minerals) in `FLORA`. Most of the 18d registry (bushes, crops, manure, remains, browsers) is missing. | `src/sim/flora.ts`, `tests/unit/terrain-flora.test.ts` |

## M3 Beings and ecosystem

| Spec | Status | Reason | Source |
|---|---|---|---|
| 05 lineage-genes-stats | PARTIAL | Stat assembly, baby halving and 40-tile strain join run in play. No lineage code (05 section 5), mutateFrom, phenotypes or per-strain counters. | `src/sim/beings/assembly.ts`, `src/sim/beings/strains.ts` |
| 06 needs-aging-reproduction | PARTIAL | Fuel, starvation, ageing death, mating, gestation, litters and the parent-slot cap run. No mood, sleep, bonds, corpses or conversions. | `src/sim/beings/system.ts`, `src/sim/beings/store.ts`, `tests/unit/beings.test.ts` |
| 07 behaviour-ai | PARTIAL | A beast core runs (flee, hunt, graze, mate, wander). No weighted decision system, 70-task catalogue, perception, factions, aggro or possession. | `src/sim/beings/system.ts` |
| 18 roster-content | PARTIAL | 90 SPECIES rows load (84 beasts, 6 Folk). Folk never spawn: `spawnFolk` has no caller and `spawnBeing` refuses non-wild rows. | `src/content/beasts.ts`, `src/content/species-roster.ts`, `src/content/species-folk.ts`, `src/sim/beings/system.ts` |
| 18a folk-and-beasts | PARTIAL | Rows load and stat fields match the roster (`tests/unit/beast-roster.test.ts`). Procedural variants, morphs, castes and skins absent. | `src/content/species-roster.ts`, `tests/unit/lineage-folk.test.ts` |
| 18b traits | PARTIAL | 144 being and 154 strain traits load and are tested. Only stat and meta effects reach the sim; behaviour hooks do not. | `src/content/traits.ts`, `src/sim/beings/assembly.ts` |

## M4 Combat, statuses, weather

| Spec | Status | Reason | Source |
|---|---|---|---|
| 08 combat-status-items | PARTIAL | Plating, the 6-tick hit window, projectile landing and blasts with falloff are tested. 24 status definitions (spec roster 56); no status is applied in play (no runtime caller of the apply path). `meleeSwing` has no caller; 0 of 16 projectile kinds exist. Beast bites subtract vitality directly, bypassing `applyDamage`. Items, afflictions and spells absent. | `src/sim/effects.ts`, `src/sim/combat.ts`, `src/sim/explosions.ts`, `src/sim/beings/system.ts`, `tests/unit/combat.test.ts` |
| 12 powers (M4 slice) | PARTIAL | `bomb` and `bolt` run as one generic blast. The 12 bomb profiles are absent. | `src/sim/powers/handlers.ts` |

## M5 Chronicle saves, inspector, tooltips

| Spec | Status | Reason | Source |
|---|---|---|---|
| 15 chronicle-saves | PARTIAL | `encodeChronicle` and `decodeChronicle` are versioned and round-trip tested, but have no caller outside tests. The running game never writes or loads a save. No autosave, slot UI, import or export. | `src/sim/chronicle.ts`, `src/app/saves.ts`, `tests/unit/chronicle.test.ts`, `tests/unit/saves-service.test.ts` |
| 13 ui-ux (M5 slice) | PARTIAL | Tile inspect event exists (`tile-inspected`). No world tooltips, nameplates or inspector panel for beings. | `src/app/main.ts`, `src/ui/hud.ts` |
| 19 crash-reporting (M5 slice) | PARTIAL | `decideRecovery`, `restoreOffers`, `isBootLoop` and Safe Mode are tested but UNWIRED: no caller outside tests. No recovery actions in the fatal dialog. | `src/app/recovery.ts`, `tests/unit/recovery-ladder.test.ts` |

## M6 Hamlets and economy

| Spec | Status | Reason | Source |
|---|---|---|---|
| 09 settlements-economy | PARTIAL | Hamlets are created at worldgen and grow once per sim-second. 6 of 60 buildings. No jobs, trade, mood or roads. The hamlet "folk" count is a census of every being in its parcels, beasts included. | `src/sim/settlements/hamlet.ts`, `src/sim/settlements/adapter.ts`, `src/sim/settlements/catalogue.ts` |
| 18c world-buildings-effects | PARTIAL | 33 grounds and 24 biomes as data. 24 of 56 statuses, 6 of 60 buildings. | `src/content/grounds.ts`, `src/content/biomes.ts`, `src/sim/effects.ts` |
| 18e structures-landmarks-creeps | PARTIAL | Three creep hubs (pulse, decay, cap 12) and volcano and geyser landmarks run. Beacons, six landmark structures and the extended buildings missing. | `src/content/creeps.ts`, `src/sim/terrain/creep.ts`, `src/sim/terrain/eruption.ts` |

## M7 Dominions

| Spec | Status | Reason | Source |
|---|---|---|---|
| 10 dominions-wars-pacts | PARTIAL | Campaigns (strength exchange) and parcel seizure run through `stepDominions`. `addDominion` has no caller outside tests, so no dominion exists in play and the step returns early. No rulers, tax, armies, boats or pacts. | `src/sim/dominions/step.ts`, `src/sim/dominions/adapter.ts`, `src/sim/dominions/types.ts` |

## M8 Customs, creeds, dialects, intrigues

| Spec | Status | Reason | Source |
|---|---|---|---|
| 11 intrigue-customs-creeds | PARTIAL | `cultureTick` runs each sim-second, but `addCustom`, `startIntrigue` and `addFamily` have no caller outside tests, so nothing is created in play. No name generator, families or banners. | `src/sim/culture/culture.ts`, `src/sim/culture/adapter.ts`, `src/sim/sim.ts` |

## M9 Powers, rules, ages, calamities

| Spec | Status | Reason | Source |
|---|---|---|---|
| 12 powers-catalogue | PARTIAL | 138 entries in `POWERS`; 136 enabled in the UI by `powerStatus`; 122 dispatch to real sim code. Spec catalogue is about 322 entries. Shape 11 of 51, Grow 6 of 47, Beings 75 of 90 spawners (Folk and sea spawners absent), Havoc 18 entries. | `src/content/powers.ts`, `src/ui/powerSupport.ts`, `src/sim/powers/handlers.ts`, `src/sim/powers/terrain-powers.ts` |
| 12 s8.7 Favour | MISSING | 0 of 28. `favour_bless` is a disabled placeholder (its handler is not in `SIM_HANDLERS`). | `src/content/powers.ts`, `src/ui/powerSupport.ts` |
| 12 s8.8 Insight | MISSING | 0 of about 40. `insight_lore` is disabled; no `ins_*` entries. | `src/content/powers.ts` |
| 02 ages-calamities (M9 slice) | PARTIAL | 16 calamities rolled every 80 ticks and run. Beings calamities spawn random species. `maxLive` is never enforced. About 18 of 49 rule ids have no reader (grep audit; not individually re-counted). Weeping rain and Discord conversion absent. | `src/sim/calamity.ts`, `src/sim/powers/handlers.ts`, `src/sim/rules.ts`, `src/sim/ages.ts`, `src/sim/sim.ts` |

## M10 Full UI, lists, overlays, options, tutorial

| Spec | Status | Reason | Source |
|---|---|---|---|
| 13 ui-ux (M10 slice) | PARTIAL | `WINDOW_CATALOG` has 12 entries (11 spec ids plus the power catalogue) of 62 window types. Virtual list (`listView`) is used by the Chronicle and other lists. No minimap, layers, nameplates, world tooltips, i18n locales, or colour-blind palette beyond the setting. Tutorial has 4 steps (spec 14). | `src/ui/windowCatalog.ts`, `src/ui/windowContent.ts`, `src/ui/listView.ts`, `src/ui/panels/tutorial.ts` |
| 14 progression-options (options) | PARTIAL | 72 settings in `SETTINGS` and shown in win_settings; roughly 44 change behaviour, the rest say "not active yet". Saved to localStorage, not IndexedDB. Telemetry switches only, no DNT or GPC handling. | `src/ui/panels/options.ts`, `src/ui/windowContent.ts`, `src/app/main.ts` |
| 14 progression-options (dev console) | MISSING | No dev console or dev tools window, no command parser, no DebugFlags. `dev.enabled` is stored but never read. Only the `window.__sr` test hook exists. | `src/ui/panels/options.ts`, `src/app/main.ts` |

## M11 Audio, achievements, stats, art

| Spec | Status | Reason | Source |
|---|---|---|---|
| 14 progression-options (achievements, stats) | PARTIAL | 63 achievement definitions. `unlockAchievements` runs each sim-second and the unlocked set is saved in the Chronicle. No unlock popup, no cross-Realm progress, no lifetime-stats window; the trophies window shows no unlock state. `src/sim/progression.ts` (taint and credit rules) has no caller outside tests. | `src/content/achievements.ts`, `src/sim/stats.ts`, `src/sim/stats-hooks.ts`, `src/sim/progression.ts` |
| 16 art-direction-audio (audio) | PARTIAL | `AudioEngine` (WebAudio), synth, mix and 56 sound recipes exist, but nothing imports `engine.ts` outside tests. `main.ts` only calls `setVolume` and `setHidden` on `AudioModel`. No music, no first-tap unlock. | `src/audio/engine.ts`, `src/audio/model.ts`, `src/audio/sounds.ts`, `src/audio/synth.ts`, `src/app/main.ts` |
| 16 art-direction-audio (art) | MISSING | No being, structure or effect sprites, atlases or palette recolour. The renderer draws terrain only. | `src/render/terrain.ts`, `src/render/terrain-shader.ts` |

## M12 Checks and hardening

| Spec | Status | Reason | Source |
|---|---|---|---|
| 17 engine-runtime (M12 slice) | PARTIAL | Build budgets run in CI (`check:budgets`, main 350 KB and worker 250 KB gzip limits). Determinism lint bans only `Math.random`, `Date` and `performance.now`; the sim still calls `Math.exp`, `Math.pow` and `Math.hypot` (`src/sim/beings/system.ts`, `src/sim/explosions.ts`). No benchmark scenes, no frame or tick perf gate in CI, no SAB mode. | `scripts/check-budgets.mjs`, `scripts/check-determinism.mjs`, `.github/workflows/ci.yml`, `tests/perf/budgets.ts` |
| 19 crash-reporting (release gate) | PARTIAL | No crash record, consent, send, restore prompt or chaos test. | `src/app/recovery.ts` |
| PLATFORM-REQUIREMENTS section 6 | PARTIAL | `playwright.config.ts` defines 10 projects. CI runs chromium (desktop, phone portrait, 360x640, 1920x1080) plus firefox and webkit at 360x640 and 1920x1080 (not run here). Tablet and phone-landscape projects never run in CI. No Lighthouse, screenshot diffs or COOP/COEP. | `playwright.config.ts`, `.github/workflows/ci.yml`, `tests/e2e/platform-smoke.spec.ts` |
| PERFORMANCE-PLAN | PARTIAL | Bundle budgets gate CI. No benchmark scenes, no frame-rate gate, `tests/perf/budgets.ts` holds constants only. `npm run bench` is not in CI. No quality ladder. | `scripts/check-budgets.mjs`, `tests/perf/budgets.ts`, `.github/workflows/ci.yml` |
| LEGAL-CHECKLIST | PARTIAL | Analytics off by default and no analytics SDK found. No `ASSET-LICENSES.md`, no QA log, no credits window, no legal or look-and-feel review. | `../Spec/LEGAL-CHECKLIST.md`, `src/ui/windowContent.ts` |

## Cross-cutting

| Spec | Status | Reason | Source |
|---|---|---|---|
| 00 README-RULES | N/A | Authoring conventions; nothing to build. | `../Spec/00-README-RULES.md` |
| 01 GLOSSARY-NAMES | DONE | Realm, Chronicle, Realm Rules, Being, Folk and related names are used in UI and code. No automated name lint. | `src/ui/windowContent.ts`, `src/ui/windowCatalog.ts` |
| 02 TECH-STACK | PARTIAL | TypeScript strict, Vite, PixiJS, module worker, IndexedDB saves code, Vitest and Playwright present. No SharedArrayBuffer mode, no COOP/COEP headers; export is binary with an FNV checksum, not gzip. | `vite.config.ts`, `src/app/saves.ts`, `src/sim/chronicle.ts` |

## Key counts (measured)

| Item | Count | Spec reference |
|---|---|---|
| Species (`SPECIES`) | 90 (84 beasts, 6 Folk) | 18a |
| Being traits / strain traits | 144 / 154 | 18b |
| Powers (`POWERS`) | 138 (136 enabled in UI) | 12, about 322 |
| Status effects (`STATUSES`) | 24 | 08, 56 |
| Calamities | 16 | 02 section 8 |
| Realm rules (`RULES`) | 49 | 02 |
| Ages (`AGES`) | 11 | 02 |
| Grounds / biomes | 33 / 24 | 01, 18c |
| Flora entries (`FLORA`) | 14 | 18d |
| Achievements | 63 | 14 (63) |
| Settings (`SETTINGS`) | 72 | 14 (about 65 in the older count) |
| Window catalogue | 12 of 62 | 13 section 7.1 |
| Buildings | 6 of 60 | 09 |
| Creep hubs | 3 | 18e |

## Notes

- **M3 exit test (1,000 beasts stable for 10 sim-years) is not met.** `DECISIONS.md` records 7 or 8 species alive of 8 on the tuned and unseen seeds, which was measured before the roster grew to 90 species. The current roster has not been re-soaked for this review (`npm run soak` was not run). Treat the old numbers as stale; the 300 to 3000 total-population criterion is the one the project chose.
- **M5, M7 and M8 exit tests are not met in play.** Save, dominion and culture code runs in unit tests; the running game never calls their entry points (see the UNWIRED notes above).
- **Old statements corrected here:** the worker never posts a heartbeat (confirmed); `check:budgets` is in CI (the old release checklist said it was not); 136 of 138 powers are enabled in the UI (the old text said only raise and lower).
- Spec files were not edited. The build plan is the parent folder's `BUILD-PLAN.md` (not in the Spec folder).
- No browser, soak or device run was done for this rewrite. Results come from grep, file reads and two Node scripts that count exports.
