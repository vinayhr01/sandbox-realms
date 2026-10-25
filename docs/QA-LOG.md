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
