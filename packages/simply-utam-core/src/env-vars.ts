/*
 * Copyright (c) 2026, SimplySF.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/** An environment-shaped map; `process.env` by default. */
export type EnvLike = Record<string, string | undefined>;

/**
 * Every environment variable this project reads, mapped to the unprefixed name it replaced.
 *
 * The `SIMPLY_` prefix matches the other SimplySF tools and keeps these settings apart from
 * anything else that reads a `UTAM_` variable. See docs/design/0006-simply-env-prefix.md.
 *
 * The legacy names still work while the prefixed name is unset, and each use of one is reported
 * once per environment by {@link envValue}. They will be removed in a future major release.
 */
export const LEGACY_ENV = {
  SIMPLY_UTAM_USERNAME: 'UTAM_USERNAME',
  SIMPLY_UTAM_ALLOWED_DOMAINS: 'UTAM_ALLOWED_DOMAINS',
  SIMPLY_UTAM_SNAPSHOT_MASK: 'UTAM_SNAPSHOT_MASK',
  SIMPLY_UTAM_SNAPSHOT_RUN_ID: 'UTAM_SNAPSHOT_RUN_ID',
} as const;

/** A current, `SIMPLY_`-prefixed variable name. */
export type EnvName = keyof typeof LEGACY_ENV;

// Where a deprecated name most likely comes from, when that isn't the user's own shell.
const HINTS: Partial<Record<EnvName, string>> = {
  SIMPLY_UTAM_SNAPSHOT_RUN_ID:
    ' A wdio.conf.mjs scaffolded by an earlier version sets it in onPrepare: rename it there too.',
};

// The deprecated names already reported, per environment object, so a value read on every step
// warns once per process rather than once per read.
const reported = new WeakMap<EnvLike, Set<string>>();

function present(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

function defaultWarn(message: string): void {
  // eslint-disable-next-line no-console -- the default sink; every caller can pass its own `log`
  console.warn(message);
}

/**
 * The warning for relying on a deprecated name: which variable to rename, and to what. Values are
 * never included.
 */
export function deprecatedEnvWarning(name: EnvName): string {
  return (
    `Deprecated environment variable ${LEGACY_ENV[name]} in use: rename it to ${name}. ` +
    `The unprefixed name will stop working in a future major release.${HINTS[name] ?? ''}`
  );
}

/**
 * Reads a setting: the prefixed name when it has a value, otherwise the deprecated unprefixed one.
 * The prefixed name always wins, and a legacy name it shadows is ignored without a warning. When
 * the legacy name does supply the value, `log` gets {@link deprecatedEnvWarning}, once per name for
 * a given `env`.
 *
 * @param env Where to read from, such as `process.env`.
 * @param name The prefixed name.
 * @param log Where the deprecation warning goes. Defaults to `console.warn`.
 */
export function envValue(
  env: EnvLike,
  name: EnvName,
  log: (message: string) => void = defaultWarn,
): string | undefined {
  const current = env[name];
  if (present(current)) return current;
  const legacyName = LEGACY_ENV[name];
  const legacy = env[legacyName];
  if (!present(legacy)) return current;

  let names = reported.get(env);
  if (!names) reported.set(env, (names = new Set()));
  if (!names.has(legacyName)) {
    names.add(legacyName);
    log(deprecatedEnvWarning(name));
  }
  return legacy;
}
