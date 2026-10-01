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

import { Connection, Org } from '@salesforce/core';

/** The environment variable naming the org a UTAM run authenticates to. */
export const USERNAME_ENV = 'UTAM_USERNAME';

/** An environment-shaped map; `process.env` by default. */
export type EnvLike = Record<string, string | undefined>;

/**
 * Default trusted Salesforce host regular expression patterns for Experience Cloud and Salesforce domains.
 */
export const DEFAULT_ALLOWED_HOST_PATTERNS: RegExp[] = [
  /\.salesforce\.com$/i,
  /\.site\.com$/i,
  /\.salesforce-sites\.com$/i,
  /\.force\.com$/i,
];

function matchesCustomDomain(lowerHost: string, rawDomain: string): boolean {
  let cleanDomain = rawDomain;
  if (cleanDomain.includes('://')) {
    try {
      cleanDomain = new URL(cleanDomain).hostname.toLowerCase();
    } catch {
      // Keep cleanDomain on URL parse failure
    }
  }
  if (cleanDomain.includes(':')) {
    cleanDomain = cleanDomain.split(':')[0];
  }

  if (cleanDomain.startsWith('*.')) {
    const suffix = cleanDomain.slice(2);
    return lowerHost === suffix || lowerHost.endsWith(`.${suffix}`);
  }
  if (cleanDomain.startsWith('.')) {
    const suffix = cleanDomain.slice(1);
    return lowerHost === suffix || lowerHost.endsWith(`.${suffix}`);
  }
  return lowerHost === cleanDomain || lowerHost.endsWith(`.${cleanDomain}`);
}

/**
 * Checks whether a given hostname is an authorized Salesforce or custom domain.
 *
 * @param hostname - The hostname to validate.
 * @param instanceUrl - Optional base instance URL of the target org.
 * @param envAllowedDomains - Comma-delimited custom allowed domains or wildcards.
 * @returns True if the hostname is authorized, false otherwise.
 */
export function isHostAllowed(
  hostname: string,
  instanceUrl?: string,
  envAllowedDomains: string | undefined = process.env['UTAM_ALLOWED_DOMAINS'],
): boolean {
  if (!hostname || typeof hostname !== 'string') {
    return false;
  }

  let lowerHost = hostname.toLowerCase().trim();
  if (lowerHost.includes(':')) {
    lowerHost = lowerHost.split(':')[0];
  }

  if (!lowerHost) {
    return false;
  }

  // 1. Check matching instance host
  if (instanceUrl) {
    try {
      const parsedInstanceUrl = new URL(instanceUrl);
      if (lowerHost === parsedInstanceUrl.hostname.toLowerCase()) {
        return true;
      }
    } catch {
      // Ignore invalid instanceUrl parsing
    }
  }

  // 2. Check default trusted Salesforce host patterns
  if (DEFAULT_ALLOWED_HOST_PATTERNS.some((pattern) => pattern.test(lowerHost))) {
    return true;
  }

  // 3. Check custom domain overrides (comma-separated list of domains or wildcards)
  if (envAllowedDomains) {
    const customDomains = envAllowedDomains
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);

    return customDomains.some((domain) => matchesCustomDomain(lowerHost, domain));
  }

  return false;
}

/**
 * Validates and parses a raw secure URL retrieved from SiteDetail.
 *
 * @param secureUrl - The raw secure URL string.
 * @param siteId - Identifier of the site for error reporting.
 * @param hostValidator - Optional callback function validating the hostname.
 * @returns The parsed and validated WHATWG URL object.
 */
export function validateAndParseSecureUrl(
  secureUrl: string,
  siteId: string,
  hostValidator?: (host: string) => boolean,
): URL {
  if (!secureUrl) {
    throw new Error(`SecureUrl is empty for Site ID '${siteId}'`);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(secureUrl);
  } catch {
    throw new Error(`Invalid Site URL '${secureUrl}' for Site ID '${siteId}'`);
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error(`Insecure protocol '${parsedUrl.protocol}' for Site URL: ${secureUrl}`);
  }

  if (typeof hostValidator === 'function' && !hostValidator(parsedUrl.hostname)) {
    throw new Error(
      `Disallowed host '${parsedUrl.hostname}' for Site URL. Expected a trusted Salesforce domain or UTAM_ALLOWED_DOMAINS entry.`,
    );
  }

  return parsedUrl;
}

export type TestEnvironmentOptions = {
  /** Username or alias of an org already authorized with the Salesforce CLI. Wins over `UTAM_USERNAME`. */
  username?: string;
  /** Where `UTAM_USERNAME` is read from. Defaults to `process.env`. */
  env?: EnvLike;
  /** Optional custom allowed domains or wildcards overriding UTAM_ALLOWED_DOMAINS. */
  allowedDomains?: string;
};

/**
 * The org a UTAM run tests against, resolved from the Salesforce CLI's local auth store.
 */
export class TestEnvironment {
  public readonly username: string;
  readonly #allowedDomains?: string;

  #org?: Promise<Org>;
  #resolvedOrg?: Org;

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
    this.#allowedDomains = options.allowedDomains;
  }

  /**
   * Indicates whether authentication has been initialized.
   */
  public get isInitialized(): boolean {
    return this.#resolvedOrg !== undefined;
  }

  /**
   * Resolve the authenticated org. The first call authenticates and every later call shares its
   * result, so callers need not coordinate who goes first; a failed attempt is not cached.
   */
  public async getOrg(): Promise<Org> {
    if (this.#resolvedOrg) {
      return this.#resolvedOrg;
    }

    this.#org ??= Org.create({ aliasOrUsername: this.username })
      .then((org) => {
        this.#resolvedOrg = org;
        return org;
      })
      .catch((error: unknown) => {
        this.#org = undefined;
        this.#resolvedOrg = undefined;
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
   * Returns the underlying `@salesforce/core` Connection instance.
   */
  public async getConnection(): Promise<Connection> {
    const org = await this.getOrg();
    return org.getConnection();
  }

  /**
   * Returns the cleaned instance URL (My Domain) of the target org.
   */
  public async getInstanceUrl(): Promise<string> {
    const org = await this.getOrg();
    const rawUrl = org.getField(Org.Fields.INSTANCE_URL);
    const instanceUrl = typeof rawUrl === 'string' ? rawUrl : '';
    return instanceUrl.replace(/\/$/, '');
  }

  /**
   * Build a single-use frontdoor URL that logs the browser in and lands on `returnUrl`.
   *
   * @param returnUrl Path to open after login, e.g. `/lightning/page/home`. Omit for the org's default landing page.
   */
  public async buildFrontdoorUrl(returnUrl?: string): Promise<string> {
    const org = await this.getOrg();
    return org.getFrontDoorUrl(returnUrl);
  }

  /**
   * Checks whether a hostname is authorized using the current target org context.
   *
   * @param hostname - The hostname to validate.
   */
  public async isHostAllowedInternal(hostname: string): Promise<boolean> {
    const org = await this.getOrg();
    const rawUrl = org.getField(Org.Fields.INSTANCE_URL);
    const instanceUrl = typeof rawUrl === 'string' ? rawUrl : undefined;
    return isHostAllowed(hostname, instanceUrl, this.#allowedDomains);
  }

  /**
   * Queries the Experience Cloud site and validates its SecureUrl.
   */
  public async getValidatedExperienceSiteUrl(sitePrefix?: string): Promise<URL> {
    const connection = await this.getConnection();
    const queryStr = sitePrefix
      ? `SELECT Id FROM Site WHERE UrlPathPrefix = '${sitePrefix.replace(/'/g, "\\'")}' LIMIT 1`
      : `SELECT Id FROM Site WHERE UrlPathPrefix = null LIMIT 1`;

    const siteResult = (await connection.query(queryStr)) as {
      records?: Array<{ Id: string }>;
    };

    if (!siteResult.records || siteResult.records.length === 0) {
      throw new Error(`Unable to find an Experience Cloud site with prefix '${sitePrefix ?? 'none'}'`);
    }

    const siteId15 = siteResult.records[0].Id.substring(0, 15);
    const siteDetailResult = (await connection.query(
      `SELECT SecureUrl FROM SiteDetail WHERE DurableId = '${siteId15}' LIMIT 1`,
    )) as {
      records?: Array<{ SecureUrl: string }>;
    };

    if (!siteDetailResult.records || siteDetailResult.records.length === 0) {
      throw new Error(`Unable to find SiteDetail for Site ID '${siteId15}'`);
    }

    const secureUrl = siteDetailResult.records[0].SecureUrl;
    return validateAndParseSecureUrl(secureUrl, siteId15, (host) =>
      isHostAllowed(host, undefined, this.#allowedDomains),
    );
  }

  /**
   * Generates a Frontdoor URL for an Experience Cloud Site using the singleaccess API.
   *
   * @param sitePrefix - Optional URL path prefix of the site.
   * @param returnUrl - Optional landing page path after login.
   * @returns One-time Experience Cloud frontdoor login URL.
   */
  public async buildExperienceFrontdoorUrl(sitePrefix?: string, returnUrl?: string): Promise<string> {
    const org = await this.getOrg();
    await org.refreshAuth();
    const connection = org.getConnection();

    if (!connection.accessToken) {
      throw new Error('Unable to retrieve an access token');
    }

    const parsedSiteUrl = await this.getValidatedExperienceSiteUrl(sitePrefix);
    const singleAccessEndpoint = new URL('/services/oauth2/singleaccess', parsedSiteUrl.origin);
    const responseRaw: unknown = await connection.request({
      method: 'POST',
      url: singleAccessEndpoint.href,
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: '',
    });

    const responseData =
      typeof responseRaw === 'string'
        ? (JSON.parse(responseRaw) as { frontdoor_uri?: string })
        : (responseRaw as { frontdoor_uri?: string } | null | undefined);
    const frontdoorUrl = responseData?.frontdoor_uri;

    if (!frontdoorUrl) {
      throw new Error('UI Bridge API response did not contain frontdoor_uri');
    }

    if (returnUrl) {
      const cleanReturnUrl = returnUrl.startsWith('/') ? returnUrl : `/${returnUrl}`;
      const separator = frontdoorUrl.includes('?') ? '&' : '?';
      return `${frontdoorUrl}${separator}retURL=${encodeURIComponent(cleanReturnUrl)}`;
    }

    return frontdoorUrl;
  }

  /**
   * Retrieves the Salesforce Organization ID dynamically via SOQL query.
   */
  public async getOrgId(): Promise<string> {
    const connection = await this.getConnection();
    const orgResult = (await connection.query('SELECT Id FROM Organization LIMIT 1')) as {
      records?: Array<{ Id: string }>;
    };
    if (!orgResult.records || orgResult.records.length === 0) {
      throw new Error('Unable to retrieve Organization ID');
    }
    return orgResult.records[0].Id;
  }

  /**
   * Resolves a given Salesforce username to its corresponding User ID via SOQL query.
   *
   * @param username - Target Salesforce username to resolve.
   */
  public async getUserIdByUsername(username: string): Promise<string> {
    const connection = await this.getConnection();
    const safeUsername = username.replace(/'/g, "\\'");
    const userResult = (await connection.query(`SELECT Id FROM User WHERE Username = '${safeUsername}' LIMIT 1`)) as {
      records?: Array<{ Id: string }>;
    };
    if (!userResult.records || userResult.records.length === 0) {
      throw new Error(`Unable to find user with username '${username}'`);
    }
    return userResult.records[0].Id;
  }

  /**
   * Resolves an Experience Cloud Site's prefix to its corresponding 15-character Network ID.
   *
   * @param sitePrefix - The URL path prefix of the Experience site.
   */
  public async getNetworkIdByPrefix(sitePrefix?: string): Promise<string> {
    const connection = await this.getConnection();
    const queryStr = sitePrefix
      ? `SELECT Id FROM Network WHERE UrlPathPrefix = '${sitePrefix.replace(/'/g, "\\'")}' LIMIT 1`
      : `SELECT Id FROM Network WHERE UrlPathPrefix = null LIMIT 1`;

    const networkResult = (await connection.query(queryStr)) as {
      records?: Array<{ Id: string }>;
    };

    if (!networkResult.records || networkResult.records.length === 0) {
      throw new Error(`Unable to find a Network (Experience Site) with prefix '${sitePrefix ?? 'none'}'`);
    }

    return networkResult.records[0].Id.substring(0, 15);
  }

  /**
   * Generates a fully qualified secure URL for a given Experience Cloud Site (Community).
   *
   * @param sitePrefix - The URL path prefix of the Experience site.
   * @param path - Optional relative subpath to append.
   */
  public async buildExperienceUrl(sitePrefix?: string, path?: string): Promise<string> {
    const parsedSiteUrl = await this.getValidatedExperienceSiteUrl(sitePrefix);
    const cleanSiteUrl = parsedSiteUrl.href.replace(/\/$/, '');

    if (path) {
      const cleanPath = path.startsWith('/') ? path : `/${path}`;
      return `${cleanSiteUrl}${cleanPath}`;
    }

    return cleanSiteUrl;
  }

  /**
   * Resets active connection state, requiring re-authentication on subsequent calls.
   */
  public reset(): void {
    this.#org = undefined;
    this.#resolvedOrg = undefined;
  }
}

let globalTestEnvironment: TestEnvironment | null = null;

/**
 * Returns the global singleton TestEnvironment instance, lazily creating it if necessary.
 *
 * @param options - Optional configuration options to initialize or overwrite the singleton.
 * @returns The active TestEnvironment instance.
 */
export function getTestEnvironment(options?: TestEnvironmentOptions): TestEnvironment {
  if (!globalTestEnvironment || options) {
    globalTestEnvironment = new TestEnvironment(options);
  }
  return globalTestEnvironment;
}

/**
 * Overrides the active global singleton TestEnvironment instance.
 *
 * @param instance - The TestEnvironment instance to set, or null to clear.
 */
export function setTestEnvironment(instance: TestEnvironment | null): void {
  globalTestEnvironment = instance;
}

/**
 * Clears and resets the global singleton TestEnvironment instance.
 */
export function resetTestEnvironment(): void {
  if (globalTestEnvironment) {
    globalTestEnvironment.reset();
  }
  globalTestEnvironment = null;
}
