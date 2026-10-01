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

import type { Connection, Org } from '@salesforce/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ALLOWED_HOST_PATTERNS,
  isHostAllowed,
  validateAndParseSecureUrl,
  TestEnvironment,
  getTestEnvironment,
  setTestEnvironment,
  resetTestEnvironment,
} from '../src/test-environment.js';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@salesforce/core', () => ({
  Org: {
    create,
    Fields: {
      INSTANCE_URL: 'INSTANCE_URL',
    },
  },
}));

function fakeOrg(
  frontdoorUrl = 'https://example.my.salesforce.com/secur/frontdoor.jsp?otp=abc',
  mockConnection?: Partial<Connection>,
): {
  org: Org;
  getFrontDoorUrl: ReturnType<typeof vi.fn>;
  getConnection: ReturnType<typeof vi.fn>;
} {
  const getFrontDoorUrl = vi.fn(() => Promise.resolve(frontdoorUrl));
  const getField = vi.fn((field: string) => {
    if (field === 'INSTANCE_URL') return 'https://example.my.salesforce.com';
    return '';
  });
  const refreshAuth = vi.fn(() => Promise.resolve());
  const conn = {
    accessToken: 'mock-access-token',
    query: vi.fn(),
    request: vi.fn(),
    ...mockConnection,
  };
  const getConnection = vi.fn(() => conn as unknown as Connection);

  const org = {
    getFrontDoorUrl,
    getField,
    getConnection,
    refreshAuth,
  } as unknown as Org;

  return { org, getFrontDoorUrl, getConnection };
}

describe('TestEnvironment', () => {
  beforeEach(() => {
    create.mockReset();
    resetTestEnvironment();
  });

  describe('configuration & authentication', () => {
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
      create
        .mockRejectedValueOnce(new Error('No authorization information found'))
        .mockResolvedValueOnce(fakeOrg().org);
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

  describe('isHostAllowed', () => {
    it('should validate default allowed Salesforce patterns', () => {
      expect(DEFAULT_ALLOWED_HOST_PATTERNS).toHaveLength(4);
      const allowedHosts = [
        'my-org.my.salesforce.com',
        'community.my.site.com',
        'portal.force.com',
        'mysite.salesforce-sites.com',
      ];

      for (const host of allowedHosts) {
        expect(isHostAllowed(host, 'https://example.salesforce.com')).toBe(true);
      }
    });

    it('should reject unauthorized hosts', () => {
      expect(isHostAllowed('evil.attacker.com', 'https://example.salesforce.com')).toBe(false);
      expect(isHostAllowed('', 'https://example.salesforce.com')).toBe(false);
    });

    it('should allow hosts matching instanceUrl or custom overrides', () => {
      expect(isHostAllowed('custom.my-app.io', 'https://custom.my-app.io')).toBe(true);
      expect(isHostAllowed('sub.example.org', undefined, '*.example.org')).toBe(true);
    });
  });

  describe('validateAndParseSecureUrl', () => {
    it('throws on empty secure URL', () => {
      expect(() => validateAndParseSecureUrl('', 'site123')).toThrow(/SecureUrl is empty/);
    });

    it('throws on non-HTTPS URL', () => {
      expect(() => validateAndParseSecureUrl('http://insecure.site.com', 'site123')).toThrow(/Insecure protocol/);
    });

    it('throws on disallowed host validator', () => {
      expect(() => validateAndParseSecureUrl('https://disallowed.com', 'site123', () => false)).toThrow(
        /Disallowed host/,
      );
    });

    it('returns parsed URL on valid input', () => {
      const parsed = validateAndParseSecureUrl('https://my-community.site.com/portal', 'site123', () => true);
      expect(parsed.origin).toBe('https://my-community.site.com');
      expect(parsed.pathname).toBe('/portal');
    });
  });

  describe('Experience Cloud & SOQL helpers', () => {
    it('queries Organization ID', async () => {
      const mockQuery = vi.fn().mockResolvedValue({ records: [{ Id: '00D000000000001AAA' }] });
      const { org } = fakeOrg(undefined, { query: mockQuery });
      create.mockResolvedValue(org);

      const env = new TestEnvironment({ username: 'qa@example.com' });
      const orgId = await env.getOrgId();

      expect(orgId).toBe('00D000000000001AAA');
      expect(mockQuery).toHaveBeenCalledWith('SELECT Id FROM Organization LIMIT 1');
    });

    it('queries User ID by username', async () => {
      const mockQuery = vi.fn().mockResolvedValue({ records: [{ Id: '005000000000001AAA' }] });
      const { org } = fakeOrg(undefined, { query: mockQuery });
      create.mockResolvedValue(org);

      const env = new TestEnvironment({ username: 'qa@example.com' });
      const userId = await env.getUserIdByUsername('user@example.com');

      expect(userId).toBe('005000000000001AAA');
      expect(mockQuery).toHaveBeenCalledWith("SELECT Id FROM User WHERE Username = 'user@example.com' LIMIT 1");
    });

    it('queries Network ID by site prefix', async () => {
      const mockQuery = vi.fn().mockResolvedValue({ records: [{ Id: '0DB000000000001AAA' }] });
      const { org } = fakeOrg(undefined, { query: mockQuery });
      create.mockResolvedValue(org);

      const env = new TestEnvironment({ username: 'qa@example.com' });
      const networkId = await env.getNetworkIdByPrefix('portal');

      expect(networkId).toBe('0DB000000000001');
    });

    it('builds experience frontdoor URL via single access endpoint', async () => {
      const mockQuery = vi.fn().mockImplementation((soql: string) => {
        if (soql.includes('FROM Site ')) {
          return Promise.resolve({ records: [{ Id: '0DM000000000001AAA' }] });
        }
        if (soql.includes('FROM SiteDetail')) {
          return Promise.resolve({ records: [{ SecureUrl: 'https://community.my.site.com/portal' }] });
        }
        return Promise.resolve({ records: [] });
      });
      const mockRequest = vi.fn().mockResolvedValue({
        // eslint-disable-next-line camelcase
        frontdoor_uri: 'https://community.my.site.com/portal/secur/frontdoor.jsp?sid=token',
      });

      const { org } = fakeOrg(undefined, { query: mockQuery, request: mockRequest });
      create.mockResolvedValue(org);

      const env = new TestEnvironment({ username: 'qa@example.com' });
      const frontdoor = await env.buildExperienceFrontdoorUrl('portal', 'home');

      expect(frontdoor).toBe('https://community.my.site.com/portal/secur/frontdoor.jsp?sid=token&retURL=%2Fhome');
    });
  });

  describe('singleton helpers', () => {
    it('manages singleton lifecycle with get/set/reset', () => {
      const env1 = getTestEnvironment({ username: 'user1@example.com' });
      expect(env1.username).toBe('user1@example.com');

      const env2 = getTestEnvironment();
      expect(env2).toBe(env1);

      const customEnv = new TestEnvironment({ username: 'custom@example.com' });
      setTestEnvironment(customEnv);
      expect(getTestEnvironment()).toBe(customEnv);

      resetTestEnvironment();
      const env3 = getTestEnvironment({ username: 'user3@example.com' });
      expect(env3).not.toBe(customEnv);
      expect(env3.username).toBe('user3@example.com');
    });
  });
});
