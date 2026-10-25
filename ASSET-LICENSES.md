# Asset and dependency licences

Not legal advice. A lawyer must review this file before any commercial release (LEGAL-CHECKLIST, last item). This file records what the repository contains. It does not clear anything.

## Third-party npm packages

Source: `package.json` and `package-lock.json`. Licence fields were read from the installed packages in `node_modules` of the main checkout (`game/sandbox-realms/node_modules`); the installed versions match the lockfile. The licence text files were not opened, so the `package.json` licence field is what is recorded. `node_modules` is not present in this worktree.

| Package | Version (lockfile) | Used in | Licence (from node_modules `package.json`) | Status |
|---|---|---|---|---|
| pixi.js | 8.22.0 | runtime (shipped) | MIT | Read from node_modules |
| typescript | 7.0.2 | build and typecheck only | Apache-2.0 | Read from node_modules |
| vite | 8.3.5 | build and dev server only | MIT | Read from node_modules |
| vitest | 5.0.5 | tests only | MIT | Read from node_modules |
| @playwright/test | 1.64.1 | end-to-end tests only | Apache-2.0 | Read from node_modules |
| @types/node | 26.6.5 | type definitions only | MIT | Read from node_modules |

Only `pixi.js` is bundled into the game. The other packages are development tools and are not shipped in `dist/`.

The `LICENSE` text files were not checked against these values. Mark a row as verified only after the licence file in each package has been read and compared.

## Project-made assets

| Path | What it is | Source | Licence |
|---|---|---|---|
| `public/icon.svg` | App icon | Made for this project | Project licence (not yet chosen; see `package.json` `"license": "ISC"`, which is the package default and needs a decision) |
| `public/icon-maskable-192.png`, `public/icon-maskable-512.png` | Icons rendered from `public/icon.svg` | `scripts/make-icons.mjs` | As above |
| `public/manifest.webmanifest`, `public/sw.js` | PWA manifest and service worker | Written for this project | As above |

Terrain, creature, sound and font assets: none are in the repository beyond the placeholder SVG and code-drawn tiles. The release checklist (`docs/release-checklist.md`) lists this as not done. When art, audio or fonts are added, add a row here with the source, the author and the licence.

## Open items

- Choose the project licence for the game's own code and assets. `package.json` says ISC by default; that is a placeholder, not a decision.
- Verify each package licence against its licence file (table above, status column).
- Trademark and name search (LEGAL-CHECKLIST).
- Lawyer review of this file and of the checklist before any commercial release.
