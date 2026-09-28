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

import { applicationPath, newRecordPath, recordPath, relatedListPath } from './lightning-paths.js';
import { TestEnvironment } from './test-environment.js';

/** The part of a WebdriverIO browser the navigator drives. */
export type NavigableBrowser = {
  navigateTo(url: string): Promise<unknown>;
};

/** Anything that can mint a logged-in URL; `TestEnvironment` in practice. */
export type FrontdoorUrlSource = {
  buildFrontdoorUrl(returnUrl?: string): Promise<string>;
};

export type LightningNavigatorOptions = {
  /** Where login URLs come from. Defaults to a `TestEnvironment` for `UTAM_USERNAME`. */
  environment?: FrontdoorUrlSource;
  /** The browser to drive. Defaults to WebdriverIO's global `browser`, looked up on each call. */
  browser?: NavigableBrowser;
};

/**
 * Logs the browser in to the test org and opens a Lightning page in one step. Every navigation
 * goes through a fresh frontdoor URL, so each one also works as the first thing a test does.
 */
export class LightningNavigator {
  readonly #environment: FrontdoorUrlSource;
  readonly #browser?: NavigableBrowser;

  /**
   * Create a navigator.
   *
   * @param options The environment and browser to use; both have defaults.
   */
  public constructor(options: LightningNavigatorOptions = {}) {
    this.#environment = options.environment ?? new TestEnvironment();
    this.#browser = options.browser;
  }

  /**
   * Log in and open `returnUrl`, or the org's default landing page when it is omitted.
   *
   * @param returnUrl Path to open after login.
   */
  public async goToLoginUrl(returnUrl?: string): Promise<void> {
    const url = await this.#environment.buildFrontdoorUrl(returnUrl);
    await this.#resolveBrowser().navigateTo(url);
  }

  /**
   * Log in and open a Lightning app's home page.
   *
   * @param applicationName The app's developer name; see `lightningAppName` for namespacing.
   */
  public async goToApplication(applicationName: string): Promise<void> {
    await this.goToLoginUrl(applicationPath(applicationName));
  }

  /**
   * Log in and open the new-record form for an object.
   *
   * @param applicationName The app's developer name.
   * @param objectApiName The object's API name.
   */
  public async goToCreateNewRecord(applicationName: string, objectApiName: string): Promise<void> {
    await this.goToLoginUrl(newRecordPath(applicationName, objectApiName));
  }

  /**
   * Log in and open a record's detail page.
   *
   * @param applicationName The app's developer name.
   * @param recordId The record's id.
   */
  public async goToRecord(applicationName: string, recordId: string): Promise<void> {
    await this.goToLoginUrl(recordPath(applicationName, recordId));
  }

  /**
   * Log in and open one of a record's related lists.
   *
   * @param applicationName The app's developer name.
   * @param recordId The parent record's id.
   * @param relatedListName The relationship name.
   */
  public async goToRelatedList(applicationName: string, recordId: string, relatedListName: string): Promise<void> {
    await this.goToLoginUrl(relatedListPath(applicationName, recordId, relatedListName));
  }

  #resolveBrowser(): NavigableBrowser {
    const browser = this.#browser ?? (globalThis as { browser?: NavigableBrowser }).browser;
    if (!browser) {
      throw new Error(
        'No browser to navigate: pass one as the `browser` option, or run inside WebdriverIO so the global `browser` exists',
      );
    }
    return browser;
  }
}
