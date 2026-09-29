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

export interface ApplyOverridesOptions {
  rootDir?: string;
  sourceDirs?: string[];
  dryRun?: boolean;
  verbose?: boolean;
}

export interface OverrideChange {
  elementName: string;
  matchCount: number;
}

export interface FileOverrideResult {
  overrideFilePath: string;
  generatedUtamFilePath: string;
  changes: OverrideChange[];
  applied: boolean;
  error?: string;
}

export interface ApplyOverridesResult {
  scannedFilesCount: number;
  modifiedFilesCount: number;
  totalOverridesApplied: number;
  dryRun: boolean;
  results: FileOverrideResult[];
}

export interface UtamOverrideItem {
  name: string;
  element: Record<string, unknown>;
}

/**
 * Detects indentation of a JSON string content (e.g. 2 spaces, 4 spaces, or tabs).
 *
 * @param content - Raw JSON string content.
 * @returns Indentation string sequence (spaces or tab).
 */
export function detectIndentation(content: string): string {
  const match = content.match(/^[ \t]+(?=")/m);
  return match ? match[0] : '    ';
}

/**
 * Recursively locates all *.utam-overrides.json files in a directory.
 *
 * @param dirPath - Directory to search within.
 * @returns Array of absolute paths to discovered *.utam-overrides.json files.
 */
export function findUtamOverridesFiles(dirPath: string): string[] {
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
          filesList.push(...findUtamOverridesFiles(fullPath));
        }
      } else if (entry.isFile() && entry.name.endsWith('.utam-overrides.json')) {
        filesList.push(fullPath);
      }
    }
  } catch {
    // Gracefully ignore directory read errors
  }
  return filesList;
}

/**
 * Recursively walks the UTAM JSON structure to find element nodes.
 *
 * @param node - Current AST node.
 * @param callback - Function invoked for each element object encountered.
 */
export function walkElements(
  node: unknown,
  callback: (element: Record<string, unknown>) => void,
): void {
  if (!node || typeof node !== 'object') {
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const itemObj = item as Record<string, unknown>;
        if (typeof itemObj['name'] === 'string') {
          callback(itemObj);
        }
        if (itemObj['elements']) {
          walkElements(itemObj['elements'], callback);
        }
        if (
          itemObj['shadow'] &&
          typeof itemObj['shadow'] === 'object' &&
          (itemObj['shadow'] as Record<string, unknown>)['elements']
        ) {
          walkElements((itemObj['shadow'] as Record<string, unknown>)['elements'], callback);
        }
      }
    }
    return;
  }

  const objNode = node as Record<string, unknown>;
  if (objNode['elements']) {
    walkElements(objNode['elements'], callback);
  }
  if (
    objNode['shadow'] &&
    typeof objNode['shadow'] === 'object' &&
    (objNode['shadow'] as Record<string, unknown>)['elements']
  ) {
    walkElements((objNode['shadow'] as Record<string, unknown>)['elements'], callback);
  }
}

/**
 * Safely merges the override element properties into the target element.
 *
 * @param target - Target AST element node to mutate.
 * @param source - Override properties to merge into target.
 */
export function mergeElements(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [key, val] of Object.entries(source)) {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      if (typeof target[key] !== 'object' || target[key] === null || Array.isArray(target[key])) {
        target[key] = {};
      }
      mergeElements(target[key] as Record<string, unknown>, val as Record<string, unknown>);
    } else {
      target[key] = val;
    }
  }
}

interface ProcessOverrideResult {
  result: FileOverrideResult;
  appliedCount: number;
}

function applyItemsToUtam(
  utamJson: unknown,
  overrides: unknown[],
): { changes: OverrideChange[]; count: number } {
  const changes: OverrideChange[] = [];
  let count = 0;

  for (const item of overrides) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const overrideItem = item as UtamOverrideItem;
    const { name, element } = overrideItem;

    if (
      typeof name !== 'string' ||
      !element ||
      typeof element !== 'object' ||
      Array.isArray(element)
    ) {
      continue;
    }

    let matchCount = 0;
    walkElements(utamJson, (elementNode) => {
      if (elementNode['name'] === name) {
        mergeElements(elementNode, element);
        matchCount++;
      }
    });

    if (matchCount > 0) {
      count += matchCount;
      changes.push({ elementName: name, matchCount });
    }
  }

  return { changes, count };
}

function processSingleOverrideFile(
  overrideFile: string,
  dryRun: boolean,
): ProcessOverrideResult {
  let overrides: unknown;
  try {
    overrides = JSON.parse(fs.readFileSync(overrideFile, 'utf-8'));
  } catch (err: unknown) {
    return {
      result: {
        overrideFilePath: overrideFile,
        generatedUtamFilePath: '',
        changes: [],
        applied: false,
        error: `Failed to parse overrides file: ${(err as Error).message}`,
      },
      appliedCount: 0,
    };
  }

  if (!Array.isArray(overrides)) {
    return {
      result: {
        overrideFilePath: overrideFile,
        generatedUtamFilePath: '',
        changes: [],
        applied: false,
        error: 'Overrides content is not a JSON array',
      },
      appliedCount: 0,
    };
  }

  const componentDir = path.dirname(overrideFile);
  const componentName = path.basename(overrideFile).replace('.utam-overrides.json', '');
  const generatedFilePath = path.join(componentDir, '__utam__', `${componentName}.utam.json`);

  if (!fs.existsSync(generatedFilePath)) {
    return {
      result: {
        overrideFilePath: overrideFile,
        generatedUtamFilePath: generatedFilePath,
        changes: [],
        applied: false,
        error: 'Target generated UTAM file does not exist',
      },
      appliedCount: 0,
    };
  }

  let fileContent: string;
  let utamJson: unknown;
  try {
    fileContent = fs.readFileSync(generatedFilePath, 'utf-8');
    utamJson = JSON.parse(fileContent);
  } catch (err: unknown) {
    return {
      result: {
        overrideFilePath: overrideFile,
        generatedUtamFilePath: generatedFilePath,
        changes: [],
        applied: false,
        error: `Failed to parse target UTAM JSON: ${(err as Error).message}`,
      },
      appliedCount: 0,
    };
  }

  const { changes, count } = applyItemsToUtam(utamJson, overrides);

  if (changes.length > 0) {
    if (!dryRun) {
      const indent = detectIndentation(fileContent);
      const endsWithNewline = fileContent.endsWith('\n');
      let outputContent = JSON.stringify(utamJson, null, indent);
      if (endsWithNewline && !outputContent.endsWith('\n')) {
        outputContent += '\n';
      }
      fs.writeFileSync(generatedFilePath, outputContent, 'utf-8');
    }

    return {
      result: {
        overrideFilePath: overrideFile,
        generatedUtamFilePath: generatedFilePath,
        changes,
        applied: true,
      },
      appliedCount: count,
    };
  }

  return {
    result: {
      overrideFilePath: overrideFile,
      generatedUtamFilePath: generatedFilePath,
      changes: [],
      applied: false,
    },
    appliedCount: 0,
  };
}

/**
 * Merges custom overrides from *.utam-overrides.json files into generated UTAM schemas.
 *
 * @param options - Override application options.
 * @returns Summary of scanned and modified UTAM schemas.
 */
export function applyUtamOverrides(options: ApplyOverridesOptions = {}): ApplyOverridesResult {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const dryRun = Boolean(options.dryRun);

  let sourceDirs = options.sourceDirs;
  if (!sourceDirs || sourceDirs.length === 0) {
    const discovered = discoverProject(rootDir);
    sourceDirs =
      discovered.packageDirectories.length > 0 ? discovered.packageDirectories : ['./sfdx-source'];
  }

  const allOverrideFiles: string[] = [];
  for (const sourceDir of sourceDirs) {
    const resolvedSource = path.isAbsolute(sourceDir)
      ? sourceDir
      : path.resolve(rootDir, sourceDir);
    allOverrideFiles.push(...findUtamOverridesFiles(resolvedSource));
  }

  const uniqueOverrideFiles = Array.from(new Set(allOverrideFiles));

  const result: ApplyOverridesResult = {
    scannedFilesCount: uniqueOverrideFiles.length,
    modifiedFilesCount: 0,
    totalOverridesApplied: 0,
    dryRun,
    results: [],
  };

  for (const overrideFile of uniqueOverrideFiles) {
    const { result: fileResult, appliedCount } = processSingleOverrideFile(overrideFile, dryRun);
    if (fileResult.applied) {
      result.modifiedFilesCount++;
      result.totalOverridesApplied += appliedCount;
    }
    result.results.push(fileResult);
  }

  return result;
}
