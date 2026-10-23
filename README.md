# Sandbox Realms

Browser god-game sandbox for mouse and touch. Milestones 0 and 1 of `../BUILD-PLAN.md`.

## Run

```bash
npm install
npm run dev          # http://localhost:5173/?debug&seed=42&size=4
```

Query parameters: `seed` (integer), `size` (sizeStep: 3 Small, 4 Standard, 5 Large, 8 Colossal), `debug` (show the perf line).

## Checks

```bash
npm run typecheck
npm test             # unit: rng, realm, brush, sim, scheduler, golden replay
npm run bench        # sim tick cost report
npm run check:determinism
npm run build
npx playwright install chromium
npm run test:e2e     # desktop, phone portrait/landscape, tablet
```

## Layout

- `src/shared` protocol, constants, seeded RNG (no platform random or clock here)
- `src/sim` deterministic sim core (`sim.ts`, `realm.ts`, `brush.ts`), pump scheduler, worker shell
- `src/content` ground kinds and elevation table
- `src/render` Pixi terrain renderer (index-texture shader) and camera
- `src/ui` pointer arbitration and styles
- `src/app` bootstrap, sim client, crash-capture skeleton
- `tests/unit` Vitest, `tests/e2e` Playwright

See `DECISIONS.md` for what was chosen and what is deferred.
