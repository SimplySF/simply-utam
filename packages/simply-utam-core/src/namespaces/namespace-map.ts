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

import fs from 'node:fs';
import path from 'node:path';

/** Where `init` scaffolds the namespace map, relative to the project. */
export const DEFAULT_NAMESPACE_MAP = path.join('.utam', 'namespace-map.json');

export interface NamespaceMapResolution {
  /** `[originalPrefix, replacementPrefix]` pairs, longest original prefix first. */
  sortedMappings: Array<[string, string]>;
  configMissingOrEmpty: boolean;
  notice?: string;
}

/**
 * Read a namespace map, or take the mappings given, sorted so longer, more specific prefixes match
 * first. Internal to core: `rewrite` and the page-object index share it, so both read the file the
 * same way.
 *
 * @param rootDir The project folder a relative `configFile` resolves against.
 * @param configFile The map's path. Defaults to `.utam/namespace-map.json`.
 * @param mappings Mappings to use instead of reading a file.
 */
export function resolveNamespaceMappings(
  rootDir: string,
  configFile?: string,
  mappings?: Record<string, string>,
): NamespaceMapResolution {
  let rawMappings: Record<string, string> = {};

  if (mappings) {
    rawMappings = mappings;
  } else {
    const configPath = configFile
      ? path.isAbsolute(configFile)
        ? configFile
        : path.resolve(rootDir, configFile)
      : path.join(rootDir, DEFAULT_NAMESPACE_MAP);

    if (!fs.existsSync(configPath)) {
      return {
        sortedMappings: [],
        configMissingOrEmpty: true,
        notice: `Namespace configuration file not found at ${configPath}. Exiting cleanly.`,
      };
    }

    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const parsed: unknown = JSON.parse(configContent);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        rawMappings = parsed as Record<string, string>;
      }
    } catch (err: unknown) {
      return {
        sortedMappings: [],
        configMissingOrEmpty: true,
        notice: `Failed to parse namespace config file: ${(err as Error).message}`,
      };
    }
  }

  const mappingEntries = Object.entries(rawMappings).filter(
    ([prefix, replacement]) => typeof prefix === 'string' && prefix.trim() && typeof replacement === 'string',
  );

  if (mappingEntries.length === 0) {
    return {
      sortedMappings: [],
      configMissingOrEmpty: true,
      notice: 'Namespace mapping object is empty. No rewrites required.',
    };
  }

  return {
    sortedMappings: [...mappingEntries].sort((a, b) => b[0].length - a[0].length),
    configMissingOrEmpty: false,
  };
}
