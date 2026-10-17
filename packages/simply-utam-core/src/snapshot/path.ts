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

import { clip, describeNode } from './describe.js';
import { findNodes, type FindResult } from './find.js';
import type { DomSnapshot, ShadowMode } from './format.js';
import { getNode, type Located } from './locate.js';
import { formatGetter } from './lookup.js';
import {
  displayName,
  matchPageObjects,
  shortName,
  type PageObjectElement,
  type PageObjectEntry,
  type PageObjectIndex,
  type PageObjectMatch,
} from './page-object-index.js';
import { DEFAULT_OUTPUT_LIMIT, limitLines, type QueryOutputOptions, type QueryResult } from './query-result.js';
import { matchSelector, nodeMatchesSelector, prepareSelector, type SelectorScope } from './selector.js';

export type PathOptions = QueryOutputOptions & {
  /** The page-object index; without it, the path has no annotations. */
  index?: PageObjectIndex;
};

export type PathAnnotation =
  | {
      kind: 'pageObject';
      importPath: string;
      root: boolean;
      interface: boolean;
      source: string;
      via: PageObjectMatch['via'] | 'project root selector';
      outputFile?: string;
      /** Other page objects for the same tag. */
      others?: string[];
    }
  | { kind: 'none' };

export type ReachableThrough = {
  pageObject: string;
  implementation?: string;
  element: string;
  public: boolean;
  /** A container element: its getter takes the page object type to load inside it. */
  container: boolean;
  /** The element's selector in that page object. */
  selector: string;
  /** Where it's declared: `elements` (light) or `shadow.elements` (shadow). */
  scope: 'light' | 'shadow';
  /** For a public element, its getter; for a private one, the public methods that use it. */
  use: string[];
  /** The route runs through this element of the same page object, declared in the wrong scope. */
  brokenBy?: string;
};

export type ScopeMismatch = {
  pageObject: string;
  /** The element declared in the wrong scope: this node's, or one it's nested in. */
  element: string;
  selector: string;
  declared: 'light' | 'shadow';
  /** The element its scope is searched from (the page object's root, or the element it's nested in). */
  parent: string;
  /** The node the element should find, in the other scope. */
  found: string;
  /** When the misdeclared element is one this node's element is nested in: this node's element. */
  via?: string;
};

export type PathStep = {
  id: string;
  tag: string;
  node: string;
  /** The shadow root crossed to reach this element, when it's in one. */
  inShadow?: ShadowMode;
  hidden: boolean;
  target: boolean;
  annotation?: PathAnnotation;
  reachableThrough?: ReachableThrough;
  /** For a root page object: its root selector, when it matches more than once or its first match is hidden. */
  rootSelectorMatches?: { selector: string; count: number; first: string; firstHidden: boolean };
  /** Elements of your own page objects that select this node but are declared in the wrong scope. */
  scopeMismatches?: ScopeMismatch[];
  /** Its shadow root can't be read, most likely because it's closed: UTAM selectors can't reach inside. */
  unreadable?: true;
};

export type PathResult = { target: string; steps: PathStep[] };

/** The page objects an annotation stands for, with their implementations' elements. */
function withImplementations(index: PageObjectIndex, entry: PageObjectEntry): PageObjectEntry[] {
  return [
    entry,
    ...(entry.implementations ?? []).map((name) => index.entries.get(name)).filter((e): e is PageObjectEntry => !!e),
  ];
}

function routeTo(
  index: PageObjectIndex,
  holder: PageObjectEntry,
  selects: (element: PageObjectElement) => boolean,
): ReachableThrough | undefined {
  for (const candidate of withImplementations(index, holder)) {
    const element = [...candidate.publicElements, ...candidate.privateElements].find(selects);
    if (!element) continue;
    const isPublic = candidate.publicElements.includes(element);
    return {
      pageObject: displayName(index, holder.name),
      ...(candidate !== holder ? { implementation: shortName(candidate) } : {}),
      element: element.name,
      selector: element.selector,
      scope: element.scope,
      public: isPublic,
      container: element.type === 'container',
      use: isPublic ? [formatGetter(element)] : (element.usedBy ?? []).map((name) => `${name}()`),
    };
  }
  return undefined;
}

function scopeMatches(snapshot: DomSnapshot, selector: string, scope: SelectorScope): Located[] {
  try {
    return matchSelector(snapshot, selector, scope).matches;
  } catch {
    return [];
  }
}

/** A root page object's selector (or its implementations'), when UTAM could load the wrong copy. */
function rootSelectorCheck(
  snapshot: DomSnapshot,
  index: PageObjectIndex,
  entry: PageObjectEntry,
): PathStep['rootSelectorMatches'] {
  const selectors = new Set<string>();
  for (const candidate of withImplementations(index, entry)) if (candidate.selector) selectors.add(candidate.selector);
  for (const selector of selectors) {
    const found = scopeMatches(snapshot, selector, { kind: 'document' });
    if (found.length > 1 || found[0]?.hiddenTop)
      return { selector, count: found.length, first: found[0].node.id, firstHidden: found[0].hiddenTop !== undefined };
  }
  return undefined;
}

/**
 * Replays an element's declaration as UTAM searches it, from the page object's root node down to
 * `target`: each element in its declared scope (`elements` or `shadow.elements`) of the one above.
 * Returns the first element that only the other scope finds on the way to the target.
 */
function checkScope(
  snapshot: DomSnapshot,
  holder: PageObjectEntry,
  element: PageObjectElement,
  root: Located,
  target: Located,
): Omit<ScopeMismatch, 'pageObject'> | undefined {
  const onPath = new Set<Located>();
  for (let up: Located | undefined = target; up; up = up.parent) onPath.add(up);
  if (!onPath.has(root)) return undefined;
  const byName = new Map([...holder.publicElements, ...holder.privateElements].map((e) => [e.name, e]));
  const parts = element.name.split('.');
  let current = root;
  for (let i = 1; i <= parts.length; i++) {
    const step = byName.get(parts.slice(0, i).join('.'));
    if (!step) return undefined;
    const search = (scope: 'light' | 'shadow'): Located | undefined =>
      scopeMatches(snapshot, step.selector, { kind: scope, within: current.node.id }).find((m) => onPath.has(m));
    const next = search(step.scope);
    if (next) {
      current = next;
      continue;
    }
    const other = search(step.scope === 'light' ? 'shadow' : 'light');
    if (!other) return undefined;
    return {
      element: step.name,
      selector: step.selector,
      declared: step.scope,
      parent: current.node.id,
      found: other.node.id,
      ...(step !== element ? { via: element.name } : {}),
    };
  }
  return undefined;
}

function selectsNode(selector: string, entry: Located): boolean {
  try {
    return nodeMatchesSelector(entry, prepareSelector(selector).selector);
  } catch {
    return false;
  }
}

/** Page objects found above the target so far, nearest last, with the node each sits on. */
type Holders = { entries: PageObjectEntry[]; node: Located };

/** Elements of the project's own page objects above the node that select it, declared in the wrong scope. */
function projectScopeMismatches(
  snapshot: DomSnapshot,
  index: PageObjectIndex,
  above: Holders[],
  entry: Located,
): ScopeMismatch[] {
  const out: ScopeMismatch[] = [];
  for (const { entries, node } of above) {
    for (const holder of entries) {
      if (holder.source !== 'project') continue;
      for (const element of [...holder.publicElements, ...holder.privateElements]) {
        if (!selectsNode(element.selector, entry)) continue;
        const mismatch = checkScope(snapshot, holder, element, node, entry);
        if (mismatch) out.push({ pageObject: displayName(index, holder.name), ...mismatch });
      }
    }
  }
  return out;
}

/**
 * A page object above the node with an element that likely selects it: one whose selector names
 * the node's tag (any page object above, nearest first), or, for the nearest page object above, one
 * whose whole selector matches the node (containers and elements selected by attribute or class).
 */
function reachable(index: PageObjectIndex, above: Holders[], entry: Located): ReachableThrough | undefined {
  for (let i = above.length - 1; i >= 0; i--) {
    for (const holder of above[i].entries) {
      const byTag = routeTo(index, holder, (element) => element.tags.includes(entry.node.tag));
      if (byTag) return byTag;
      if (i === above.length - 1) {
        const bySelector = routeTo(index, holder, (element) => selectsNode(element.selector, entry));
        if (bySelector) return bySelector;
      }
    }
  }
  return undefined;
}

/**
 * The project's own root page objects whose root selector's first match in the document is a node:
 * how `path` shows a project page object that scopes a shipped one to a plain container.
 */
function projectRoots(snapshot: DomSnapshot, index: PageObjectIndex): Map<Located, PageObjectEntry[]> {
  const out = new Map<Located, PageObjectEntry[]>();
  for (const entry of index.entries.values()) {
    if (entry.source !== 'project' || !entry.root || !entry.selector) continue;
    const first = scopeMatches(snapshot, entry.selector, { kind: 'document' })[0];
    if (first) out.set(first, [...(out.get(first) ?? []), entry]);
  }
  return out;
}

function annotationFor(index: PageObjectIndex, found: PageObjectMatch[], byRootSelector: boolean): PathAnnotation {
  const [best, ...rest] = found;
  const importPath = displayName(index, best.entry.name);
  const others = [...new Set(rest.map((match) => displayName(index, match.entry.name)))].filter(
    (name) => name !== importPath,
  );
  return {
    kind: 'pageObject',
    importPath,
    root: best.entry.root,
    interface: best.entry.interface,
    source: best.entry.source,
    via: byRootSelector ? 'project root selector' : best.via,
    ...(best.entry.outputFile ? { outputFile: best.entry.outputFile } : {}),
    ...(others.length > 0 ? { others } : {}),
  };
}

/** Walks the chain from the document to the target and works out each step's annotations. */
class PathBuilder {
  public readonly steps: PathStep[] = [];
  private readonly above: Holders[] = [];
  private readonly reported = new Set<string>();
  private readonly roots: Map<Located, PageObjectEntry[]>;

  public constructor(
    private readonly snapshot: DomSnapshot,
    private readonly index: PageObjectIndex | undefined,
  ) {
    this.roots = index ? projectRoots(snapshot, index) : new Map<Located, PageObjectEntry[]>();
  }

  public add(entry: Located, isTarget: boolean, inShadow: ShadowMode | undefined): boolean {
    const { node } = entry;
    const isCustom = node.tag.includes('-');
    const projectRoot = this.roots.get(entry);
    if (!isCustom && !isTarget && !node.hidden && !projectRoot) return false;
    const step: PathStep = {
      id: node.id,
      tag: node.tag,
      node: describeNode(node),
      hidden: node.hidden === true,
      target: isTarget,
    };
    if (inShadow) step.inShadow = inShadow;
    if (node.shadow?.mode === 'unreadable') step.unreadable = true;
    if (this.index && (isCustom || isTarget || projectRoot)) this.annotate(step, entry, isCustom, projectRoot);
    this.steps.push(step);
    return true;
  }

  private annotate(step: PathStep, entry: Located, isCustom: boolean, projectRoot?: PageObjectEntry[]): void {
    const index = this.index!;
    const byTag = isCustom ? matchPageObjects(index, entry.node.tag) : [];
    // A project root whose selector names the tag is already among the tag's matches.
    const extraRoots = (projectRoot ?? []).filter((po) => !byTag.some((match) => match.entry === po));
    const found = [...extraRoots.map((po) => ({ entry: po, via: 'root selector' as const })), ...byTag];
    if (found.length > 0) step.annotation = annotationFor(index, found, projectRoot !== undefined && !isCustom);
    else if (isCustom) step.annotation = { kind: 'none' };

    const mismatches = projectScopeMismatches(this.snapshot, index, this.above, entry);
    const fresh = mismatches.filter((m) => !this.reported.has(`${m.pageObject}|${m.element}`));
    for (const m of fresh) this.reported.add(`${m.pageObject}|${m.element}`);
    if (fresh.length > 0) step.scopeMismatches = fresh;

    const through = reachable(index, this.above, entry);
    if (through) {
      // A route through a misdeclared element, or one nested in it, isn't one UTAM can follow.
      for (const key of this.reported) {
        const [pageObject, element] = key.split('|');
        if (
          pageObject === through.pageObject &&
          (through.element === element || through.element.startsWith(`${element}.`))
        )
          through.brokenBy = element;
      }
      step.reachableThrough = through;
    }

    if (found.length === 0) return;
    this.above.push({ entries: found.map((m) => m.entry), node: entry });
    // A shipped root reached through a project page object above it isn't loaded with utam.load, so
    // its root selector's other matches don't matter.
    const scopedByProject = through !== undefined && !through.brokenBy && this.isProject(through.pageObject);
    if (found[0].entry.root && !scopedByProject) {
      const check = rootSelectorCheck(this.snapshot, index, found[0].entry);
      if (check) step.rootSelectorMatches = check;
    }
  }

  private isProject(pageObject: string): boolean {
    const name = this.index!.aliases.get(pageObject) ?? pageObject;
    return this.index!.entries.get(name)?.source === 'project';
  }
}

function annotationText(annotation: PathAnnotation | undefined): string {
  if (annotation?.kind === 'none') return 'no page object found';
  if (annotation?.kind !== 'pageObject') return '';
  const flags = [
    annotation.root ? 'root' : '',
    annotation.interface ? 'interface' : '',
    annotation.source === 'project' ? `project; compiled to ${annotation.outputFile ?? '?'}` : '',
    annotation.via === 'convention' ? 'by naming convention' : '',
    annotation.via === 'project root selector' ? 'its root selector matches here' : '',
  ].filter(Boolean);
  let text = `${annotation.importPath}${flags.length > 0 ? ` (${flags.join(', ')})` : ''}`;
  if (annotation.others)
    text += ` [also: ${annotation.others.slice(0, 3).join(', ')}${annotation.others.length > 3 ? ', …' : ''}]`;
  return text;
}

function stepLines(step: PathStep, depth: number): string[] {
  const indent = '  '.repeat(depth);
  const lines: string[] = [];
  if (step.inShadow) lines.push(`${indent}#shadow(${step.inShadow})`);
  let label = `${indent}${clip(step.node, 70)}`;
  if (step.hidden) label += '  (hidden)';
  if (step.target) label += `  ← target [${step.id}]`;
  const text = annotationText(step.annotation);
  lines.push(text ? `${label.padEnd(44)} ${text}` : label);
  if (step.unreadable)
    lines.push(`${indent}  ⚠ unreadable shadow root, most likely closed: UTAM selectors can't reach inside it.`);
  if (step.rootSelectorMatches) {
    const r = step.rootSelectorMatches;
    lines.push(
      `${indent}  ⚠ root selector "${clip(r.selector, 60)}" matches ${r.count} in the document; utam.load takes the first, ${r.first}${r.firstHidden ? ' (hidden)' : ''}. See find --css "${r.selector}".`,
    );
  }
  for (const m of step.scopeMismatches ?? []) {
    const [declared, other] =
      m.declared === 'light' ? ['elements', 'shadow.elements'] : ['shadow.elements', 'elements'];
    const where = m.declared === 'light' ? `${m.parent}'s shadow root` : `${m.parent}'s light DOM`;
    const subject = m.via
      ? `element "${m.via}" can't be found: the element it's nested in, "${m.element}" "${clip(m.selector, 60)}",`
      : `element "${m.element}" "${clip(m.selector, 60)}"`;
    lines.push(
      `${indent}  ⚠ ${m.pageObject}: ${subject} is declared in ${declared}, but ${m.found} is in ${where}. Move it to ${other}.`,
    );
  }
  if (step.reachableThrough) {
    const r = step.reachableThrough;
    const holder = r.implementation ? `${r.pageObject} (in its implementation ${r.implementation})` : r.pageObject;
    const kind = `${r.public ? 'public' : 'private'}${r.container ? ' container' : ''}, ${r.scope}`;
    const use = r.public ? r.use.join(', ') : `used by ${r.use.length > 0 ? r.use.join(', ') : 'no public method'}`;
    const route = `${holder}, element "${r.element}" "${clip(r.selector, 60)}" (${kind}, ${use})`;
    lines.push(
      r.brokenBy
        ? `${indent}  ↳ not reachable as declared: ${route}. It runs through "${r.brokenBy}", which is in the wrong scope (⚠ above).`
        : `${indent}  ↳ reachable through ${route}`,
    );
  }
  return lines;
}

/**
 * The custom elements from the document down to a node, with shadow crossings, hidden ancestors,
 * and what the page-object index knows about each: its page object, a likely route through a page
 * object above it, a root selector that matches more than one copy, and an element of your own page
 * objects declared in the wrong scope.
 *
 * @param snapshot The snapshot.
 * @param handle The target node's handle.
 * @param options The page-object index, and the output limit.
 */
export function componentPath(
  snapshot: DomSnapshot,
  handle: string,
  options: PathOptions = {},
): QueryResult<PathResult> {
  const chain: Located[] = [];
  for (let entry: Located | undefined = getNode(snapshot, handle); entry; entry = entry.parent) chain.unshift(entry);
  const builder = new PathBuilder(snapshot, options.index);
  let pendingShadow: ShadowMode | undefined;
  for (const [i, entry] of chain.entries()) {
    if (entry.viaShadow) pendingShadow = entry.parent?.node.shadow?.mode;
    if (builder.add(entry, i === chain.length - 1, pendingShadow)) pendingShadow = undefined;
  }
  const lines = builder.steps.flatMap((step, depth) => stepLines(step, depth));
  return {
    lines: limitLines(lines, options.limit ?? DEFAULT_OUTPUT_LIMIT, 'Use tree on a node lower down.'),
    json: { target: handle, steps: builder.steps },
  };
}

/** `path --text`'s answer: the path, or the candidates, with the exit code the CLI uses. */
export type PathByTextResult = QueryResult<PathResult | { candidates: FindResult }> & { exitCode: 0 | 1 };

/**
 * The path to the only visible node matching `text`. With no visible match, or more than one, it
 * prints no path: it lists the candidates and returns exit code 1, so the caller picks one.
 *
 * @param snapshot The snapshot.
 * @param text The text to find, as `find --text` matches it.
 * @param options The page-object index, and the output limit.
 */
export function componentPathByText(snapshot: DomSnapshot, text: string, options: PathOptions = {}): PathByTextResult {
  const limit = options.limit ?? DEFAULT_OUTPUT_LIMIT;
  const found = findNodes(snapshot, { text, all: true, limit: Number.MAX_SAFE_INTEGER });
  const { visible, hidden } = found.json;
  if (visible.length === 1) {
    const result = componentPath(snapshot, visible[0].id, options);
    if (hidden.length > 0)
      result.lines.push(
        `${hidden.length} hidden matches for "${text}" also exist; see \`find --text "${text}" --all\`.`,
      );
    return { ...result, exitCode: 0 };
  }
  const command = (id: string): string => `npx simply-utam snapshot path --node ${id}`;
  let lines: string[];
  if (visible.length === 0 && hidden.length === 0) {
    lines = [`No path printed: nothing matches "${text}". Try find with a shorter label, --tag or --attr.`];
  } else if (visible.length === 0) {
    lines = [
      `No path printed: "${text}" matches only hidden nodes (${hidden.length}), and path --text needs a visible one.`,
      `List them with \`npx simply-utam snapshot find --text "${text}" --all\`, then run, for example:`,
      `  ${command(hidden[0].id)}`,
    ];
  } else {
    lines = [
      `No path printed: "${text}" has ${visible.length} visible matches, and path --text needs exactly one.`,
      'Pick the one you want below and run path with its handle, for example:',
      `  ${command(visible[0].id)}`,
      'Candidates (visible, in document order):',
      ...found.lines.slice(1, 1 + visible.length).map((line) => `  ${line}`),
      ...(hidden.length > 0 ? [`(${hidden.length} hidden matches too; find --all lists them.)`] : []),
    ];
  }
  return { lines: limitLines(lines, limit, 'Narrow the text.'), json: { candidates: found.json }, exitCode: 1 };
}
