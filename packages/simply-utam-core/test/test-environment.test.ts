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

import type { Org } from '@salesforce/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestEnvironment } from '../src/test-environment.js';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@salesforce/core', () => ({ Org: { create } }));

function fakeOrg(frontdoorUrl = 'https://example.my.salesforce.com/secur/frontdoor.jsp?otp=abc'): {
  org: Org;
  getFrontDoorUrl: ReturnType<typeof vi.fn>;
} {
  const getFrontDoorUrl = vi.fn(() => Promise.resolve(frontdoorUrl));
  return { org: { getFrontDoorUrl } as unknown as Org, getFrontDoorUrl };
}

describe('TestEnvironment', () => {
  beforeEach(() => {
    create.mockReset();
  });

  it('reads the username from UTAM_USERNAME', () => {
    expect(new TestEnvironment({ env: { UTAM_USERNAME: 'qa@example.com' } }).username).toBe('qa@example.com');
  });

  it('prefers an explicit username over the environment', () => {
    const environment = new TestEnvironment({ username: 'alias', env: { UTAM_USERNAME: 'qa@example.com' } });
    expect(environment.username).toBe('alias');
  });

  it('refuses to start without a username', () => {
    expect(() => new TestEnvironment({ env: {} })).toThrow(/UTAM_USERNAME/);
  });

  it('authenticates once, however many callers race for it', async () => {
    const { org } = fakeOrg();
    create.mockResolvedValue(org);
    const environment = new TestEnvironment({ username: 'qa@example.com' });

    const [first, second] = await Promise.all([environment.getOrg(), environment.getOrg()]);
    await environment.init();

    expect(first).toBe(org);
    expect(second).toBe(org);
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({ aliasOrUsername: 'qa@example.com' });
  });

  it('retries authentication after a failure instead of caching it', async () => {
    create.mockRejectedValueOnce(new Error('No authorization information found')).mockResolvedValueOnce(fakeOrg().org);
    const environment = new TestEnvironment({ username: 'qa@example.com' });

    await expect(environment.init()).rejects.toThrow(/No authorization/);
    await expect(environment.init()).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("builds the frontdoor URL through the org's single-access endpoint", async () => {
    const { org, getFrontDoorUrl } = fakeOrg();
    create.mockResolvedValue(org);
    const environment = new TestEnvironment({ username: 'qa@example.com' });

    const url = await environment.buildFrontdoorUrl('/lightning/page/home');

    expect(url).toBe('https://example.my.salesforce.com/secur/frontdoor.jsp?otp=abc');
    expect(getFrontDoorUrl).toHaveBeenCalledWith('/lightning/page/home');
  });
});
