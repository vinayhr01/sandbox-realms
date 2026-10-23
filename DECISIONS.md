# Decisions

Choices made while building M0 and M1 (BUILD-PLAN.md). Spec `OPEN` items use the stated default.

## Built

| Area | Choice | Note |
|---|---|---|
| Repo | single package, `src/` split by area | 17 section 14 monorepo deferred until a second package exists |
| Stack | Vite 8, TypeScript 7 strict, PixiJS 8 (WebGL), Vitest 5, Playwright | versions as installed |
| Sim | pure `Sim` class, worker shell at 20 tps, MessageChannel pump, 8 ms budget | ticks discarded when over budget (world slows) |
| Determinism | sfc32 seeded RNG, FNV-1a state hash every 20 ticks, `scripts/check-determinism.mjs` | golden replay in `tests/unit/golden.test.ts` |
| Protocol | numeric kinds, `seq` per command, transfer-mode frames with a buffer pool | Mode S (SharedArrayBuffer) not built |
| Terrain | RGBA8 index texture (ground, cover, elevation, flags) + palette texture, fragment shader | one 576x576 texture serves every size; `uView.w` carries the live side |
| Brush | raise/lower, circle/square/diamond, radius 0-16, dab per line tile | raise step 5 per dab (TUNE) |
| Input | one Pointer Events path; drag with armed brush paints, otherwise pans; pinch zooms; wheel zooms | stroke segments are sent once per frame, joint tiles not repeated (`includeStart`) |
| Camera | fit on load, zoom 0.5x-8x of fit (max 48 px/tile), 16 px edge margin | |
| Layout | portrait column, landscape (max-height 500) tool column on the right | |
| PWA | hand-written service worker, no `skipWaiting` | Workbox deferred (OPEN in 17) |
| Recovery | unclean-exit sentinel, local journal, fatal dialog | 19 sections 7-10 deferred |

## Deferred (not in M0/M1)

- Mode S (SharedArrayBuffer) and cross-origin isolation headers.
- Hollows and refill (04 section 2): lowering sea tiles only deepens them for now.
- Undo, perf HUD beyond the `?debug` line, benchmark CI gate against budgets.
- Cover, flora, structures, beings, weather; the ground list is the 12 terrain kinds only.
- Full tool catalogue (path, till, sponge, flood, etc.), ring and scatter brushes, the Realm tab only creates new realms.
- PNG icons (only the SVG icon is shipped; maskable PNGs needed before release).
- ESLint and dependency-cruiser boundaries.

## Measurements and limits

- Headless Chromium here uses software WebGL: about 1-3 fps in the Playwright runs. Frame-rate targets (60 fps at 512x512, phone matrix) are unverified; they need real devices.
- Each dirty row set re-uploads the full 576x576 index texture (about 1.3 MB). Partial sub-uploads are the next optimisation if profiling shows the upload dominates.
- Firefox and WebKit are not in the Playwright projects yet (only Chromium is installed here).
- Sim tick cost measured at 128-512 sizes is well under the 8 ms budget (`npm run bench`).

## Milestones 2 and 3

| Area | Choice | Spec gap |
|---|---|---|
| Clock | calendar from ticks; ages rotate with speed multiplier; Veiled resolves on entry | 12 ages, default slots and duration roll as 02 section 5 |
| Rules | 49 rules with defaults, `forbidden_lore` one-way, age enable flags | effects are read by systems; most consumers come with their milestones |
| Worldgen | value noise (integer lattice), forceHeight, centre shapes, basin, lake, low/high ground, shore snap, round and square edges, typing, mountain edges, freeze peaks, weighted biome flood fills, 10 flora passes, starting beasts | gradient noise replaced by value noise; blob masks are radial, not bitmaps; rivers, lakes, replace rules and the Chessboard/Cells/Warren layouts are not built; Sleeping Crater has no volcano |
| Terrain | fire with scars, sea refill and hollows, magma levels with flow and cooling, freeze and thaw with shoal spread, heat, biome spread | slime, acid, lightning and explosive chains are not built (M4) |
| Flora | 10 kinds from 18d, wild seeding in patches, growth stages, spread, lifespan, drought and frost passes | most of the 18d registry is not built |
| Beings | species table of 8 from 18a, SoA store with generations, fuel and starvation, ageing and natural death, mating with gestation and litter, flee/hunt/graze/wander | no traits, genes or strains (05, 18b), no stat assembly, no AI task system (07 section 4 onward) |

### Ecosystem status (M3 exit test not met)

`npm run soak` runs 1,000 beasts for 10 sim-years. Population stays bounded (about 1,400 to 2,000, under the cap) and nothing crashes, but species balance is not stable: thistlehart and nectarbuzz fall to a handful by year 10, cluckling dies out early, and starvation and predation dominate deaths (see the log written by the soak). The per-species numbers are TUNE and the pursuit model is simple (greedy steps, no paths). Not fixed yet.

### Notes

- `ticksForFrame` in `clock.ts` clamps `frameDt` to 0.1 s as 02 section 2 says; 02 section 12 test 2 expects 20 ticks for a 0.5 s frame at x2, which contradicts the clamp. The clamp wins; the test expectation is not implemented.
- Golden replay hash moved again with beings in the state hash.
