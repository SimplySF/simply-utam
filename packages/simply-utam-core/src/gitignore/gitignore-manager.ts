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
import * as path from 'node:path';
import {
  FORCEIGNORE_HEADER,
  mergeIgnoreRules,
  writeFileSafely,
  type ForceignoreRule,
  type MergeForceignoreResult,
} from '../forceignore/forceignore-manager.js';

/**
 * File name of git's ignore file, relative to the project root.
 */
export const GITIGNORE_FILE = '.gitignore';

/**
 * Rules that keep DOM snapshots out of git. Snapshots are per-run output and can hold page text, so
 * they're ignored; the rest of `.utam/`, such as `namespace-map.json`, is project configuration.
 */
export const SIMPLY_UTAM_GITIGNORE_RULES: readonly ForceignoreRule[] = [
  {
    pattern: '.utam/snapshots/',
    alternatives: [
      '.utam/snapshots',
      '.utam/snapshots/**',
      '/.utam/snapshots/',
      '/.utam/snapshots',
      '/.utam/snapshots/**',
      '.utam/',
      '.utam',
      '/.utam/',
      '/.utam',
      '.utam/**',
    ],
  },
];

/**
 * Options for merging UTAM rules into .gitignore content.
 */
export interface MergeGitignoreOptions {
  /**
   * Rules that must be present. Defaults to SIMPLY_UTAM_GITIGNORE_RULES.
   */
  rules?: readonly ForceignoreRule[];
}

/**
 * Options for ensuring a project's .gitignore keeps UTAM output out of git.
 */
export interface EnsureGitignoreOptions extends MergeGitignoreOptions {
  /**
   * Root directory of the consumer project. Defaults to current working directory.
   */
  projectDir?: string;

  /**
   * If true, computes the result without writing to disk.
   */
  dryRun?: boolean;
}

/**
 * Outcome of ensuring a project's .gitignore keeps UTAM output out of git.
 */
export interface GitignoreResult extends Omit<MergeForceignoreResult, 'content' | 'action'> {
  /**
   * Path of the .gitignore file, relative to the project root.
   */
  path: string;

  /**
   * What happened to the file. 'created' wrote a new file, and 'failed' means the file could not be
   * read or written (the reason is in warnings).
   */
  action: 'created' | 'appended' | 'inserted' | 'unchanged' | 'failed';
}

/**
 * Merges missing UTAM rules into .gitignore content without changing any existing line, under a
 * `# Ignore UTAM` comment, as `mergeForceignore` does for .forceignore.
 *
 * @param content - The current .gitignore content. An empty string for a new file.
 * @param options - Rules to ensure.
 * @returns The merged content and a description of what changed.
 */
export function mergeGitignore(content: string, options?: MergeGitignoreOptions): MergeForceignoreResult {
  return mergeIgnoreRules(content, {
    rules: options?.rules ?? SIMPLY_UTAM_GITIGNORE_RULES,
    header: FORCEIGNORE_HEADER,
    fileName: GITIGNORE_FILE,
  });
}

/**
 * Ensures a project's .gitignore keeps UTAM output out of git, adding only the missing rules and
 * creating the file when it's missing. Existing lines are never removed, rewritten, or reordered. A
 * read or write error is reported as a 'failed' result rather than thrown.
 *
 * @param options - Project directory, rules, and dry-run flag.
 * @returns What happened to the file.
 */
export function ensureGitignore(options?: EnsureGitignoreOptions): GitignoreResult {
  const projectDir = path.resolve(options?.projectDir ?? process.cwd());
  const filePath = path.join(projectDir, GITIGNORE_FILE);
  const exists = fs.existsSync(filePath);

  let merged: MergeForceignoreResult;
  try {
    merged = mergeGitignore(exists ? fs.readFileSync(filePath, 'utf-8') : '', options);
    if (merged.action !== 'unchanged' && !options?.dryRun) {
      writeFileSafely(filePath, merged.content);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      path: GITIGNORE_FILE,
      action: 'failed',
      addedPatterns: [],
      warnings: [`Could not update ${GITIGNORE_FILE}, so UTAM rules were not added: ${reason}`],
    };
  }
  const action = exists || merged.action === 'unchanged' ? merged.action : 'created';
  return {
    path: GITIGNORE_FILE,
    action,
    placement: merged.placement,
    addedPatterns: merged.addedPatterns,
    warnings: merged.warnings,
  };
}
