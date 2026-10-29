# Spec coverage (refreshed against main at 4d81302, after close 14)

Source of truth: `../Spec/` (read-only, outside this repo; path checked: `game\Spec` is the parent of `sandbox-realms`). Milestone-to-spec mapping: `../Spec/ROADMAP.md`, with 18a to 18e assigned as in `../BUILD-PLAN.md`.

Status values (latest code wins):

- **DONE**: the spec's required behaviour is implemented, reachable from the running game (imported from `src/app/main.ts` or the sim worker chain), and covered by a test or check.
- **PARTIAL**: some of it is implemented, or it is implemented but not reachable in play, or only a subset of the spec's items exist.
- **NOT BUILT**: no code for it.
- **N/A**: nothing to build.

How this pass was checked: registry sizes were measured by importing the content and sim tables in Node (`POWERS`, `STATUSES`, `BUILDINGS`, `FLORA`, `SETTINGS` and the rest), and claims were checked by grep and file reads. The "Remaining" and "Not built" lines of the DECISIONS.md close sections were used as evidence of what is open; a sample was re-checked by grep (heartbeat, contentHash, Titan, hold and long-press wiring, `meleeSwing`, `addCustom`, `writeBook`, `liveCount`, rule readers). No test, tsc, build, soak or Playwright run was done in this pass. Most close 4 to close 14 work was itself checked by reading only (see DECISIONS.md); treat a DONE or PARTIAL here as "built in code", not "proven in a run".

## Summary by milestone

Rows below are (milestone, spec file) pairs. A spec file can appear under more than one milestone, as ROADMAP splits it.

| Milestone | Rows | DONE | PARTIAL | NOT BUILT | Exit test |
|---|---|---|---|---|---|
| M0 Shell, worker, protocol | 2 | 0 | 2 | 0 | Not checked on a device |
| M1 Terrain painter | 4 | 0 | 4 | 0 | 512 offered; no undo |
| M2 Worldgen, clock, flora, water, fire | 4 | 1 | 3 | 0 | Templates generate; fire deterministic (tests exist) |
| M3 Beings | 6 | 0 | 6 | 0 | NOT MET at the last soak (see Notes); not re-run |
| M4 Combat, statuses, weather | 2 | 0 | 2 | 0 | Scripted fight tests exist; projectiles and many statuses now fire in play; not run in a browser |
| M5 Chronicle saves, panels | 3 | 0 | 3 | 0 | Saves and recovery run in play; no recorded browser run of the IndexedDB path |
| M6 Hamlets and economy | 3 | 0 | 3 | 0 | UNVERIFIED: town tier exists at 40 folk; no run measured "a hamlet grows to a town" |
| M7 Dominions | 1 | 0 | 1 | 0 | UNVERIFIED: wars, capture and pacts run; no run measured the exit test |
| M8 Culture | 3 | 0 | 2 | 1 | UNVERIFIED: culture is wired and runs; no run measured the exit test |
| M9 Powers, rules, ages, calamities | 4 | 0 | 4 | 0 | Not met: 250 powers of about 322; Favour 21 of 28 |
| M10 Full UI | 3 | 0 | 3 | 0 | Not met: 62 of 62 window rows; minimap, tooltips, arrows built; nameplates on beings and i18n missing |
| M11 Audio, achievements, stats, art | 3 | 0 | 3 | 0 | Not met: audio starts on the first gesture, not checked on a device |
| M12 Checks and hardening | 4 | 0 | 4 | 0 | Not met: no device, Lighthouse or chaos runs |
| Cross-cutting (00, 01, 02) | 3 | 1 | 1 | 0 | 00 is authoring rules (N/A) |

Totals: 42 milestone rows (1 DONE, 40 PARTIAL, 1 NOT BUILT) and 3 cross-cutting rows (1 DONE, 1 PARTIAL, 1 N/A). That is 2 DONE, 41 PARTIAL, 1 NOT BUILT and 1 N/A across 45 rows. No milestone exit test is confirmed met in this pass.

## M0 Shell, worker, protocol

| Spec | Status | Reason | Source |
|---|---|---|---|
| 17 engine-runtime | PARTIAL | MessageChannel pump with `planPump` (two clamps: `FRAME_DT_CLAMP_MS` 100 and `MAX_CATCHUP_MS` 250), 8 ms frame budget, seeded RNG. `Ev.Heartbeat` is posted every 20 ticks (or 60 idle pumps); the page watchdog judges 6 s of silence with a Restart or Wait dialog. contentHash handshake on `Ev.Ready` with a "Build mismatch" dialog. Render-side degradation ladder (4 levels, in memory); levels 1 to 3 (bloom, particles, shadows) change nothing because no renderer reads those options, level 4 caps the render scale. Ping/Pong every 2 s with an 8 s `main_hang` rule in the worker. System isolation: `SysIsolation` (3 faults in 10 s, off for 600 ticks, third switch-off stops the sim) wraps every `step` part and per-unit bodies (`hamlet:<i>`, `being:<slot>`, `dominion:<id>`, `border:a-b`); a stop shows the "Simulation paused" dialog (Reload last autosave, Continue, Export diagnostics). Command replay ring (2048) and a diagnostics bundle. Not built: SharedArrayBuffer mode, fatal invariant detection (NaN positions, free-list corruption), the worker's own log ring, dev-build rethrow, isolation inside `structureStep`, `rankDominions` and the inner sweeps of `runTerrain` and `runBehaviours`. | `src/sim/worker.ts`, `src/sim/scheduler.ts`, `src/shared/protocol.ts`, `src/shared/replay-ring.ts`, `src/content/content-hash.ts`, `src/app/sim-client.ts`, `src/app/recovery.ts`, `src/app/diagnostics.ts`, `src/app/main.ts`, `src/sim/sim.ts` |
| 19 crash-reporting | PARTIAL | Local crash record (IndexedDB with memory fallback, schema 2) with a 50-entry breadcrumb ring (9 crumb types), scrubbed logs, perf block and `sys` block. Consent modes ask, always, never (DNT and GPC force never); the Settings control is three-way. Export is not consent-gated and never sends. Redaction has a unit test and a fuzz. Emergency save on every fatal path. Fatal dialog offers Reload last autosave, Continue (disabled when the sim is stopped), Export diagnostics, Safe Mode. Not built: endpoint, Send, preview and retry (OPEN-19-1), "Send report" and "Start fresh", record fields `qualityTier`, `degradeHistory`, `beings`, `lastAutosaveAgeMs`, `bootCount24h`, service-worker context, the chaos test. | `src/app/crash-record.ts`, `src/app/recovery.ts`, `src/app/log-ring.ts`, `src/app/perf-sample.ts`, `src/app/save-controller.ts`, `src/app/main.ts`, `src/ui/panels/options.ts`, `tests/unit/crash-redaction.test.ts` |

## M1 Terrain painter

| Spec | Status | Reason | Source |
|---|---|---|---|
| 01 world-grid | PARTIAL | Grid side is 64 x sizeStep. `index.html` offers 192, 256, 320 and Colossal 512; Titan 576 is behind the Advanced checkbox on desktop only. Patch (16) and Parcel (8) partitions with per-Parcel counters for liquid, ground, lava, fire and flora, and patch dirty bits. Connectivity layer (regions, links, landmasses) rebuilt every 8 ticks, skipped during a quake. Not built: tree, plant, fungus, mineral and structure counters, the `island.formed` event, the 512 device warning, the Titan cost tier. | `src/sim/realm.ts`, `src/sim/terrain/connectivity.ts`, `src/shared/constants.ts`, `src/content/grounds.ts`, `src/sim/terrain/biome-spread.ts`, `index.html` |
| 04 terrain-fluids | PARTIAL | Water, magma, freeze, slime, heat and biome spread run in `Sim.step` under per-part guards. Blast hardness (`explode` with a power), charge chains (`detonateChain`, limit 400) and device grounds (thunderpowder, timedpowder, hidden charge) are built. Vents, quakes and flora spread jobs are saved (chronicle tag 22). Open: fire clears flora to nothing (no charred stump or fallen log producer), fire never burns buildings, chain carry-over is not modelled, not every caller of `explode` passes a power. | `src/sim/terrain/water.ts`, `src/sim/terrain/magma.ts`, `src/sim/terrain/heat.ts`, `src/sim/terrain/fire.ts`, `src/sim/terrain/save.ts`, `src/sim/explosions.ts`, `src/sim/devices.ts` |
| 12 powers (M1 slice) | PARTIAL | Raise, lower and 11 ground paints (13 Shape entries of 51) run through `executePower`. Other catalogue powers are under M9. | `src/sim/powers/handlers.ts`, `src/content/powers.ts` |
| 13 ui-ux (M1 slice) | PARTIAL | Pointer arbitration, pinch and wheel zoom, edge pan, window host and tutorial. Hold-to-raise (150 ms then every 100 ms; the spec says 10 ticks for burst brushes), long-press (tile inspect), double-tap zoom, and a second finger ends a stroke are wired in `main.ts`. Undo is not built: the sim keeps no per-stroke journal, so the stroke stays painted and the status line says so. | `src/ui/input.ts`, `src/ui/edgePan.ts`, `src/ui/windowHost.ts`, `src/app/main.ts` |

## M2 Worldgen, clock, flora, water, fire

| Spec | Status | Reason | Source |
|---|---|---|---|
| 02 clock-ages-calamities | PARTIAL | Clock, 11 ages, cloud weather (the cinder cloud now drops ash) and the 16-entry calamity roll (every 80 sim-seconds) run in play. Speed set 0.5 to 10 (spec x05 to x40; not re-checked). Both frame clamps are applied (100 ms wall delta, 250 ms world accumulator); 02 section 12 test 2, first case, cannot hold under either (spec defect, DECISIONS.md "Clock, worldgen and flora release"). | `src/sim/ages.ts`, `src/sim/clock.ts`, `src/shared/constants.ts`, `src/sim/scheduler.ts`, `src/sim/calamity.ts`, `src/sim/weather.ts` |
| 03 worldgen | PARTIAL | 12 templates, Chessboard, Cells and Warren layouts, rivers, lakes, replace rules and starting beasts. `buildOnce` is a resumable generator job (six UI stages, 12 ms slices, `Ev.WorldgenProgress`, a progress bar, replay-based resume from IndexedDB). The resume path is mostly dormant in play (the startup NewRealm replaces a resumed job). No cancel command. The typing and elevation loops and `seedStartingBeasts` are not sliced. | `src/sim/worldgen.ts`, `src/sim/worldgen/layouts.ts`, `src/sim/worldgen/water.ts`, `src/sim/worldgen/replace.ts`, `src/sim/worker.ts`, `src/app/main.ts` |
| 04 terrain-fluids (M2 slice) | DONE | Fire pacing (no spread before age 40, extinguish rule, all out by 500), scars, sea refill (0.7 per run, inland hollows never fill) and rain refill run in play. Acceptance tests 6 and 7 exist as code checks in `tests/unit/world-release-checks.test.ts`. | `src/sim/terrain/fire.ts`, `src/sim/terrain/water.ts`, `tests/unit/world-release-checks.test.ts` |
| 18d flora-resources | PARTIAL | `FLORA` has 35 entries, 21 of them from the 18d registry (10 bushes, 4 crops, 3 remains, manure pile, hive, 2 ruins). Crops, hives, ruins and manure feed the tiller, honey, cleaner, manure and hunter jobs. Not built: bush ripeness and picking, mill grain, the manure growth boost, burn results from fire, shade skip in the drought pass, wet-ground rules. A ruin source exists only through `destroyBuilding`, which has no caller, so the cleaner has no work in play. | `src/sim/flora.ts`, `src/content/flora-18d.ts`, `src/sim/settlements/jobs.ts` |

## M3 Beings and ecosystem

| Spec | Status | Reason | Source |
|---|---|---|---|
| 05 lineage-genes-stats | PARTIAL | Stat assembly, baby halving, strain join and `mutateFrom` (trait path, flood guard). Strain counters born, newAdults, reproduced, died, killed. Lineage codes and a genome (segment library, strands, budget decomposition, resonance totals) are built and saved, but the totals feed no stat. Phenotype palette index and shade are stored per Being; nothing draws them. Not built: `unstableShuffle`, the `shifting_code` timer, `gene_chaos`, species-forced strand type, uplift and evolve (6.4). | `src/sim/beings/assembly.ts`, `src/sim/beings/strains.ts`, `src/sim/beings/genome.ts`, `src/sim/beings/variants.ts` |
| 06 needs-aging-reproduction | PARTIAL | Fuel and starvation, ageing death, mating, gestation, litters, the parent-slot cap and the POP cap. Mood (events), sleep with the 23-entry dream pot, bonds, lovers (`smitten`) and best friends, REB rebirths, affliction conversions on death (rot, spore, tumor, hexed), birth modes clonal, budded, spore, single parent, egg and rooted. Not built: corpses (spec default is none), low-fuel pace (the spec gives none), `famished`, virgin, divine, soul-born and metamorph births, care sheltering (1800) and the `nurturing` strain, the 1800-tick dream effect. | `src/sim/beings/system.ts`, `src/sim/beings/store.ts`, `src/sim/beings/social.ts`, `src/sim/beings/afflictions.ts`, `src/content/moods.ts` |
| 07 behaviour-ai | PARTIAL | 27 decision rows with tiers and a softmax pick (`brain.ts`), override layer, step-machine tasks (`follow_parent`, `douse_self`), perception, the faction matrix, aggro entries, fights and Folk brawls, tier-4 overrides (`steered_follow`, `muddled`, flight, outburst). Possession is wired in play: the Possess power, tap-to-order, six Architect abilities, keys J K L U T Y N and a touch pad (owner choices). Not built: most of the roughly 70 other tasks (boats, homes, intrigue, wyrm, craft, hand), step verifiers and `speedMult`, `canControl` flags (no roster data), key or stick movement, attack aim, the `iron_will` yell, the reflection pot beyond outburst. | `src/sim/beings/system.ts`, `src/sim/beings/brain.ts`, `src/sim/beings/perception.ts`, `src/sim/beings/hostility.ts`, `src/sim/beings/aggro.ts`, `src/sim/beings/possession.ts`, `src/sim/beings/abilities.ts`, `src/content/decisions.ts`, `src/ui/panels/possessControls.ts` |
| 18 roster-content | PARTIAL | 90 SPECIES rows load (84 beasts, 6 Folk). Each has a spawner power that reaches `spawnBeing` or `spawnFolk`. Folk also found hamlets. Aquatic and Architect-bound rows have no land behaviour (carried from the previous pass, not re-checked). | `src/content/beasts.ts`, `src/content/species-roster.ts`, `src/content/species-folk.ts`, `src/content/powers.ts`, `src/sim/powers/handlers.ts` |
| 18a folk-and-beasts | PARTIAL | Rows load and match the roster. Procedural variants are built: 12 biome morphs, 4 castes, albino and melanic rolls, inherited morph. Morph grants are text only (no mechanic reads them). Pack leader is rolled per Being, not per group. Not built: uplift and the morph-triggered evolution rule. | `src/content/variants.ts`, `src/sim/beings/variants.ts`, `src/content/species-roster.ts`, `src/content/species-folk.ts` |
| 18b traits | PARTIAL | 144 being and 154 strain traits load. Stat and meta effects reach the sim, plus behaviour hooks for about 30 traits (flee gates, sight, diet, sleep, reflect, fight start, venom, mendflesh, wanderlust, POP and others) in `trait-hooks.ts`. The rest are cut for lack of state (homes, day cycle, lineage migration, loot, afflictions). | `src/content/traits.ts`, `src/sim/beings/assembly.ts`, `src/sim/beings/trait-hooks.ts` |

## M4 Combat, statuses, weather

| Spec | Status | Reason | Source |
|---|---|---|---|
| 08 combat-status-items | PARTIAL | `applyDamage`, plating, the 6-tick hit window, attack timers, on-hit modifiers and blasts with falloff. Beast claws and bites run through `predate` (`meleeSwing` has a caller). 16 projectile kinds are launched from ranged weapons, throwers, the brazier tower, watchspire bolts and trading-boat cannons; `acid_glob`, `snow_pellet`, `knuckle_bone`, `hurled_stone` and `frenzy_sphere` have no owner in the spec. 32 status definitions (spec roster 56) with sources in play for most; not audited status by status. Spells: 16 of 18 built (`whirl_call` and `overgrow` not built) with aether state. Items: 95 kinds, 58 modifiers, equip, melee wear, hamlet fetch, craft and repair. Not built: ranged and bare-attack wear, item spells (staff spell lists are data), `skill_spell`, `item.forged`, ash terrain. | `src/sim/combat.ts`, `src/sim/effects.ts`, `src/sim/projectiles.ts`, `src/sim/spells.ts`, `src/sim/explosions.ts`, `src/sim/items/`, `src/content/items.ts`, `src/content/spells.ts` |
| 12 powers (M4 slice) | PARTIAL | 12 bomb powers (8 bombs and 4 device bombs) plus `havoc_bolt`, on 10 profiles in `BOMB_PROFILES`; `havoc_sparkler` has no blast. Not modelled: the 0.9 s drop, sunburst flash and high-flyer hits, wasteland as a ground, water soak, the bomb counter. | `src/sim/powers/handlers.ts`, `src/content/powers.ts`, `src/sim/devices.ts` |

## M5 Chronicle saves, inspector, tooltips

| Spec | Status | Reason | Source |
|---|---|---|---|
| 15 chronicle-saves | PARTIAL | `SCHEMA_VERSION` 7 (schema 6 and older rejected; the format is unreleased). Optional tags for clans (18), items (19), boats (21), terrain (22) and spells (23). Save, load, delete, export, import and autosave run through `SaveController` and `SaveService` (IndexedDB, memory fallback). FNV checksum, not gzip and SHA. Not built: checksum quarantine store, thumbnails. No recorded browser run of the IndexedDB backend. | `src/sim/chronicle.ts`, `src/sim/worker.ts`, `src/app/save-controller.ts`, `src/app/saves.ts`, `tests/unit/chronicle.test.ts`, `tests/unit/saves-service.test.ts` |
| 13 ui-ux (M5 slice) | PARTIAL | Tile inspect (tap and long-press), `win_being` from the Beings list and map taps, desktop world tooltips for tiles and Beings (`worldTip.ts`). The tile tooltip names owners, not ground or height (the snapshot has no terrain). | `src/app/main.ts`, `src/ui/worldTip.ts`, `src/ui/hud.ts`, `src/ui/specWindows.ts`, `src/ui/windowContent.ts` |
| 19 crash-reporting (M5 slice) | PARTIAL | `decideRecovery` on a fault, `restoreOffers`, `isBootLoop` dialog, Safe Mode, sentinel and journal. No recorded browser run of the dialog actions. | `src/app/recovery.ts`, `src/app/main.ts`, `src/app/save-controller.ts`, `tests/unit/recovery-ladder.test.ts` |

## M6 Hamlets and economy

| Spec | Status | Reason | Source |
|---|---|---|---|
| 09 settlements-economy | PARTIAL | Hamlets are placed at worldgen and founded by Folk bands (`MIN_BAND` 2, `BAND_RANGE` 20). A `town` tier label from 40 folk (derived, `TOWN_POP`). 31 of 60 buildings. Builder sites with progress, plus the jobs forager, herbalist, honey gatherer, tiller, prospector, woodcutter, miner, iron miner, roadwright, cleaner, manure collector, hunter and soldier slots, filled by priority and a round-robin quota; derived hamlet leader; child labour via the custom. Roads (queue, laying, decay), bazaar trade, hamlet mood terms, beacon desires. Garrison: company by soldier slots, recruit cost and wages (TUNE), release over the limit, leader warfare from the leader's valor. 50 of 53 custom traits are live. Not built: 29 buildings, building damage (no site is ever destroyed, so the cleaner has no work), mill and farmstead gates, the hunter as a quota job, jobs from the spec census (Folk only), a Barracks row (the garrison is the Barracks). | `src/sim/settlements/hamlet.ts`, `src/sim/settlements/adapter.ts`, `src/sim/settlements/catalogue.ts`, `src/sim/settlements/jobs.ts`, `src/sim/settlements/roads.ts`, `src/sim/settlements/trade.ts`, `src/sim/settlements/garrison-adapter.ts`, `src/sim/settlements/custom-rules.ts`, `src/sim/items/hamlet-gear.ts` |
| 18c world-buildings-effects | PARTIAL | 33 grounds and 24 biomes as data. 32 of 56 statuses and 31 of 60 buildings defined. Wild, hazard, resource and wonder objects are not hamlet buildings and are not built as such (`wonder_obelisk` has no defined bonus). | `src/content/grounds.ts`, `src/content/biomes.ts`, `src/sim/effects.ts`, `src/sim/settlements/catalogue.ts` |
| 18e structures-landmarks-creeps | PARTIAL | 3 creep hubs (pulse, burn and flood death, saved) with creep effects on Beings (gloom fever, bloat sluggish, `unnerved`, `giggling`). 9 landmarks and beacon pillars placeable by powers and saved; rime and ember pylons and the acid font act, the insight seed and lantern spire are dormant. Extended buildings built: `quarry_lodge`, `bastion`, `brazier_tower`, `slipway`. Not built: `arsenal`, `paddock`, `sea_lantern`, the six optional EXT buildings, gourd props, hub hp, pillar monster spawners. | `src/content/creeps.ts`, `src/sim/terrain/creep.ts`, `src/sim/terrain/eruption.ts`, `src/sim/settlements/landmarks.ts`, `src/sim/settlements/creep-effects.ts` |

## M7 Dominions

| Spec | Status | Reason | Source |
|---|---|---|---|
| 10 dominions-wars-pacts-armies | PARTIAL | Founding from hamlets (`FOUND_FOLK` 30, `realm_expansion`), borders, wars, truces, pacts (including `forcePact`), armies, contact fights, rank every 40 ticks, power-formula supremacy. Hamlet capture (`HAMLET_CAPTURE` on: threshold 100, 130 with a bastion, `DEF_PER_TOWER` 10, saved progress) with moods, ruler flight and ally hand-over; raze of empty hamlets. Rulers are Beings with succession. Loyalty sum with cache and `isHappy`; rebellion (campaign record, uprising intrigue). Tax chain recorded as a ledger. Boats: docks, fishing, trading, transport through the slipway, cannon fire, path search. Watchspire bolts. Not built: tax money movement, `declareCampaign` and campaign ending, `checkMoreAligned` and allied hamlets defecting, hamlet cap (`maxHamlets`) and sea-link loyalty terms, boat passengers, `forcePact` has no command, `hamletsRebelled`. Exit test UNVERIFIED. | `src/sim/dominions/adapter.ts`, `src/sim/dominions/founding.ts`, `src/sim/dominions/step.ts`, `src/sim/dominions/capture.ts`, `src/sim/dominions/rebellion.ts`, `src/sim/dominions/campaigns.ts`, `src/sim/dominions/loyalty.ts`, `src/sim/dominions/rulers.ts`, `src/sim/dominions/pacts.ts`, `src/sim/dominions/armies.ts`, `src/sim/dominions/tax.ts`, `src/sim/boats/boats.ts`, `src/sim/projectiles.ts` |

## M8 Customs, creeds, dialects, intrigues

| Spec | Status | Reason | Source |
|---|---|---|---|
| 11 intrigue-customs-creeds-dialects | PARTIAL | Culture is wired: `cultureYearly` gives each dominion a custom (53-row catalogue, rarity-weighted) and a scheme intrigue, and families are recorded for Folk. Dominion intrigues for pacts, divide, schism, divergence, `newDialect`, `newCreed`, uprising and 12 of 15 rites. Creeds with 45 tenets (harmony, `bloodSecrecy`, spell and rite tenets act). Study xp, books (read effects), talk and fight conversion, name generator, banner indices, dialect phonology rules. `writeBook` has no caller (owner decision: dormant). Not built: rites `verdantRite`, `discordRite`, `ascendRite`; rite progress, rate and level gates; tenets `fireWard`, `insight` and the five transformation tenets; book writer. | `src/sim/culture/culture.ts`, `src/sim/culture/adapter.ts`, `src/sim/culture/effects.ts`, `src/sim/culture/rites.ts`, `src/sim/culture/trait-rules.ts`, `src/sim/dominions/intrigue.ts`, `src/content/customs.ts`, `src/content/creeds.ts`, `src/content/rites.ts` |
| 11 clans (kinbands) | PARTIAL | A clan is the living members of one strain; 4 or more living members found one clan. `clansStep` runs monthly; chief is the oldest member. Renown per year with a living chief, `mergeClans` as a god tool (no command), limit 50 enforced at merge only, saved as optional tag 18. Founded from strains, not families. Not built: chief decisions (`bloodPact`, `deathbound`), enforcement of 50 on births. Clans never split (spec). | `src/sim/clans/clans.ts`, `src/ui/specWindows.ts`, `src/sim/sim.ts` |
| 11 name sets, sound shift, dialect syllables | NOT BUILT | Name sets (one per custom, 1 to 12 per lineage), the sound shift (6.6), splice, swap and double, dialect syllable assembly, `makeWord`, affixes and the 37 concept slots. The spec gives the mechanics but not the data: about 39 of the 60 sound-shift pairs, the set contents and six phonology inventories are left to implementation, so building them means authoring rule data (spec gap). `draftPhonology` returns nothing until items are supplied. | `src/sim/culture/names.ts`, `src/sim/culture/phonology.ts`, `src/content/dialect-phonology.ts` |

## M9 Powers, rules, ages, calamities

| Spec | Status | Reason | Source |
|---|---|---|---|
| 12 powers-catalogue | PARTIAL | `POWERS` has 250 entries (measured): Realm 14 of 14, Shape 13 of 51, Grow 19 of 47, Sky 6 of 38, Beings 90 of 90, Havoc 31 (spec 8.6 lists 14; the extra entries are 16 omens, hex cast and pestilence), Favour 21 of 28, Insight 56. Spec total is about 322. Enablement is by `powerStatus`; handlers are split between `SIM_HANDLERS` and `UI_HANDLERS`. | `src/content/powers.ts`, `src/ui/powerSupport.ts`, `src/sim/powers/handlers.ts`, `src/sim/powers/terrain-powers.ts` |
| 12 s8.7 Favour | PARTIAL | 21 entries: Bless (not in the spec) and 20 spec entries (vigour, ward, spark, surge, muse, kinship, strife, grudge, frenzy, grace, hex, slumber, unweave, cleanse, purify, foundling, waking flora, item rain, edit item rain, loot rain). Several effects are substitutions (Vigour as `emboldened`, opinion effects as mood events). Not built: `fav_hush` (could now use the `hushed` status), six colour dusts (no dominion colour state), Trait Rain A, B, C and their editors (13 spec rows). | `src/content/powers.ts`, `src/sim/powers/favour.ts`, `src/sim/powers/rites.ts` |
| 12 s8.8 Insight | PARTIAL | 56 entries, covering every spec row except Campaign Forecast: inspect, follow, possess, hamlet select, layers L01 to L10, marks M01 to M07, overlays O01 to O08 (names, happiness, tasks, talk bubbles, ticker, money flow, army lines), arrows A01 to A07, tooltips, Ties and Accord Finder with a dominion pick, lists X01 to X14, Codex, Compare, plus Lore (not in the spec). Deviations: arrows and bubbles are approximations of snapshot data, tile tips name owners not ground, Lore has no window. Forecast stays cut (owner decision, no `declareCampaign`). | `src/content/powers.ts`, `src/ui/powerSupport.ts`, `src/render/insight-layers.ts`, `src/ui/historyTicker.ts`, `src/ui/worldTip.ts`, `src/sim/snapshot.ts` |
| 02 ages-calamities (M9 slice) | PARTIAL | 16 calamities rolled every 80 sim-seconds and run. `maxLive` is checked in `calamityRoll`, but its one caller passes `liveCount: () => 0`, so no cap binds. 16 of 49 rule ids have no string reference outside `rules.ts` (grep; indirect reads would be missed): `pop_cap_100`, `terrain_building`, `hostile_commoners`, `wandering_settlers`, `gene_chaos`, `mutation_box`, `gentle_monsters`, `seeds_of_thought`, `roots_beyond_borders`, `shore_erosion`, `popping_fungi`, `vengeful_bark`, `whimsical_flora`, `vermin_plague`, `evolution_events`, `forbidden_lore`. Weeping rain and Discord conversion are absent (those words occur only as age and calamity tags). | `src/sim/calamity.ts`, `src/sim/powers/handlers.ts`, `src/sim/rules.ts`, `src/sim/ages.ts`, `src/sim/sim.ts` |

## M10 Full UI, lists, overlays, options, tutorial

| Spec | Status | Reason | Source |
|---|---|---|---|
| 13 ui-ux (M10 slice) | PARTIAL | `WINDOW_CATALOG` has 74 entries: 62 of 62 spec window rows (the nine `win_customize_*` ids are one row) plus 4 extras. Virtual list view. Minimap. Mark layer draws Beings and buildings as procedural sprites, items, armies, campaigns, battles, pact links, boats and hamlet names; Insight layers, arrows, talk bubbles and ticker. Display layers (vignette, opacity, brightness), colour-blind filter. Tutorial has 4 steps. Missing: nameplates on Beings (hamlet names only), i18n (`lang` offers `auto` and `en`), the render effects behind `map.nightLights`, `shadows`, `bloom`, `particles`, `treeWind`, `cursorLights` and `ageEffects`, the context tab, quick strip, tap-to-order. | `src/ui/windowCatalog.ts`, `src/ui/windowContent.ts`, `src/ui/listView.ts`, `src/ui/minimap.ts`, `src/render/marks.ts`, `src/render/insight-layers.ts`, `src/ui/panels/tutorial.ts`, `src/app/main.ts` |
| 14 progression-options (options) | PARTIAL | 78 settings in `SETTINGS`, of which 58 are flagged `live` (counted from `options.ts`; whether each flagged row changes behaviour was not re-checked). Saved to localStorage, not IndexedDB. `privacy.errorReports` is three-way; `privacy.telemetry` has no sender. | `src/ui/panels/options.ts`, `src/ui/windowContent.ts`, `src/app/main.ts` |
| 14 progression-options (dev console) | PARTIAL | `win_dev_console` and `win_dev_tools` open only when `dev.enabled` is on. The console accepts `help` and `clear` and reads the realm; it cannot change it. Commands tab says the sim keeps no command log, but a replay ring now exists in the worker and feeds the diagnostics bundle. No DebugFlags and no realm-changing commands. | `src/ui/systemWindows.ts`, `src/ui/panels/options.ts`, `src/app/main.ts` |

## M11 Audio, achievements, stats, art

| Spec | Status | Reason | Source |
|---|---|---|---|
| 14 progression-achievements-stats | PARTIAL | 63 achievement definitions evaluated each sim-second; the unlocked set is saved. Trophies window shows state and progress; lifetime counters are listed (`lifetimeRows`). No unlock popup, no cross-Realm progress. `countsCredited`, `grantAllowed` and `achievementProgress` in `progression.ts` still have no caller outside tests. | `src/content/achievements.ts`, `src/sim/stats.ts`, `src/sim/stats-hooks.ts`, `src/sim/progression.ts`, `src/ui/snapshot-model.ts` |
| 16 art-direction-audio (audio) | PARTIAL | `AudioEngine`, synth, mix, 56 sound recipes and a procedural music bed unlock on the first gesture (never in Safe Mode). Night and the calamity flag are not fed to the audio feed; stingers fire for Age change, war and peace only; the edge-pulse cue has no live trigger. Not checked on a device. | `src/audio/engine.ts`, `src/audio/sounds.ts`, `src/audio/synth.ts`, `src/audio/music.ts`, `src/audio/feed.ts`, `src/app/audio-wiring.ts` |
| 16 art-direction-audio (art) | PARTIAL | 90 species and 31 buildings are hand-drawn SVG illustrations (owner approved each group batch), baked into 2048 px atlas pages at 128 and 48 px. Creatures play rigged gaits from 15 families in `src/art/gaits.ts` (quad, biped, bird, flyer, fish, insect, snake, hover, crab, tentacle, pulse, squish, undulate, waddle, static), turning to face their direction of travel. Terrain blends smoothly, with detail that fades in by zoom. Far creatures are dots and near ones icons, with footfall dust and contact shadows. Not built: palette recolour and per-palette atlas variants, effect sprites, phenotype drawing. Not reviewed by an artist, and not checked on a real Android device. The 20 ms P95 perf gate is not met on the dev machine (see DECISIONS.md, Map graphics). | `src/art/`, `src/art/gaits.ts`, `src/art/rig.ts`, `src/art/load.ts`, `src/render/atlas.ts`, `src/render/creatures.ts`, `src/render/feed-interp.ts`, `src/render/terrain-shader.ts`, `src/render/terrain-detail.ts`, `src/render/dust.ts`, `tests/e2e/perf-creatures.spec.ts` |

## M12 Checks and hardening

| Spec | Status | Reason | Source |
|---|---|---|---|
| 17 engine-runtime (M12 slice) | PARTIAL | Build budgets gate CI (`check:budgets`, main 350 KB and worker 250 KB gzip). The determinism lint bans `Math.random`, `Date.now`, `new Date(`, `performance.now` and `crypto.getRandomValues` in `src/sim`, `src/shared` and `src/content`; the sim still uses `Math.exp`, `Math.pow` and `Math.hypot` (`brain.ts`, `system.ts`, `assembly.ts`, `combat.ts`, `explosions.ts`), which the lint does not ban. `GOLDEN_HASH` is 1357125849 (re-baselined at close 13). `npm run bench` is not in CI; no benchmark scenes, no frame or tick perf gate, no SAB mode. | `scripts/check-budgets.mjs`, `scripts/check-determinism.mjs`, `.github/workflows/ci.yml`, `package.json`, `tests/unit/golden.test.ts` |
| 19 crash-reporting (release gate) | PARTIAL | Record, consent, export and the restore prompt exist. No send path (OPEN-19-1) and no chaos test. | `src/app/recovery.ts`, `src/app/crash-record.ts` |
| PLATFORM-REQUIREMENTS section 6 | PARTIAL | `playwright.config.ts` defines 6 Chromium projects (desktop, phone portrait, phone landscape, tablet, 360x640, 1920x1080). CI runs 4 of them (desktop, phone portrait, 360x640, 1920x1080). Phone landscape and tablet never run in CI (documented in `docs/release-checklist.md`). Firefox and WebKit are out of the test matrix by owner decision. No Lighthouse, screenshot diffs or COOP and COEP. | `playwright.config.ts`, `.github/workflows/ci.yml`, `tests/e2e/platform-smoke.spec.ts`, `docs/release-checklist.md` |
| PERFORMANCE-PLAN | PARTIAL | Bundle budgets gate CI. No benchmark scenes, no frame-rate gate, no quality-tier ladder beyond the four render-side degrade levels. | `scripts/check-budgets.mjs`, `.github/workflows/ci.yml`, `package.json`, `src/app/recovery.ts` |

## Cross-cutting

| Spec | Status | Reason | Source |
|---|---|---|---|
| 00 README-RULES | N/A | Authoring conventions; nothing to build. | `../Spec/00-README-RULES.md` |
| 01 GLOSSARY-NAMES | DONE | Realm, Chronicle, Realm Rules, Being, Folk and related names are used in UI and code. No automated name lint. | `src/ui/windowContent.ts`, `src/ui/windowCatalog.ts` |
| 02 TECH-STACK | PARTIAL | TypeScript strict, Vite, PixiJS, module worker, IndexedDB saves, Vitest and Playwright present. No SharedArrayBuffer mode and no COOP or COEP headers; export is binary with an FNV checksum, not gzip. | `vite.config.ts`, `src/app/saves.ts`, `src/sim/chronicle.ts` |

## Key counts (measured)

Counts come from importing the registries in Node or from grep; "carried" means taken from the previous pass.

| Item | Count | Spec reference |
|---|---|---|
| Species (`SPECIES`) | 90 (84 beasts, 6 Folk) | 18a |
| Being traits / strain traits | 144 / 154 | 18b |
| Decision rows (`DECISION_ROWS`) | 27 | 07 |
| Powers (`POWERS`) | 250: realm 14, shape 13, grow 19, sky 6, beings 90, havoc 31, favour 21, insight 56 | 12, about 322 |
| Status effects (`STATUSES`) | 32 | 08, 56 |
| Projectile kinds | 16 | 08, 18c (16) |
| Spells / rites built | 16 of 18 / 12 of 15 | 08 9.2, 11 section 3 |
| Item kinds / modifiers | 95 / 58 | 08 |
| Calamities | 16 | 02 section 8 |
| Realm rules (`RULES`) | 49 (16 with no string reference outside `rules.ts`) | 02 |
| Ages (`AGES`) | 11 | 02 |
| Grounds / biomes | 33 / 24 | 01, 18c |
| Flora entries (`FLORA`) | 35 (21 from the 18d registry) | 18d |
| Buildings (`BUILDINGS`) | 31 of 60 | 09, 18c |
| Landmarks / creep hubs | 9 / 3 | 18e |
| Custom traits / live | 53 / 50 | 11 section 9.1 |
| Creed tenets | 45 | 11 section 9.4 |
| Achievements | 63 | 14 (63) |
| Settings (`SETTINGS`) | 78 (58 flagged `live`) | 13 and 14; 16 for audio |
| Window catalogue | 74 entries; 62 of 62 spec rows built | 13 section 7.1 |
| Tutorial steps | 4 | 14 |
| Save schema / protocol version | 7 / 3 | 15 |
| `GOLDEN_HASH` | 1357125849 | determinism |
| Playwright projects / run in CI | 6 / 4 (Chromium only) | PLATFORM-REQUIREMENTS |

## Notes

- **M3 exit test (1,000 beasts stable for 10 sim-years) is not met at the last soak and has not been re-run.** The strict soak (total 300 to 3,000) on the 90-species roster gave year-10 totals of 1,103 to 1,573 on six seeds and 32 to 41 of 90 species surviving (DECISIONS.md "Beings round 2"). Since then fights, aggro, morphs, castes, lovers and conversions were added; the effect on the soak was never measured.
- **M5 to M8 exit tests are UNVERIFIED, not failed.** Culture, dominions, capture, rebellion and boats are all wired into `Sim.step`, but no run measured the roadmap exit tests (a hamlet grows to a town, two dominions fight and make peace, a custom spreads). The IndexedDB save path has no recorded browser run.
- **Corrections to the previous pass:** Heartbeat, watchdog, contentHash handshake and the degradation ladder exist. The 512 realm is offered and Titan sits behind Advanced. Hold-to-raise, long-press and double-tap are wired (undo is not). `meleeSwing` is called by `predate`. A town tier label exists. Dominions, culture (`addCustom`, `startIntrigue`, `addFamily`), rulers, tax ledger, boats, capture, raze, rebellion, spells and rites are built. The minimap, world tooltips, cursor arrows, history ticker and 56 Insight rows are built. Procedural sprites exist, so art is no longer NOT BUILT. Powers are 250 (not 154), statuses 32 (not 24), buildings 31 (not 7), settings 78 (not 75). Heartbeat and the other "Current state" cells in the DECISIONS.md top table (heartbeat never posted, 6 buildings, 159 powers, inert culture) are stale; the dated sections below that table win.
- **Still true, re-checked:** `liveCount: () => 0` in `powers/handlers.ts`; `writeBook` has no caller; the Math.exp/pow/hypot lint gap; `countsCredited`, `grantAllowed` and `achievementProgress` have no caller outside tests; `check:budgets` is in CI.
- Spec files were not edited. The build plan is the parent folder's `BUILD-PLAN.md` (not in the Spec folder). `LEGAL-CHECKLIST.md` rows are not tracked here on purpose (owner decision).

## Still open, and why

Spec gap (the spec is silent, contradictory or leaves the data open):

- Low-fuel pace (06 2.1, 07 7.1 give no pace term) and persistent corpses (06 7.3 default is none).
- Sound shift rule list, name sets, dialect phonology inventories and the shape-to-inventory mapping (11 section 6).
- Hamlet cap (`baseHamlets`, `hamletBonus`, aggression are not in the Spec), the sea-link loyalty term, leader `loyaltyMood`, the Age loyalty bonus (10 section 5).
- 10 section 16 test 5 contradicts section 7 (capture); code follows section 7. 02 section 12 test 2 first case cannot hold. 17 section 2.2 cites a missing section 7.5.
- Soldier wages, recruit cost, company size, leader warfare scale and many other TUNE values have no spec number.

Owner decision (kept cut, dormant or chosen on purpose):

- Campaign Forecast stays cut (no `declareCampaign`). `writeBook` and `write_book` stay dormant. Crash send and endpoint not built (OPEN-19-1, nothing leaves the device). Unowned projectile kinds, `acid_glob` and the magmaling gear owner stay cut.
- Hamlet capture rule stays on (`HAMLET_CAPTURE`); raze means "empty hamlet". Firefox and WebKit are out of the test matrix. Legal checklist rows are not tracked. Package version 0.1.0.

Not built (buildable; no spec blocker):

- Content: 29 buildings, 24 statuses, Shape 38, Grow 28 and Sky 32 powers, 7 Favour entries (`fav_hush` is now possible), the 3 missing rites and 2 spells, most of the 07 task catalogue, 18d bush picking and fire burn results.
- Systems: undo (needs a per-stroke journal in the sim), tax money movement, campaign ending, allied-hamlet defection, boat passengers, building damage, ranged wear, item spells, genome effects on stats, SAB mode, fatal invariant checks, the worker log ring.
- Client: nameplates on Beings, i18n, dev-console commands, achievement popup and cross-Realm progress, render effects (night lights, shadows, bloom, particles), sprite atlases, audio feed for night and calamity, saves thumbnails and quarantine.
- Checks: benchmark scenes and a perf gate in CI, tablet and phone-landscape in CI, Lighthouse, COOP and COEP, a chaos test, a device pass, a soak re-run, a browser run of the IndexedDB and dialog paths, and a lint for Math.exp, Math.pow and Math.hypot in the sim.

## UX redesign (2026-10-28 spec, parts A to H)

- A foundation: Preact shell over the Pixi map (`src/ui/shell`), the store (`store.ts`), tokens (`tokens.css`), top pills, toasts.
- B power sheet: chips, grid, search, recent row and favourites, brush, cooldown rings (`PowerSheet.tsx`, `powerCatalog.ts`).
- C Atlas: tabs and back stack hosting the window bodies, Settings grouped and searchable, Discoveries tab (`Atlas.tsx`, `atlasRoutes.ts`).
- D info card and touch: `InfoCard.tsx`; a tap inspects at once; zoom buttons; toasts and the coach share the top column.
- E progressive discovery: `src/content/discoveries.ts`, `src/ui/shell/discovery.ts`, the first-launch coach (`Coach.tsx`).
- F deploy effects: `src/render/effects.ts`, `effectRecipes.ts`; the `map.effects` step is the first on the degrade ladder.
- G keymap: `src/ui/shell/keymap.ts`; the Keys window and the Settings keys list come from it.
- H accessibility: contrast across three themes (tests/a11y); keyboard walkthrough (tests/e2e/a11y-keys.spec.ts); retired settings removed.
- Dropped or open: Ctrl+Z (DECISIONS.md); info cards for towns and buildings; the pill pulse for toggles.
