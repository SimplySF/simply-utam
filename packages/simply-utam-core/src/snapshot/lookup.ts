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

import {
  displayName,
  findPageObjects,
  matchPageObjects,
  type PageObjectArg,
  type PageObjectElement,
  type PageObjectEntry,
  type PageObjectIndex,
  type PageObjectMatch,
} from './page-object-index.js';
import { DEFAULT_OUTPUT_LIMIT, limitLines, type QueryOutputOptions, type QueryResult } from './query-result.js';

/** `lookup`'s answer as data: the query and every page object it matched. */
export type LookupResult = { query: string; matches: PageObjectMatch[] };

/** One page object in `lookup --search`'s answer. */
export type SearchResultLine = {
  importPath: string;
  name: string;
  root: boolean;
  interface: boolean;
  tags: string[];
  description?: string;
};

/** `lookup --search`'s answer as data. */
export type SearchResult = { query: string; results: SearchResultLine[] };

/**
 * A getter's or method's parameter list, such as `fieldLabel: string`.
 *
 * @param args The parameters.
 */
export function formatParams(args: PageObjectArg[] | undefined): string {
  return (args ?? []).map((arg) => `${arg.name}: ${arg.type}`).join(', ');
}

/**
 * How test code reaches a public element: its getter, with parameters. A container's getter also
 * takes the page object type to load inside it.
 *
 * @param element A public element.
 */
export function formatGetter(element: PageObjectElement): string {
  const last = element.name.split('.').at(-1) ?? element.name;
  const args =
    element.type === 'container'
      ? [...(element.args ?? []), { name: 'pageObjectType', type: 'constructor' }]
      : element.args;
  return `get${last[0].toUpperCase()}${last.slice(1)}(${formatParams(args)})`;
}

/** A compose summary on as many lines as it needs, broken before each `→ chain` or `;` statement. */
function wrapCompose(compose: string, indent: string, width = 110): string[] {
  const pieces = compose.split(/(?=; | → chain )/);
  const lines: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length > width) {
      lines.push(indent + current);
      current = piece.trimStart();
    } else current += piece;
  }
  if (current) lines.push(indent + current);
  return lines.map((line, i) => (i === 0 ? line : `${indent}  ${line.trimStart()}`));
}

/** Drops the boilerplate the shipped page objects start their descriptions with. */
function shortDescription(description: string): string {
  return description.replace(/Represents the \S+ (Lightning web|Aura) component\.?\s*/i, '').trim();
}

function matchedBy(match: PageObjectMatch): string | undefined {
  if (match.via === 'name') return undefined;
  if (match.via !== 'typed element') return `  matched by: ${match.via}`;
  const more = (match.declaredByCount ?? 0) - (match.declaredBy?.length ?? 0);
  return `  matched by: typed element in ${(match.declaredBy ?? []).join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

function describeHeader(index: PageObjectIndex, match: PageObjectMatch): string[] {
  const { entry } = match;
  const flags = [entry.root ? 'root' : 'not root', entry.interface ? 'interface' : '', entry.source].filter(Boolean);
  const lines = [`${displayName(index, entry.name)} (${flags.join(', ')})`];
  if (entry.importPath && entry.name !== entry.importPath)
    lines.push(`  name: ${entry.name} (manifest name; a .utam.json "type" uses ${entry.importPath})`);
  if (entry.outputFile) lines.push(`  compiled to: ${entry.outputFile} (import it by relative path from test code)`);
  const via = matchedBy(match);
  if (via) lines.push(via);
  if (match.matchedImplementation)
    lines.push(`  matched implementation: ${match.matchedImplementation}; test code loads the interface`);
  if (entry.description) lines.push(`  description: ${shortDescription(entry.description)}`);
  if (entry.selector) lines.push(`  root selector: ${entry.selector}`);
  if (entry.implements) lines.push(`  implements: ${displayName(index, entry.implements)}`);
  if (entry.implementations)
    lines.push(`  implementations: ${entry.implementations.map((name) => displayName(index, name)).join(', ')}`);
  return lines;
}

function describeMethods(index: PageObjectIndex, entry: PageObjectEntry): string[] {
  if (entry.methods.length === 0) return [];
  const lines = ['  methods:'];
  for (const method of entry.methods) {
    const returns = method.returns ? ` → ${displayName(index, method.returns)}` : '';
    lines.push(`    ${method.name}(${formatParams(method.args)})${returns}`);
    if (method.compose) lines.push(...wrapCompose(method.compose, '      '));
  }
  return lines;
}

function describeElements(index: PageObjectIndex, entry: PageObjectEntry): string[] {
  if (entry.publicElements.length === 0 && entry.privateElements.length === 0) return [];
  const describe = (element: PageObjectElement): string => {
    const type = element.type ? ` → ${displayName(index, element.type)}` : '';
    return `${element.name}${element.list ? '[]' : ''}: "${element.selector}" [${element.scope}]${type}`;
  };
  const lines = [
    "  [light]: declared in elements, searched in its parent's light DOM; [shadow]: in shadow.elements, searched in its parent's shadow root.",
  ];
  if (entry.publicElements.length > 0) {
    lines.push('  public elements:');
    for (const element of entry.publicElements) lines.push(`    ${formatGetter(element)}  ${describe(element)}`);
  }
  if (entry.privateElements.length > 0) {
    lines.push('  private elements:');
    for (const element of entry.privateElements) {
      const used = element.usedBy?.length ? `  (used by ${element.usedBy.map((m) => `${m}()`).join(', ')})` : '';
      lines.push(`    ${describe(element)}${used}`);
    }
  }
  return lines;
}

/**
 * The page objects for a tag, or one page object by name, with their import paths, methods and
 * elements. A tag maps to a page object through a root selector, an element typed as that page
 * object, or the naming convention; an implementation is reported as the interface test code loads.
 *
 * @param index The page-object index.
 * @param query A custom element's tag, or a page object's name, import path or short name.
 * @param options The text output limit.
 */
export function lookupPageObject(
  index: PageObjectIndex,
  query: string,
  options: QueryOutputOptions = {},
): QueryResult<LookupResult> {
  const matches = matchPageObjects(index, query);
  const lines: string[] = [];
  if (matches.length === 0) {
    lines.push(
      `No page object found for "${query}". This doesn't prove none exists, only that the index found no match by tag or name. Try lookup --search <words>.`,
    );
  }
  for (const match of matches) {
    lines.push(
      ...describeHeader(index, match),
      ...describeMethods(index, match.entry),
      ...describeElements(index, match.entry),
    );
  }
  return {
    lines: limitLines(
      lines,
      options.limit ?? DEFAULT_OUTPUT_LIMIT,
      'Look up one page object by its name, or raise --limit.',
    ),
    json: { query, matches },
  };
}

/**
 * Page objects whose name, import path, tags or description contain every word of `query`
 * (case-insensitive): name matches first, then tag matches, then description matches.
 *
 * @param index The page-object index.
 * @param query One or more words.
 * @param options The text output limit.
 */
export function searchPageObjects(
  index: PageObjectIndex,
  query: string,
  options: QueryOutputOptions = {},
): QueryResult<SearchResult> {
  const results: SearchResultLine[] = findPageObjects(index, query).map(({ entry, tags }) => ({
    importPath: displayName(index, entry.name),
    name: entry.name,
    root: entry.root,
    interface: entry.interface,
    tags,
    ...(entry.description ? { description: entry.description } : {}),
  }));
  const lines = [`${results.length} page objects match "${query}" (name matches first, then tag, then description):`];
  for (const result of results) {
    const flags = [result.root ? 'root' : '', result.interface ? 'interface' : ''].filter(Boolean).join(', ');
    const tags = result.tags.length > 0 ? `  tags: ${result.tags.slice(0, 4).join(', ')}` : '';
    lines.push(`${result.importPath}${flags ? ` (${flags})` : ''}${tags}`);
    if (result.description) lines.push(`    ${shortDescription(result.description)}`);
  }
  if (results.length > 0) lines.push("Run lookup <name or tag> for one page object's methods and elements.");
  return {
    lines: limitLines(
      lines,
      options.limit ?? DEFAULT_OUTPUT_LIMIT,
      'Add words to narrow the search, or raise --limit.',
    ),
    json: { query, results },
  };
}
