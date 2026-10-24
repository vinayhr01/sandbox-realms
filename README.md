# Sandbox Realms

Browser god-game sandbox for mouse and touch. Milestones 0 to 12 of `../BUILD-PLAN.md` are partly built: the engine, terrain, beings, combat, saves, settlements, dominions, culture and a first set of powers run in the game. Many spec items are still missing or unwired; `docs/spec-coverage.md` lists each one.

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
npm run check:determinism # no Math.random, Date or performance.now in sim/shared
npm run build             # both typechecks, then vite build
npm run check:budgets     # gzip size budgets; run after build
npm run test:a11y         # contrast checks (vitest.a11y.config.ts)
npm run soak              # ecosystem soak (vitest.soak.config.ts); slow, not a pass/fail gate
npx playwright install chromium
npm run test:e2e          # Playwright projects in playwright.config.ts (desktop, phone, tablet, 360x640 and 1920x1080 per browser)
```

CI (`.github/workflows/ci.yml`) runs typecheck, determinism, build, budgets, unit tests and one Playwright job per browser. Firefox could not launch on the Windows dev machine; WebKit and Chromium have run here. See `docs/release-checklist.md` for the full status.

## Layout

- `src/shared` protocol, constants, seeded RNG (no platform random or clock here)
- `src/sim` deterministic sim core: `sim.ts` (step order), `realm.ts`, `brush.ts`, `clock.ts`, `ages.ts`, `rules.ts`, `worldgen.ts`, `flora.ts`, `weather.ts`, `combat.ts`, `effects.ts`, `explosions.ts`, `calamity.ts`, `stats.ts`, `chronicle.ts` (saves)
- `src/sim/terrain` fire, water, magma, freeze, biome spread; `src/sim/beings` beasts; `src/sim/settlements` hamlets; `src/sim/dominions` wars and pacts; `src/sim/culture` creeds and dialects; `src/sim/powers` power and calamity handlers
- `src/content` grounds, biomes, beasts, powers, achievements (data)
- `src/render` Pixi terrain renderer (index-texture shader) and camera
- `src/ui` pointer arbitration, styles, panels (options, power bar, list window, tutorial)
- `src/audio` audio model (not connected to WebAudio)
- `src/app` bootstrap, sim client, worker, recovery (crash journal)
- `tests/unit`, `tests/a11y`, `tests/soak` Vitest; `tests/e2e` Playwright

See `DECISIONS.md` for what was chosen and what is deferred, and `docs/spec-coverage.md` for the spec coverage review.
