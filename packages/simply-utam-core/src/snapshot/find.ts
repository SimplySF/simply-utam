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

import { clip, describeNode, describePlain } from './describe.js';
import { DomSnapshotError, type DomNode, type DomSnapshot } from './format.js';
import { getNode, isUnder, locate, toFound, treeHost, type FoundNode, type Located } from './locate.js';
import { DEFAULT_OUTPUT_LIMIT, limitLines, type QueryOutputOptions, type QueryResult } from './query-result.js';
import {
  attribute,
  matchSelector,
  nodeMatchesSelector,
  prepareSelector,
  unseenNames,
  type SelectorScope,
} from './selector.js';

export type FindOptions = QueryOutputOptions & {
  /** Case-insensitive substring of a node's text, shadow text or any attribute value except `class`. */
  text?: string;
  /** `name` (present) or `name=value` (case-insensitive substring of the value). */
  attr?: string;
  tag?: string;
  /** A whole class token, as `.name` matches it (case-sensitive). */
  class?: string;
  /**
   * A CSS selector, matched as UTAM's `findElement` would: every match in document order, the first
   * marked. Used alone; the other filters don't apply.
   */
  css?: string;
  /** With `css`: search under this node instead of the document. */
  within?: string;
  /** With `css` and `within`: search the node's shadow root rather than its light descendants. */
  shadow?: boolean;
  /** List hidden matches in full rather than as a count. */
  all?: boolean;
};

export type FindResult = { visible: FoundNode[]; hidden: FoundNode[] };

function matches(node: DomNode, options: FindOptions): boolean {
  if (options.tag && node.tag !== options.tag.toLowerCase()) return false;
  const attrs = node.attrs ?? {};
  if (options.attr) {
    const [name, ...rest] = options.attr.split('=');
    const value = rest.join('=').replace(/^["']|["']$/g, '');
    const actual = attribute(attrs, name);
    if (actual === undefined) return false;
    if (rest.length > 0 && !actual.toLowerCase().includes(value.toLowerCase())) return false;
  }
  if (options.class && !(attribute(attrs, 'class') ?? '').split(/\s+/).includes(options.class)) return false;
  if (options.text) {
    const needle = options.text.toLowerCase();
    const values = [
      node.text,
      node.shadow?.text,
      ...Object.entries(attrs)
        .filter(([name]) => name !== 'class')
        .map(([, value]) => value),
    ];
    if (!values.some((value) => value?.toLowerCase().includes(needle))) return false;
  }
  return true;
}

function hiddenNote(entry: Located): string {
  const top = entry.hiddenTop;
  if (!top) return '';
  return top === entry ? '  (hidden)' : `  (hidden, under ${top.node.id} ${describePlain(top.node)})`;
}

function describeQuery(options: FindOptions): string {
  return (
    [
      options.text !== undefined ? `text "${options.text}"` : '',
      options.attr !== undefined ? `attr ${options.attr}` : '',
      options.tag !== undefined ? `tag ${options.tag}` : '',
      options.class !== undefined ? `class ${options.class}` : '',
    ]
      .filter(Boolean)
      .join(', ') || 'everything'
  );
}

/**
 * Nodes matching text, an attribute, a tag or a class, or with `css`, a CSS selector as UTAM's
 * `findElement` runs it. Visible matches come first, in document order, then hidden ones; when there
 * are hidden matches, a last line names the first in the document's own tree, which a root selector finds.
 *
 * @param snapshot The snapshot.
 * @param options What to match.
 */
export function findNodes(snapshot: DomSnapshot, options: FindOptions): QueryResult<FindResult> {
  if (options.css !== undefined) return findByCss(snapshot, options);
  const all = [...locate(snapshot).values()].filter((entry) => matches(entry.node, options));
  const visible = all.filter((entry) => !entry.hiddenTop);
  const hidden = all.filter((entry) => entry.hiddenTop);
  const lines = [`${visible.length} visible, ${hidden.length} hidden matches for ${describeQuery(options)}`];
  for (const entry of visible) lines.push(`${entry.node.id.padEnd(8)} ${describeNode(entry.node)}`);
  if (hidden.length > 0) {
    if (options.all) {
      for (const entry of hidden)
        lines.push(`${entry.node.id.padEnd(8)} ${describeNode(entry.node)}${hiddenNote(entry)}`);
    } else {
      lines.push(`${hidden.length} hidden matches not listed; add --all to list them.`);
    }
    // Visible matches are listed first; say which a root selector reaches first. utam.load searches
    // only the document's own tree, not inside shadow roots.
    const first = all.find((entry) => treeHost(entry) === undefined);
    lines.push(
      first
        ? `First in the document's own tree, which a root selector reaches first: ${first.node.id}${first.hiddenTop ? ' (hidden)' : ''}. utam.load takes a root selector's first match; test a selector with find --css.`
        : "Every match is inside a shadow root, so a root selector can't reach them; test a selector with find --css.",
    );
  }
  return {
    lines: limitLines(lines, options.limit ?? DEFAULT_OUTPUT_LIMIT, 'Narrow the query, or raise --limit.'),
    json: { visible: visible.map(toFound), hidden: hidden.map(toFound) },
  };
}

function scopeLabel(scope: SelectorScope): string {
  if (scope.kind === 'document') return 'in the document';
  return scope.kind === 'shadow' ? `in ${scope.within}'s shadow root` : `in ${scope.within}'s light DOM`;
}

/** Where a match the search didn't cover is, and the search that would find it. */
function whereElse(entry: Located, scope: SelectorScope, snapshot: DomSnapshot): { reason: string; command: string } {
  const host = treeHost(entry);
  const inShadowOf = (located: Located | undefined): string =>
    located ? `in ${located.node.id}'s shadow root` : "in the document's tree";
  const commandFor = (located: Located | undefined): string =>
    located ? `--within ${located.node.id} --shadow` : 'no --within (the document)';
  if (scope.kind === 'document') return { reason: inShadowOf(host), command: commandFor(host) };
  const within = getNode(snapshot, scope.within);
  const searchedTree = scope.kind === 'shadow' ? within : treeHost(within);
  if (host !== searchedTree && !(scope.kind === 'shadow' && host === treeHost(within)))
    return { reason: inShadowOf(host), command: commandFor(host) };
  if (scope.kind === 'shadow' && isUnder(entry, within))
    return { reason: `in ${within.node.id}'s light DOM`, command: `--within ${within.node.id}` };
  // The same tree as the search, but not under the node it searched from.
  return { reason: `outside ${within.node.id}, in the same tree`, command: commandFor(host) };
}

/** For a selector with no match in its scope: where it does match, and the scope that would find each. */
function elsewhere(snapshot: DomSnapshot, css: string, scope: SelectorScope): string[] {
  const { selector } = prepareSelector(css);
  const all = [...locate(snapshot).values()].filter((entry) => nodeMatchesSelector(entry, selector));
  if (all.length === 0) {
    if (unseenNames(snapshot, selector).length > 0)
      return [
        'It matches nothing in this snapshot, in any shadow root, but it names something no node here has, which the live page may have on a pruned wrapper (see below).',
      ];
    return ['It matches nothing anywhere in this snapshot, in any shadow root.'];
  }
  const shown = 5;
  const lines = [`It matches ${all.length} node${all.length === 1 ? '' : 's'} this search doesn't cover:`];
  let crossesShadow = false;
  for (const entry of all.slice(0, shown)) {
    const { reason, command } = whereElse(entry, scope, snapshot);
    if (reason.endsWith('shadow root')) crossesShadow = true;
    lines.push(
      `  ${entry.node.id.padEnd(8)} ${clip(describeNode(entry.node), 90)}${hiddenNote(entry)}  ${reason} → ${command}`,
    );
  }
  if (all.length > shown) lines.push(`  … ${all.length - shown} more`);
  if (crossesShadow) lines.push("A selector doesn't cross a shadow root, synthetic ones included.");
  lines.push(
    'In a page object, each element is searched from the one above it: shadow.elements for its shadow root, elements for its light DOM.',
  );
  return lines;
}

function findByCss(snapshot: DomSnapshot, options: FindOptions): QueryResult<FindResult> {
  const css = options.css!;
  if (options.shadow && !options.within) throw new DomSnapshotError('--shadow needs --within <node>.');
  const scope: SelectorScope = options.within
    ? { kind: options.shadow ? 'shadow' : 'light', within: options.within }
    : { kind: 'document' };
  const { matches: found, notes, maskedAttributes } = matchSelector(snapshot, css, scope);
  const lines = [`${found.length} matches for css "${css}" ${scopeLabel(scope)}, in document order:`];
  for (const [i, entry] of found.entries()) {
    const mark = i === 0 ? '  ← findElement / utam.load takes this one' : '';
    lines.push(`${entry.node.id.padEnd(8)} ${describeNode(entry.node)}${hiddenNote(entry)}${mark}`);
  }
  const visible = found.find((entry) => !entry.hiddenTop);
  if (found[0]?.hiddenTop) {
    lines.push(
      visible
        ? `Warning: the first match is hidden, so UTAM gets the hidden copy, not ${visible.node.id}. Scope the selector to a container only the visible copy is in.`
        : 'Warning: every match is hidden.',
    );
  }
  if (found.length === 0) lines.push(...elsewhere(snapshot, css, scope));
  for (const name of maskedAttributes)
    lines.push(`Can't check [${name}=…] values: they're masked in this snapshot, so a masked node may not be listed.`);
  lines.push(...notes);
  return {
    lines: limitLines(lines, options.limit ?? DEFAULT_OUTPUT_LIMIT, 'Narrow the selector, or raise --limit.'),
    json: {
      visible: found.filter((entry) => !entry.hiddenTop).map(toFound),
      hidden: found.filter((entry) => entry.hiddenTop).map(toFound),
    },
  };
}
