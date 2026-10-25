# QA log

One entry per QA run. Newest entry first. A run is a real check in a real browser or on a device, with the build it used. Code review, type reading and unit tests are not QA runs unless they are listed as such here.

## Template

Copy this block for each run. Keep the fields; write "n/a" where a field does not apply.

```
### YYYY-MM-DD - short name of the run

- Build: `app.build` (the content hash) from a crash record or the console, and the git commit
- Tester: name or initials
- Browser and version:
- Device and viewport: (for example: desktop 1280x720, phone 390x844 touch)
- Scope: what was checked (for example: crash record export, not-responding dialog, restore prompt)
- Steps: numbered, short
- Result per step: pass, fail or not run, with the observed text or behaviour
- Crash records seen: ids from the export file, if any (no personal data goes in this log)
- Defects: link to the issue or describe in one line
- Follow-up: what must be checked next
```

## Entries

### 2026-10-25 - Release close 4 (documentation close, no test run)

- Build: not applicable. No build was made. Git base: `706a0c1` (branch `worktree-agent-a67e32b7752547803`); the release-close commit is on that branch.
- Tester: not applicable (documentation and metadata only; no person ran QA)
- Browser and version: n/a
- Device and viewport: n/a
- Scope: release close 4 files only (CHANGELOG.md, RELEASE-CHECKLIST.md, package.json version 0.1.0, ASSET-LICENSES.md, this log, DECISIONS.md). Development-only instruction: no tests, tsc, vitest, build or Playwright were run. `GOLDEN_HASH` not edited.
- Steps: none run.
- Result per step, by test type:
  - Unit tests (`npm test`, vitest `tests/unit`): not run
  - Typecheck (`npm run typecheck`, tsc strict on both configs): not run
  - Build (`npm run build`, vite build): not run
  - Budgets (`npm run check:budgets`): not run
  - Determinism lint (`npm run check:determinism`): not run
  - Golden replay (`tests/unit/golden.test.ts`, `GOLDEN_HASH`): not run
  - Tick cost bench (`npm run bench`): not run
  - Accessibility unit config (`npm run test:a11y`): not run
  - Ecosystem soak (`npm run soak`): not run
  - Playwright end-to-end, all projects (desktop-chromium, phone-portrait, phone-landscape, tablet, platform Chromium, Firefox, WebKit): not run
  - Browser QA of the crash record, consent, export, not-responding dialog and credits window (see the "Not yet run" entry below): not run
  - Save and restore in a real browser, IndexedDB backend: not run
  - Installability and offline play (PWA): not run
  - Lighthouse mobile run: not run
  - Real-device checks (low Android, iPhone): not run
  - Screen-reader and keyboard-only pass: not run
- Crash records seen: n/a
- Defects: none recorded; nothing was tested, so none could be found.
- Follow-up: run the full list above when test access is available, starting with `npm run typecheck`, `npm test` and the golden replay. The golden hash re-baseline noted in DECISIONS (Beings build 3 and later) is still open.

### Not yet run - no QA run has been done

- Build: not applicable
- Tester: not applicable
- Scope: none. This log starts empty. The crash record, consent gate, export download, not-responding copy and credits window were written by code reading and type reading only. No test, `tsc`, `vitest`, build or Playwright run was done for them.
- Result: no QA run has been done yet. The items listed below are unverified.
- Still to check in a browser:
  - Trigger a fatal fault and confirm one record appears in IndexedDB `sr-crash`, store `crashes`.
  - With IndexedDB blocked, confirm the localStorage key `sr-crash-lite` gets an entry and the fatal dialog still shows.
  - With `privacy.errorReports` off, confirm "Export crash record" refuses and downloads nothing. With it on, confirm one JSON file downloads and the network log shows no request.
  - Confirm the "Simulation not responding" dialog wording and the Reload and Wait buttons.
  - Confirm the Credits window lists the dependency versions.
