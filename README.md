# Sandbox Realms

**Play free in your browser: https://vinayhr01.github.io/sandbox-realms/**

Sandbox Realms is a free browser god game and world-building sandbox. Shape the land, seed biomes, call weather and disasters, and watch about 90 creatures and six peoples build hamlets, form dominions, creeds and cultures, and wage campaigns. It is a simulation sandbox with a deterministic world: the same seed gives the same realm. It runs with mouse, touch and keyboard, needs no install, and can run offline as a web app.

- Terrain tools: raise, lower and inspect tiles with round, square or diamond brushes
- Biomes, weather and natural disasters that change the realm over time
- Creatures, hamlets, dominions, armies and campaigns
- Creeds, customs, dialects and cultures
- Mouse, touch and keyboard controls; works offline as an installable web app

Development status: milestones 0 to 12 of `../BUILD-PLAN.md` are partly built: the engine, terrain, beings, combat, saves, settlements, dominions, culture and a first set of powers run in the game. Many spec items are still missing or unwired; `docs/spec-coverage.md` lists each one.

## Run

```bash
npm install
npm run dev          # http://localhost:5173/?debug&seed=42&size=4
```

Query parameters: `seed` (integer), `size` (sizeStep: 3 Small, 4 Standard, 5 Large; the URL also accepts 2 to 9, and the New Realm menu offers 3 to 5), `debug` (show the perf line).

## Checks

Scripts from `package.json`:

```bash
npm run typecheck         # tsc on tsconfig.json and tsconfig.sim.json (no emit)
npm test                  # unit tests (vitest run, tests/unit)
npm run bench             # sim tick cost (tests/unit/tick-cost.test.ts, verbose)
npm run check:determinism # no Math.random, Date.now, new Date(, performance.now or crypto.getRandomValues in src/sim, src/shared, src/content
npm run build             # both typechecks, then vite build
npm run check:budgets     # gzip size budgets; run after build
npm run icons             # regenerate the PNG icons from public/icon.svg (needs Playwright's Chromium)
npm run test:a11y         # contrast checks (vitest.a11y.config.ts)
npm run soak              # ecosystem soak (vitest.soak.config.ts); slow, not a pass/fail gate
npx playwright install chromium
npm run test:e2e          # Playwright projects in playwright.config.ts (desktop, phone, tablet, 360x640 and 1920x1080 per browser)
```

CI (`.github/workflows/ci.yml`) runs typecheck, unit tests, build and budgets in one job, the determinism lint and golden test in their own job, and four Chromium Playwright shards. The tablet and phone-landscape Playwright projects are defined but not in CI's matrix, so they never run there. Firefox could not launch on the Windows dev machine. WebKit is not in the test matrix; Chromium is the only browser tested. See `docs/release-checklist.md` for the full status.

## Layout

- `src/shared` protocol, constants, seeded RNG (no platform random or clock here)
- `src/sim` deterministic sim core: `sim.ts` (step order), `realm.ts`, `brush.ts`, `clock.ts`, `ages.ts`, `rules.ts`, `worldgen.ts`, `flora.ts`, `weather.ts`, `combat.ts`, `effects.ts`, `explosions.ts`, `calamity.ts`, `stats.ts`, `chronicle.ts` (saves)
- `src/sim/terrain` fire, water, magma, freeze, biome spread; `src/sim/beings` beasts; `src/sim/settlements` hamlets; `src/sim/dominions` wars and pacts; `src/sim/culture` creeds and dialects; `src/sim/powers` power and calamity handlers
- `src/content` grounds, biomes, beasts, powers, achievements (data)
- `src/render` Pixi terrain renderer (index-texture shader) and camera
- `src/ui` pointer arbitration, styles, panels (options, power bar, list window, tutorial)
- `src/audio` audio model (volumes, voice caps, hidden tab) and the WebAudio engine, built in `main.ts` and unlocked on the first gesture
- `src/app` bootstrap, sim client, worker, recovery (crash journal)
- `tests/unit`, `tests/a11y`, `tests/soak` Vitest; `tests/e2e` Playwright

See `DECISIONS.md` for what was chosen and what is deferred, and `docs/spec-coverage.md` for the spec coverage review.
