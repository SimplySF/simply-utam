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
import { isAbsoluteOnAnyPlatform, toPosixRelative } from '../path-utils.js';

/**
 * File name of the Salesforce ignore file, relative to the project root.
 */
export const FORCEIGNORE_FILE = '.forceignore';

/**
 * Comment line that heads the UTAM rules in a .forceignore file. It has no closing marker.
 */
export const FORCEIGNORE_HEADER = '# Ignore UTAM';

/**
 * Default markers of a project's customization region in .forceignore.
 */
export const DEFAULT_FORCEIGNORE_REGION = {
  start: '# -- START CUSTOMIZATION',
  end: '# -- END CUSTOMIZATION',
} as const;

/**
 * A required .forceignore rule, and the existing patterns accepted as already covering it.
 */
export interface ForceignoreRule {
  /**
   * The pattern written when the rule is missing.
   */
  pattern: string;

  /**
   * Other patterns that, when present as an active line, count as covering the rule.
   */
  alternatives: string[];
}

/**
 * Rules that keep UTAM artifacts written inside LWC bundles out of Salesforce deploys.
 */
export const SIMPLY_UTAM_FORCEIGNORE_RULES: readonly ForceignoreRule[] = [
  { pattern: '**/__utam__/**', alternatives: ['**/__utam__/', '**/__utam__', '__utam__/', '__utam__'] },
  { pattern: '**/lwc/**/*.rules.json', alternatives: ['**/*.rules.json', '*.rules.json'] },
  { pattern: '**/*.utam-overrides.json', alternatives: ['*.utam-overrides.json'] },
];

/**
 * Options for merging UTAM rules into .forceignore content.
 */
export interface MergeForceignoreOptions {
  /**
   * Rules that must be present. Defaults to SIMPLY_UTAM_FORCEIGNORE_RULES.
   */
  rules?: readonly ForceignoreRule[];

  /**
   * Exact line that starts the customization region. Defaults to DEFAULT_FORCEIGNORE_REGION.start.
   */
  regionStart?: string;

  /**
   * Exact line that ends the customization region. Defaults to DEFAULT_FORCEIGNORE_REGION.end.
   */
  regionEnd?: string;
}

/**
 * Where missing rules were written: an existing `# Ignore UTAM` block, the customization region, or
 * the end of the file.
 */
export type ForceignorePlacement = 'block' | 'region' | 'end';

/**
 * Outcome of merging UTAM rules into .forceignore content.
 */
export interface MergeForceignoreResult {
  /**
   * The resulting content. Equal to the input when action is 'unchanged'.
   */
  content: string;

  /**
   * 'appended' added rules to an existing block, 'inserted' added a new block, and 'unchanged' found
   * every rule already covered.
   */
  action: 'appended' | 'inserted' | 'unchanged';

  /**
   * Where missing rules were written, when any were.
   */
  placement?: ForceignorePlacement;

  /**
   * Patterns that were added, in rule order.
   */
  addedPatterns: string[];

  /**
   * Non-fatal problems, such as a malformed customization region.
   */
  warnings: string[];
}

/**
 * Options for ensuring a project's .forceignore covers UTAM artifacts.
 */
export interface EnsureForceignoreOptions extends MergeForceignoreOptions {
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
 * Outcome of ensuring a project's .forceignore covers UTAM artifacts.
 */
export interface ForceignoreResult extends Omit<MergeForceignoreResult, 'content' | 'action'> {
  /**
   * Path of the .forceignore file, relative to the project root.
   */
  path: string;

  /**
   * What happened to the file. 'created' wrote a new file, 'skipped' means there is no .forceignore
   * and no sfdx-project.json, and 'failed' means the file could not be read or written (the reason is
   * in warnings).
   */
  action: 'created' | 'appended' | 'inserted' | 'unchanged' | 'skipped' | 'failed';
}

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

interface Line {
  text: string;
  eol: string;
}

function splitLines(body: string): Line[] {
  const lines: Line[] = [];
  let index = 0;
  while (index < body.length) {
    const newline = body.indexOf('\n', index);
    if (newline === -1) {
      lines.push({ text: body.slice(index), eol: '' });
      break;
    }
    const raw = body.slice(index, newline);
    lines.push(raw.endsWith('\r') ? { text: raw.slice(0, -1), eol: '\r\n' } : { text: raw, eol: '\n' });
    index = newline + 1;
  }
  return lines;
}

function isActivePattern(text: string): boolean {
  const trimmed = text.trim();
  return trimmed !== '' && !trimmed.startsWith('#') && !trimmed.startsWith('!');
}

function isBlockLine(text: string): boolean {
  const trimmed = text.trim();
  return trimmed !== '' && !trimmed.startsWith('#');
}

function findMarker(lines: Line[], marker: string): number[] {
  return lines.flatMap((line, index) => (line.text.trim() === marker ? [index] : []));
}

function findBlockEnd(lines: Line[], headerIndex: number): number {
  let end = headerIndex + 1;
  while (end < lines.length && isBlockLine(lines[end].text)) {
    end++;
  }
  return end;
}

/**
 * Finds the index of the region's end marker, or a warning when the region is malformed.
 */
function findRegionEnd(
  lines: Line[],
  regionStart: string,
  regionEnd: string,
  fileName: string,
): { index?: number; warning?: string } {
  if (!regionStart || !regionEnd) {
    // An empty marker would match every blank line.
    return {
      warning: `A customization region marker is empty, so UTAM rules were added at the end of ${fileName}.`,
    };
  }
  const starts = findMarker(lines, regionStart);
  const ends = findMarker(lines, regionEnd);
  if (starts.length === 0 && ends.length === 0) {
    return {};
  }
  if (starts.length === 1 && ends.length === 1 && starts[0] < ends[0]) {
    return { index: ends[0] };
  }
  return {
    warning: `The customization region ('${regionStart}' … '${regionEnd}') is malformed, so UTAM rules were added at the end of ${fileName}.`,
  };
}

/**
 * Picks the line ending for inserted lines: the one used by the line they follow, or else the one most
 * lines in the file use.
 */
function pickEol(lines: Line[], insertAt: number): string {
  const previous = insertAt > 0 ? lines[insertAt - 1].eol : '';
  if (previous) {
    return previous;
  }
  const crlf = lines.filter((line) => line.eol === '\r\n').length;
  const lf = lines.filter((line) => line.eol === '\n').length;
  return crlf > lf ? '\r\n' : '\n';
}

function needsSeparator(lines: Line[], index: number): boolean {
  return index > 0 && lines[index - 1].text.trim() !== '';
}

/**
 * Merges missing UTAM rules into .forceignore content without changing any existing line.
 *
 * Missing rules are added under the first `# Ignore UTAM` comment if one exists. Otherwise a new
 * `# Ignore UTAM` block is inserted above the customization region's end marker, or appended at the
 * end of the content when there is no valid region.
 *
 * @param content - The current .forceignore content. An empty string for a new file.
 * @param options - Rules and customization region markers.
 * @returns The merged content and a description of what changed.
 */
export function mergeForceignore(content: string, options?: MergeForceignoreOptions): MergeForceignoreResult {
  return mergeIgnoreRules(content, {
    rules: options?.rules ?? SIMPLY_UTAM_FORCEIGNORE_RULES,
    regionStart: options?.regionStart,
    regionEnd: options?.regionEnd,
    header: FORCEIGNORE_HEADER,
    fileName: FORCEIGNORE_FILE,
  });
}

/** What {@link mergeIgnoreRules} needs to know about an ignore file. */
export interface IgnoreFileMerge {
  rules: readonly ForceignoreRule[];
  regionStart?: string;
  regionEnd?: string;
  /** The comment line that heads the added rules. */
  header: string;
  /** The file's name, for warnings. */
  fileName: string;
}

/**
 * Adds missing rules to an ignore file's content (`.forceignore`, `.gitignore`) without changing any
 * existing line: under the first header comment if there is one, otherwise in a new block above the
 * customization region's end marker, or at the end.
 *
 * @param content - The file's current content; an empty string for a new file.
 * @param merge - The rules, region markers, header and file name.
 * @returns The merged content and a description of what changed.
 */
export function mergeIgnoreRules(content: string, merge: IgnoreFileMerge): MergeForceignoreResult {
  const { rules, header, fileName } = merge;
  const regionStart = (merge.regionStart ?? DEFAULT_FORCEIGNORE_REGION.start).trim();
  const regionEnd = (merge.regionEnd ?? DEFAULT_FORCEIGNORE_REGION.end).trim();

  const bom = content.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK : '';
  const body = content.slice(bom.length);
  const lines = splitLines(body);

  const active = new Set(lines.filter((line) => isActivePattern(line.text)).map((line) => line.text.trim()));
  const addedPatterns = rules
    .filter((rule) => ![rule.pattern, ...rule.alternatives].some((pattern) => active.has(pattern)))
    .map((rule) => rule.pattern);

  if (addedPatterns.length === 0) {
    return { content, action: 'unchanged', addedPatterns, warnings: [] };
  }

  const warnings: string[] = [];
  let insertAt: number;
  let newLines: string[];
  let placement: ForceignorePlacement;

  const headerIndex = lines.findIndex((line) => line.text.trim() === header);
  if (headerIndex === -1) {
    const region = findRegionEnd(lines, regionStart, regionEnd, fileName);
    if (region.warning) {
      warnings.push(region.warning);
    }
    placement = region.index === undefined ? 'end' : 'region';
    insertAt = region.index ?? lines.length;
    newLines = [...(needsSeparator(lines, insertAt) ? [''] : []), header, ...addedPatterns];
  } else {
    placement = 'block';
    insertAt = findBlockEnd(lines, headerIndex);
    newLines = addedPatterns;
  }

  const eol = pickEol(lines, insertAt);
  if (insertAt > 0 && lines[insertAt - 1].eol === '') {
    lines[insertAt - 1].eol = eol;
  }
  lines.splice(insertAt, 0, ...newLines.map((text) => ({ text, eol })));

  return {
    content: bom + lines.map((line) => line.text + line.eol).join(''),
    action: placement === 'block' ? 'appended' : 'inserted',
    placement,
    addedPatterns,
    warnings,
  };
}

/**
 * Escapes the characters that .forceignore would read as wildcards in a literal path: `[`, `]` and `*`.
 * A `?` is left as is: the `ignore` 5.x library that Salesforce's deploy tooling uses can't escape it,
 * and unescaped it still matches the literal character.
 */
function escapeIgnoreWildcards(literalPath: string): string {
  return literalPath.replace(/[[\]*]/g, '\\$&');
}

/**
 * Escapes a literal path for use as a whole .forceignore line: its wildcards, plus a leading `#` (a
 * comment) or `!` (a negation).
 */
function escapeIgnorePattern(literalPath: string): string {
  return escapeIgnoreWildcards(literalPath).replace(/^[#!]/, '\\$&');
}

/**
 * Builds .forceignore rules for UTAM test folders that sit inside a Salesforce package directory.
 *
 * Each rule is the folder's path relative to the project root, with forward slashes and a trailing
 * slash, so it matches only that folder. Characters .forceignore treats as special are escaped, so a
 * folder such as `force-app[1]` is matched literally. Folders outside every package directory are never deployed
 * and get no rule, and absolute paths or paths outside the project root get no rule because a
 * .forceignore pattern can't reach them.
 *
 * @param testDirs - Test folders, relative to the project root.
 * @param packageDirectories - Package directories from sfdx-project.json, relative to the project root.
 * @returns One rule per test folder that needs one, without duplicates.
 */
export function resolveUtamTestIgnoreRules(testDirs: string[], packageDirectories: string[]): ForceignoreRule[] {
  const packages = packageDirectories.map(toPosixRelative);
  const rules: ForceignoreRule[] = [];
  const seen = new Set<string>();

  for (const testDir of testDirs.map(toPosixRelative)) {
    const insidePackage = packages.some((pkg) => pkg === '' || testDir === pkg || testDir.startsWith(`${pkg}/`));
    const outsideProject = isAbsoluteOnAnyPlatform(testDir) || testDir === '..' || testDir.startsWith('../');
    if (!testDir || outsideProject || !insidePackage || seen.has(testDir)) {
      continue;
    }
    seen.add(testDir);
    const literal = escapeIgnorePattern(testDir);
    const rooted = `/${escapeIgnoreWildcards(testDir)}`;
    rules.push({
      pattern: `${literal}/`,
      alternatives: [literal, `${literal}/**`, `${rooted}/`, rooted, `${rooted}/**`],
    });
  }

  return rules;
}

/**
 * Replaces a file's content by writing a temporary file next to it and renaming it into place, so an
 * interrupted write can't leave the project's file truncated. A symlink is followed, an existing file's
 * permissions are kept, and a read-only file is refused just as a plain write would refuse it.
 *
 * When that isn't possible (the folder doesn't allow new files, or on Windows another process briefly
 * holds the file), the temporary file is removed and the file is written in place instead. An error
 * from that write is thrown.
 */
export function writeFileSafely(filePath: string, content: string): void {
  const exists = fs.existsSync(filePath);
  const target = exists ? fs.realpathSync(filePath) : filePath;
  if (exists) {
    // A rename only needs permission on the folder, so check the file itself to respect a read-only
    // .forceignore the same way a plain write would.
    fs.accessSync(target, fs.constants.W_OK);
  }
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temp, content, 'utf-8');
    if (exists) {
      fs.chmodSync(temp, fs.statSync(target).mode);
    }
    fs.renameSync(temp, target);
  } catch {
    fs.rmSync(temp, { force: true });
    fs.writeFileSync(target, content, 'utf-8');
  }
}

/**
 * Ensures a project's .forceignore covers UTAM artifacts, adding only the missing rules.
 *
 * Creates the file when it is missing and the project has an sfdx-project.json. Existing lines are
 * never removed, rewritten, or reordered. A read or write error is reported as a 'failed' result
 * rather than thrown, so a problem with a file the project owns doesn't abort the caller.
 *
 * @param options - Project directory, rules, region markers, and dry-run flag.
 * @returns What happened to the file.
 */
export function ensureForceignore(options?: EnsureForceignoreOptions): ForceignoreResult {
  const projectDir = path.resolve(options?.projectDir ?? process.cwd());
  const filePath = path.join(projectDir, FORCEIGNORE_FILE);
  const exists = fs.existsSync(filePath);

  if (!exists && !fs.existsSync(path.join(projectDir, 'sfdx-project.json'))) {
    return { path: FORCEIGNORE_FILE, action: 'skipped', addedPatterns: [], warnings: [] };
  }

  let merged: MergeForceignoreResult;
  try {
    merged = mergeForceignore(exists ? fs.readFileSync(filePath, 'utf-8') : '', options);
    if (merged.action !== 'unchanged' && !options?.dryRun) {
      writeFileSafely(filePath, merged.content);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      path: FORCEIGNORE_FILE,
      action: 'failed',
      addedPatterns: [],
      warnings: [`Could not update ${FORCEIGNORE_FILE}, so UTAM rules were not added: ${reason}`],
    };
  }
  const action = exists || merged.action === 'unchanged' ? merged.action : 'created';

  return {
    path: FORCEIGNORE_FILE,
    action,
    placement: merged.placement,
    addedPatterns: merged.addedPatterns,
    warnings: merged.warnings,
  };
}
