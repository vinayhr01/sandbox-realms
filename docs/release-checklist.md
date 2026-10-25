# Release checklist (status at main 2fc292c)

Not legal advice. Each item is marked from what the repository contains and from the runs recorded here. "Not done" means no evidence in the repo, not that the work is impossible. Spec references are to `../Spec/`.

Browser and device status, in one place:

- **Browsers that ran:** Chromium (desktop smoke, panels and platform specs). WebKit was removed from the test matrix.
- **Firefox:** configured in `playwright.config.ts` and in CI (`.github/workflows/ci.yml`), but it could not launch on the Windows dev machine ("side-by-side configuration is incorrect"). It has not run anywhere.
- **Devices:** no real-device checks have been done (no low Android, no iPhone).
- **Not run in CI:** the tablet and phone-landscape Playwright projects. They are defined in `playwright.config.ts` but no CI matrix entry lists them, so they never run in CI. This is documented here; CI was not changed. Run them locally with `npx playwright test --project=tablet --project=phone-landscape`. Also not in CI: `npm run bench`, `npm run test:a11y` and `npm run soak`. `vitest.config.ts` includes `tests/unit` only.

## Legal and originality (LEGAL-CHECKLIST)
- [ ] Art, audio, fonts and text created or licensed; `ASSET-LICENSES.md` written. Not done: no art or audio beyond placeholder SVG and code-drawn tiles.
- [x] Third-party libraries listed: pixi.js 8, vite, vitest, playwright, typescript (see `package.json`).
- [ ] Trademark and name search. Not done.
- [ ] Name audit of creatures, powers, traits and UI strings. Not done (no automated lint either).
- [ ] Look-and-feel review by someone outside the project. Not done.
- [x] No affiliation claims in the repo (checked `README.md` and `index.html`).
- [x] Privacy: no analytics SDK or network calls found in the code; settings, saves and the crash journal use local storage or IndexedDB on the device.
- [ ] Store and age-rating review. Not done.
- [ ] Lawyer review before commercial release. Not done.

## Platform (PLATFORM-REQUIREMENTS section 6)
- [x] Playwright projects defined in `playwright.config.ts`: desktop-chromium (1280x720), phone-portrait (390x844, touch), phone-landscape (844x390, touch), tablet (820x1180, touch), and platform project for Chromium at 360x640 (touch) and 1920x1080.
- [x] Chromium desktop smoke, panels and windows specs (`tests/e2e/`) passed in the last recorded run (desktop-chromium: 10 of 10 across smoke and panels).
- [x] Platform smoke (`tests/e2e/platform-smoke.spec.ts`: load, sim clock, no horizontal overflow, tap on the map) passed on Chromium at 360x640 and 1920x1080 in the last recorded run.
- [ ] Firefox runs. Not done: cannot launch on this Windows machine. CI has the job, not yet run on GitHub.
- [x] WebKit removed from the test matrix (DECISIONS.md, owner decision). Nothing to run.
- [ ] Tablet and phone-landscape projects run in CI. Not done: the CI matrix does not list them (see the note above; documented, CI unchanged).
- [x] CI (`.github/workflows/ci.yml`) runs typecheck, determinism lint, build, budgets, unit tests and one Playwright job per browser. Not yet verified on GitHub in this state.
- [ ] Per-milestone screenshot diffs. Not done: screenshots are written but not compared.
- [ ] Lighthouse mobile run (PWA, accessibility >= 90, performance budget). Not done.
- [ ] Real-device checks on a low Android and an iPhone. Not done.
- [ ] Golden replay hash identical across engines. Not done: only Node runs the check.
- [ ] COOP and COEP headers and the SharedArrayBuffer mode. Not built.

## PWA
- [x] Maskable PNG icons at 192 and 512 generated from `public/icon.svg` by `scripts/make-icons.mjs` (`npm run icons`), listed in `public/manifest.webmanifest`, precached by `public/sw.js`.
- [ ] Installability checked in a browser. Not done.
- [ ] Offline play checked in a browser. Not done.

## Performance (17 section 13, PERFORMANCE-PLAN)
- [x] Build-size budgets gate CI: `scripts/check-budgets.mjs` runs after `npm run build` (main about 83 KB gzip against 350 KB; worker about 26 KB against 250 KB). Last recorded values; re-check after changes.
- [x] Determinism lint: no `Math.random`, `Date.now`, `new Date(`, `performance.now` or `crypto.getRandomValues` in `src/sim`, `src/shared` or `src/content` (`scripts/check-determinism.mjs`; runs in CI's `determinism` job). Note: `Math.exp`, `Math.pow` and `Math.hypot` are used in sim code and the lint does not ban them.
- [x] Sim tick cost measured in `tests/unit/tick-cost.test.ts` (median, 50 ms gate; the 8 ms budget is a warning).
- [~] Ecosystem soak. Not met: the M3 exit (all species alive for 10 years) was not reached; 32 to 41 of 90 species survived year 10 on six seeds. The chosen criterion (total beasts 300 to 3,000) was run on the 90-species roster: year-10 totals were 1,103 to 1,573. The 8-species result is stale. See `DECISIONS.md` (Beings round 2).
- [ ] Frame-rate target (60 fps at 512x512 on mid phones). Not done: headless WebGL runs at 1 to 3 fps.
- [ ] Memory soak (60 minutes at 10x, heap growth under 5%). Not done.
- [ ] Benchmark scenes and a CI perf gate. Not done: there are no benchmark scenes, and `npm run bench` (the tick-cost test) is not in CI.
- [ ] Quality ladder (degradation). Not done: `degradeLevel` is read in `src/app/saves.ts` and never set.

## Accessibility (13 section 14)
- [x] Dark theme text contrast: primary 14.56:1, secondary 7.74:1, ink on accent 10.87:1 (`tests/a11y/contrast.test.ts`, at least 4.5 required). The a11y config is not in CI.
- [ ] Light theme contrast. Not done: the light theme is defined but not tested.
- [ ] Screen-reader pass and keyboard-only pass. Not done.
- [ ] Text scaling to 200 percent. Not done.
- [x] `prefers-reduced-motion` disables transitions and animations (`src/ui/styles.css`).

## Save and recovery (15, 19)
- [x] Save codec round trip, corruption and version rejection, resume determinism (`tests/unit/chronicle.test.ts`).
- [x] Save service model in `src/app/saves.ts`: slots (12 manual, quick, autosave ring of 5, suspend), atomic write with previous generation, quota soft cap, autosave timing, import check, export file naming. Tests: `tests/unit/saves-model.test.ts`, `tests/unit/saves-service.test.ts` (memory backend).
- [x] Save, load, delete, export, import and autosave (timer and on pause) run in the game through the sim worker's capture and restore commands (`src/app/main.ts` `liveRealm`, `src/sim/worker.ts`, `src/app/save-controller.ts`). No recorded browser run of this path.
- [ ] IndexedDB backend in a real browser. Not done (type-checked only).
- [ ] Checksum-failure handling and the quarantine store. Not done.
- [x] Sentinel, local journal and fatal dialog are wired in `src/app/main.ts`.
- [x] Recovery ladder and restore prompt wired in `src/app/main.ts`: `decideRecovery` on a fault, `restoreOffers` for the restore prompt (Safe Mode offers only the previous autosave generation), and the boot-loop dialog. No recorded browser run of the dialog actions.
- [ ] Crash record, consent, export and chaos test (19 section 14 release gate). Not done.
