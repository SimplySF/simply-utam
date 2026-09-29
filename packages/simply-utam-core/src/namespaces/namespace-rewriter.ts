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
import { discoverProject } from '../discovery/index.js';
import { detectIndentation } from '../overrides/index.js';

export interface RewriteNamespacesOptions {
  rootDir?: string;
  sourceDirs?: string[];
  configFile?: string;
  mappings?: Record<string, string>;
  dryRun?: boolean;
  verbose?: boolean;
}

export interface NamespaceReplacement {
  original: string;
  updated: string;
}

export interface FileRewriteResult {
  filePath: string;
  changes: NamespaceReplacement[];
  applied: boolean;
  error?: string;
}

export interface RewriteNamespacesResult {
  filesScanned: number;
  filesModified: number;
  totalReplacements: number;
  dryRun: boolean;
  configMissingOrEmpty: boolean;
  notice?: string;
  results: FileRewriteResult[];
}

/**
 * Recursively locates all *.utam.json files in a directory.
 *
 * @param dirPath - Directory to search within.
 * @returns Array of absolute paths to discovered *.utam.json files.
 */
export function findUtamJsonFiles(dirPath: string): string[] {
  const filesList: string[] = [];
  try {
    if (!fs.existsSync(dirPath)) {
      return filesList;
    }
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const name = entry.name;
        if (
          name !== 'node_modules' &&
          name !== '.git' &&
          name !== 'dist' &&
          name !== 'lib' &&
          name !== '.wireit' &&
          name !== 'pageObjects' &&
          name !== 'allure-results'
        ) {
          filesList.push(...findUtamJsonFiles(fullPath));
        }
      } else if (entry.isFile() && entry.name.endsWith('.utam.json')) {
        filesList.push(fullPath);
      }
    }
  } catch {
    // Gracefully ignore directory read errors
  }
  return filesList;
}

/**
 * Recursively updates string values in a JSON structure based on sorted prefix mappings.
 *
 * @param value - Value or AST subtree to examine.
 * @param sortedMappings - Tuples of [originalPrefix, replacementPrefix] sorted descending by length.
 * @param changesList - Array recording applied namespace replacements.
 * @returns Transformed value with replaced prefixes.
 */
export function updateValueWithMappings(
  value: unknown,
  sortedMappings: Array<[string, string]>,
  changesList: NamespaceReplacement[],
): unknown {
  if (typeof value === 'string') {
    for (const [prefix, replacement] of sortedMappings) {
      if (value.startsWith(prefix)) {
        const updated = replacement + value.slice(prefix.length);
        changesList.push({ original: value, updated });
        return updated;
      }
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => updateValueWithMappings(item, sortedMappings, changesList));
  }

  if (value !== null && typeof value === 'object') {
    const updatedObj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      updatedObj[key] = updateValueWithMappings(val, sortedMappings, changesList);
    }
    return updatedObj;
  }

  return value;
}

interface MappingResolutionResult {
  sortedMappings: Array<[string, string]>;
  configMissingOrEmpty: boolean;
  notice?: string;
}

function resolveMappings(
  rootDir: string,
  configFile?: string,
  mappings?: Record<string, string>,
): MappingResolutionResult {
  let rawMappings: Record<string, string> = {};

  if (mappings) {
    rawMappings = mappings;
  } else {
    const configPath = configFile
      ? path.isAbsolute(configFile)
        ? configFile
        : path.resolve(rootDir, configFile)
      : path.join(rootDir, '.utam', 'namespace-map.json');

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

function processSingleUtamFile(
  file: string,
  sortedMappings: Array<[string, string]>,
  dryRun: boolean,
): FileRewriteResult {
  let fileContent: string;
  let originalJson: unknown;
  try {
    fileContent = fs.readFileSync(file, 'utf-8');
    originalJson = JSON.parse(fileContent);
  } catch (err: unknown) {
    return {
      filePath: file,
      changes: [],
      applied: false,
      error: `Failed to parse UTAM JSON: ${(err as Error).message}`,
    };
  }

  const changesList: NamespaceReplacement[] = [];
  const updatedJson = updateValueWithMappings(originalJson, sortedMappings, changesList);

  if (changesList.length === 0) {
    return {
      filePath: file,
      changes: [],
      applied: false,
    };
  }

  if (!dryRun) {
    const indent = detectIndentation(fileContent);
    const endsWithNewline = fileContent.endsWith('\n');
    let outputContent = JSON.stringify(updatedJson, null, indent);
    if (endsWithNewline && !outputContent.endsWith('\n')) {
      outputContent += '\n';
    }
    fs.writeFileSync(file, outputContent, 'utf-8');
  }

  return {
    filePath: file,
    changes: changesList,
    applied: true,
  };
}

/**
 * Rewrites namespace prefixes across compiled *.utam.json page object definitions.
 *
 * @param options - Namespace rewriting options.
 * @returns Summary of files scanned and namespace replacements made.
 */
export function rewriteUtamNamespaces(options: RewriteNamespacesOptions = {}): RewriteNamespacesResult {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const dryRun = Boolean(options.dryRun);

  const resolution = resolveMappings(rootDir, options.configFile, options.mappings);
  if (resolution.configMissingOrEmpty) {
    return {
      filesScanned: 0,
      filesModified: 0,
      totalReplacements: 0,
      dryRun,
      configMissingOrEmpty: true,
      notice: resolution.notice,
      results: [],
    };
  }

  let sourceDirs = options.sourceDirs;
  if (!sourceDirs || sourceDirs.length === 0) {
    const discovered = discoverProject(rootDir);
    sourceDirs = discovered.packageDirectories.length > 0 ? discovered.packageDirectories : ['./sfdx-source'];
  }

  const allUtamFiles: string[] = [];
  for (const sourceDir of sourceDirs) {
    const resolvedSource = path.isAbsolute(sourceDir) ? sourceDir : path.resolve(rootDir, sourceDir);
    allUtamFiles.push(...findUtamJsonFiles(resolvedSource));
  }

  const uniqueUtamFiles = Array.from(new Set(allUtamFiles));

  const result: RewriteNamespacesResult = {
    filesScanned: uniqueUtamFiles.length,
    filesModified: 0,
    totalReplacements: 0,
    dryRun,
    configMissingOrEmpty: false,
    results: [],
  };

  for (const file of uniqueUtamFiles) {
    const fileResult = processSingleUtamFile(file, resolution.sortedMappings, dryRun);
    if (fileResult.applied) {
      result.filesModified++;
      result.totalReplacements += fileResult.changes.length;
    }
    result.results.push(fileResult);
  }

  return result;
}
