# Spec coverage (rewritten against main at 304419a)

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
| M4 Combat, statuses, weather | 2 | 0 | 2 | 0 | Scripted fight tests exist; one status (warded) applied in play; no projectile launched in play |
| M5 Chronicle saves, panels | 3 | 0 | 3 | 0 | Saves and recovery run in play; no recorded browser run of the IndexedDB path |
| M6 Hamlets and economy | 3 | 0 | 3 | 0 | NOT MET: no hamlet grows to a town (no town tier on main) |
| M7 Dominions | 1 | 0 | 1 | 0 | UNVERIFIED: dominions can now be founded in play; no run measured the exit test |
| M8 Culture | 2 | 0 | 2 | 0 | NOT MET: culture inert in play (clans do run, see row 11) |
| M9 Powers, rules, ages, calamities | 4 | 0 | 4 | 0 | Not met: Favour and Insight have one power each (Bless, Lore) |
| M10 Full UI | 3 | 0 | 3 | 0 | Not met: 62 of 62 spec window rows built; minimap built; nameplates (hamlet names only) and world tooltips missing |
| M11 Audio, achievements, stats | 3 | 0 | 2 | 1 | Not met: audio starts on the first gesture; not checked on a device |
| M12 Checks and hardening | 5 | 0 | 5 | 0 | Not met: no device, Lighthouse or chaos runs |
| Cross-cutting (00, 01, 02) | 3 | 1 | 1 | 0 | 00 is authoring rules (N/A) |

Totals: 42 milestone rows (41 PARTIAL, 1 MISSING) and 3 cross-cutting rows (1 DONE, 1 PARTIAL, 1 N/A). That is 42 PARTIAL, 1 MISSING, 1 DONE and 1 N/A across 45 rows. No milestone exit test is confirmed met in this pass.

## M0 Shell, worker, protocol

| Spec | Status | Reason | Source |
|---|---|---|---|
| 17 engine-runtime | PARTIAL | MessageChannel pump with fixed-step `planPump` (catch-up clamp and per-speed tick cap), a frame budget that drops ticks over 8 ms, seeded RNG, and pump-fault containment (`pumpFaultAction`: fatal after 3 faults in a row). Frame stats carry `stateHash` every `HASH_EVERY_TICKS`. No `Ev.Heartbeat` (the `Ev` enum has none), no watchdog, no contentHash handshake, no degradation ladder (`degradeLevel` is fixed at 0 in `main.ts`; autosave skips at level 3 or worse but the level never rises). | `src/sim/worker.ts`, `src/sim/scheduler.ts`, `src/shared/protocol.ts`, `src/app/sim-client.ts`, `src/app/main.ts`, `src/app/saves.ts` |
| 19 crash-reporting | PARTIAL | Global error handlers, unclean-exit sentinel, localStorage journal and fatal dialog are wired in `main.ts`. No IndexedDB record, consent, export or "not responding" dialog. | `src/app/recovery.ts`, `src/app/main.ts` |

## M1 Terrain painter

| Spec | Status | Reason | Source |
|---|---|---|---|
| 01 world-grid | PARTIAL | Grid side is 64 x sizeStep (192, 256, 320 offered in `index.html`). Typed-array realm, ground table and biome spread exist. Parcels of 8 tiles (`PARCEL` in `constants.ts`) index hamlets and dominions. No Patch partitions, counters or connectivity scheduler. | `src/sim/realm.ts`, `src/shared/constants.ts`, `src/content/grounds.ts`, `src/sim/terrain/biome-spread.ts`, `index.html` |
| 04 terrain-fluids | PARTIAL | Water, magma, freeze, slime, heat and biome spread run in `Sim.step` and are tested. Blast hardness, charge chains and the connectivity layer are missing. | `src/sim/terrain/water.ts`, `src/sim/terrain/magma.ts`, `src/sim/terrain/fire.ts`, `src/sim/explosions.ts` |
| 12 powers (M1 slice) | PARTIAL | Raise, lower and ground paints run through `executePower`. Other catalogue powers are covered under M9. | `src/sim/powers/handlers.ts`, `src/content/powers.ts` |
| 13 ui-ux | PARTIAL | Pointer arbitration, pinch and wheel zoom, edge pan, window host and tutorial exist. Missing: hold-to-raise, undo (a second finger ends a stroke without undo), long-press, double-tap, the 512 px realm (not offered). | `src/ui/input.ts`, `src/ui/edgePan.ts`, `src/ui/windowHost.ts`, `src/app/main.ts` |

## M2 Worldgen, clock, flora, water, fire

| Spec | Status | Reason | Source |
|---|---|---|---|
| 02 clock-ages-calamities | PARTIAL | Clock, age rotation, cloud weather and the 16-entry calamity roll run in play (the roll fires every 80 sim-seconds). Speed set is 0.5 to 10 (spec x05 to x40). Frame clamp `MAX_CATCHUP_MS` is 250 ms, not the spec's 100 ms (spec value UNVERIFIED in this pass). The clamp is applied in `planPump`, which the worker pump calls; the older `ticksForFrame` name no longer exists. | `src/sim/ages.ts`, `src/sim/clock.ts`, `src/shared/constants.ts`, `src/sim/scheduler.ts`, `src/sim/worker.ts`, `src/sim/calamity.ts`, `src/sim/weather.ts` |
| 03 worldgen | PARTIAL | All 12 templates, Chessboard, Cells and Warren layouts, rivers, lakes, replace rules and starting beasts exist and are tested. No resumable jobs or progress events (grep: none). | `src/sim/worldgen.ts`, `src/sim/worldgen/layouts.ts`, `src/sim/worldgen/water.ts`, `src/sim/worldgen/replace.ts` |
| 04 terrain-fluids (M2 slice) | PARTIAL | Fire spread, burnout, scars, sea refill and rain run in play. Connectivity scheduler and acceptance tests 6 and 7 missing. | `src/sim/terrain/fire.ts`, `src/sim/terrain/water.ts` |
| 18d flora-resources | PARTIAL | 14 flora entries (10 vegetation, 4 minerals) in `FLORA`. Most of the 18d registry (bushes, crops, manure, remains, browsers) is missing. | `src/sim/flora.ts`, `tests/unit/terrain-flora.test.ts` |

## M3 Beings and ecosystem

| Spec | Status | Reason | Source |
|---|---|---|---|
| 05 lineage-genes-stats | PARTIAL | Stat assembly, baby halving and 40-tile strain join run in play. No lineage codes (`strains.ts` says they are not built), no mutateFrom, phenotypes or per-strain counters. | `src/sim/beings/assembly.ts`, `src/sim/beings/strains.ts` |
| 06 needs-aging-reproduction | PARTIAL | Fuel, starvation, ageing death, mating, gestation, litters and the parent-slot cap run. No mood, sleep, bonds, corpses or conversions (grep: none in `src/sim`). | `src/sim/beings/system.ts`, `src/sim/beings/store.ts`, `tests/unit/beings.test.ts` |
| 07 behaviour-ai | PARTIAL | A beast core runs (flee, hunt, graze, mate, wander) as one decision per being. No weighted decision system, no task catalogue (grep: none), no perception, factions, aggro or possession. | `src/sim/beings/system.ts` |
| 18 roster-content | PARTIAL | 90 SPECIES rows load (84 beasts, 6 Folk). Each species has a spawner power (`spawn_beast_<id>` or `spawn_folk_<id>`, `content/powers.ts`) that goes through `spawn_being` (`powers/handlers.ts`) to `spawnFolk` for Folk or `spawnBeing` for wild rows. `spawnBeing` still refuses non-wild rows. Aquatic and Architect-bound rows have no land behaviour (comment in `beings/system.ts`). Folk also found hamlets (MIN_BAND path, see row 09). | `src/content/beasts.ts`, `src/content/species-roster.ts`, `src/content/species-folk.ts`, `src/content/powers.ts`, `src/sim/powers/handlers.ts`, `src/sim/beings/system.ts` |
| 18a folk-and-beasts | PARTIAL | Rows load and stat fields match the roster (`tests/unit/beast-roster.test.ts`). Folk founders are placed by `spawnFolk` with the lineage's starting traits. Procedural variants, morphs and castes absent (grep: none); skin exists only as a trait (`skin_patches`). | `src/content/species-roster.ts`, `src/content/species-folk.ts`, `src/sim/beings/system.ts`, `tests/unit/lineage-folk.test.ts` |
| 18b traits | PARTIAL | 144 being and 154 strain traits load and are tested. Only stat and meta effects reach the sim; behaviour hooks do not. | `src/content/traits.ts`, `src/sim/beings/assembly.ts` |

## M4 Combat, statuses, weather

| Spec | Status | Reason | Source |
|---|---|---|---|
| 08 combat-status-items | PARTIAL | Plating, the 6-tick hit window and blasts with falloff are tested. 24 status definitions (spec roster 56). One status is applied in play: `warded`, by Bless (`rites.ts` calls `sim.effects.add`); the other 23 have no apply call. `meleeSwing` has no caller. `stepProjectiles` runs each tick (`sim.ts`), but nothing launches a projectile in play (the list is filled only by Chronicle restore) and no projectile kind table exists (spec lists 16). Beast bites subtract vitality directly, bypassing `applyDamage`. Items are built and reachable: item kinds with rolled mods, equip and unequip (`Cmd.SetGear`), wear on weapon hits (`wear.ts`), item rain (`Cmd.ItemRain`), and hamlet fetch, craft and repair (`hamlet-gear.ts`), all wired to the specWindows UI. Afflictions and spells absent. | `src/sim/effects.ts`, `src/sim/combat.ts`, `src/sim/explosions.ts`, `src/sim/beings/system.ts`, `src/sim/powers/rites.ts`, `src/sim/items/`, `src/content/items.ts`, `src/ui/specWindows.ts`, `tests/unit/combat.test.ts` |
| 12 powers (M4 slice) | PARTIAL | `bomb` and `bolt` run as one generic blast (`blastAt`). The 12 bomb profiles are absent. | `src/sim/powers/handlers.ts` |

## M5 Chronicle saves, inspector, tooltips

| Spec | Status | Reason | Source |
|---|---|---|---|
| 15 chronicle-saves | PARTIAL | `encodeChronicle` and `decodeChronicle` are versioned and round-trip tested, and the sim worker runs them on capture and restore commands. Save, load, delete, export, import and autosave run in the game through `SaveController` and `SaveService` (IndexedDB, memory fallback). No recorded browser run of the IndexedDB backend; no checksum quarantine (`saves.ts` header says so); no thumbnails; the Chronicle window lists slots. | `src/sim/chronicle.ts`, `src/sim/worker.ts`, `src/app/save-controller.ts`, `src/app/saves.ts`, `src/app/main.ts`, `tests/unit/chronicle.test.ts`, `tests/unit/saves-service.test.ts` |
| 13 ui-ux (M5 slice) | PARTIAL | Tile inspect event exists (`tile-inspected`). A being inspector window (`win_being`) opens from the Beings list and the specWindows inspector links. No world tooltips and no nameplates on beings (see M10). | `src/app/main.ts`, `src/ui/hud.ts`, `src/ui/specWindows.ts`, `src/ui/windowContent.ts` |
| 19 crash-reporting (M5 slice) | PARTIAL | `decideRecovery` runs on a fault, `restoreOffers` feeds the restore prompt, `isBootLoop` drives the boot-loop dialog, and Safe Mode is set from the fatal dialog (`main.ts`). No crash record. No recorded browser run of the dialog actions. | `src/app/recovery.ts`, `src/app/main.ts`, `src/app/save-controller.ts`, `tests/unit/recovery-ladder.test.ts` |

## M6 Hamlets and economy

| Spec | Status | Reason | Source |
|---|---|---|---|
| 09 settlements-economy | PARTIAL | Hamlets are placed at worldgen and also founded where a Folk band gathers: two or more adults of one lineage within `BAND_RANGE` (20) on suitable ground, `MIN_BAND` 2 (`foundHamlets`). A hamlet grows once per sim-second; its folk count is a census of every being on its parcels, beasts included. 7 of 60 buildings (`BUILDINGS`, garrison included). Garrison build gate: 50 folk, 16 buildings, 20 parcels. Hamlet gold: a purse paid for buildings and gear work; each completed build adds `BUILDER_COINS` (6) to it (`hamlet.ts`). Garrison soldier and gear-capacity effects not built; no hall tier. No jobs, trade, mood, roads or town tier. | `src/sim/settlements/hamlet.ts`, `src/sim/settlements/adapter.ts`, `src/sim/settlements/catalogue.ts`, `src/sim/items/hamlet-gear.ts` |
| 18c world-buildings-effects | PARTIAL | 33 grounds and 24 biomes as data. 24 of 56 statuses, 7 of 60 buildings. | `src/content/grounds.ts`, `src/content/biomes.ts`, `src/sim/effects.ts`, `src/sim/settlements/catalogue.ts` |
| 18e structures-landmarks-creeps | PARTIAL | Three creep hubs (pulse, decay, cap 12) and volcano and geyser landmarks run. Beacons (grep: none), six landmark structures and the extended buildings missing. | `src/content/creeps.ts`, `src/sim/terrain/creep.ts`, `src/sim/terrain/eruption.ts` |

## M7 Dominions

| Spec | Status | Reason | Source |
|---|---|---|---|
| 10 dominions-wars-pacts | PARTIAL | Dominions are founded in play: `foundingYear` makes one for a hamlet holding `FOUND_FOLK` (30) folk when the `realm_expansion` rule is on (`founding.ts`, called from `dominionsYearly`). Campaigns (strength exchange), parcel seizure and truces run through `stepDominions` once per sim-second. Pacts are formed and dissolved yearly (`pactYear`, `pacts.ts`), armies are raised, captained and marched (`armies.ts`), and opinion gates pacts (`opinion.ts`). `addDominion` has no caller outside tests. Missing: tax, boats, rulers as entities (`supremeOf` is a stand-in), and the 'forced' pact kind (god tool, not built). Whether a hamlet reaches 30 folk in a normal run is UNVERIFIED (no run was done). | `src/sim/dominions/adapter.ts`, `src/sim/dominions/founding.ts`, `src/sim/dominions/step.ts`, `src/sim/dominions/pacts.ts`, `src/sim/dominions/armies.ts`, `src/sim/dominions/opinion.ts`, `src/sim/sim.ts` |

## M8 Customs, creeds, dialects, intrigues

| Spec | Status | Reason | Source |
|---|---|---|---|
| 11 intrigue-customs-creeds | PARTIAL | `cultureTick` runs each sim-second (`sim.ts`) and the intrigue progress code exists, but `addCustom`, `startIntrigue` and `addFamily` have no caller outside tests, so no custom, intrigue or family is created in play. No name generator, families or banners. | `src/sim/culture/culture.ts`, `src/sim/culture/adapter.ts`, `src/sim/sim.ts` |
| 11 clans (kinbands) | PARTIAL | A clan is the living members of one strain. A strain with 4 or more living members founds one clan, once; `clansStep` runs in `sim.step` each Month. The chief is the oldest living member. Extinct clans stay on record. Saved as optional chronicle tag 18; the Clans list and clan inspector read the snapshot. Founded from strains, not families (spec 11 families are not in play). Limit 50 is recorded, not enforced; no splits, merges, renown or chief decisions. | `src/sim/clans/clans.ts`, `src/ui/specWindows.ts`, `src/sim/sim.ts` |

## M9 Powers, rules, ages, calamities

| Spec | Status | Reason | Source |
|---|---|---|---|
| 12 powers-catalogue | PARTIAL | 154 entries in `POWERS` by static count of `content/powers.ts` (48 literal entries, 90 species spawners, 16 omens). Spec catalogue is about 322 entries. Shape 13 of 51 (raise, lower and 11 ground paints), Grow 11 of 47 (seed, 4 flora, 3 landmarks, 3 creep hubs), Beings 90 of 90 spawners (aquatic rows included; no land behaviour), Havoc 18 entries. Spec denominators carried from the previous pass. Enabled state (`powerStatus`) and handler dispatch were not re-measured in this pass (UNVERIFIED). | `src/content/powers.ts`, `src/ui/powerSupport.ts`, `src/sim/powers/handlers.ts`, `src/sim/powers/terrain-powers.ts` |
| 12 s8.7 Favour | PARTIAL | 1 of 28. Bless (`favour_bless`) is built and enabled: it gives `warded` to beings within radius 3 and needs the `rituals` rule. The other 27 spec entries are not built. | `src/content/powers.ts`, `src/sim/powers/rites.ts`, `src/ui/powerSupport.ts` |
| 12 s8.8 Insight | PARTIAL | 1 of about 40. Lore (`insight_lore`) is built and enabled: it records the species of beings within radius 4 in the codex. No Lore window. The other spec entries are not built. | `src/content/powers.ts`, `src/sim/powers/rites.ts`, `src/ui/powerSupport.ts` |
| 02 ages-calamities (M9 slice) | PARTIAL | 16 calamities rolled every 80 sim-seconds (`sim.ts` behaviour) and run. Beings calamities spawn random species. `maxLive` is checked in `calamityRoll`, but its only caller (`powers/handlers.ts`) passes `liveCount: () => 0`, so no cap binds. About 18 of 49 rule ids have no reader (grep audit from the previous pass; not re-counted). Weeping rain and Discord conversion absent (grep: no weather or conversion code for them; `weeping` and `discord` exist only as Ages and calamity tags). | `src/sim/calamity.ts`, `src/sim/powers/handlers.ts`, `src/sim/rules.ts`, `src/sim/ages.ts`, `src/sim/sim.ts` |

## M10 Full UI, lists, overlays, options, tutorial

| Spec | Status | Reason | Source |
|---|---|---|---|
| 13 ui-ux (M10 slice) | PARTIAL | `WINDOW_CATALOG` has 74 entries: 62 of 62 spec window rows built (the nine `win_customize_*` ids are one row), plus 4 extras (power catalogue, population, beings, culture). Virtual list (`listView`) is used by the Chronicle and other lists. Minimap built (`ui/minimap.ts`, mounted in `main.ts`, toggled by `ui.minimap`). Map layers: the mark layer (`render/marks.ts`: beings as dots, item, army, campaign, battle and pact-link marks, hamlet names) and display layers (vignette, layer opacity and brightness). Colour-blind filter is applied through the settings. Missing: world tooltips (`ui.worldTooltips` is declared, and no code outside `options.ts` reads it), nameplates on beings (names are drawn for hamlets only), and i18n locales (`lang` offers `auto` and `en` only). Tutorial has 4 steps (spec 14). | `src/ui/windowCatalog.ts`, `src/ui/windowContent.ts`, `src/ui/listView.ts`, `src/ui/minimap.ts`, `src/render/marks.ts`, `src/ui/panels/tutorial.ts`, `src/app/main.ts` |
| 14 progression-options (options) | PARTIAL | 75 settings in `SETTINGS` (72 spec 13 rows and 3 spec 16 audio rows, per the previous pass), shown in win_settings. 49 rows are flagged `live` (counted from `options.ts`; whether each flagged row changes behaviour was not re-checked). Saved to localStorage, not IndexedDB. Telemetry switches only, no DNT or GPC handling. | `src/ui/panels/options.ts`, `src/ui/windowContent.ts`, `src/app/main.ts` |
| 14 progression-options (dev console) | PARTIAL | Developer windows (`win_dev_console`, `win_dev_tools`) open only when `dev.enabled` is on (`devGate` in `systemWindows.ts`). The console accepts `help` and `clear` and reads the realm; it cannot change it. The flags window lists the dev settings. No DebugFlags and no realm-changing commands. The `window.__sr` test hook exists in `main.ts`. | `src/ui/systemWindows.ts`, `src/ui/panels/options.ts`, `src/app/main.ts` |

## M11 Audio, achievements, stats, art

| Spec | Status | Reason | Source |
|---|---|---|---|
| 14 progression-achievements-stats | PARTIAL | 63 achievement definitions. `unlockAchievements` runs each sim-second (`sim.ts`, `stats-hooks.ts`) and the unlocked set is saved in the Chronicle. The trophies window shows unlock state and progress (`snapshot-model.ts`). No unlock popup, no cross-Realm progress, no lifetime-stats window. `countsCredited`, `grantAllowed` and `achievementProgress` in `progression.ts` have no caller outside tests; `trophySummary`, `visibleText` and `codexProgress` are used. | `src/content/achievements.ts`, `src/sim/stats.ts`, `src/sim/stats-hooks.ts`, `src/sim/progression.ts`, `src/ui/snapshot-model.ts` |
| 16 art-direction-audio (audio) | PARTIAL | `AudioEngine` (WebAudio), synth, mix and 56 sound recipes exist. `main.ts` builds the engine, unlocks it on the first pointer, key or touch (never in Safe Mode), and starts a procedural music bed whose state follows pause and tab visibility. The audio README says night and the calamity flag are not fed yet (`feed.ts`). Not checked on a device. | `src/audio/engine.ts`, `src/audio/model.ts`, `src/audio/sounds.ts`, `src/audio/synth.ts`, `src/audio/feed.ts`, `src/app/main.ts` |
| 16 art-direction-audio (art) | MISSING | No being, structure or effect sprites, atlases or palette recolour. The renderer draws terrain and the mark layer (coloured dots and text labels, no sprites). | `src/render/terrain.ts`, `src/render/terrain-shader.ts`, `src/render/marks.ts` |

## M12 Checks and hardening

| Spec | Status | Reason | Source |
|---|---|---|---|
| 17 engine-runtime (M12 slice) | PARTIAL | Build budgets run in CI (`check:budgets`, main 350 KB and worker 250 KB gzip limits). Determinism lint bans `Math.random`, `Date.now`, `new Date(`, `performance.now` and `crypto.getRandomValues` in `src/sim`, `src/shared` and `src/content`; the sim still calls `Math.exp`, `Math.pow` and `Math.hypot` (`src/sim/beings/system.ts`, `src/sim/explosions.ts`, `src/sim/combat.ts`), which the lint does not ban. `npm run bench` (vitest tick-cost) is not in CI. No benchmark scenes, no frame or tick perf gate in CI, no SAB mode. | `scripts/check-budgets.mjs`, `scripts/check-determinism.mjs`, `.github/workflows/ci.yml`, `package.json` |
| 19 crash-reporting (release gate) | PARTIAL | No crash record, consent, send, restore prompt or chaos test. | `src/app/recovery.ts` |
| PLATFORM-REQUIREMENTS section 6 | PARTIAL | `playwright.config.ts` defines 10 projects. CI runs chromium (desktop, phone portrait, 360x640, 1920x1080) plus firefox and webkit at 360x640 and 1920x1080 (not run here). Tablet and phone-landscape projects never run in CI because no CI matrix entry lists them (documented in `docs/release-checklist.md`; CI not changed). No Lighthouse, screenshot diffs or COOP/COEP. | `playwright.config.ts`, `.github/workflows/ci.yml`, `tests/e2e/platform-smoke.spec.ts` |
| PERFORMANCE-PLAN | PARTIAL | Bundle budgets gate CI. No benchmark scenes, no frame-rate gate. `npm run bench` is not in CI. No quality ladder. | `scripts/check-budgets.mjs`, `.github/workflows/ci.yml`, `package.json` |
| LEGAL-CHECKLIST | PARTIAL | Analytics off by default and no analytics SDK found. A credits window exists (`win_credits`, static text). No `ASSET-LICENSES.md`, no QA log, no legal or look-and-feel review. | `../Spec/LEGAL-CHECKLIST.md`, `src/ui/staticWindows.ts`, `src/ui/windowContent.ts` |

## Cross-cutting

| Spec | Status | Reason | Source |
|---|---|---|---|
| 00 README-RULES | N/A | Authoring conventions; nothing to build. | `../Spec/00-README-RULES.md` |
| 01 GLOSSARY-NAMES | DONE | Realm, Chronicle, Realm Rules, Being, Folk and related names are used in UI and code. No automated name lint. | `src/ui/windowContent.ts`, `src/ui/windowCatalog.ts` |
| 02 TECH-STACK | PARTIAL | TypeScript strict, Vite, PixiJS, module worker, IndexedDB saves code, Vitest and Playwright present. No SharedArrayBuffer mode, no COOP/COEP headers; export is binary with an FNV checksum, not gzip. | `vite.config.ts`, `src/app/saves.ts`, `src/sim/chronicle.ts` |

## Key counts (measured)

Counts marked "static" come from grep or a read of the source, not from a run. Counts marked "carried" are from the previous pass and were not re-counted.

| Item | Count | Spec reference |
|---|---|---|
| Species (`SPECIES`) | 90 (84 beasts, 6 Folk) | 18a |
| Being traits / strain traits | 144 / 154 (carried) | 18b |
| Powers (`POWERS`) | 154 (static: 48 literal, 90 species spawners, 16 omens); enabled and dispatch not re-measured | 12, about 322 |
| Status effects (`STATUSES`) | 24 (static); one applied in play (`warded`) | 08, 56 |
| Calamities | 16 | 02 section 8 |
| Realm rules (`RULES`) | 49 | 02 |
| Ages (`AGES`) | 11 (carried) | 02 |
| Grounds / biomes | 33 / 24 (biomes carried) | 01, 18c |
| Flora entries (`FLORA`) | 14 | 18d |
| Achievements | 63 | 14 (63) |
| Settings (`SETTINGS`) | 75 (49 flagged `live`) | 13 and 14; 16 for audio |
| Window catalogue | 74 entries; 62 of 62 spec rows built | 13 section 7.1 |
| Clans (`clans`) | 1 optional chronicle tag (18); clans form from strains with 4 or more living members | 11 |
| Buildings (`BUILDINGS`) | 7 of 60 | 09 |
| Hamlet founding | `MIN_BAND` 2, `BAND_RANGE` 20; dominion at `FOUND_FOLK` 30 | 09, 10 |
| Creep hubs | 3 | 18e |

## Notes

- **M3 exit test (1,000 beasts stable for 10 sim-years) is not met.** The strict soak (total beasts 300 to 3,000) was run on the 90-species roster (`DECISIONS.md`, Beings round 2): year-10 totals were 1,103 to 1,573 on six seeds, and 32 to 41 of 90 species survived. The earlier 7-or-8-of-8 figures are stale.
- **M5 and M8 exit tests are not met in play.** Culture code runs in unit tests and the running game never calls its entry points (see the UNWIRED notes above). M7 is UNVERIFIED: dominions are founded in play now, but no run measured the exit test.
- **Corrections in this pass:** `spawnFolk` has a caller now (`spawn_folk_<id>`); Folk spawn in play. `ticksForFrame` no longer exists (`planPump` replaces it). Bless applies `warded` in play. Dominions, pacts, armies, hamlets founding, items and the minimap are wired. The dev console exists (read-only, gated by `dev.enabled`). The credits window exists. `maxLive` is checked but its one caller passes zero, so no cap binds. The power total is 154 by static count, not 138.
- **Still true, re-checked:** the worker never posts a heartbeat (no `Ev.Heartbeat`); `check:budgets` is in CI; no `meleeSwing` caller; no `addCustom`, `startIntrigue` or `addFamily` caller; `achievementProgress`, `countsCredited` and `grantAllowed` have no caller outside tests.
- Spec files were not edited. The build plan is the parent folder's `BUILD-PLAN.md` (not in the Spec folder).
- No browser, soak, device, test, tsc, build or Playwright run was done in this pass (development-only rule). Results come from grep, file reads and line counts.

## Remaining work (ordered)

Ordered by ROADMAP milestone (M0 to M12), then cross-cutting. Each line gives the open item, the spec file, and where the work would go. Spec wording was not re-read line by line in this pass; items that depend on spec text not read here are marked UNVERIFIED.

1. M0, `../Spec/systems/17-engine-runtime-performance.md`: worker heartbeat event (`Ev.Heartbeat` is absent), watchdog, contentHash handshake, degradation ladder (`degradeLevel` hard-coded 0). Would go in `src/shared/protocol.ts`, `src/sim/worker.ts`, `src/app/sim-client.ts`, `src/app/main.ts`.
2. M0 and M5, `../Spec/systems/19-crash-reporting.md`: crash record in IndexedDB, consent, send/export, "not responding" dialog. Would go in `src/app/recovery.ts`, `src/app/saves.ts`, `src/ui/systemWindows.ts`.
3. M1, `../Spec/systems/01-world-grid-tiles-biomes.md`: Patch partitions, counters, connectivity scheduler; 512 px realm size (not offered). Would go in `src/sim/realm.ts`, `src/shared/constants.ts`, `index.html` (`#realm-size`).
4. M1, `../Spec/systems/04-terrain-fluids-fire-heat.md`: blast hardness, charge chains, connectivity layer; acceptance tests 6 and 7 (M2 slice). Would go in `src/sim/terrain/`, `src/sim/explosions.ts`.
5. M1, `../Spec/systems/13-ui-ux-touch-desktop.md`: hold-to-raise, undo, long-press, double-tap. Would go in `src/ui/input.ts`, `src/app/main.ts`.
6. M2, `../Spec/systems/02-world-clock-ages-calamities.md`: frame clamp value (spec says 100 ms, UNVERIFIED here; code is 250 ms). Would go in `src/shared/constants.ts`, `src/sim/scheduler.ts`.
7. M2, `../Spec/systems/03-worldgen.md`: resumable worldgen jobs and progress events. Would go in `src/sim/worldgen.ts`, `src/sim/worker.ts`.
8. M2, `../Spec/systems/18d-flora-and-resources.md`: bushes, crops, manure, remains, browsers (14 of the 18d registry built). Would go in `src/sim/flora.ts`, `src/content/`.
9. M3, `../Spec/systems/05-lineage-genes-stats.md`: lineage codes, mutateFrom, phenotypes, per-strain counters. Would go in `src/sim/beings/strains.ts`, `src/sim/beings/assembly.ts`.
10. M3, `../Spec/systems/06-needs-aging-reproduction-death.md`: mood, sleep, bonds, corpses, conversions. Would go in `src/sim/beings/system.ts`, `src/sim/beings/store.ts`.
11. M3, `../Spec/systems/07-behaviour-ai.md`: weighted decision system, task catalogue, perception, factions, aggro, possession. Would go in new modules under `src/sim/beings/` (replacing the single decision in `src/sim/beings/system.ts`).
12. M3, `../Spec/systems/18a-folk-and-beasts.md`: procedural variants, morphs, castes (skins are a trait only). Would go in `src/content/species-folk.ts`, `src/sim/beings/assembly.ts`.
13. M3, `../Spec/systems/18b-traits.md`: behaviour hooks for traits (only stat and meta effects reach the sim). Would go in `src/content/traits.ts`, `src/sim/beings/system.ts`.
14. M3 exit test, `../Spec/ROADMAP.md`: 1,000 beasts stable for 10 sim-years (last soak per `DECISIONS.md` failed). Would be checked with `vitest.soak.config.ts`; not run in this pass (UNVERIFIED now).
15. M4, `../Spec/systems/08-combat-status-items.md`: call `meleeSwing`; launch projectiles in play and add the 16 kinds; route beast bites through `applyDamage`; statuses beyond `warded` (23 of 24 unapplied, and 56 in the spec); afflictions and spells. Would go in `src/sim/combat.ts`, `src/sim/effects.ts`, `src/sim/beings/system.ts`, `src/content/items.ts`.
16. M4, `../Spec/systems/12-powers-catalogue.md`: the 12 bomb profiles (`bomb` and `bolt` run one generic blast). Would go in `src/sim/powers/handlers.ts`, `src/content/powers.ts`.
17. M5, `../Spec/systems/15-chronicle-saves.md`: checksum quarantine store; thumbnails; a recorded browser run of the IndexedDB path (a test task, not code). Would go in `src/app/saves.ts`, `src/app/save-controller.ts`.
18. M6, `../Spec/systems/09-settlements-buildings-economy.md`: jobs, trade, mood, roads, town tier (hamlet to town is the M6 exit test); garrison soldiers and gear-capacity effects; hall tier (spec gate cut, see `hamlet.ts`). Would go in `src/sim/settlements/hamlet.ts`, `src/sim/settlements/catalogue.ts`, `src/sim/settlements/adapter.ts`.
19. M6, `../Spec/systems/18c-world-buildings-effects.md`: 53 buildings and 32 statuses not built (7 of 60 buildings, 24 of 56 statuses). Would go in `src/sim/settlements/catalogue.ts`, `src/sim/effects.ts`, `src/content/grounds.ts`.
20. M6, `../Spec/systems/18e-structures-landmarks-creeps.md`: beacons, six landmark structures, extended buildings. Would go in `src/content/creeps.ts`, `src/sim/terrain/creep.ts`, `src/sim/terrain/eruption.ts`.
21. M7, `../Spec/systems/10-dominions-wars-pacts-armies.md`: tax, boats, rulers as entities (`supremeOf` is a stand-in), the 'forced' pact kind (god tool, not built), and a recorded run of the M7 exit test (two dominions fight, win or lose, peace; UNVERIFIED). Would go in `src/sim/dominions/` (`adapter.ts`, `armies.ts`, `pacts.ts`).
22. M8, `../Spec/systems/11-intrigue-customs-creeds-dialects.md`: call sites for `addCustom`, `startIntrigue` and `addFamily` (no caller outside tests); name generator, families, banners. Would go in `src/sim/culture/adapter.ts`, `src/sim/sim.ts`, `src/sim/culture/culture.ts`.
23. M8, `../Spec/systems/11-intrigue-customs-creeds-dialects.md` (clans): splits, merges, renown, chief decisions, enforcement of the 50 limit. Would go in `src/sim/clans/clans.ts`.
24. M9, `../Spec/systems/12-powers-catalogue.md`: remaining catalogue (Favour 27 of 28, Insight about 39 of 40, Grow, Shape and Beings gaps; spec denominators carried, UNVERIFIED this pass). Would go in `src/content/powers.ts`, `src/sim/powers/handlers.ts`, `src/sim/powers/rites.ts`.
25. M9, `../Spec/systems/02-world-clock-ages-calamities.md`: `maxLive` cap (the caller passes `liveCount: () => 0`), weeping rain and discord conversion, about 18 of 49 rules with no reader (carried count). Would go in `src/sim/powers/handlers.ts` (`calamityInputs`), `src/sim/calamity.ts`, `src/sim/weather.ts`, `src/sim/rules.ts`.
26. M10, `../Spec/systems/13-ui-ux-touch-desktop.md`: world tooltips (`ui.worldTooltips` unread), nameplates on beings (hamlet names only today), i18n locales beyond `en`. Would go in `src/render/marks.ts`, `src/app/main.ts`, `src/ui/`.
27. M10, `../Spec/systems/14-progression-achievements-options.md`: developer console command parser and DebugFlags, realm-changing commands (the console is read-only today). Would go in `src/ui/systemWindows.ts`, `src/shared/protocol.ts`, `src/sim/` (new command handling).
28. M10, `../Spec/systems/14-progression-achievements-options.md` (options): flagged `live` rows (49 of 75) whose behaviour was not re-checked in this pass (UNVERIFIED). Would go in `src/ui/panels/options.ts`, `src/app/main.ts`.
29. M11, `../Spec/systems/14-progression-achievements-options.md` (achievements, stats): unlock popup, cross-Realm progress, lifetime-stats window, and wiring of `countsCredited`, `grantAllowed` and `achievementProgress` (no caller outside tests). Would go in `src/sim/progression.ts`, `src/ui/snapshot-model.ts`, `src/app/main.ts`.
30. M11, `../Spec/systems/16-audio-art-direction.md` (audio): night and calamity flags not fed to the audio feed (per `src/audio/README.md`); device check (UNVERIFIED, not run). Would go in `src/audio/feed.ts`, `src/app/audio-wiring.ts`.
31. M11, `../Spec/systems/16-audio-art-direction.md` (art): being, structure and effect sprites, atlases, palette recolour. Would go in a new sprite module under `src/render/`, with `src/render/terrain.ts` and `src/render/marks.ts` as the callers.
32. M12, `../Spec/systems/17-engine-runtime-performance.md` and `../Spec/PERFORMANCE-PLAN.md`: benchmark scenes, a frame or tick perf gate in CI, `npm run bench` in CI, SAB mode, and a lint for `Math.exp`, `Math.pow` and `Math.hypot` in the sim. Would go in `.github/workflows/ci.yml`, `scripts/check-determinism.mjs`, `package.json`, `tests/unit/tick-cost.test.ts`.
33. M12, `../Spec/systems/19-crash-reporting.md` (release gate): chaos test, crash record, consent, send, restore prompt. Would go in `src/app/recovery.ts`, `tests/e2e/`.
34. M12, `../Spec/PLATFORM-REQUIREMENTS.md` section 6: tablet and phone-landscape projects not in the CI matrix; Lighthouse, screenshot diffs, COOP and COEP headers. Would go in `.github/workflows/ci.yml`, `playwright.config.ts`, `vite.config.ts`.
35. M12, `../Spec/LEGAL-CHECKLIST.md`: `ASSET-LICENSES.md` (absent at repo root), QA log, look-and-feel review. Would go in a new root `ASSET-LICENSES.md` (only if the user asks for it), `src/ui/staticWindows.ts` for the credits text.
36. Cross-cutting, `../Spec/systems/` (02 TECH-STACK): SharedArrayBuffer mode, COOP and COEP headers, gzip export (export is binary with FNV, not gzip). Would go in `vite.config.ts`, `src/sim/chronicle.ts`, `src/app/saves.ts`.
