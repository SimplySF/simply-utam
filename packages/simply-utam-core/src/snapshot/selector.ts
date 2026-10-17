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

import { compile, type Options } from 'css-select';
import { DomSnapshotError, type DomSnapshot } from './format.js';
import { getNode, locate, toFound, type FoundNode, type Located } from './locate.js';

/** An own attribute's value, so a name like `constructor` isn't read off the object's prototype. */
export function attribute(attrs: Record<string, string> | undefined, name: string): string | undefined {
  return attrs && Object.hasOwn(attrs, name) ? attrs[name] : undefined;
}

// css-select over the snapshot. A shadow root is a boundary, as it is for querySelector: a node in
// one has no parent to match a combinator against, and a host's children are its light children.
type Adapter = NonNullable<Options<Located, Located>['adapter']>;

/** The adapter, exported for its tests: `compile` uses only part of it, and `selectAll` the rest. */
export const adapter: Adapter = {
  isTag: (node): node is Located => node !== undefined,
  getName: (node) => node.node.tag,
  getAttributeValue: (node, name) => attribute(node.node.attrs, name),
  hasAttrib: (node, name) => attribute(node.node.attrs, name) !== undefined,
  getChildren: (node) => node.light,
  getParent: (node) => (node.viaShadow ? null : (node.parent ?? null)),
  getSiblings: (node) => (node.parent ? (node.viaShadow ? node.parent.shadow : node.parent.light) : [node]),
  prevElementSibling: (node) => {
    const siblings = adapter.getSiblings(node);
    return siblings[siblings.indexOf(node) - 1] ?? null;
  },
  getText: (node) => [node.node.text, node.node.shadow?.text].filter(Boolean).join(' '),
  removeSubsets: (nodes) =>
    nodes.filter((node) => {
      for (let up = node.parent; up; up = up.viaShadow ? undefined : up.parent) if (nodes.includes(up)) return false;
      return true;
    }),
  existsOne: (test, nodes) => nodes.some((node) => test(node) || adapter.existsOne(test, node.light)),
  findAll: (test, nodes) =>
    nodes.flatMap((node) => [...(test(node) ? [node] : []), ...adapter.findAll(test, node.light)]),
  findOne: (test, nodes) => {
    for (const node of nodes) {
      if (test(node)) return node;
      const found = adapter.findOne(test, node.light);
      if (found) return found;
    }
    return null;
  },
};

// Pseudo-classes about live state that a snapshot can't judge; they're dropped, so the selector may over-match.
// Longer names come first, and the guard stops `:focus` matching the start of `:focus-within`.
const LIVE_STATE = /:(focus-within|focus-visible|focus|hover|active|visited|checked)(?![\w-])/g;
// A live-state pseudo-class that is a whole compound, such as `:hover` in `:hover, a` or `a > :focus`,
// leaves this mark: any element, or, as a whole argument of `:not()`, `:is()`, `:where()` or `:has()`,
// nothing, which drops a pseudo-class left with no arguments too.
const WHOLE_COMPOUND = '\uE001';
const COMPOUND_START = /[\s>+~,(]/;
const LOGICAL_PSEUDO = /:(not|is|where|has)\(([^()]*)\)/g;
// Strings and attribute tests, which the rewrites below must not read as syntax.
const VALUE = /(["'])(?:\\.|(?!\1).)*\1|\[(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\]"'])*\]/g;
const MASKED_VALUE = /\uE000(\d+)\uE000/g;

/** Rewrite a selector's syntax only: its strings and attribute tests are kept as they are. */
function outsideValues(selector: string, rewrite: (syntax: string) => string): string {
  const values: string[] = [];
  const masked = selector.replace(VALUE, (value) => `\uE000${values.push(value) - 1}\uE000`);
  return rewrite(masked).replace(MASKED_VALUE, (_match, i: string) => values[Number(i)]);
}

function dropLiveState(syntax: string): string {
  // Dropped, a pseudo-class that is a whole compound leaves any element in its place.
  const dropped = (offset: number, whole: string): string =>
    offset === 0 || COMPOUND_START.test(whole[offset - 1]) ? WHOLE_COMPOUND : '';
  let out = syntax.replace(LIVE_STATE, (_match, _name, offset: number, whole: string) => dropped(offset, whole));
  let before: string;
  do {
    before = out;
    out = out.replace(LOGICAL_PSEUDO, (_match, name: string, args: string, offset: number, whole: string) => {
      const kept = args.split(',').filter((arg) => arg.trim() !== WHOLE_COMPOUND);
      return kept.length > 0 ? `:${name}(${kept.join(',').trim()})` : dropped(offset, whole);
    });
  } while (out !== before);
  return out.replaceAll(WHOLE_COMPOUND, '*');
}

/** A selector made ready to check against a snapshot, with what it can't check. */
export type PreparedSelector = { selector: string; notes: string[] };

/**
 * Rewrite a page object's selector for the snapshot: `%s`/`%d` placeholders in an attribute test or
 * a child-position argument match any value, and live-state pseudo-classes are dropped. Says what it
 * changed.
 *
 * @param selector The CSS selector, as a page object or a user writes it.
 */
export function prepareSelector(selector: string): PreparedSelector {
  const notes: string[] = [];
  let out = selector.replace(/\[\s*([\w-]+)\s*[~|^$*]?=\s*(["']?)[^\]]*%[sd][^\]]*\2\s*\]/g, '[$1]');
  out = outsideValues(out, (syntax) => syntax.replace(/(:nth-[\w-]+\()\s*%d\s*\)/g, '$1n)'));
  if (out !== selector) notes.push('%s/%d placeholders match any value.');
  const live = new Set<string>();
  outsideValues(out, (syntax) => {
    for (const match of syntax.matchAll(LIVE_STATE)) live.add(`:${match[1]}`);
    return syntax;
  });
  if (live.size > 0) {
    out = outsideValues(out, dropLiveState);
    notes.push(`Ignored ${[...live].join(', ')}: a snapshot doesn't record live state, so this may over-match.`);
  }
  return { selector: out, notes };
}

/** A selector with strings and attribute tests blanked, so a `>` or `.` inside one isn't read as syntax. */
function blankValues(selector: string): string {
  return selector.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""').replace(/\[[^\]]*\]/g, '[]');
}

/** The tags, classes and ids a selector names, leaving out pseudo-class arguments that aren't selectors. */
function selectorNames(selector: string): { tags: string[]; classes: string[]; ids: string[] } {
  const bare = blankValues(selector).replace(/:(nth-[\w-]+|lang|dir)\([^)]*\)/g, '');
  const names = (pattern: RegExp): string[] => [...new Set([...bare.matchAll(pattern)].map((m) => m[1]))];
  return {
    tags: names(/(?:^|[\s>+~,(])([a-zA-Z][\w-]*)/g).map((tag) => tag.toLowerCase()),
    classes: names(/\.(-?[_a-zA-Z][\w-]*)/g),
    ids: names(/#(-?[_a-zA-Z][\w-]*)/g),
  };
}

const POSITIONAL = /[>+~]|:(nth-[\w-]+|first-child|last-child|only-child|first-of-type|last-of-type|only-of-type)/;

/**
 * The plain tags, classes and ids a selector names that no node in the snapshot has. Such a name may be
 * on a plain wrapper the snapshot pruned, so the live page can match where the snapshot doesn't.
 *
 * @param snapshot The snapshot.
 * @param selector The selector, already through {@link prepareSelector}.
 */
export function unseenNames(snapshot: DomSnapshot, selector: string): string[] {
  const { tags, classes, ids } = selectorNames(selector);
  const seen = seenNames(snapshot);
  return [
    // The walker keeps every custom element, so a custom tag no node has isn't on the page.
    ...tags.filter((tag) => !tag.includes('-') && !seen.tags.has(tag)),
    ...classes.filter((name) => !seen.classes.has(name)).map((name) => `.${name}`),
    ...ids.filter((id) => !seen.ids.has(id)).map((id) => `#${id}`),
  ];
}

type SeenNames = { tags: Set<string>; classes: Set<string>; ids: Set<string | undefined> };
const seenBySnapshot = new WeakMap<DomSnapshot, SeenNames>();

function seenNames(snapshot: DomSnapshot): SeenNames {
  let seen = seenBySnapshot.get(snapshot);
  if (!seen) {
    const nodes = [...locate(snapshot).values()].map((entry) => entry.node);
    seen = {
      tags: new Set(nodes.map((node) => node.tag)),
      classes: new Set(nodes.flatMap((node) => (attribute(node.attrs, 'class') ?? '').split(/\s+/))),
      ids: new Set(nodes.map((node) => attribute(node.attrs, 'id'))),
    };
    seenBySnapshot.set(snapshot, seen);
  }
  return seen;
}

/** What the snapshot's pruned wrappers may change about a selector's matches. */
function prunedNotes(snapshot: DomSnapshot, selector: string): string[] {
  const notes: string[] = [];
  const unseen = unseenNames(snapshot, selector);
  if (unseen.length > 0)
    notes.push(
      `No node in this snapshot has ${unseen.join(', ')}: it may be on an element the snapshot pruned (plain wrappers are dropped), so the live page may match differently.`,
    );
  if (POSITIONAL.test(blankValues(selector)))
    notes.push(
      ">, +, ~ and child-position pseudo-classes can match differently on the live page: the snapshot drops plain wrappers, so a node's parent and siblings here may not be its live ones.",
    );
  return notes;
}

const compiled = new Map<string, (node: Located) => boolean>();

function compiledFor(selector: string): (node: Located) => boolean {
  let test = compiled.get(selector);
  if (!test) {
    try {
      test = compile<Located, Located>(selector, { adapter, xmlMode: false, cacheResults: false });
    } catch (error) {
      throw new DomSnapshotError(`Can't read selector "${selector}": ${(error as Error).message}`);
    }
    compiled.set(selector, test);
  }
  return test;
}

/**
 * Whether a node matches a selector, ancestors included, within the node's own tree scope.
 *
 * @param node The node.
 * @param selector The selector, already through {@link prepareSelector}.
 */
export function nodeMatchesSelector(node: Located, selector: string): boolean {
  return compiledFor(selector)(node);
}

/** Where a selector is searched, as UTAM searches it. */
export type SelectorScope =
  /** A root page object's selector: the document. */
  | { kind: 'document' }
  /** An element under a page object's `shadow`: the host's shadow root. */
  | { kind: 'shadow'; within: string }
  /** An element under a page object's `elements`: the host's light descendants. */
  | { kind: 'light'; within: string };

export type SelectorMatches = {
  /** Matches in document order: the first is what `findElement` returns. */
  matches: FoundNode[];
  /** What the snapshot can't judge about the selector, such as placeholders and live state. */
  notes: string[];
  /** Attributes the selector tests whose value is masked on some node in scope. */
  maskedAttributes: string[];
};

/** {@link SelectorMatches} with the located nodes, for the other queries. */
export type LocatedMatches = Omit<SelectorMatches, 'matches'> & { matches: Located[] };

function scopeNodes(roots: Located[]): Located[] {
  const out: Located[] = [];
  const walk = (node: Located): void => {
    out.push(node);
    for (const child of node.light) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}

/** The nodes a search in `scope` tests, in document order. */
function scopeCandidates(snapshot: DomSnapshot, scope: SelectorScope): Located[] {
  if (scope.kind === 'document') return scopeNodes([locate(snapshot).values().next().value!]);
  const host = getNode(snapshot, scope.within);
  if (scope.kind === 'shadow' && host.shadow.length === 0)
    throw new DomSnapshotError(`${scope.within} has no shadow root in this snapshot.`);
  return scopeNodes(scope.kind === 'shadow' ? host.shadow : host.light);
}

/**
 * The nodes a selector matches in a scope, as {@link matchSelector} finds them but without its notes,
 * and none for a selector that can't be read or a scope that isn't in the snapshot: for checking
 * page objects' selectors, where one that can't be checked is skipped.
 *
 * @param snapshot The snapshot.
 * @param selector The CSS selector, as a page object writes it.
 * @param scope Where to search.
 */
export function scopeMatches(snapshot: DomSnapshot, selector: string, scope: SelectorScope): Located[] {
  try {
    const test = compiledFor(prepareSelector(selector).selector);
    return scopeCandidates(snapshot, scope).filter((node) => test(node));
  } catch {
    return [];
  }
}

/**
 * Every node a selector matches in a scope, in document order, as `querySelectorAll` would find them:
 * combinators don't cross shadow roots, and ancestors above the scope still count. The first match
 * is the one UTAM's `findElement`, and `utam.load` for a root selector, takes.
 *
 * @param snapshot The snapshot.
 * @param selector The CSS selector, as a page object or a person writes it.
 * @param scope Where to search; the document when omitted.
 */
export function querySnapshot(
  snapshot: DomSnapshot,
  selector: string,
  scope: SelectorScope = { kind: 'document' },
): SelectorMatches {
  const located = matchSelector(snapshot, selector, scope);
  return { ...located, matches: located.matches.map(toFound) };
}

/**
 * {@link querySnapshot}, keeping the located nodes.
 *
 * @param snapshot The snapshot.
 * @param selector The CSS selector.
 * @param scope Where to search; the document when omitted.
 */
export function matchSelector(
  snapshot: DomSnapshot,
  selector: string,
  scope: SelectorScope = { kind: 'document' },
): LocatedMatches {
  const prepared = prepareSelector(selector);
  const test = compiledFor(prepared.selector);
  const candidates = scopeCandidates(snapshot, scope);
  const matches = candidates.filter((node) => test(node));
  const tested = [...prepared.selector.matchAll(/\[\s*([\w-]+)\s*[~|^$*]?=/g)].map((m) => m[1]);
  const maskedAttributes = [...new Set(tested)].filter((name) =>
    candidates.some((node) => attribute(node.node.attrs, name)?.startsWith('•')),
  );
  return { matches, notes: [...prepared.notes, ...prunedNotes(snapshot, prepared.selector)], maskedAttributes };
}
