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

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { DEFAULT_NAMESPACE_MAP, resolveNamespaceMappings } from '../namespaces/namespace-map.js';

/** What the project's namespace configuration says. */
export type NamespaceConfig = {
  /** The project's `package.json` name. */
  packageName?: string;
  /** `generator.config.json` `namespaces`: component namespace → import prefix. */
  namespaces: Record<string, string>;
  /** `.utam/namespace-map.json`: project prefix → external prefix, longest first, as `rewrite` applies it. */
  namespaceMap: Array<[string, string]>;
  /** The prefix the project's own page objects are imported by. */
  projectPrefix: string;
};

/** A page-object package a namespace maps to, installed in the project. */
export type PageObjectPackage = {
  name: string;
  dir: string;
  version?: string;
  /** The import prefixes that name it, in the order the configuration gives them. */
  prefixes: string[];
};

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/**
 * Read the generator's `namespaces` and the namespace map.
 *
 * @param projectDir The test project.
 */
export function readNamespaceConfig(projectDir: string): NamespaceConfig {
  const packageName = readJson<{ name?: string }>(path.join(projectDir, 'package.json'))?.name;
  const namespaces =
    readJson<{ namespaces?: Record<string, string> }>(path.join(projectDir, 'generator.config.json'))?.namespaces ?? {};
  // `c` is the namespace init writes and the generator compiles the project's own components under,
  // whatever it's named: a scope-free name kept from older versions, or --app-name.
  const projectPrefix =
    (typeof namespaces['c'] === 'string' ? namespaces['c'] : undefined) ??
    Object.values(namespaces).find((prefix) => packageName && prefix.startsWith(`${packageName}/`)) ??
    (packageName ? `${packageName}/pageObjects/` : 'pageObjects/');
  return {
    ...(packageName ? { packageName } : {}),
    namespaces,
    namespaceMap: resolveNamespaceMappings(projectDir).sortedMappings,
    projectPrefix,
  };
}

/** The package an import prefix names: its first path segment, or its first two for a scoped package. */
export function packageOf(prefix: string): string | undefined {
  const [first, second] = prefix.split('/');
  if (!first || first.startsWith('.')) return undefined;
  if (!first.startsWith('@')) return first;
  return second ? `${first}/${second}` : undefined;
}

/** A package's folder, found the way `require` searches `node_modules` from the project. */
export function packageDir(projectDir: string, name: string): string | undefined {
  const require = createRequire(path.join(projectDir, 'package.json'));
  for (const dir of require.resolve.paths(name) ?? []) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  return undefined;
}

/**
 * The page-object packages the project's namespace configuration maps to: the values of the
 * generator's `namespaces` outside the project's own package, then the namespace map's values. A
 * mapped package that isn't installed gets a warning naming where it was mapped.
 *
 * @param projectDir The test project.
 * @param config Its namespace configuration.
 */
export function discoverPageObjectPackages(
  projectDir: string,
  config: NamespaceConfig,
): { packages: PageObjectPackage[]; warnings: string[] } {
  const sources: Array<{ prefix: string; from: string }> = [
    ...Object.entries(config.namespaces).map(([namespace, prefix]) => ({
      prefix,
      from: `generator.config.json maps namespace "${namespace}" to it`,
    })),
    ...config.namespaceMap.map(([from, prefix]) => ({
      prefix,
      from: `${DEFAULT_NAMESPACE_MAP} maps "${from}" to it`,
    })),
  ];
  const found = new Map<string, PageObjectPackage>();
  const missing = new Map<string, string[]>();
  for (const { prefix, from } of sources) {
    if (typeof prefix !== 'string' || prefix === config.projectPrefix) continue;
    const name = packageOf(prefix);
    if (!name || name === config.packageName) continue;
    const known = found.get(name);
    if (known) {
      if (!known.prefixes.includes(prefix)) known.prefixes.push(prefix);
      continue;
    }
    if (missing.has(name)) {
      missing.get(name)!.push(from);
      continue;
    }
    const dir = packageDir(projectDir, name);
    if (!dir) {
      missing.set(name, [from]);
      continue;
    }
    const version = readJson<{ version?: string }>(path.join(dir, 'package.json'))?.version;
    found.set(name, { name, dir, ...(version ? { version } : {}), prefixes: [prefix] });
  }
  const warnings = [...missing].map(
    ([name, froms]) => `${name} is not installed in ${projectDir}, but ${froms.join(' and ')}; it isn't indexed.`,
  );
  return { packages: [...found.values()], warnings };
}
