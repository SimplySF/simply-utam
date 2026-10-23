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

import { clip, shellQuote } from './describe.js';
import type { DomSnapshot } from './format.js';
import type { Located } from './locate.js';
import {
  displayName,
  type PageObjectElement,
  type PageObjectEntry,
  type PageObjectIndex,
} from './page-object-index.js';
import type { QueryResult } from './query-result.js';
import { recaptureForNames, scopeMatches, testedAttributes, type SelectorScope } from './selector.js';

// Lazy and anchored on the text after it, so a selector with a quote in it, like `[title='Save']`, is kept whole.
const UTAM_NOT_FOUND = /Can't find elements? with locator '(.+?)' inside its scope (element|shadow root)/;

/** Where UTAM searched, from its not-found error, and the elements that may have declared it. */
export type UtamErrorHint = {
  selector: string;
  scope: 'light' | 'shadow';
  /** Root page objects' elements with that selector and scope, whose parent resolves in the snapshot. */
  candidates: Array<{ pageObject: string; element: string; parent: string }>;
};

function firstMatch(snapshot: DomSnapshot, selector: string, scope: SelectorScope): Located | undefined {
  return scopeMatches(snapshot, selector, scope)[0];
}

/** A root page object's element's parent node, found as UTAM finds it: the first match at each level. */
function resolveParent(snapshot: DomSnapshot, entry: PageObjectEntry, element: PageObjectElement): Located | undefined {
  if (!entry.selector) return undefined;
  let current = firstMatch(snapshot, entry.selector, { kind: 'document' });
  const byName = new Map([...entry.publicElements, ...entry.privateElements].map((e) => [e.name, e]));
  const parts = element.name.split('.');
  for (let i = 1; current && i < parts.length; i++) {
    const step = byName.get(parts.slice(0, i).join('.'));
    if (!step) return undefined;
    current = firstMatch(snapshot, step.selector, { kind: step.scope, within: current.node.id });
  }
  return current;
}

/**
 * For a snapshot whose error is UTAM's "Can't find element(s) with locator '…' inside its scope …":
 * the `find --css` that repeats UTAM's search, with `--within` the element it searched from when the
 * page-object index can identify it. Undefined for any other error.
 *
 * @param snapshot The snapshot.
 * @param index The page-object index, to identify the element UTAM searched from.
 */
export function utamErrorHint(snapshot: DomSnapshot, index?: PageObjectIndex): QueryResult<UtamErrorHint> | undefined {
  const match = UTAM_NOT_FOUND.exec(snapshot.meta.error ?? '');
  if (!match) return undefined;
  const [, selector, where] = match;
  const scope = where === 'element' ? 'light' : 'shadow';
  const candidates: UtamErrorHint['candidates'] = [];
  for (const entry of index?.entries.values() ?? []) {
    if (!entry.root) continue;
    for (const element of [...entry.publicElements, ...entry.privateElements]) {
      if (element.selector !== selector || element.scope !== scope) continue;
      const parent = resolveParent(snapshot, entry, element);
      if (parent)
        candidates.push({ pageObject: displayName(index!, entry.name), element: element.name, parent: parent.node.id });
    }
  }
  const searched =
    scope === 'light'
      ? "its scope element's light DOM (elements)"
      : "its scope element's shadow root (shadow.elements)";
  const command = (within?: string): string =>
    `npx simply-utam snapshot find --css ${shellQuote(selector)}${within ? ` --within ${within}${scope === 'shadow' ? ' --shadow' : ''}` : ''}`;
  const lines = [`  UTAM searched ${searched} for "${selector}". To repeat its search here:`];
  if (candidates.length > 0) {
    for (const c of candidates.slice(0, 3))
      lines.push(`    ${command(c.parent)}   (${c.pageObject}, element "${clip(c.element, 60)}")`);
  } else {
    lines.push(
      `    ${command()}`,
      "    This snapshot doesn't say which element it searched from. Check the selector in both scopes: --within <handle>, with and without --shadow.",
    );
  }
  const recapture = recaptureForNames(snapshot, testedAttributes(selector));
  if (recapture) lines.push(`    ${recapture}`);
  return { lines, json: { selector, scope, candidates } };
}

export type SnapshotHeaderOptions = {
  /** The snapshot's file, as the reader should see it named. */
  file?: string;
  /** The page-object index, or a way to build it; only used when the error is UTAM's not-found one. */
  index?: PageObjectIndex | (() => PageObjectIndex);
};

/** An error's first line, and any lines an assertion reports the expected and received values on. */
function errorLines(error: string): string[] {
  const lines = error
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const kept = [lines[0], ...lines.slice(1).filter((line) => /^(expected|received)\b/i.test(line))];
  return kept.map((line) => clip(line, 300));
}

/**
 * The lines every snapshot command prints first: which snapshot it read, where it came from, and,
 * for a failure, the scenario, the step and the error, with a failed assertion's expected and
 * received values, and for UTAM's not-found error, the `find --css` that repeats UTAM's search.
 *
 * @param snapshot The snapshot.
 * @param options Its file name, and the page-object index for UTAM's error.
 */
export function snapshotHeader(snapshot: DomSnapshot, options: SnapshotHeaderOptions = {}): string[] {
  const { meta } = snapshot;
  const truncated = meta.truncated ? `, TRUNCATED (${meta.truncated.reasons.join(', ')})` : '';
  const lines = [
    `Snapshot ${options.file ?? ''}${options.file ? ': ' : ''}${meta.trigger}${meta.label ? ` "${meta.label}"` : ''}, ${meta.capturedAt}, ${meta.url}, mask ${meta.mask}${truncated}`,
  ];
  if (meta.scenario) lines.push(`  scenario: ${meta.scenario}`);
  if (meta.step) lines.push(`  step: ${meta.step}`);
  if (meta.error) {
    const [first, ...rest] = errorLines(meta.error);
    lines.push(`  error: ${first}`, ...rest.map((line) => `         ${line}`));
  }
  // The index is only built for UTAM's not-found error, which the pattern tells cheaply.
  if (UTAM_NOT_FOUND.test(meta.error ?? '')) {
    const index = typeof options.index === 'function' ? options.index() : options.index;
    lines.push(...(utamErrorHint(snapshot, index)?.lines ?? []));
  }
  return lines;
}
