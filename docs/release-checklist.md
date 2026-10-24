# Release checklist (status at main 0172ff0)

Not legal advice. Each item is marked from what the repository contains and from the runs recorded here. "Not done" means no evidence in the repo, not that the work is impossible. Spec references are to `../Spec/`.

Browser and device status, in one place:

- **Browsers that ran:** Chromium (desktop smoke, panels and platform specs) and WebKit (platform smoke at 360x640 and 1920x1080, from the last recorded local run).
- **Firefox:** configured in `playwright.config.ts` and in CI (`.github/workflows/ci.yml`), but it could not launch on the Windows dev machine ("side-by-side configuration is incorrect"). It has not run anywhere.
- **Devices:** no real-device checks have been done (no low Android, no iPhone).
- **Not run in CI:** the tablet and phone-landscape Playwright projects; `npm run bench`; the a11y, perf and soak Vitest configs (`vitest.config.ts` includes `tests/unit` only).

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
- [x] Playwright projects defined in `playwright.config.ts`: desktop-chromium (1280x720), phone-portrait (390x844, touch), phone-landscape (844x390, touch), tablet (820x1180, touch), and platform projects for Chromium, Firefox and WebKit at 360x640 (touch) and 1920x1080.
- [x] Chromium desktop smoke, panels and windows specs (`tests/e2e/`) passed in the last recorded run (desktop-chromium: 10 of 10 across smoke and panels).
- [x] Platform smoke (`tests/e2e/platform-smoke.spec.ts`: load, sim clock, no horizontal overflow, tap on the map) passed on Chromium and WebKit at 360x640 and 1920x1080 in the last recorded run.
- [ ] Firefox runs. Not done: cannot launch on this Windows machine. CI has the job, not yet run on GitHub.
- [ ] Full runs on WebKit beyond platform smoke. Not done.
- [ ] Tablet and phone-landscape projects run. Not done: defined but not in CI.
- [x] CI (`.github/workflows/ci.yml`) runs typecheck, determinism lint, build, budgets, unit tests and one Playwright job per browser. Not yet verified on GitHub in this state.
- [ ] Per-milestone screenshot diffs. Not done: screenshots are written but not compared.
- [ ] Lighthouse mobile run (PWA, accessibility >= 90, performance budget). Not done.
- [ ] Real-device checks on a low Android and an iPhone. Not done.
- [ ] Golden replay hash identical across engines. Not done: only Node runs the check.
- [ ] COOP and COEP headers and the SharedArrayBuffer mode. Not built.

## PWA
- [x] Maskable PNG icons at 192 and 512 generated from `public/icon.svg` by `scripts/make-icons.mjs`, listed in `public/manifest.webmanifest`, precached by `public/sw.js`.
- [ ] Installability checked in a browser. Not done.
- [ ] Offline play checked in a browser. Not done.

## Performance (17 section 13, PERFORMANCE-PLAN)
- [x] Build-size budgets gate CI: `scripts/check-budgets.mjs` runs after `npm run build` (main about 83 KB gzip against 350 KB; worker about 26 KB against 250 KB). Last recorded values; re-check after changes.
- [x] Determinism lint: no `Math.random`, `Date` or `performance.now` in sim or shared code (`scripts/check-determinism.mjs`). Note: `Math.exp`, `Math.pow` and `Math.hypot` are used in sim code and the lint does not ban them.
- [x] Sim tick cost measured in `tests/unit/tick-cost.test.ts` (median, 50 ms gate; the 8 ms budget is a warning).
- [~] Ecosystem soak. Not met: the M3 exit (all species alive for 10 years) was not reached. The chosen criterion (total beasts 300 to 3,000 each year on every seed) was met on the 8-species roster; it has not been re-run on the 90-species roster. See `DECISIONS.md`.
- [ ] Frame-rate target (60 fps at 512x512 on mid phones). Not done: headless WebGL runs at 1 to 3 fps.
- [ ] Memory soak (60 minutes at 10x, heap growth under 5%). Not done.
- [ ] Benchmark scenes and a CI perf gate. Not done: `tests/perf/budgets.ts` holds constants only.
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
- [ ] Autosave, slots, import and export in the running game. Not done: `encodeChronicle` and `decodeChronicle` have no caller outside tests, and the Chronicle window lists slots only.
- [ ] IndexedDB backend in a real browser. Not done (type-checked only).
- [ ] Checksum-failure handling and the quarantine store. Not done.
- [x] Sentinel, local journal and fatal dialog are wired in `src/app/main.ts`.
- [ ] Recovery ladder and recovery dialog actions. Not done in play: `decideRecovery`, `restoreOffers` and Safe Mode run only in `tests/unit/recovery-ladder.test.ts`.
- [ ] Crash record, consent, export and chaos test (19 section 14 release gate). Not done.
