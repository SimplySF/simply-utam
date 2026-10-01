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
import {
  LightningNavigator,
  goToLoginUrl,
  goToExperiencePage,
  loginAsUser,
  loginAsExperienceUser,
  goToApplication,
  goToCreateNewRecord,
  goToRecord,
  goToRelatedList,
  resolveBrowser,
  type FrontdoorUrlSource,
  type NavigableBrowser,
} from '../src/navigator.js';
import { TestEnvironment } from '../src/test-environment.js';

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

  it('navigates to experience page and performs impersonation', async () => {
    const browser = fakeBrowser();
    const mockEnv: FrontdoorUrlSource = {
      buildFrontdoorUrl: vi.fn().mockResolvedValue('https://example.my.salesforce.com/frontdoor'),
      buildExperienceFrontdoorUrl: vi.fn().mockResolvedValue('https://community.site.com/frontdoor?retURL=%2Fs%2Fhome'),
      getOrgId: vi.fn().mockResolvedValue('00D000000000001AAA'),
      getUserIdByUsername: vi.fn().mockResolvedValue('005000000000001AAA'),
      getInstanceUrl: vi.fn().mockResolvedValue('https://example.my.salesforce.com'),
      getNetworkIdByPrefix: vi.fn().mockResolvedValue('0DB000000000001'),
      buildExperienceUrl: vi.fn().mockResolvedValue('https://community.site.com/s/home'),
    };

    const navigator = new LightningNavigator({ environment: mockEnv, browser });

    await navigator.goToExperiencePage('portal', 'home');
    expect(browser.visited).toContain('https://community.site.com/frontdoor?retURL=%2Fs%2Fhome');

    await navigator.loginAsUser('target@example.com', '/lightning/page/home');
    expect(browser.visited).toContain(
      'https://example.my.salesforce.com/servlet/servlet.su?oid=00D000000000001AAA&suorgadminid=005000000000001AAA&targetURL=%2Flightning%2Fpage%2Fhome',
    );

    await navigator.loginAsExperienceUser('target@example.com', 'portal', 'home');
    expect(browser.visited).toContain('https://community.site.com/s/home');
  });

  describe('functional navigation helpers', () => {
    it('supports standalone function calls', async () => {
      const browser = fakeBrowser();
      const mockEnv = {
        buildFrontdoorUrl: vi.fn((ret?: string) =>
          Promise.resolve(`https://example.my.salesforce.com/frontdoor?ret=${ret}`),
        ),
        buildExperienceFrontdoorUrl: vi
          .fn()
          .mockResolvedValue('https://community.site.com/frontdoor?retURL=%2Fs%2Fhome'),
        getOrgId: vi.fn().mockResolvedValue('00D000000000001AAA'),
        getUserIdByUsername: vi.fn().mockResolvedValue('005000000000001AAA'),
        getInstanceUrl: vi.fn().mockResolvedValue('https://example.my.salesforce.com'),
        getNetworkIdByPrefix: vi.fn().mockResolvedValue('0DB000000000001'),
        buildExperienceUrl: vi.fn().mockResolvedValue('https://community.site.com/s/home'),
      } as unknown as TestEnvironment;

      expect(resolveBrowser(browser)).toBe(browser);

      await goToLoginUrl('/custom', browser, mockEnv);
      await goToExperiencePage('portal', 'home', browser, mockEnv);
      await loginAsUser('target@example.com', '/lightning', browser, mockEnv);
      await loginAsExperienceUser('target@example.com', 'portal', 'home', browser, mockEnv);
      await goToApplication('MyApp', browser, mockEnv);
      await goToCreateNewRecord('MyApp', 'Account', browser, mockEnv);
      await goToRecord('MyApp', '001000000000001AAA', browser, mockEnv);
      await goToRelatedList('MyApp', '001000000000001AAA', 'Contacts', browser, mockEnv);

      expect(browser.visited.length).toBeGreaterThanOrEqual(8);
    });
  });
});
