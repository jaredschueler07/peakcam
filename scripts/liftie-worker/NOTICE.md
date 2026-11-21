# Third-party notice: Liftie

`vendor/liftie/` holds files from **Liftie** (https://github.com/pirxpilot/liftie), copied from the published npm package at the exact version, commit and tarball hash recorded in `vendor/liftie/VERSION.json`. They are unmodified apart from a one-line provenance header that `vendor.mjs` adds to each `.js` file.

Liftie is licensed under the BSD 3-Clause License:

> Copyright (c) 2012 Damian Krzeminski. All rights reserved.

The full licence text, including its conditions and disclaimer, is in `vendor/liftie/License.md` and must stay with these files.

## What is copied

- `lib/lifts/parse.js`, `lib/lifts/parser.js`, `lib/lifts/request.js`, `lib/select.js`, `lib/env.js`: the parse helpers.
- `lib/tools/*.js`: parsers shared by resort families (Vail Resorts, Alterra/Intrawest, POWDR, Boyne, Aspen and others).
- `lib/resorts/<id>/{index.js,resort.json}`: one definition per Liftie id that `data/operator-sources.json` maps.

Liftie's web server, client, views and build tooling are not copied. The libraries the parsers import are pinned in `package.json` here and installed with `npm ci --prefix scripts/liftie-worker`.

## Updating

```bash
node scripts/liftie-worker/vendor.mjs 4.4.3   # an exact published version
node --import tsx --test scripts/liftie-worker/core.test.mjs lib/operators/liftie-local.test.ts
npm run operator-sync -- --dry-run --state CO
```

The script verifies the tarball against the registry's integrity hash before copying anything. Review the diff under `vendor/liftie/` like any other code change: some parsers evaluate a script block taken from the operator's page with `node:vm`, which is why `scripts/operator-sync.ts` runs the worker in a child process that is given no secrets.

PeakCam does not use Liftie's name or its contributors' names to endorse or promote the product.
