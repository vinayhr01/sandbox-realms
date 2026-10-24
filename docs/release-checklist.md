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
- [x] Playwright smoke suite exists at 4 viewports: 1280x720, 390x844 (touch), 844x390 (touch), 820x1180 (touch). Last run: 32 of 32 passed on Chromium only (8 tests at each of 4 projects).
- [ ] Firefox and WebKit runs. Not done: only Chromium is installed here.
- [ ] Per-milestone screenshot diffs of each layout class. Not done: screenshots are written but not compared.
- [ ] Lighthouse mobile run (PWA, accessibility >= 90, performance budget). Not done.
- [ ] Real-device checks on a low Android and an iPhone. Not done.
- [ ] Golden replay hash identical across engines. Not done: only Node is checked.

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
- [ ] Autosave, slots, import and export UI. Not done.
- [ ] Recovery ladder and user-facing recovery dialog. Not done: only a fatal dialog and a local journal exist.
