# Contributing to @simplysf/simply-utam-core

Org authentication, Lightning navigation, and debugging helpers for UTAM UI tests. This package is part of the [`simply-utam`](https://github.com/SimplySF/simply-utam) monorepo.

**Start with the [root CONTRIBUTING.md](https://github.com/SimplySF/simply-utam/blob/main/CONTRIBUTING.md).** It covers repository structure, environment setup, commit conventions, versioning, CI, git hooks, and the pull request process — all of which apply here. This file covers only what is specific to this package.

## Working on this package

Run from this directory to target just this package:

```sh
pnpm run build       # compile + lint
pnpm test            # the full gate CI runs
pnpm run test:only   # just the unit tests, skipping lint
pnpm run lint
```

## The public surface

The public surface is whatever [`src/index.ts`](src/index.ts) re-exports; anything not exported from
there is internal and can change freely. Adding to the public surface means adding an export to
`src/index.ts` **and** documenting it in [`README.md`](README.md)'s `## API` section — the README is
the API reference for this package. `test/index.test.ts` asserts the exported-key list; update it
deliberately when the surface changes, so an accidental removal fails loudly instead of shipping
quietly.

## No runtime dependency on WebdriverIO or UTAM

This package runs inside other people's test projects, which pin their own WebdriverIO and UTAM
versions. So the browser and UTAM objects are typed structurally (`NavigableBrowser`,
`UtamElementLike`) rather than imported, and the package never pulls in a second copy of either.
Keep it that way: describe the few members you need as a type. `@salesforce/core` is the one runtime
dependency, and adding another is a design decision, not a convenience.

`process.env` is read only through an injectable `env` option that defaults to it, and anything that
writes output takes an injectable sink (see `logUtamHtml`'s `log`), so every path is testable without
stubbing globals.

## Tests

No pull request is accepted without tests covering the change. Tests live in [`test/`](test),
mirroring the `src/` layout, and run under [Vitest](https://vitest.dev/). `@salesforce/core` is mocked
at the module boundary; nothing in the unit tests needs an org or a browser.

## Reporting issues

Please [open an issue](https://github.com/SimplySF/simply-utam/issues) rather than sending a pull request for anything non-trivial without prior discussion.
