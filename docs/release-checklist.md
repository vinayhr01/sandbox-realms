# Release checklist (status as of this commit)

Not legal advice. Items are marked from what the repository actually contains. "Not done" means no evidence in the repo, not that the work is impossible.

## Legal and originality (from Spec/LEGAL-CHECKLIST.md)
- [ ] Art, audio, fonts and text created or licensed for the project; `ASSET-LICENSES.md` written. Not done: no art or audio beyond placeholder SVG and code-drawn tiles.
- [x] Third-party libraries listed: pixi.js 8, vite, vitest, playwright, typescript (see package.json).
- [ ] Trademark and name search. Not done.
- [ ] Name audit of creatures, powers, traits and UI strings. Not done.
- [ ] Look-and-feel review by someone outside the project. Not done.
- [x] No affiliation claims in the repo (checked the README and index.html).
- [x] Privacy: no analytics or network calls in the code; saves and the crash journal stay in local storage (recovery.ts, chronicle.ts).
- [ ] Store and age-rating review. Not done.
- [ ] Lawyer review before commercial release. Not done.

## Platform (from PLATFORM-REQUIREMENTS section 6)
- [x] Playwright smoke suite exists at 4 viewports: 1280x720, 390x844 (touch), 844x390 (touch), 820x1180 (touch). Last run in this change: `--project=desktop-chromium` passed 10 of 10 (smoke, panels and platform smoke). The other three original projects (phone-portrait, phone-landscape, tablet) were not re-run in this change.
- [x] Platform projects for Chromium, Firefox and WebKit at 360x640 (touch) and 1920x1080 (playwright.config.ts). tests/e2e/platform-smoke.spec.ts (load, sim clock, no horizontal overflow, tap on the map) passes on Chromium and WebKit at both sizes here.
- [ ] Firefox and WebKit full runs. Partial: WebKit runs only the platform smoke. Firefox is configured but cannot launch on this Windows machine ("side-by-side configuration is incorrect" at process start), so it has not run anywhere yet. The smoke and panels specs have not run on Firefox or WebKit.
- [x] CI runs typecheck, unit tests, determinism lint, the golden replay test, build budgets, and one Playwright job per browser (.github/workflows/ci.yml). Not yet run on GitHub.
- [ ] Per-milestone screenshot diffs of each layout class. Not done: screenshots are written but not compared.
- [ ] Lighthouse mobile run (PWA, accessibility >= 90, performance budget). Not done.
- [ ] Real-device checks on a low Android and an iPhone. Not done.
- [ ] Golden replay hash identical across engines. Not done: only Node is checked.

## PWA
- [x] Maskable PNG icons at 192 and 512 generated from public/icon.svg by scripts/make-icons.mjs (artwork inside the 80% safe zone, full-bleed background) and listed in the manifest. The service worker precaches them.
- [ ] Installability checked in a browser. Not done.

## Performance (from 17 section 13 and PERFORMANCE-PLAN)
- [x] Build-size budgets: main chunk about 83 KB gzip (limit 350), worker chunk about 26 KB gzip (limit 250). Checked by scripts/check-budgets.mjs after `npm run build`.
- [x] Determinism lint: no Math.random, Date or performance.now in sim or shared code (scripts/check-determinism.mjs).
- [x] Sim tick cost measured in tests/unit/tick-cost.test.ts, well under 8 ms at 128 to 512 sizes.
- [x] Ecosystem soak, chosen criterion (DECISIONS.md): total beasts stay between 300 and 3,000 every year for 10 years on the unseen seeds 1, 555 and 31337. Not part of the criterion: all 8 species alive (7 or 8 survive per seed), which is not met.
- [ ] Frame-rate target (60 fps at 512x512 on mid phones). Not done: headless WebGL runs at 1 to 3 fps.
- [ ] Memory soak (60 minutes at 10x, heap growth under 5%). Not done.

## Accessibility (from 13 section 14)
- [x] Dark theme text contrast: primary text 14.56:1, secondary 7.74:1, ink on accent 10.87:1 (tests/a11y/contrast.test.ts, >= 4.5 required).
- [ ] Light theme contrast. Not done: the light theme is defined but not tested.
- [ ] Screen-reader pass and keyboard-only pass. Not done.
- [ ] Text scaling to 200 percent. Not done.
- [x] prefers-reduced-motion disables transitions and animations (styles.css).

## Save and recovery (from 19 and 15)
- [x] Save round trip, corruption and version rejection, and resume determinism (tests/unit/chronicle.test.ts).
- [x] Save logic in src/app/saves.ts: slot model (12 manual, quick, autosave ring of 5, suspend), atomic write with previous generation, quota soft cap, autosave and suspend timing, import check, export file naming and delivery route. Tests: tests/unit/saves-model.test.ts and saves-service.test.ts (memory backend).
- [ ] Autosave, slots, import and export UI. Not done: no UI calls SaveService yet. The IndexedDB backend is type-checked but has not run in a browser or under fake-indexeddb (not installed). Checksum-failure handling and the quarantine store are not implemented.
- [ ] Recovery ladder and user-facing recovery dialog. Partial: decisions are in src/app/recovery.ts (decideRecovery for restart from autosave, reset Realm, fatal dialog; boot-loop guard; Safe Mode profile; restore offers), tested in tests/unit/recovery-ladder.test.ts. Not wired into main.ts, and the dialog has no restart, reset or Safe Mode actions yet.
