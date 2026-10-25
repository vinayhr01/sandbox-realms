# Asset and dependency licences

Not legal advice. A lawyer must review this file before any commercial release (LEGAL-CHECKLIST, last item). This file records what the repository contains. It does not clear anything. The legal review is not written here; it is left to the project owner.

## Third-party npm packages

Source: `package.json` and `package-lock.json` (98 lockfile entries).

Licence fields were read from the installed packages in `node_modules` of the main checkout (`game/sandbox-realms/node_modules`, outside this worktree; `node_modules` is not present in this worktree). The installed versions match the lockfile for all 54 installed packages (0 mismatches).

What "Read" means here: the `license` field in each installed package's `package.json` was read. The `LICENSE` text file was not opened for any package, so no row is marked verified against its licence text. Status values:

- **Field read**: the `package.json` licence field was read from the installed package. Licence text not opened.
- **UNVERIFIED**: the package is in the lockfile but not installed on this machine (platform-specific optional binary), so no licence field was read.

### Direct dependencies

| Package | Version (lockfile = installed) | Used in | Licence (field) | Status |
|---|---|---|---|---|
| pixi.js | 8.22.0 | runtime (shipped when imported by the game) | MIT | Field read |
| typescript | 7.0.2 | build and typecheck only | Apache-2.0 | Field read |
| vite | 8.3.5 | build and dev server only | MIT | Field read |
| vitest | 5.0.5 | tests only | MIT | Field read |
| @playwright/test | 1.64.1 | end-to-end tests only | Apache-2.0 | Field read |
| @types/node | 26.6.5 | type definitions only | MIT | Field read |

Only `pixi.js` is bundled into the game. The other direct packages are development tools and are not shipped in `dist/`.

### Installed transitive packages (48)

Each is a dependency of a direct package. Where a package is a runtime dependency of `pixi.js` (listed in its `package.json`), it is shipped only if the bundle imports it; that was not traced. All other rows are build, test or type-only.

| Package | Version | Licence (field) | Status |
|---|---|---|---|
| @jridgewell/resolve-uri | 3.1.2 | MIT | Field read |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT | Field read |
| @jridgewell/trace-mapping | 0.3.31 | MIT | Field read |
| @oxc-project/types | 0.155.0 | MIT | Field read |
| @pixi/colord | 2.9.6 | MIT | Field read (pixi.js runtime dependency) |
| @rolldown/binding-win32-x64-msvc | 1.2.15 | MIT | Field read |
| @rolldown/pluginutils | 1.0.1 | MIT | Field read |
| @types/chai | 5.2.3 | MIT | Field read |
| @types/deep-eql | 4.0.2 | MIT | Field read |
| @types/earcut | 3.0.0 | MIT | Field read (types only) |
| @types/estree | 1.0.9 | MIT | Field read |
| @typescript/typescript-win32-x64 | 7.0.2 | Apache-2.0 | Field read |
| @vitest/mocker | 5.0.5 | MIT | Field read |
| @vitest/spy | 5.0.5 | MIT | Field read |
| @webgpu/types | 0.1.74 | BSD-3-Clause | Field read (pixi.js runtime dependency; types only) |
| @xmldom/xmldom | 0.8.15 | MIT | Field read (pixi.js runtime dependency) |
| assertion-error | 2.0.1 | MIT | Field read |
| chai | 6.3.0 | MIT | Field read |
| detect-libc | 2.1.2 | Apache-2.0 | Field read |
| earcut | 3.2.4 | ISC | Field read (pixi.js runtime dependency) |
| es-module-lexer | 2.3.2 | MIT | Field read |
| estree-walker | 3.0.3 | MIT | Field read |
| eventemitter3 | 5.0.4 | MIT | Field read (pixi.js runtime dependency) |
| expect-type | 1.4.0 | Apache-2.0 | Field read |
| fdir | 6.5.0 | MIT | Field read |
| gifuct-js | 2.1.2 | MIT | Field read (pixi.js runtime dependency) |
| ismobilejs | 1.1.1 | MIT | Field read (pixi.js runtime dependency) |
| js-binary-schema-parser | 2.0.3 | MIT | Field read (dependency of gifuct-js) |
| lightningcss | 1.33.0 | MPL-2.0 | Field read |
| lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 | Field read |
| magic-string | 1.4.3 | MIT | Field read |
| nanoid | 3.3.20 | MIT | Field read |
| obug | 3.0.0 | MIT | Field read |
| parse-svg-path | 0.2.0 | MIT | Field read (pixi.js runtime dependency) |
| picocolors | 1.1.1 | ISC | Field read |
| picomatch | 4.0.7 | MIT | Field read |
| playwright | 1.64.1 | Apache-2.0 | Field read |
| playwright-core | 1.64.1 | Apache-2.0 | Field read |
| postcss | 8.5.31 | MIT | Field read |
| rolldown | 1.2.15 | MIT | Field read |
| source-map-js | 1.2.2 | BSD-3-Clause | Field read |
| std-env | 4.3.0 | MIT | Field read |
| tiny-lru | 11.4.7 | BSD-3-Clause | Field read (pixi.js runtime dependency) |
| tinybench | 6.2.2 | MIT | Field read |
| tinyexec | 1.3.1 | MIT | Field read |
| tinyglobby | 0.2.17 | MIT | Field read |
| undici-types | 8.9.0 | MIT | Field read |
| why-is-node-running | 3.2.1 | MIT | Field read |

Licence field counts over the 54 installed packages: MIT 40, Apache-2.0 7, BSD-3-Clause 3, ISC 2, MPL-2.0 2. The MPL-2.0 packages (lightningcss, lightningcss-win32-x64-msvc) are build tooling, not shipped.

### Lockfile entries not installed on this machine (UNVERIFIED)

These are platform-specific optional binaries for other operating systems. Their `package.json` was not present, so no licence field was read. Status: **UNVERIFIED** for all 44.

- `@rolldown/binding-*` (14): android-arm-eabi, android-arm64, darwin-arm64, darwin-x64, freebsd-x64, linux-arm-gnueabihf, linux-arm64-gnu, linux-arm64-musl, linux-ppc64-gnu, linux-s390x-gnu, linux-x64-gnu, linux-x64-musl, openharmony-arm64, win32-arm64-msvc
- `@typescript/typescript-*` (19): aix-ppc64, darwin-arm64, darwin-x64, freebsd-arm64, freebsd-x64, linux-arm, linux-arm64, linux-loong64, linux-mips64el, linux-ppc64, linux-riscv64, linux-s390x, linux-x64, netbsd-arm64, netbsd-x64, openbsd-arm64, openbsd-x64, sunos-x64, win32-arm64
- `fsevents` (1)
- `lightningcss-*` (10): android-arm64, darwin-arm64, darwin-x64, freebsd-x64, linux-arm-gnueabihf, linux-arm64-gnu, linux-arm64-musl, linux-x64-gnu, linux-x64-musl, win32-arm64-msvc

The licence text files were not checked for any row. Mark a row as verified only after the licence file in each package has been read and compared.

## Project-made assets

| Path | What it is | Source | Licence |
|---|---|---|---|
| `public/icon.svg` | App icon | Made for this project | Project licence (not yet chosen; see `package.json` `"license": "ISC"`, which is the package default and needs a decision) |
| `public/icon-maskable-192.png`, `public/icon-maskable-512.png` | Icons rendered from `public/icon.svg` | `scripts/make-icons.mjs` | As above |
| `public/manifest.webmanifest`, `public/sw.js` | PWA manifest and service worker | Written for this project | As above |

Terrain, creature, sound and font assets: none are in the repository beyond the placeholder SVG and code-drawn tiles. `RELEASE-CHECKLIST.md` lists this as not done. When art, audio or fonts are added, add a row here with the source, the author and the licence.

## Open items

- Choose the project licence for the game's own code and assets. `package.json` says ISC by default; that is a placeholder, not a decision.
- Read the `LICENSE` text of each package and compare it with the field values above (status column).
- Read the licences of the 44 UNVERIFIED lockfile entries on a machine where they are installed. They are native binaries of build tools (rolldown, typescript, lightningcss, fsevents); none is game code, but whether any is copied into `dist/` was not checked.
- Trademark and name search (LEGAL-CHECKLIST).
- Lawyer review of this file and of the checklist before any commercial release.
