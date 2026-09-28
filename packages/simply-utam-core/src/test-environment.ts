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

import { Org } from '@salesforce/core';

/** The environment variable naming the org a UTAM run authenticates to. */
export const USERNAME_ENV = 'UTAM_USERNAME';

/** An environment-shaped map; `process.env` by default. */
export type EnvLike = Record<string, string | undefined>;

export type TestEnvironmentOptions = {
  /** Username or alias of an org already authorized with the Salesforce CLI. Wins over `UTAM_USERNAME`. */
  username?: string;
  /** Where `UTAM_USERNAME` is read from. Defaults to `process.env`. */
  env?: EnvLike;
};

/**
 * The org a UTAM run tests against, resolved from the Salesforce CLI's local auth store.
 */
export class TestEnvironment {
  public readonly username: string;

  #org?: Promise<Org>;

  /**
   * Create a new environment for the given username, or `UTAM_USERNAME` when none is passed.
   *
   * @param options Explicit username and environment overrides.
   */
  public constructor(options: TestEnvironmentOptions = {}) {
    const username = options.username ?? (options.env ?? process.env)[USERNAME_ENV];
    if (!username) {
      throw new Error(`You must set a username using the ${USERNAME_ENV} env property for the test`);
    }
    this.username = username;
  }

  /**
   * Resolve the authenticated org. The first call authenticates and every later call shares its
   * result, so callers need not coordinate who goes first; a failed attempt is not cached.
   */
  public async getOrg(): Promise<Org> {
    this.#org ??= Org.create({ aliasOrUsername: this.username }).catch((error: unknown) => {
      this.#org = undefined;
      throw error;
    });
    return this.#org;
  }

  /**
   * Authenticate eagerly, for a runner hook that wants auth failures reported before any test
   * starts. Optional: every other method authenticates on first use.
   */
  public async init(): Promise<void> {
    await this.getOrg();
  }

  /**
   * Build a single-use frontdoor URL that logs the browser in and lands on `returnUrl`.
   *
   * The URL comes from Salesforce's single-access endpoint rather than a `sid=` query parameter,
   * so the session's access token never appears in the browser's address bar or history.
   *
   * @param returnUrl Path to open after login, e.g. `/lightning/page/home`. Omit for the org's default landing page.
   */
  public async buildFrontdoorUrl(returnUrl?: string): Promise<string> {
    const org = await this.getOrg();
    return org.getFrontDoorUrl(returnUrl);
  }
}
