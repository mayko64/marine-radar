# Marine Radar Simulator

A standalone browser-based marine radar training simulator.

## Requirements

- Node.js 22 or newer
- npm
- Google Chrome for the CDP browser acceptance suite

## Install

```bash
npm ci
```

## Build

```bash
npm run build
```

The generated standalone file is `dist/radar.html`. It requires no backend,
package installation, or network connection at runtime.

## Verify

- `npm test` builds the simulator, type-checks the TypeScript tooling, checks
  the browser runtime syntax, validates the approved output contract, and runs
  the Node characterization suite against the generated artifact.
- `npm run test:browser` runs the Chrome/CDP acceptance suite.
- Set `CHROME_PATH` when Chrome is not installed at the default macOS path.
- `npm run verify` runs every local check.

## Public GitHub Pages Site

The workflow in `.github/workflows/pages.yml` builds and tests the simulator
on every push to `main`. It publishes `dist/radar.html` as `index.html` using
GitHub Pages and also stores the original filename as a downloadable Actions
artifact.

After pushing the public repository to GitHub, select **Settings → Pages →
Source → GitHub Actions**. The unauthenticated site will be available at:

```text
https://<username>.github.io/<repository-name>/
```

## Source Layout

`src/document`, `src/styles`, and `src/radar` are the authoritative simulator
source. `tools/build.ts` assembles those fragments deterministically according
to `config/assembly.json`.

The build tooling is strict TypeScript. The byte-preserved legacy radar
runtime remains browser JavaScript because it contains
sloppy-mode numeric syntax that TypeScript cannot parse without changing the
accepted output.

## Approving an Intentional Output Change

Edit the appropriate source fragment and run `npm run build:preview`. This
writes the unapproved candidate to `dist/radar.html` and prints its proposed
byte length and SHA-256. Inspect the generated HTML and run the
characterization and browser suites, then update `bytes` and `sha256` in
`config/assembly.json` to the reviewed values. Run `npm run verify` again
before committing. Normal `npm run build` remains strict and never publishes
an unapproved artifact.
