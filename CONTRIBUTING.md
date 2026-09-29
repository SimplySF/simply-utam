# Contributing

Thanks for your interest in contributing to Simply UTAM! This document covers the repo structure, how to get set up, and how to submit changes.

1. Please read our [Code of Conduct](CODE_OF_CONDUCT.md).
2. Create a new issue before starting significant work so we can keep track of what you're trying to add or fix, offer suggestions, and avoid duplicate effort.
3. Fork this repository.
4. [Set up your environment](#setup) and make sure you can build and test the affected package(s) locally.
5. Create a topic branch in your fork.
6. Make your change, following the [commit message format](#commit-messages) below.
7. Write tests for your change. No pull request will be accepted without tests covering the change.
8. Open a pull request against `main`. We'll review your code, suggest any needed changes, and merge it in.

## Repository Structure

This repository is a Lerna monorepo. Today it holds the core library; more packages (for example a
CLI or a WebdriverIO service) are expected to be added on top of it. Every package has its own
`CONTRIBUTING.md` covering what's specific to it — read this file first, then that one.

| Package                                                   | Description                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| [`@simplysf/simply-utam`](packages/simply-utam)           | Developer CLI executable and convenience re-exports                  |
| [`@simplysf/simply-utam-core`](packages/simply-utam-core) | Org authentication, Lightning navigation, and UTAM debugging helpers |

Tooling:

- **Package manager:** pnpm workspaces
- **Task orchestration:** Lerna v10 (independent versioning) + Wireit (per-package build caching)
- **Language:** TypeScript (ESM)
- **Tests:** [Vitest](https://vitest.dev/)
- **Node:** ^22.13.0 || ^24.0.0 || ^26.0.0 (required by Lerna 10; the published packages only require >=22.0.0)

## Setup

This repo pins its pnpm version via the `packageManager` field in `package.json`. Use [Corepack](https://nodejs.org/api/corepack.html) (bundled with Node.js) to install that exact version rather than installing pnpm globally:

```sh
corepack enable
git clone git@github.com:SimplySF/simply-utam.git
cd simply-utam
corepack install   # installs the pnpm version pinned in package.json
pnpm install
pnpm run build
pnpm test
```

`corepack enable` only needs to be run once per machine. After that, Corepack transparently uses whatever version of pnpm is pinned in `package.json`, so every contributor and CI job runs the same version.

`pnpm install` at the root installs and links every workspace package and sets up git hooks automatically via husky.

To try a change in a real UTAM project before it is published, pack the package and install the
tarball there:

```sh
cd packages/simply-utam-core
pnpm pack
# then, in the UTAM project:
npm install --save-dev /path/to/simplysf-simply-utam-core-<version>.tgz
```

## Common Commands

Run from the repo root to target all packages:

```sh
pnpm run build       # lerna run build (compile + lint)
pnpm run compile     # lerna run compile
pnpm run lint        # lerna run lint
pnpm run test        # lerna run test
pnpm run test:only   # lerna run test:only
pnpm run format      # lerna run format
pnpm run reset       # clear node_modules, the lockfile, and all wireit/TS/ESLint caches
pnpm run reset:install  # same as reset, then reinstall dependencies
```

Run inside a single package directory to target just that package:

```sh
cd packages/simply-utam-core
pnpm run build
pnpm test
```

## Adding a Dependency

To add a dependency to a specific package:

```sh
pnpm add <package> --filter @simplysf/simply-utam-core
```

To add a root-level devDependency (e.g., a shared build tool):

```sh
pnpm add -w -D <package>
```

## Commit Messages

Commits must follow [Conventional Commits](https://www.conventionalcommits.org/) (enforced by commitlint on commit). Lerna uses your commit types to decide which packages get versioned and how their `CHANGELOG.md` is generated.

```text
feat: add support for X
fix: correct handling of Y
docs: update README
chore: bump a dependency
```

If your change only affects one package, scope the commit to it, e.g. `feat(simply-utam-core): add a list view navigation helper`.

## Pull Requests

- Keep pull requests focused on a single change where possible.
- Make sure `pnpm run build` and `pnpm test` pass before opening the PR. CI runs both across every package; the pre-push hook runs the same checks but scoped to packages changed since the last release tag (see [Git Hooks](#git-hooks)), so a passing push doesn't guarantee a passing PR if your branch touches a root-level config file (e.g. `tsconfig.json`, `eslint.config.mjs`) that no single package's directory reflects.
- Aim for high test coverage on new code.
- If you changed a package's public API, update its README's `## API` section and its `test/index.test.ts` in the same PR.

## Versioning and Publishing

Versioning uses Lerna's independent mode — each package has its own version and releases separately. On every push to `main`, `release.yml` runs `lerna version --conventional-commits` (which bumps versions, writes changelogs, tags, and creates GitHub releases) and then `lerna publish from-package`, which publishes any committed version still missing from npm. Pushes to `prerelease/**` branches, or a manual run with a prerelease id, publish prereleases instead.

## CI

| Workflow      | Trigger                           | What it does                                                              |
| ------------- | --------------------------------- | ------------------------------------------------------------------------- |
| `test.yml`    | Push to non-main branches         | Runs `pnpm run build` + `pnpm test` on Linux and Windows (lts/\*, lts/-1) |
| `release.yml` | Push to `main` or `prerelease/**` | Builds, tests, versions, and publishes changed packages to npm            |

## Git Hooks

| Hook         | Command                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------- |
| `pre-commit` | `lint-staged` — runs `prettier --write` on staged files                                       |
| `commit-msg` | `commitlint` — enforces conventional commit format                                            |
| `pre-push`   | `lerna run build --since --include-dependents && lerna run test --since --include-dependents` |

`pre-push` only builds/tests packages changed since the last release tag (plus their transitive
dependents) to keep the hook fast locally — CI (`test.yml`) always runs `pnpm run build` + `pnpm test`
across every package, so nothing changed here reduces what actually gates a merge.

Hooks are installed automatically on `pnpm install` via the `prepare: husky` script.

## Reporting Issues

Please report bugs or request features by [opening an issue](https://github.com/SimplySF/simply-utam/issues) rather than submitting a PR without prior discussion for anything non-trivial.
