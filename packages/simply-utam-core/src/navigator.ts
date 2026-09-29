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
import { getTestEnvironment, TestEnvironment } from './test-environment.js';

/** The part of a WebdriverIO browser the navigator drives. */
export type NavigableBrowser = {
  navigateTo(url: string): Promise<unknown>;
};

/** Anything that can mint a logged-in URL; `TestEnvironment` in practice. */
export type FrontdoorUrlSource = {
  buildFrontdoorUrl(returnUrl?: string): Promise<string>;
  buildExperienceFrontdoorUrl?(sitePrefix?: string, returnUrl?: string): Promise<string>;
  getOrgId?(): Promise<string>;
  getUserIdByUsername?(username: string): Promise<string>;
  getInstanceUrl?(): Promise<string>;
  getNetworkIdByPrefix?(sitePrefix?: string): Promise<string>;
  buildExperienceUrl?(sitePrefix?: string, path?: string): Promise<string>;
};

export type LightningNavigatorOptions = {
  /** Where login URLs come from. Defaults to a `TestEnvironment` for `UTAM_USERNAME`. */
  environment?: FrontdoorUrlSource;
  /** The browser to drive. Defaults to WebdriverIO's global `browser`, looked up on each call. */
  browser?: NavigableBrowser;
};

declare global {
  var browser: NavigableBrowser | undefined;
}

/**
 * Resolves an active browser instance from explicit parameters or the global runtime context.
 *
 * @param browserInstance - Optional explicit browser instance.
 * @returns The resolved NavigableBrowser instance.
 */
export function resolveBrowser(browserInstance?: NavigableBrowser): NavigableBrowser {
  const resolved = browserInstance ?? (typeof browser !== 'undefined' ? browser : undefined);
  if (!resolved || typeof resolved.navigateTo !== 'function') {
    throw new Error(
      'No browser to navigate: pass one as the `browser` option, or run inside WebdriverIO so the global `browser` exists',
    );
  }
  return resolved;
}

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
    this.#environment = options.environment ?? getTestEnvironment();
    this.#browser = options.browser;
  }

  /**
   * Log in and open `returnUrl`, or the org's default landing page when it is omitted.
   *
   * @param returnUrl Path to open after login.
   * @returns The resolved frontdoor URL navigated to.
   */
  public async goToLoginUrl(returnUrl?: string): Promise<string> {
    const url = await this.#environment.buildFrontdoorUrl(returnUrl);
    await this.resolveBrowser().navigateTo(url);
    return url;
  }

  /**
   * Log in and open a Lightning app's home page.
   *
   * @param applicationName The app's developer name; see `lightningAppName` for namespacing.
   * @returns The resolved application URL.
   */
  public async goToApplication(applicationName: string): Promise<string> {
    return this.goToLoginUrl(applicationPath(applicationName));
  }

  /**
   * Log in and open the new-record form for an object.
   *
   * @param applicationName The app's developer name.
   * @param objectApiName The object's API name.
   * @returns The resolved record creation URL.
   */
  public async goToCreateNewRecord(applicationName: string, objectApiName: string): Promise<string> {
    return this.goToLoginUrl(newRecordPath(applicationName, objectApiName));
  }

  /**
   * Log in and open a record's detail page.
   *
   * @param applicationName The app's developer name.
   * @param recordId The record's id.
   * @returns The resolved record view URL.
   */
  public async goToRecord(applicationName: string, recordId: string): Promise<string> {
    return this.goToLoginUrl(recordPath(applicationName, recordId));
  }

  /**
   * Log in and open one of a record's related lists.
   *
   * @param applicationName The app's developer name.
   * @param recordId The parent record's id.
   * @param relatedListName The relationship name.
   * @returns The resolved related list URL.
   */
  public async goToRelatedList(applicationName: string, recordId: string, relatedListName: string): Promise<string> {
    return this.goToLoginUrl(relatedListPath(applicationName, recordId, relatedListName));
  }

  /**
   * Navigates the browser to a specific Experience Cloud site page via UI Bridge frontdoor login.
   *
   * @param sitePrefix - The URL prefix of the Experience site.
   * @param pageName - The Experience page name (relative to /s/).
   * @returns The resolved Experience frontdoor URL navigated to.
   */
  public async goToExperiencePage(sitePrefix: string, pageName: string): Promise<string> {
    const cleanPageName = pageName.startsWith('/') ? pageName.slice(1) : pageName;
    let frontdoorUrl: string;
    if (typeof this.#environment.buildExperienceFrontdoorUrl === 'function') {
      frontdoorUrl = await this.#environment.buildExperienceFrontdoorUrl(sitePrefix, `/s/${cleanPageName}`);
    } else {
      const env = getTestEnvironment();
      frontdoorUrl = await env.buildExperienceFrontdoorUrl(sitePrefix, `/s/${cleanPageName}`);
    }
    await this.resolveBrowser().navigateTo(frontdoorUrl);
    return frontdoorUrl;
  }

  /**
   * Logs in as a specific user using Salesforce user impersonation.
   *
   * @param username - The target user's username.
   * @param returnUrl - The target page to land on once logged in. Defaults to '/'.
   * @returns The resolved impersonation redirect URL.
   */
  public async loginAsUser(username: string, returnUrl = '/'): Promise<string> {
    const browserTarget = this.resolveBrowser();
    await this.goToLoginUrl('/');
    const env = this.#environment;
    const orgId = typeof env.getOrgId === 'function' ? await env.getOrgId() : await getTestEnvironment().getOrgId();
    const userId =
      typeof env.getUserIdByUsername === 'function'
        ? await env.getUserIdByUsername(username)
        : await getTestEnvironment().getUserIdByUsername(username);
    const instanceUrl =
      typeof env.getInstanceUrl === 'function'
        ? await env.getInstanceUrl()
        : await getTestEnvironment().getInstanceUrl();
    const loginAsUrl = `${instanceUrl}/servlet/servlet.su?oid=${orgId}&suorgadminid=${userId}&targetURL=${encodeURIComponent(returnUrl)}`;
    await browserTarget.navigateTo(loginAsUrl);
    return loginAsUrl;
  }

  /**
   * Logs in as a specific user and navigates directly to an Experience Cloud site.
   *
   * @param username - The target user's username.
   * @param sitePrefix - The URL prefix of the Experience site.
   * @param pageName - The Experience page name (relative to /s/).
   * @returns The resolved Experience site page URL.
   */
  public async loginAsExperienceUser(username: string, sitePrefix: string, pageName: string): Promise<string> {
    const browserTarget = this.resolveBrowser();
    await this.loginAsUser(username, '/');
    const env = this.#environment;
    const networkId =
      typeof env.getNetworkIdByPrefix === 'function'
        ? await env.getNetworkIdByPrefix(sitePrefix)
        : await getTestEnvironment().getNetworkIdByPrefix(sitePrefix);
    const instanceUrl =
      typeof env.getInstanceUrl === 'function'
        ? await env.getInstanceUrl()
        : await getTestEnvironment().getInstanceUrl();
    const networkSwitchUrl = `${instanceUrl}/servlet/networks/switch?networkId=${networkId}`;
    await browserTarget.navigateTo(networkSwitchUrl);
    const cleanPageName = pageName.startsWith('/') ? pageName.slice(1) : pageName;
    const experienceUrl =
      typeof env.buildExperienceUrl === 'function'
        ? await env.buildExperienceUrl(sitePrefix, `/s/${cleanPageName}`)
        : await getTestEnvironment().buildExperienceUrl(sitePrefix, `/s/${cleanPageName}`);
    await browserTarget.navigateTo(experienceUrl);
    return experienceUrl;
  }

  public resolveBrowser(): NavigableBrowser {
    return resolveBrowser(this.#browser);
  }
}

/**
 * Functional helper: Navigates the browser to the Salesforce Frontdoor login URL.
 *
 * @param returnUrl - Optional landing page path after login.
 * @param browserInstance - Optional browser instance overriding the global runner.
 * @param testEnvironment - Optional TestEnvironment instance.
 * @returns The resolved frontdoor URL navigated to.
 */
export async function goToLoginUrl(
  returnUrl?: string,
  browserInstance?: NavigableBrowser,
  testEnvironment?: TestEnvironment,
): Promise<string> {
  const navigator = new LightningNavigator({
    browser: browserInstance,
    environment: testEnvironment,
  });
  return navigator.goToLoginUrl(returnUrl);
}

/**
 * Functional helper: Navigates the browser to an Experience Cloud page.
 *
 * @param sitePrefix - The URL prefix of the Experience site.
 * @param pageName - The Experience page name.
 * @param browserInstance - Optional browser instance overriding the global runner.
 * @param testEnvironment - Optional TestEnvironment instance.
 * @returns The resolved Experience frontdoor URL navigated to.
 */
export async function goToExperiencePage(
  sitePrefix: string,
  pageName: string,
  browserInstance?: NavigableBrowser,
  testEnvironment?: TestEnvironment,
): Promise<string> {
  const navigator = new LightningNavigator({
    browser: browserInstance,
    environment: testEnvironment,
  });
  return navigator.goToExperiencePage(sitePrefix, pageName);
}

/**
 * Functional helper: Logs in as a specific user using Salesforce user impersonation.
 *
 * @param username - The target user's username.
 * @param returnUrl - Landing path after impersonation.
 * @param browserInstance - Optional browser instance overriding the global runner.
 * @param testEnvironment - Optional TestEnvironment instance.
 * @returns The resolved impersonation redirect URL.
 */
export async function loginAsUser(
  username: string,
  returnUrl = '/',
  browserInstance?: NavigableBrowser,
  testEnvironment?: TestEnvironment,
): Promise<string> {
  const navigator = new LightningNavigator({
    browser: browserInstance,
    environment: testEnvironment,
  });
  return navigator.loginAsUser(username, returnUrl);
}

/**
 * Functional helper: Logs in as a user and navigates directly to an Experience Cloud site.
 *
 * @param username - The target user's username.
 * @param sitePrefix - The URL prefix of the Experience site.
 * @param pageName - The Experience page name.
 * @param browserInstance - Optional browser instance overriding the global runner.
 * @param testEnvironment - Optional TestEnvironment instance.
 * @returns The resolved Experience site page URL.
 */
export async function loginAsExperienceUser(
  username: string,
  sitePrefix: string,
  pageName: string,
  browserInstance?: NavigableBrowser,
  testEnvironment?: TestEnvironment,
): Promise<string> {
  const navigator = new LightningNavigator({
    browser: browserInstance,
    environment: testEnvironment,
  });
  return navigator.loginAsExperienceUser(username, sitePrefix, pageName);
}

/**
 * Functional helper: Navigates to a standard Lightning Application home page.
 *
 * @param applicationName - The developer name of the Lightning application.
 * @param browserInstance - Optional browser instance.
 * @param testEnvironment - Optional TestEnvironment instance.
 * @returns The resolved frontdoor application URL.
 */
export async function goToApplication(
  applicationName: string,
  browserInstance?: NavigableBrowser,
  testEnvironment?: TestEnvironment,
): Promise<string> {
  const navigator = new LightningNavigator({
    browser: browserInstance,
    environment: testEnvironment,
  });
  return navigator.goToApplication(applicationName);
}

/**
 * Functional helper: Navigates to a new record creation page for a specific sObject in an application.
 *
 * @param applicationName - The developer name of the Lightning application.
 * @param objectName - The API name of the sObject.
 * @param browserInstance - Optional browser instance.
 * @param testEnvironment - Optional TestEnvironment instance.
 * @returns The resolved frontdoor URL.
 */
export async function goToCreateNewRecord(
  applicationName: string,
  objectName: string,
  browserInstance?: NavigableBrowser,
  testEnvironment?: TestEnvironment,
): Promise<string> {
  const navigator = new LightningNavigator({
    browser: browserInstance,
    environment: testEnvironment,
  });
  return navigator.goToCreateNewRecord(applicationName, objectName);
}

/**
 * Functional helper: Navigates to a record view page in a Lightning application.
 *
 * @param applicationName - The developer name of the Lightning application.
 * @param recordId - The 15 or 18 character Salesforce record ID.
 * @param browserInstance - Optional browser instance.
 * @param testEnvironment - Optional TestEnvironment instance.
 * @returns The resolved frontdoor URL.
 */
export async function goToRecord(
  applicationName: string,
  recordId: string,
  browserInstance?: NavigableBrowser,
  testEnvironment?: TestEnvironment,
): Promise<string> {
  const navigator = new LightningNavigator({
    browser: browserInstance,
    environment: testEnvironment,
  });
  return navigator.goToRecord(applicationName, recordId);
}

/**
 * Functional helper: Navigates to a related list view for a specific record in a Lightning application.
 *
 * @param applicationName - The developer name of the Lightning application.
 * @param recordId - The 15 or 18 character parent record ID.
 * @param relatedListName - The relationship name of the related list.
 * @param browserInstance - Optional browser instance.
 * @param testEnvironment - Optional TestEnvironment instance.
 * @returns The resolved frontdoor URL.
 */
export async function goToRelatedList(
  applicationName: string,
  recordId: string,
  relatedListName: string,
  browserInstance?: NavigableBrowser,
  testEnvironment?: TestEnvironment,
): Promise<string> {
  const navigator = new LightningNavigator({
    browser: browserInstance,
    environment: testEnvironment,
  });
  return navigator.goToRelatedList(applicationName, recordId, relatedListName);
}
