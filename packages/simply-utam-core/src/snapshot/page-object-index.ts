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
import { createRequire } from 'node:module';
import * as path from 'node:path';

/** An element declared in a page object. */
export type PageObjectElement = {
  /** The element's name; nested elements are written `parent.child`. */
  name: string;
  /** The page object it returns (import path when known), or its basic type. */
  type?: string;
  selector: string;
  /** The tags the selector names (the last part of each comma-separated alternative). */
  tags: string[];
  /** The last compound of each comma-separated alternative, such as `[slot='secondaryFields']`. */
  lastParts: string[];
  /** `shadow` when declared under `shadow.elements`, so UTAM searches its parent's shadow root. */
  scope: 'light' | 'shadow';
  /** `returnAll`: the getter returns a list. */
  list?: true;
  /**
   * For a private element: the public methods whose `compose` uses it, or an element nested in it,
   * and the getters of public elements nested in it.
   */
  usedBy?: string[];
  /** `wait: true`: UTAM also generates a `waitFor…` method for it. */
  wait?: true;
  /** The getter's parameters: selector arguments (`%s`, `%d`) of this element and the elements it's nested in. */
  args?: PageObjectArg[];
};

export type PageObjectArg = { name: string; type: string };

export type PageObjectMethod = {
  name: string;
  returns?: string;
  args?: PageObjectArg[];
  /** One line on what its `compose` statements do, such as `getText on title ".title"`; none for an interface. */
  compose?: string;
};

export type PageObjectEntry = {
  /** Manifest name, or the import path where there's no manifest. */
  name: string;
  /** What test code imports, or what `type` names in the project's own `.utam.json` files. */
  importPath?: string;
  /** For the project's own page objects: the compiled file, relative to the project. */
  outputFile?: string;
  /** Whether `utam.load` can load it directly. */
  root: boolean;
  interface: boolean;
  /** For an implementation: the interface it implements. */
  implements?: string;
  /** For an interface: its implementations (profiles aren't read). */
  implementations?: string[];
  /** `project`, or the package it came from. */
  source: string;
  /** The root selector, for a root page object. */
  selector?: string;
  publicElements: PageObjectElement[];
  privateElements: PageObjectElement[];
  methods: PageObjectMethod[];
  /** The `.utam.json` file it was read from. */
  file: string;
  /** The page object's own description, joined into one line. */
  description?: string;
};

/** Why a tag or name maps to a page object. */
export type PageObjectMatch = {
  entry: PageObjectEntry;
  via: 'root selector' | 'typed element' | 'convention' | 'name';
  /** For `typed element`: up to a few `pageObject.element` names that declare it. */
  declaredBy?: string[];
  declaredByCount?: number;
  /** Set when the tag matched an implementation and the interface is reported instead. */
  matchedImplementation?: string;
};

export type PageObjectIndex = {
  entries: Map<string, PageObjectEntry>;
  /** Import path or manifest name → entry name. */
  aliases: Map<string, string>;
  tags: Map<string, Array<{ name: string; via: 'root selector' | 'typed element'; declaredBy?: string }>>;
  namespaces: Record<string, string>;
  warnings: string[];
};

export type BuildPageObjectIndexOptions = {
  /** The test project. Defaults to the current directory. */
  projectDir?: string;
};

type UtamJson = {
  root?: boolean;
  interface?: boolean;
  implements?: string;
  selector?: { css?: string };
  elements?: UtamElementJson[];
  shadow?: { elements?: UtamElementJson[] };
  methods?: Array<{
    name: string;
    returnType?: string;
    compose?: unknown[];
    description?: unknown;
    args?: UtamArgJson[];
  }>;
  description?: unknown;
};

type UtamArgJson = { name?: string; type?: string; value?: unknown };

type UtamElementJson = {
  name: string;
  type?: unknown;
  public?: boolean;
  wait?: boolean;
  selector?: { css?: string; returnAll?: boolean; args?: UtamArgJson[] };
  elements?: UtamElementJson[];
  shadow?: { elements?: UtamElementJson[] };
};

const SALESFORCE_PAGEOBJECTS = 'salesforce-pageobjects';

/** Split on a separator outside brackets, parentheses and quotes. */
function splitTopLevel(value: string, isSeparator: (char: string) => boolean): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const char of value) {
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '[' || char === '(') depth++;
    else if (char === ']' || char === ')') depth--;
    else if (depth === 0 && isSeparator(char)) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/**
 * The tags a CSS selector names: the tag of the last compound in each comma-separated alternative.
 *
 * @param selector A CSS selector, possibly with `%s` placeholders.
 */
export function selectorTags(selector: string): string[] {
  const tags = new Set<string>();
  for (const alternative of splitTopLevel(selector, (char) => char === ',')) {
    const compounds = splitTopLevel(alternative, (char) => /[\s>+~]/.test(char));
    const tag = /^[a-zA-Z][\w-]*/.exec(compounds.at(-1) ?? '')?.[0];
    if (tag) tags.add(tag.toLowerCase());
  }
  return [...tags];
}

/**
 * The last compound of each comma-separated alternative: what the element itself must match.
 *
 * @param selector A CSS selector.
 */
export function selectorLastParts(selector: string): string[] {
  return splitTopLevel(selector, (char) => char === ',')
    .map((alternative) => splitTopLevel(alternative, (char) => /[\s>+~]/.test(char)).at(-1) ?? '')
    .filter((part) => part !== '');
}

function camelCase(value: string): string {
  return value.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/** The element names a method's `compose` statements use on its own page object. */
function composeElements(statements: unknown, out: Set<string>): void {
  if (Array.isArray(statements)) {
    for (const item of statements) composeElements(item, out);
    return;
  }
  if (!statements || typeof statements !== 'object') return;
  const statement = statements as Record<string, unknown>;
  // A chained statement's element belongs to the page object the previous statement returned.
  if (typeof statement.element === 'string' && statement.chain !== true) out.add(statement.element);
  for (const value of Object.values(statement)) if (typeof value === 'object') composeElements(value, out);
}

/** Named arguments, in order, without repeats; literal values aren't parameters. */
function mergeArgs(...lists: Array<UtamArgJson[] | PageObjectArg[] | undefined>): PageObjectArg[] {
  const out: PageObjectArg[] = [];
  for (const list of lists) {
    for (const arg of list ?? []) {
      if (!arg.name || ('value' in arg && arg.value !== undefined) || out.some((item) => item.name === arg.name))
        continue;
      out.push({ name: arg.name, type: arg.type ?? 'unknown' });
    }
  }
  return out;
}

/** A method's parameters: its own `args`, then the selector arguments of the elements it uses. */
function methodArgs(
  own: UtamArgJson[] | undefined,
  composeList: unknown[],
  used: Set<string>,
  elements: PageObjectElement[],
): PageObjectArg[] {
  const statementArgs = composeList.flatMap((statement) => {
    const args = (statement as { args?: UtamArgJson[] }).args;
    return Array.isArray(args) ? args.filter((arg) => typeof arg.type === 'string' && arg.type !== 'function') : [];
  });
  const elementArgs = elements
    .filter((element) => used.has(element.name.split('.').at(-1) ?? ''))
    .map((element) => element.args);
  return mergeArgs(own, statementArgs, ...elementArgs);
}

function describe(description: unknown): string | undefined {
  let lines: unknown[] = [];
  if (typeof description === 'string') lines = [description];
  else if (Array.isArray((description as { text?: unknown } | undefined)?.text))
    lines = (description as { text: unknown[] }).text;
  const text = lines
    .filter((line): line is string => typeof line === 'string')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text === '' ? undefined : text;
}

type ComposeStatement = {
  returnType?: string;
  element?: string;
  apply?: string;
  chain?: boolean;
  args?: Array<{ predicate?: unknown[] }>;
};

/** What a method returns, when its JSON says: a return type, an element it ends on, or its description. */
function methodReturns(
  method: { returnType?: string; description?: unknown },
  composeList: unknown[],
  elements: PageObjectElement[],
): string | undefined {
  let last = composeList.at(-1) as ComposeStatement | undefined;
  if (method.returnType) return method.returnType;
  if (typeof last?.returnType === 'string') return last.returnType;
  // `waitFor` with a predicate that ends on an element returns that element.
  if (last?.apply === 'waitFor') last = last.args?.[0]?.predicate?.at(-1) as ComposeStatement | undefined;
  if (last?.element && !last.apply && !last.chain) {
    const element = elements.find((item) => item.name.split('.').at(-1) === last.element);
    if (element?.type?.includes('/')) return element.type;
  }
  const described = (method.description as { return?: unknown } | undefined)?.return;
  return typeof described === 'string' ? /\(([\w-]+\/pageObjects\/\w+)\)/.exec(described)?.[1] : undefined;
}

type ComposePiece = { chain: boolean; element?: string; verbs: string[]; matcher?: string };

/** A statement or matcher argument in short form: a parameter's name, or a literal value. */
function argText(arg: unknown): string | undefined {
  if (!arg || typeof arg !== 'object') return undefined;
  const { name, type, value } = arg as UtamArgJson;
  if (typeof name === 'string') return name;
  if (type === 'pageObject' || type === 'rootPageObject') return String(value).split('/').at(-1);
  if (type === 'elementReference') return String(value);
  if (typeof value === 'string') return `"${value.replace(/^"|"$/g, '')}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const css = (value as { css?: unknown } | undefined)?.css;
  return typeof css === 'string' ? `"${css}"` : undefined;
}

function argList(args: unknown): string[] {
  return Array.isArray(args) ? args.map(argText).filter((text): text is string => text !== undefined) : [];
}

/** Every element a nested statement list names, such as a `waitFor` predicate's. */
function namedElements(value: unknown, out: Set<string>): Set<string> {
  if (Array.isArray(value)) for (const item of value) namedElements(item, out);
  else if (value && typeof value === 'object') {
    const element = (value as { element?: unknown }).element;
    if (typeof element === 'string') out.add(element);
    for (const child of Object.values(value)) if (typeof child === 'object') namedElements(child, out);
  }
  return out;
}

function composePiece(raw: unknown): ComposePiece {
  const statement = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const piece: ComposePiece = { chain: statement.chain === true, verbs: [] };
  if (typeof statement.element === 'string') piece.element = statement.element;
  const external = statement.applyExternal as { type?: unknown; invoke?: unknown } | undefined;
  if (external && typeof external === 'object') {
    const utility = typeof external.type === 'string' ? `${external.type.split('/').at(-1) ?? ''}.` : '';
    piece.verbs.push(
      `${utility}${String(external.invoke)}(${argList((external as { args?: unknown }).args).join(', ')})`,
    );
  }
  const { apply } = statement;
  if (apply === 'waitFor') {
    // A predicate is its own statement list; the elements it names say what's waited for.
    piece.verbs.push(`waitFor(${[...namedElements(statement.args, new Set())].join(', ')})`);
  } else if (apply === 'returnSelf') {
    piece.verbs.push('returns self');
  } else if (typeof apply === 'string') {
    const args = argList(statement.args);
    // Without an element, `apply` calls a method: this page object's, or the chained one's.
    piece.verbs.push(args.length > 0 || !piece.element ? `${apply}(${args.join(', ')})` : apply);
  }
  const matcher = statement.matcher as { type?: unknown; args?: unknown } | undefined;
  if (matcher && typeof matcher.type === 'string') {
    const args = argList(matcher.args);
    piece.matcher = `${matcher.type}${args.length > 0 ? `(${args.join(', ')})` : ''}`;
  }
  return piece;
}

/**
 * A method's `compose` in one line: each statement's `apply` (or `returns` when it only names an
 * element) on the element, with the element's selector when it's one of this page object's.
 * Chained statements act on the previous statement's return value, written `→ chain …`.
 */
function summarizeCompose(composeList: unknown[], elements: PageObjectElement[]): string | undefined {
  try {
    const pieces: ComposePiece[] = [];
    for (const statement of composeList) {
      const piece = composePiece(statement);
      const previous = pieces.at(-1);
      // Statements in a row on the same element read as one: `scrollToCenter, click on tab`.
      if (
        previous &&
        !piece.chain &&
        !previous.chain &&
        piece.element &&
        previous.element === piece.element &&
        piece.verbs.length > 0 &&
        previous.verbs.length > 0 &&
        !previous.matcher
      ) {
        previous.verbs.push(...piece.verbs);
        previous.matcher = piece.matcher;
      } else pieces.push(piece);
    }
    const shown = new Set<string>();
    const target = (name: string): string => {
      const element = elements.find((item) => item.name.split('.').at(-1) === name);
      if (!element || shown.has(name)) return name;
      shown.add(name);
      return `${name} "${element.selector}"`;
    };
    const parts = pieces.map((piece, i) => {
      // A chained element belongs to the page object the previous statement returned.
      const on = piece.element ? (piece.chain ? piece.element : target(piece.element)) : undefined;
      let text: string;
      if (piece.verbs.length > 0) text = `${piece.verbs.join(', ')}${on ? ` on ${on}` : ''}`;
      else if (piece.chain || piece.matcher || pieces[i + 1]?.chain) text = on ?? '?';
      else text = `returns ${on ?? '?'}`;
      if (piece.matcher) text += ` is ${piece.matcher}`;
      return i === 0 ? text : `${piece.chain ? ' → chain ' : '; '}${text}`;
    });
    const line = parts.join('');
    if (line === '') return undefined;
    return line;
  } catch {
    return undefined;
  }
}

/** A public element's getter finds every element it's nested in first, so it uses them too. */
function addGetterUse(publicElements: PageObjectElement[], privateElements: PageObjectElement[]): void {
  for (const element of publicElements) {
    const last = element.name.split('.').at(-1) ?? element.name;
    const title = `${last[0].toUpperCase()}${last.slice(1)}`;
    const getters = [`get${title}`, ...(element.wait ? [`waitFor${title}`] : [])];
    for (const outer of privateElements)
      if (element.name.startsWith(`${outer.name}.`)) (outer.usedBy ??= []).push(...getters);
  }
}

function readEntry(
  json: UtamJson,
  base: Omit<PageObjectEntry, 'root' | 'interface' | 'publicElements' | 'privateElements' | 'methods'>,
): PageObjectEntry {
  const publicElements: PageObjectElement[] = [];
  const privateElements: PageObjectElement[] = [];
  function walk(
    elements: UtamElementJson[] | undefined,
    scope: 'light' | 'shadow',
    prefix: string,
    parentArgs: PageObjectArg[],
  ): void {
    for (const element of elements ?? []) {
      const selector = element.selector?.css;
      const name = prefix + element.name;
      const args = mergeArgs(parentArgs, element.selector?.args);
      if (selector !== undefined) {
        const item: PageObjectElement = {
          name,
          selector,
          tags: selectorTags(selector),
          lastParts: selectorLastParts(selector),
          scope,
        };
        if (args.length > 0) item.args = args;
        if (element.type !== undefined)
          item.type = typeof element.type === 'string' ? element.type : JSON.stringify(element.type);
        if (element.selector?.returnAll) item.list = true;
        if (element.wait) item.wait = true;
        (element.public ? publicElements : privateElements).push(item);
      }
      walk(element.elements, 'light', `${name}.`, args);
      walk(element.shadow?.elements, 'shadow', `${name}.`, args);
    }
  }
  walk(json.elements, 'light', '', []);
  walk(json.shadow?.elements, 'shadow', '', []);
  const allElements = [...publicElements, ...privateElements];

  const methods: PageObjectMethod[] = [];
  for (const method of json.methods ?? []) {
    const composeList = Array.isArray(method.compose) ? method.compose : [];
    const returns = methodReturns(method, composeList, allElements);
    const used = new Set<string>();
    composeElements(composeList, used);
    const args = methodArgs(method.args, composeList, used, allElements);
    const compose = summarizeCompose(composeList, allElements);
    methods.push({
      name: method.name,
      ...(returns ? { returns } : {}),
      ...(args.length > 0 ? { args } : {}),
      ...(compose ? { compose } : {}),
    });
    for (const element of privateElements) {
      // `compose` names an element by its own name, even when it's nested in another; a method that
      // uses an element nested in this one uses this one too.
      const usesIt = allElements.some(
        (other) =>
          (other === element || other.name.startsWith(`${element.name}.`)) &&
          used.has(other.name.split('.').at(-1) ?? other.name),
      );
      if (usesIt) (element.usedBy ??= []).push(method.name);
    }
  }

  addGetterUse(publicElements, privateElements);

  return {
    ...base,
    root: json.root === true,
    interface: json.interface === true,
    ...(json.implements ? { implements: json.implements } : {}),
    ...(json.root && json.selector?.css ? { selector: json.selector.css } : {}),
    ...(describe(json.description) ? { description: describe(json.description) } : {}),
    publicElements,
    privateElements,
    methods,
  };
}

function globFiles(rootDir: string, masks: string[]): string[] {
  const files = new Set<string>();
  for (const mask of masks) {
    for (const file of fs.globSync(mask, { cwd: rootDir, exclude: (name: string) => name === 'node_modules' })) {
      files.add(path.join(rootDir, file));
    }
  }
  return [...files].sort();
}

function addEntry(index: PageObjectIndex, entry: PageObjectEntry): void {
  index.entries.set(entry.name, entry);
  index.aliases.set(entry.name, entry.name);
  if (entry.importPath) index.aliases.set(entry.importPath, entry.name);
}

/** `salesforce-pageobjects`, through its manifest, resolved from the project. */
function indexSalesforcePageObjects(index: PageObjectIndex, projectDir: string): void {
  let packageDir: string;
  try {
    const require = createRequire(path.join(projectDir, 'package.json'));
    packageDir = path.dirname(require.resolve(`${SALESFORCE_PAGEOBJECTS}/package.json`));
  } catch {
    index.warnings.push(
      `${SALESFORCE_PAGEOBJECTS} is not installed in ${projectDir}; only the project's own page objects are indexed.`,
    );
    return;
  }
  const manifest = readJson<{ pageObjects?: Record<string, string> }>(
    path.join(packageDir, 'dist', 'utam.manifest.json'),
  );
  if (!manifest?.pageObjects) {
    index.warnings.push(`${SALESFORCE_PAGEOBJECTS} has no readable dist/utam.manifest.json; it isn't indexed.`);
    return;
  }
  for (const [name, source] of Object.entries(manifest.pageObjects)) {
    const relative = source.replace(/^package\//, '');
    const file = path.join(packageDir, relative);
    const json = readJson<UtamJson>(file);
    if (!json) continue;
    const underDist = path.posix.relative('dist', relative);
    const importPath = `${SALESFORCE_PAGEOBJECTS}/${path.posix.dirname(underDist)}/pageObjects/${path.posix.basename(underDist, '.utam.json')}`;
    addEntry(index, readEntry(json, { name, importPath, source: SALESFORCE_PAGEOBJECTS, file }));
  }
}

/** The project's own page objects, from `utam.config.json` and the generator's `namespaces`. */
function indexProjectPageObjects(index: PageObjectIndex, projectDir: string): void {
  const utamConfig = readJson<{
    pageObjectsRootDir?: string;
    pageObjectsFileMask?: string[];
    pageObjectsOutputDir?: string;
  }>(path.join(projectDir, 'utam.config.json'));
  const generatorConfig = readJson<{ namespaces?: Record<string, string> }>(
    path.join(projectDir, 'generator.config.json'),
  );
  const packageName = readJson<{ name?: string }>(path.join(projectDir, 'package.json'))?.name;
  index.namespaces = generatorConfig?.namespaces ?? {};
  if (!utamConfig) return;
  const projectPrefix =
    Object.values(index.namespaces).find((prefix) => packageName && prefix.startsWith(`${packageName}/`)) ??
    (packageName ? `${packageName}/pageObjects/` : 'pageObjects/');
  const rootDir = path.resolve(projectDir, utamConfig.pageObjectsRootDir ?? '.');
  const outputDir = utamConfig.pageObjectsOutputDir ?? 'pageObjects';
  for (const file of globFiles(rootDir, utamConfig.pageObjectsFileMask ?? ['**/__utam__/**/*.utam.json'])) {
    const json = readJson<UtamJson>(file);
    if (!json) {
      index.warnings.push(`Skipped ${path.relative(projectDir, file)}: not valid JSON.`);
      continue;
    }
    const base = path.basename(file, '.utam.json');
    const importPath = `${projectPrefix}${base}`;
    addEntry(
      index,
      readEntry(json, {
        name: importPath,
        importPath,
        outputFile: path.posix.join(outputDir, `${base}.js`),
        source: 'project',
        file,
      }),
    );
  }
}

/** Interfaces list their implementations; tags come from root selectors and typed elements. */
function linkEntries(index: PageObjectIndex): void {
  for (const entry of index.entries.values()) {
    if (!entry.implements) continue;
    const iface = index.entries.get(index.aliases.get(entry.implements) ?? entry.implements);
    if (iface) (iface.implementations ??= []).push(entry.name);
  }
  const addTag = (
    tag: string,
    value: { name: string; via: 'root selector' | 'typed element'; declaredBy?: string },
  ): void => {
    const list = index.tags.get(tag) ?? [];
    list.push(value);
    index.tags.set(tag, list);
  };
  for (const entry of index.entries.values()) {
    if (entry.selector)
      for (const tag of selectorTags(entry.selector)) addTag(tag, { name: entry.name, via: 'root selector' });
    for (const element of [...entry.publicElements, ...entry.privateElements]) {
      const target = element.type ? index.aliases.get(element.type) : undefined;
      if (!target) continue;
      for (const tag of element.tags)
        addTag(tag, { name: target, via: 'typed element', declaredBy: `${shortName(entry)}.${element.name}` });
    }
  }
}

/**
 * Index `salesforce-pageobjects` and the project's own page objects by the tags they cover.
 *
 * @param options Where the project is.
 */
export function buildPageObjectIndex(options: BuildPageObjectIndexOptions = {}): PageObjectIndex {
  const projectDir = path.resolve(options.projectDir ?? process.cwd());
  const index: PageObjectIndex = {
    entries: new Map(),
    aliases: new Map(),
    tags: new Map(),
    namespaces: {},
    warnings: [],
  };
  indexSalesforcePageObjects(index, projectDir);
  indexProjectPageObjects(index, projectDir);
  linkEntries(index);
  return index;
}

/** A page object's last path segment, for compact output. */
export function shortName(entry: PageObjectEntry): string {
  return (entry.importPath ?? entry.name).split('/').at(-1) ?? entry.name;
}

/**
 * Resolve a page object by manifest name, import path, or its short name when that is unique.
 *
 * @param index The index.
 * @param name Any of the names a page object goes by.
 */
export function resolvePageObject(index: PageObjectIndex, name: string): PageObjectEntry[] {
  const exact = index.aliases.get(name);
  if (exact) return [index.entries.get(exact)!];
  return [...index.entries.values()].filter((entry) => shortName(entry) === name);
}

/** What test code should use for an entry: the interface when it's an implementation. */
function preferInterface(
  index: PageObjectIndex,
  entry: PageObjectEntry,
): { entry: PageObjectEntry; implementation?: string } {
  if (!entry.implements) return { entry };
  const iface = index.entries.get(index.aliases.get(entry.implements) ?? entry.implements);
  return iface ? { entry: iface, implementation: entry.name } : { entry };
}

/**
 * The page objects for a tag: by root selector, by typed element, or by naming convention. A query
 * that isn't a tag (it has a `/`, or no `-`) is looked up as a page object's name, import path or
 * short name.
 *
 * @param index The index.
 * @param query A custom element's tag, or a page object's name.
 */
export function matchPageObjects(index: PageObjectIndex, query: string): PageObjectMatch[] {
  const isTag = query.includes('-') && !query.includes('/');
  const matches = isTag ? matchTag(index, query) : [];
  if (matches.length > 0 || isTag) return matches;
  return resolvePageObject(index, query).map((entry) => ({ entry, via: 'name' }));
}

function matchTag(index: PageObjectIndex, tag: string): PageObjectMatch[] {
  const matches = new Map<string, PageObjectMatch>();
  for (const item of index.tags.get(tag.toLowerCase()) ?? []) {
    const found = index.entries.get(item.name);
    if (!found) continue;
    const { entry, implementation } = preferInterface(index, found);
    const key = `${entry.name}|${item.via}`;
    const existing = matches.get(key);
    if (existing) {
      if (item.declaredBy) {
        existing.declaredByCount = (existing.declaredByCount ?? 0) + 1;
        if ((existing.declaredBy ??= []).length < 3) existing.declaredBy.push(item.declaredBy);
      }
      continue;
    }
    matches.set(key, {
      entry,
      via: item.via,
      ...(item.declaredBy ? { declaredBy: [item.declaredBy], declaredByCount: 1 } : {}),
      ...(implementation ? { matchedImplementation: implementation } : {}),
    });
  }
  if (matches.size === 0) {
    const [namespace, ...rest] = tag.toLowerCase().split('-');
    const camel = camelCase(rest.join('-'));
    const candidates = [`utam-${namespace}/pageObjects/${camel}`];
    if (index.namespaces[namespace]) candidates.push(`${index.namespaces[namespace]}${camel}`);
    for (const candidate of candidates) {
      const name = index.aliases.get(candidate);
      if (name) {
        const { entry, implementation } = preferInterface(index, index.entries.get(name)!);
        matches.set(entry.name, {
          entry,
          via: 'convention',
          ...(implementation ? { matchedImplementation: implementation } : {}),
        });
      }
    }
  }
  // The project's own first, then root selectors, then typed elements.
  const rank = (match: PageObjectMatch): number =>
    (match.entry.source === 'project' ? 0 : 10) + ['root selector', 'typed element', 'convention'].indexOf(match.via);
  return [...matches.values()].sort((a, b) => rank(a) - rank(b));
}

export type PageObjectSearchMatch = { entry: PageObjectEntry; tags: string[] };

/**
 * Page objects whose name, import path, tags or description contain every word of `query`
 * (case-insensitive). Name matches come first, then tag matches, then description matches.
 *
 * @param index The index.
 * @param query One or more words.
 */
export function findPageObjects(index: PageObjectIndex, query: string): PageObjectSearchMatch[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const tagsByEntry = new Map<string, Set<string>>();
  for (const [tag, items] of index.tags) {
    for (const item of items) {
      const set = tagsByEntry.get(item.name) ?? new Set<string>();
      set.add(tag);
      tagsByEntry.set(item.name, set);
    }
  }
  const scored: Array<PageObjectSearchMatch & { score: number }> = [];
  for (const entry of index.entries.values()) {
    const tags = [...(tagsByEntry.get(entry.name) ?? [])];
    const names = `${entry.name} ${entry.importPath ?? ''}`.toLowerCase();
    const tagText = tags.join(' ');
    const description = (entry.description ?? '').toLowerCase();
    let score = 0;
    for (const word of words) {
      if (names.includes(word)) score += 3;
      else if (tagText.includes(word)) score += 2;
      else if (description.includes(word)) score += 1;
      else {
        score = -1;
        break;
      }
    }
    if (score > 0) scored.push({ entry, tags, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || shortName(a.entry).localeCompare(shortName(b.entry)))
    .map(({ entry, tags }) => ({ entry, tags }));
}

/**
 * Show a page object reference as test code would import it.
 *
 * @param index The index.
 * @param name A manifest name or import path.
 */
export function displayName(index: PageObjectIndex, name: string): string {
  const entry = index.entries.get(index.aliases.get(name) ?? '');
  return entry?.importPath ?? name;
}
