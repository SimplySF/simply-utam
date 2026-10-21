# 0004 — Self-referencing page object imports

**Status:** Draft
**Package:** `packages/simply-utam-core`, `packages/simply-utam`
**Date:** 2026-10-21

## Problem

The UTAM compiler turns a reference from one page object to another into a bare module import of the
project's own package name:

```js
import _Bar from 'my-app/pageObjects/bar';
```

Under plain Node ESM that import cannot resolve, because nothing makes `my-app` importable from inside
`my-app`. Running `wdio` fails with:

```
@wdio/runner: Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'my-app' imported from …/pageObjects/foo.js
```

Projects that worked around this with a self-dependency (`"my-app": "file:"`) then break on upgrading
to WebdriverIO 10, with the file rather than the package missing:

```
@wdio/runner: Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/node_modules/my-app/pageObjects/bar'
imported from …/pageObjects/foo.js
Did you mean to import "file:///…/pageObjects/bar.js"?
```

Two things cause it:

1. **No self-reference.** Node resolves a package's own name only through its `exports` field, or
   through a `node_modules/<name>` entry that points back at the project.
2. **The namespace drops the npm scope.** `resolveAppName` strips a leading `@scope/` from
   package.json `name`, so a package named `@acme/my-app` generates imports of `my-app/pageObjects/…`.
   Self-referencing needs the specifier to equal `name` exactly, so no package-level fix can resolve it.

### Findings

Reproduced with the real `utam` compiler and `utam-generate`, on Node 26. The test project was a
`"type": "module"` package with one page object that references another.

| package.json                                                     | Import specifier               | Plain Node | `tsx` loader |
| ---------------------------------------------------------------- | ------------------------------ | ---------- | ------------ |
| neither `exports` nor self-dependency                            | `my-app/pageObjects/bar`       | fails      | fails        |
| `"exports": { "./pageObjects/*": "./pageObjects/*.js" }`         | `my-app/pageObjects/bar`       | **works**  | works        |
| `"exports": { "./*": "./*.js" }`                                 | `my-app/pageObjects/bar`       | **works**  | works        |
| `"exports": { "./*": "./*" }`                                    | `my-app/pageObjects/bar`       | fails      | works        |
| `"dependencies": { "my-app": "file:" }`, after build and `npm i` | `my-app/pageObjects/bar`       | fails      | **works**    |
| name `@acme/my-app`, `exports` as above                          | `my-app/pageObjects/bar`       | fails      | fails        |
| name `@acme/my-app`, `exports` as above                          | `@acme/my-app/pageObjects/bar` | **works**  | **works**    |

Observations:

- Page object imports are extensionless, so the `exports` target needs `.js`. A target without it
  (`"./*": "./*"`) maps to a file that does not exist, and plain Node fails. A loader such as `tsx`
  adds the extension itself, so the same package.json works there. An `exports` entry with `.js` works
  under both.
- A scope mismatch fails under every loader: with the package named `@acme/my-app`, the specifier
  `my-app/pageObjects/bar` fails even under `tsx`, while `@acme/my-app/pageObjects/bar` works under both.
- The `file:` self-dependency creates `node_modules/my-app -> ..`, which resolves the package. The file
  still has no extension, so it works only when the loader adds one. That is why it works in a WDIO
  project that loads page objects through such a loader, and fails under plain Node. It also needs the
  page objects built and `npm i` run afterwards.
- The two do not conflict. When `exports` exists, Node resolves the package's own name through it before
  looking in `node_modules`, so a self-dependency left for unrelated reasons is inert.
- An existing `exports` that omits `./pageObjects/*` fails hard (`ERR_PACKAGE_PATH_NOT_EXPORTED`). Node
  does not fall back to the symlink, so "has an `exports` field" is not the same as "page objects resolve".
- The rest of the pipeline is scope-agnostic. `utam-generate` emits `@acme/my-app/pageObjects/qux` for a
  namespace of `@acme/my-app/pageObjects/`, the compiler copies the type string unchanged, and
  `simply-utam rewrite` matches by string prefix, so a scoped key rewrites a scoped type. A key and a type
  that disagree on the scope silently match nothing.

### WebdriverIO 9 and 10

The self-dependency works only under a loader that adds the missing `.js`, and WebdriverIO used to
supply one without being asked. In `@wdio/cli` 9.32.0, `Launcher.initialize()` always appends
`--import <tsx>` to `NODE_OPTIONS`, so every worker runs under `tsx`. In 10.1.0 it does so only when
`shouldEnableTsx()` finds TypeScript: a `.ts` config file, a `--tsConfigPath` argument, or a `.ts` path in
`specs`, `exclude`, `suites` or `cucumberOpts.require`. The scaffolded project (`wdio.conf.mjs`,
`*.feature`, `*.steps.mjs`) matches none of these, so its workers run without `tsx`.

Reproduced with real runs in headless Chrome: two identical projects, each a Cucumber suite with `.mjs`
steps that import compiled UTAM page objects, with the `"my-app": "file:"` self-dependency:

| WebdriverIO                                                      | Worker loader                          | Result                     |
| ---------------------------------------------------------------- | -------------------------------------- | -------------------------- |
| 9.32.0                                                           | `tsx`, through `NODE_OPTIONS`          | passes                     |
| 10.1.0                                                           | none                                   | fails with the error above |
| 10.1.0, `execArgv: ['--import', 'tsx']`                          | `tsx`, through the worker's `execArgv` | passes                     |
| 10.1.0, the `exports` entry, with or without the self-dependency | none                                   | passes                     |

Under pnpm (12.11) the self-dependency and the `execArgv` workaround need more:

- `"my-app": "file:"` and `"my-app": "file:."` both fail at install. Only `"my-app": "link:."` links the
  project to itself.
- `--import tsx` fails with `Cannot find package 'tsx'`. `tsx` is a dependency of `@wdio/cli`, and pnpm
  does not make it resolvable from the project, so the project has to declare `tsx` itself.
- With the `exports` entry, the suite passes under pnpm with neither a self-dependency nor `tsx`.

So the WebdriverIO 10 failure is this document's problem surfacing through a workaround that relied on
`tsx`. The `exports` entry resolves it for both WebdriverIO majors, without a loader.

## Decision

1. **`init` uses the full package name as the namespace** (`@acme/my-app`, not `my-app`), so the imports
   match package.json `name`. `--app-name` still overrides it.
2. **`init` makes page objects importable by adding one `exports` entry** to the project's package.json,
   `"./pageObjects/*": "./pageObjects/*.js"`. It adds the entry only when it can do so without changing
   what already resolves.
3. **`init` warns when the namespace is not the package name**, because self-referencing cannot resolve
   that import.

`exports` is chosen over a self-dependency because it is resolved by Node itself: it works under any
loader and any WebdriverIO major, with no install-order step, and adds no dependency on the project
itself. The documentation keeps `execArgv: ['--import', 'tsx']` as a stopgap for a project that cannot
change its package.json yet, with the pnpm caveat that `tsx` must then be a declared devDependency.

## Behavior

### Namespace

`resolveAppName` returns, in order:

1. `--app-name`, when given.
2. package.json `name`, unchanged, scope included.
3. `salesforce-app`.

The result is written into `generator.config.json` (`namespaces.c`) and `.utam/namespace-map.json`, both
from the same value, so a generated type and a map key always agree on the scope.

### The `exports` entry

The path is `<pageObjectsOutputDir>` from `utam.config.json` (`pageObjects` by default), so
`"./pageObjects/*": "./pageObjects/*.js"`. It is added by merging, never by replacing:

| package.json `exports`                             | Action                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| absent                                             | Add `{ "./pageObjects/*": "./pageObjects/*.js" }`.                    |
| object of subpaths, no `./pageObjects/*`           | Add the one key. No other key is touched.                             |
| object already covering `./pageObjects/*` or `./*` | Leave alone.                                                          |
| string, array or conditions object (`"import"`)    | Leave alone and warn: it cannot be extended without restructuring it. |

Adding `exports` to a package that had none also hides every subpath not listed (including `.` and
`./package.json`), because `exports` closes the package to deep imports. `init` reports this when it adds
the field. A project that deep-imports its own files must list them.

The entry is skipped, with a notice, when the namespace is not the package name (see below). `init`
reports the edit in `modifiedFiles` like its other package.json changes, and `--dry-run` leaves the file
alone.

### When the namespace is not the package name

This covers `--app-name my-app` on a package named `@acme/my-app`, and any package whose `name` is
missing. A bare `my-app/…` import cannot resolve through `exports`, so `init` does not add the entry and
prints:

```
The namespace "my-app" differs from the package name "@acme/my-app", so page object imports cannot
resolve through "exports". Use the package name, or alias the namespace with a dependency
("my-app": "file:." with npm, "link:." with pnpm) and a loader that resolves extensionless paths.
```

Under WebdriverIO 10 that loader has to be added explicitly (see
[WebdriverIO 9 and 10](#webdriverio-9-and-10)).

### Existing projects

`init` is write-once: it skips files that exist unless `--force` is given. A project initialised with a
stripped namespace keeps its generated files and map keys until it re-runs `init --force`, so the default
change does not affect it. When `init` finds an existing `generator.config.json` whose `namespaces.c` is
the stripped form of a scoped package name, it prints a notice with the new value and the `--app-name`
that keeps the old one.

## Alternatives considered

| Alternative                                                | Why not                                                                                                                                                                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-dependency (`"my-app": "file:"`) instead of `exports` | Works only after a build and `npm i`, and only where the loader resolves extensionless paths. Plain Node and WebdriverIO 10 fail. pnpm rejects `file:` and needs `link:.`.                                              |
| `execArgv: ['--import', 'tsx']` in `wdio.conf.mjs`         | Fixes only the missing extension, not the package name, so it still needs a self-dependency. Puts back the per-worker loader WebdriverIO 10 removed, and under pnpm needs `tsx` declared. Kept as a documented stopgap. |
| Both `exports` and a self-dependency                       | Safe, because `exports` wins, but the dependency does nothing once `exports` is present.                                                                                                                                |
| A flag to choose scoped or stripped namespaces             | `--app-name` already sets the value, and `resolveAppName` runs once, in `init`. The stripped mode also cannot use `exports`, so a flag would change more than a string.                                                 |
| Keep stripping, rewrite imports at build time              | A rewrite step could turn `my-app/…` into relative imports, but it adds a build stage and diverges from the compiler's own output.                                                                                      |
| Document the manual `exports` entry only                   | Every project hits the error first. `init` already edits package.json for the Wireit scripts.                                                                                                                           |

## Implementation plan

1. `resolveAppName`: stop stripping the scope. Update the `--app-name` summary and the README.
2. A pure `ensurePageObjectExports(packageJson, outputDir)` in `scaffold`, returning the updated object
   and what it did (`added`, `unchanged`, `skipped` with a reason). A thin step in `scaffoldProject`
   applies it, reads `pageObjectsOutputDir` from `utam.config.json`, and records the result.
3. The namespace-mismatch and stripped-config notices, in `scaffoldProject`'s result and the CLI output.
4. Public surface: export the new function from `src/index.ts`, list it in the README's `## API`
   section, and cover it in `test/index.test.ts`.
5. Update this document and the design index to match what shipped.

Commit the namespace change and the `exports` change separately. The namespace change is the breaking
one and should read as such in the changelog.

## Testing

- `resolveAppName`: scoped and unscoped names, `--app-name` override, missing name.
- `ensurePageObjectExports`: absent, object without the key, object covering it by `./*`, string and
  conditions forms, idempotence on a second run, a custom `pageObjectsOutputDir`.
- `scaffoldProject`: `modifiedFiles` and `--dry-run`, a scoped package, a namespace that differs from the
  name, an existing stripped `generator.config.json`.
- An integration check outside the unit suite: compile a two-page-object project and import it under plain
  Node for a scoped and an unscoped name. The findings table above is the expected result.
- An end-to-end check outside the unit suite: a scaffolded project with `wdio.conf.mjs` and `.mjs` steps
  runs on WebdriverIO 9 and 10, under npm and pnpm, with no `tsx` in `execArgv`.

## Resolved questions

- **`"./package.json"` in the new `exports`.** Not added. The project is a test harness, not a library
  another package imports, and `wdio-utam-service` (the only runtime consumer here) never reads the
  project's `package.json` by specifier. Tools that read the file from disk (npm, wireit, Lerna) are
  unaffected by `exports`. The notice that `exports` closes the package to deep imports stays, so a
  project that needs `./package.json` can add it.
- **Does anything else read the generated namespace?** No. The injection configs that
  `salesforce-pageobjects` ships name only `salesforce-pageobjects/…` page objects, and
  `wdio-utam-service` takes injection config paths and does no namespace resolution of its own. The
  `c` namespace appears only in types we generate. One consequence for the documentation: an injection
  config a project writes for its own page objects must use the same specifier the generator emits, which
  is now the full package name.
- **Versioning.** Dry-run with Lerna 10 (`lerna version --conventional-commits --no-git-tag-version`) in a
  throwaway clone, with one commit touching `simply-utam-core` after its last release (0.1.2):

  | Commit                                             | `simply-utam-core`         | `simply-utam` |
  | -------------------------------------------------- | -------------------------- | ------------- |
  | `fix:`                                             | 0.1.3                      | 0.1.5         |
  | `feat:`                                            | 0.2.0                      | 0.1.5         |
  | `fix!:` or `feat!:` (no footer)                    | 0.1.3 (the `!` is ignored) | 0.1.5         |
  | `fix:` or `feat:` with a `BREAKING CHANGE:` footer | **0.2.0**                  | 0.1.5         |

  So a breaking change at 0.x releases as a minor bump, not 1.0.0, which is what 0.x consumers expect. The
  `!` shorthand is not recognised by this release setup: it neither marks the change breaking nor keeps
  the `feat` type's minor bump. The namespace commit therefore carries the **`BREAKING CHANGE:` footer**
  (describing the scoped-name change and the `--app-name` workaround) and does not rely on `!`. The footer
  also puts the note under "BREAKING CHANGES" in the changelog.

## Open questions

None.
