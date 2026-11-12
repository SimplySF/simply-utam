# 0006 — Prefixing environment variables with `SIMPLY_`

**Status:** Implemented (branch `feat/simply-env-prefix`, not yet merged)
**Package:** `packages/simply-utam-core`, `packages/simply-utam`
**Date:** 2026-11-12

## Problem

The environment variables SimplyUTAM reads were named `UTAM_USERNAME`, `UTAM_ALLOWED_DOMAINS`,
`UTAM_SNAPSHOT_MASK` and `UTAM_SNAPSHOT_RUN_ID`. `UTAM_` is the namespace of UTAM itself (Salesforce's
compiler, `wdio-utam-service`), not of this project, so a name could collide with one UTAM or another
tool adopts later. The other SimplySF tools have moved to a `SIMPLY_` prefix (simply-gitlab 0012,
simply-atlassian 0023), and this repo already names its own constants that way
(`SIMPLY_UTAM_FORCEIGNORE_RULES`, `SIMPLY_UTAM_GITIGNORE_RULES`).

## Decision

Every variable gets a `SIMPLY_` prefix. The unprefixed names are deprecated, not removed: each still
works while its prefixed name is unset, and using one produces a warning. They are removed in a future
major release.

The mapping lives once, in `simply-utam-core` (`src/env-vars.ts`, exported as `LEGACY_ENV`), and every
reader goes through `envValue(env, name, log?)`.

## Behavior

| New name                      | Deprecated name        | Read by                                                       |
| ----------------------------- | ---------------------- | ------------------------------------------------------------- |
| `SIMPLY_UTAM_USERNAME`        | `UTAM_USERNAME`        | `TestEnvironment` (and so `LightningNavigator`)               |
| `SIMPLY_UTAM_ALLOWED_DOMAINS` | `UTAM_ALLOWED_DOMAINS` | `TestEnvironment`, `isHostAllowed`'s default                  |
| `SIMPLY_UTAM_SNAPSHOT_MASK`   | `UTAM_SNAPSHOT_MASK`   | `captureDomSnapshot`, `walkerExpression`, the console snippet |
| `SIMPLY_UTAM_SNAPSHOT_RUN_ID` | `UTAM_SNAPSHOT_RUN_ID` | `writeDomSnapshot`; set by the scaffolded `onPrepare`         |

Resolution, per setting: an explicit option (`username`, `allowedDomains`, `mask`, `runId`) wins, as
before; otherwise the prefixed name when it has a non-empty value; otherwise the deprecated name. A
legacy name shadowed by its prefixed one is ignored without a warning.

**Warnings.** When a deprecated name supplies a value, one line names the rename:
`Deprecated environment variable UTAM_USERNAME in use: rename it to SIMPLY_UTAM_USERNAME. …`. Values
are never included. Each name warns once per environment object, so a run that reads the mask on
every step warns once per worker process, not once per step. The warning goes to the reader's `log`
sink (`TestEnvironmentOptions.log`, `WalkerOptions.log`, `WriteDomSnapshotOptions.log`; the CLI's
`snapshot console snippet` passes its oclif `warn`), defaulting to `console.warn`.

**`TestEnvironment`** now resolves allowed domains from its own `env` at construction. Before, it read
`process.env` on every host check, ignoring an injected `env`.

**Scaffolded `wdio.conf.mjs`.** `onPrepare` sets `SIMPLY_UTAM_SNAPSHOT_RUN_ID` only when neither name
is set, so a run id a CI job exports under the old name is still honoured (and warned about). A config
scaffolded by an earlier version still sets `UTAM_SNAPSHOT_RUN_ID`; that works, and the warning for
this name says to rename it in `onPrepare`. `init` keeps an existing `wdio.conf.mjs`, so this edit is
the user's.

## Public API

`simply-utam-core` (and so `simply-utam`) adds `LEGACY_ENV`, `EnvName`, `envValue`,
`deprecatedEnvWarning` and `ALLOWED_DOMAINS_ENV`, and `log` options on `TestEnvironmentOptions` and
`WriteDomSnapshotOptions`. `USERNAME_ENV`, `SNAPSHOT_MASK_ENV` and `SNAPSHOT_RUN_ID_ENV` now hold the
prefixed names. `EnvLike` moves to `env-vars.ts` and is still exported from the same places.

## Alternatives considered

- **Hard rename with no fallback.** Breaks every shell, CI job and `wdio.conf.mjs` on upgrade, with a
  "You must set a username" error that does not say why. Rejected for a minor release.
- **Warn on every read.** The mask and run id are read per capture, so a failing suite would print
  the warning dozens of times.
- **Template copies `UTAM_SNAPSHOT_RUN_ID` into the new name.** Hides the deprecation from the user
  whose CI sets the old name.

## Removal

A later major release deletes the fallback and warning in `envValue`, `LEGACY_ENV`, and the
`UTAM_SNAPSHOT_RUN_ID` check in the scaffolded `onPrepare`.
