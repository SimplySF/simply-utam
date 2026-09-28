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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { LightningNavigator, type FrontdoorUrlSource, type NavigableBrowser } from '../src/navigator.js';

const environment: FrontdoorUrlSource = {
  buildFrontdoorUrl: (returnUrl) => Promise.resolve(`https://example.my.salesforce.com/frontdoor?ret=${returnUrl}`),
};

function fakeBrowser(): NavigableBrowser & { visited: string[] } {
  const visited: string[] = [];
  return {
    visited,
    navigateTo: (url) => {
      visited.push(url);
      return Promise.resolve();
    },
  };
}

describe('LightningNavigator', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('logs in and lands on the requested page', async () => {
    const browser = fakeBrowser();
    const navigator = new LightningNavigator({ environment, browser });

    await navigator.goToApplication('MyApp');
    await navigator.goToCreateNewRecord('MyApp', 'Account');
    await navigator.goToRecord('MyApp', '001000000000001AAA');
    await navigator.goToRelatedList('MyApp', '001000000000001AAA', 'Contacts');

    expect(browser.visited).toStrictEqual([
      'https://example.my.salesforce.com/frontdoor?ret=/lightning/app/c__MyApp/page/home',
      'https://example.my.salesforce.com/frontdoor?ret=/lightning/app/c__MyApp/o/Account/new',
      'https://example.my.salesforce.com/frontdoor?ret=/lightning/app/c__MyApp/r/001000000000001AAA/view',
      'https://example.my.salesforce.com/frontdoor?ret=/lightning/app/c__MyApp/r/001000000000001AAA/related/Contacts/view',
    ]);
  });

  it('passes no return URL for a plain login', async () => {
    const buildFrontdoorUrl = vi.fn(() => Promise.resolve('https://example.my.salesforce.com/frontdoor'));
    const navigator = new LightningNavigator({ environment: { buildFrontdoorUrl }, browser: fakeBrowser() });

    await navigator.goToLoginUrl();

    expect(buildFrontdoorUrl).toHaveBeenCalledWith(undefined);
  });

  it("falls back to WebdriverIO's global browser, looked up at call time", async () => {
    const navigator = new LightningNavigator({ environment });
    const browser = fakeBrowser();
    vi.stubGlobal('browser', browser);

    await navigator.goToApplication('MyApp');

    expect(browser.visited).toHaveLength(1);
  });

  it('says what is missing when there is no browser at all', async () => {
    const navigator = new LightningNavigator({ environment });

    await expect(navigator.goToApplication('MyApp')).rejects.toThrow(/No browser to navigate/);
  });

  it('defaults to a TestEnvironment, which needs UTAM_USERNAME', () => {
    vi.stubEnv('UTAM_USERNAME', '');
    try {
      expect(() => new LightningNavigator()).toThrow(/UTAM_USERNAME/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
