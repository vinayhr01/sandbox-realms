# Release checklist (release close 4, version 0.1.0)


Status key:

- **DONE (recorded)**: met, per the evidence in the repo or in an earlier recorded run. Not re-run in this close.
- **PARTIAL**: some of it is met; the rest is open.
- **NOT DONE**: no evidence in the repo.
- **NOT RUN**: the check exists but has not been run in a state that counts.
- **LEFT TO OWNER**: a decision or review outside the repo. Not written here.

Summary: 0 gates are closed for a commercial release. The version is 0.1.0, which is a pre-release marker, not a release sign-off.

## Browser and device status

- **Browsers that ran (recorded):** Chromium (desktop smoke, panels and platform specs). WebKit was removed from the test matrix.
- **Firefox:** configured in `playwright.config.ts` and in CI, but could not launch on the Windows dev machine. Has not run anywhere. NOT RUN.
- **Devices:** no real-device checks. NOT DONE.
- **Not run in CI:** tablet and phone-landscape Playwright projects, `npm run bench`, `npm run test:a11y` and `npm run soak`. Documented; CI not changed. NOT RUN in CI.

## Platform (PLATFORM-REQUIREMENTS section 6)

- [DONE (recorded)] Playwright projects defined in `playwright.config.ts`: desktop-chromium (1280x720), phone-portrait (390x844, touch), phone-landscape (844x390, touch), tablet (820x1180, touch), and platform project for Chromium at 360x640 (touch) and 1920x1080.
- [DONE (recorded)] Chromium desktop smoke, panels and windows specs (`tests/e2e/`) passed in the last recorded run (desktop-chromium: 10 of 10 across smoke and panels).
- [DONE (recorded)] Platform smoke (`tests/e2e/platform-smoke.spec.ts`: load, sim clock, no horizontal overflow, tap on the map) passed on Chromium at 360x640 and 1920x1080 in the last recorded run.
- [NOT DONE] Firefox runs. Cannot launch on this Windows machine. CI has the job, not yet run on GitHub.
- [DONE] WebKit removed from the test matrix (DECISIONS.md, owner decision).
- [NOT DONE] Tablet and phone-landscape projects run in CI. CI matrix does not list them.
- [PARTIAL] CI (`.github/workflows/ci.yml`) runs typecheck, determinism lint, build, budgets, unit tests and one Playwright job per browser. Not yet verified on GitHub in this state. NOT RUN on GitHub.
- [NOT DONE] Per-milestone screenshot diffs. Screenshots are written but not compared.
- [NOT DONE] Lighthouse mobile run (PWA, accessibility >= 90, performance budget).
- [NOT DONE] Real-device checks on a low Android and an iPhone.
- [NOT DONE] Golden replay hash identical across engines. Only Node runs the check. Also: `GOLDEN_HASH` is not re-baselined since Beings build 3 (see DECISIONS.md), so the golden test is NOT RUN against the current code.
- [NOT DONE] COOP and COEP headers and the SharedArrayBuffer mode. Not built.

## PWA

- [DONE (recorded)] Maskable PNG icons at 192 and 512 generated from `public/icon.svg` by `scripts/make-icons.mjs` (`npm run icons`), listed in `public/manifest.webmanifest`, precached by `public/sw.js`.
- [NOT DONE] Installability checked in a browser.
- [NOT DONE] Offline play checked in a browser.

## Performance (17 section 13, PERFORMANCE-PLAN)

- [DONE (recorded)] Build-size budgets gate CI: `scripts/check-budgets.mjs` runs after `npm run build` (main about 83 KB gzip against 350 KB; worker about 26 KB against 250 KB). Last recorded values; NOT RUN in this close.
- [DONE (recorded)] Determinism lint: no `Math.random`, `Date.now`, `new Date(`, `performance.now` or `crypto.getRandomValues` in `src/sim`, `src/shared` or `src/content` (`scripts/check-determinism.mjs`; CI `determinism` job). `Math.exp`, `Math.pow` and `Math.hypot` are not banned. NOT RUN in this close.
- [NOT RUN] Sim tick cost in `tests/unit/tick-cost.test.ts` (median, 50 ms gate; 8 ms budget is a warning). Last recorded run only.
- [PARTIAL] Ecosystem soak. The M3 exit (all species alive for 10 years) was not reached: 32 to 41 of 90 species survived year 10 on six seeds; year-10 totals 1,103 to 1,573 on the 90-species roster. See `DECISIONS.md` (Beings round 2).
- [NOT DONE] Frame-rate target (60 fps at 512x512 on mid phones). Headless WebGL runs at 1 to 3 fps.
- [NOT DONE] Memory soak (60 minutes at 10x, heap growth under 5%).
- [NOT DONE] Benchmark scenes and a CI perf gate.
- [NOT DONE] Quality ladder (degradation). `degradeLevel` is read in `src/app/saves.ts` and never set.

## Accessibility (13 section 14)

- [DONE (recorded)] Dark theme text contrast: primary 14.56:1, secondary 7.74:1, ink on accent 10.87:1 (`tests/a11y/contrast.test.ts`, at least 4.5 required). The a11y config is not in CI. NOT RUN in this close.
- [NOT DONE] Light theme contrast. The light theme is defined but not tested.
- [NOT DONE] Screen-reader pass and keyboard-only pass.
- [NOT DONE] Text scaling to 200 percent.
- [DONE (recorded)] `prefers-reduced-motion` disables transitions and animations (`src/ui/styles.css`).

## Save and recovery (15, 19)

- [DONE (recorded)] Save codec round trip, corruption and version rejection, resume determinism (`tests/unit/chronicle.test.ts`). NOT RUN in this close.
- [DONE (recorded)] Save service model in `src/app/saves.ts`: slots, atomic write with previous generation, quota soft cap, autosave timing, import check, export file naming. Tests: `tests/unit/saves-model.test.ts`, `tests/unit/saves-service.test.ts` (memory backend). NOT RUN in this close.
- [PARTIAL] Save, load, delete, export, import and autosave run in the game through the sim worker's capture and restore commands (`src/app/main.ts` `liveRealm`, `src/sim/worker.ts`, `src/app/save-controller.ts`). No recorded browser run of this path.
- [NOT RUN] IndexedDB backend in a real browser (type-checked and model-tested only).
- [NOT DONE] Checksum-failure handling and the quarantine store.
- [PARTIAL] Sentinel, local journal and fatal dialog wired in `src/app/main.ts`. No browser run of the crash record.
- [PARTIAL] Recovery ladder and restore prompt wired in `src/app/main.ts` (`decideRecovery`, `restoreOffers`, boot-loop dialog). No recorded browser run of the dialog actions.
- [NOT DONE] Crash record, consent, export and chaos test (19 section 14 release gate). Browser checks listed in `docs/QA-LOG.md` ("Not yet run") are NOT RUN.

## Originality and privacy gates that are code-side

- [NOT RUN] Crash record consent gate with `privacy.errorReports` off: "Export crash record" refuses and downloads nothing. Written by code reading only.
- [NOT RUN] Crash records appear in IndexedDB `sr-crash` and fall back to localStorage `sr-crash-lite` when IndexedDB is blocked. Written by code reading only.

## Not in the two source checklists, noted for the owner

- `package.json` version is 0.1.0 (set in this close; it was 1.0.0 before). `package-lock.json` root version fields still read 1.0.0; the next `npm install` will rewrite them. Not changed here.
