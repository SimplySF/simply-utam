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
import { discoverProject, findLwcDirectories } from '../discovery/index.js';
import { detectIndentation } from '../overrides/index.js';

/** The generator layout the stage reads page objects from, as the scaffolded config sets it. */
const EXPECTED_LAYOUT = { outputDir: '__utam__', relativeOutputDir: true, outputFileExtension: '.utam.json' };

/** `utam-generate`'s own defaults, which a project's `generator.config.json` overrides key by key. */
const GENERATOR_DEFAULTS = { outputDir: '__utam__', relativeOutputDir: false, outputFileExtension: '.utam.json' };

const DEFAULT_PAGE_OBJECTS_FILE_MASK = ['**/__utam__/**/*.utam.json'];

/**
 * The description line the stage adds to every page object it renames. It is how a later run tells
 * its own output, which it replaces, from a page object someone wrote or renamed by hand, which it
 * must not overwrite.
 */
const RENAMED_MARKER = 'Renamed by simply-utam names from ';
const UTAM_EXT = '.utam.json';

export interface NameSecondaryPageObjectsOptions {
  rootDir?: string;
  sourceDirs?: string[];
  /** The `utam-generate` config, relative to `rootDir`. Defaults to `generator.config.json`. */
  generatorConfigPath?: string;
  /** The compiler config whose `pageObjectsFileMask` sets the collision check's scope. Defaults to `utam.config.json`. */
  utamConfigPath?: string;
  dryRun?: boolean;
  verbose?: boolean;
}

export interface PageObjectRename {
  /** The template the page object was generated from. */
  template: string;
  /** The generated file. */
  from: string;
  /** Where it is moved to. */
  to: string;
  /** The new page object name, which is what the compiler names its output after. */
  name: string;
}

export interface PageObjectNameCollision {
  /** The final name, as the first source spells it. */
  name: string;
  /** Every file that would compile to that name, ignoring case. */
  sources: string[];
}

export interface NameSecondaryPageObjectsResult {
  renames: PageObjectRename[];
  /** Non-empty means nothing was renamed. */
  collisions: PageObjectNameCollision[];
  /** Page objects in a bundle's `__utam__` folder that match none of the bundle's templates. */
  unmatched: string[];
  /** Why the stage did nothing, when it skipped. */
  skipped?: string;
  dryRun: boolean;
}

interface Template {
  /** The page object name the generator gives it: the basename up to the first `.`. */
  name: string;
  file: string;
}

/**
 * Reads a JSON config file.
 *
 * @returns The parsed object, or `undefined` when the file does not exist.
 * @throws When the file exists but is not a JSON object, so a typo is not mistaken for a missing file.
 */
function readJsonConfig(file: string): Record<string, unknown> | undefined {
  let content: string;
  try {
    content = fs.readFileSync(file, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${(error as Error).message}`, { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Cannot read ${file}: expected a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * The name a secondary template's page objects get: the bundle name, then the template name with
 * its first letter upper-cased. `component_1` and `fooTemplate` give `component_1FooTemplate`.
 */
export function secondaryPageObjectName(bundleName: string, templateName: string): string {
  return `${bundleName}${templateName.charAt(0).toUpperCase()}${templateName.slice(1)}`;
}

/**
 * Fails unless the generator writes page objects into a `__utam__` folder beside each template, the
 * layout this stage (like `overrides`) reads them from. With a single output folder the generator
 * overwrites same-named templates itself, before any stage could rename them.
 */
function assertGeneratorLayout(configPath: string, config: Record<string, unknown>): void {
  const effective = { ...GENERATOR_DEFAULTS, ...config };
  const wrong = (Object.keys(EXPECTED_LAYOUT) as Array<keyof typeof EXPECTED_LAYOUT>).filter((key) =>
    key === 'outputDir' ? !isUtamFolder(effective.outputDir) : effective[key] !== EXPECTED_LAYOUT[key],
  );
  if (wrong.length > 0) {
    const found = wrong.map((key) => `${key}: ${JSON.stringify(effective[key])}`).join(', ');
    throw new Error(
      `${configPath} must set "outputDir": "__utam__", "relativeOutputDir": true and "outputFileExtension": ".utam.json" for page objects to be named per component (found ${found}). With one output folder, the generator overwrites same-named templates before they can be renamed.`,
    );
  }
}

/** Whether an `outputDir` value names the `__utam__` folder, however it is spelled (`./__utam__`, `__utam__/`). */
function isUtamFolder(outputDir: unknown): boolean {
  return (
    typeof outputDir === 'string' && path.normalize(outputDir).replace(/[\\/]+$/, '') === EXPECTED_LAYOUT.outputDir
  );
}

/**
 * Fails when a rules file beside a template sets its own `outputDir`. The generator honours it, so
 * that template's page objects go somewhere other than `__utam__`, where this stage would never find
 * them, and the clash it exists to prevent would stay without a word.
 */
function assertNoRulesOutputDir(folders: Iterable<string>): void {
  for (const folder of folders) {
    let files: string[];
    try {
      files = fs.readdirSync(folder).filter((file) => file.endsWith('.rules.json'));
    } catch {
      continue;
    }
    for (const file of files) {
      const rulesPath = path.join(folder, file);
      const outputDir = readJsonConfig(rulesPath)?.['outputDir'];
      if (outputDir !== undefined && !isUtamFolder(outputDir)) {
        throw new Error(
          `${rulesPath} sets "outputDir": ${JSON.stringify(outputDir)}, so its page objects are not written to __utam__ beside the template, and cannot be named per component. Remove "outputDir" from the rules file.`,
        );
      }
    }
  }
}

/** Every `.html` file in a bundle, its subfolders included, grouped by the folder it is in. */
function findTemplates(bundleDir: string): Map<string, Template[]> {
  const byFolder = new Map<string, Template[]>();
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__utam__' && entry.name !== '__tests__' && entry.name !== 'node_modules') {
          walk(full);
        }
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        const templates = byFolder.get(dir) ?? [];
        templates.push({ name: entry.name.split('.')[0], file: full });
        byFolder.set(dir, templates);
      }
    }
  };
  walk(bundleDir);
  return byFolder;
}

/**
 * The template a generated page object came from: the one it is named after, or, for a frame page
 * object (`<template>_<frame>`), the longest template name it starts with.
 */
function matchTemplate(pageObjectName: string, templates: Template[]): Template | undefined {
  let best: Template | undefined;
  for (const template of templates) {
    const matches = pageObjectName === template.name || pageObjectName.startsWith(`${template.name}_`);
    if (matches && (!best || template.name.length > best.name.length)) {
      best = template;
    }
  }
  return best;
}

interface BundlePlan {
  renames: PageObjectRename[];
  unmatched: string[];
}

function planBundle(bundleDir: string, bundleName: string): BundlePlan {
  const plan: BundlePlan = { renames: [], unmatched: [] };
  const templatesByFolder = findTemplates(bundleDir);
  assertNoRulesOutputDir(templatesByFolder.keys());
  for (const [folder, templates] of templatesByFolder) {
    const utamDir = path.join(folder, '__utam__');
    let files: string[];
    try {
      files = fs.readdirSync(utamDir).filter((file) => file.endsWith(UTAM_EXT));
    } catch {
      continue;
    }

    // Files a previous run already renamed match no template by name, but are expected here.
    const renamedPrefixes = templates
      .filter((template) => template.name !== bundleName)
      .map((template) => secondaryPageObjectName(bundleName, template.name));

    for (const file of files.sort()) {
      const pageObjectName = file.slice(0, -UTAM_EXT.length);
      const template = matchTemplate(pageObjectName, templates);
      if (!template) {
        const alreadyRenamed = renamedPrefixes.some(
          (prefix) => pageObjectName === prefix || pageObjectName.startsWith(`${prefix}_`),
        );
        if (!alreadyRenamed) {
          plan.unmatched.push(path.join(utamDir, file));
        }
        continue;
      }
      if (template.name === bundleName) {
        continue;
      }
      const name = secondaryPageObjectName(bundleName, template.name) + pageObjectName.slice(template.name.length);
      plan.renames.push({
        template: template.file,
        from: path.join(utamDir, file),
        to: path.join(utamDir, `${name}${UTAM_EXT}`),
        name,
      });
    }
  }
  return plan;
}

/** Every LWC bundle folder under the source directories, or the project's package directories. */
function findBundles(rootDir: string, explicitSourceDirs?: string[]): string[] {
  let sourceDirs = explicitSourceDirs;
  if (!sourceDirs || sourceDirs.length === 0) {
    const discovered = discoverProject(rootDir);
    sourceDirs = discovered.packageDirectories.length > 0 ? discovered.packageDirectories : ['./sfdx-source'];
  }

  const bundles = new Set<string>();
  for (const sourceDir of sourceDirs) {
    const resolvedSource = path.isAbsolute(sourceDir) ? sourceDir : path.resolve(rootDir, sourceDir);
    for (const lwcDir of findLwcDirectories(resolvedSource)) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(lwcDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== '__tests__') {
          bundles.add(path.join(lwcDir, entry.name));
        }
      }
    }
  }
  return [...bundles].sort();
}

/** Every page object the compiler will read, per `utam.config.json`'s root and file mask. */
function compiledSources(rootDir: string, utamConfigPath: string): string[] {
  const config = readJsonConfig(utamConfigPath) ?? {};
  const configDir = fs.existsSync(utamConfigPath) ? path.dirname(utamConfigPath) : rootDir;
  const pageObjectsRoot = path.resolve(
    configDir,
    typeof config['pageObjectsRootDir'] === 'string' ? config['pageObjectsRootDir'] : '.',
  );
  const masks = Array.isArray(config['pageObjectsFileMask'])
    ? (config['pageObjectsFileMask'] as unknown[]).filter((mask): mask is string => typeof mask === 'string')
    : DEFAULT_PAGE_OBJECTS_FILE_MASK;

  const files = new Set<string>();
  for (const mask of masks) {
    for (const file of fs.globSync(mask, {
      cwd: pageObjectsRoot,
      exclude: (name: string) => name === 'node_modules',
    })) {
      files.add(path.join(pageObjectsRoot, file));
    }
  }
  return [...files];
}

/** Final names that more than one source would compile to, compared ignoring case. */
function findCollisions(
  renames: PageObjectRename[],
  rootDir: string,
  utamConfigPath: string,
): PageObjectNameCollision[] {
  const renamedFrom = new Map(renames.map((rename) => [path.resolve(rename.from), rename]));
  // A target this stage wrote on an earlier run is replaced by its rename, so it is not a second
  // source. Any other file already at a target is someone's page object, and it collides.
  const replacedTargets = new Set(
    renames
      .map((rename) => path.resolve(rename.to))
      .filter((target) => !fs.existsSync(target) || isRenamedByThisStage(target)),
  );
  const byName = new Map<string, { name: string; sources: string[] }>();
  const add = (name: string, source: string): void => {
    const entry = byName.get(name.toLowerCase()) ?? { name, sources: [] };
    entry.sources.push(source);
    byName.set(name.toLowerCase(), entry);
  };

  const sources = new Set([
    ...compiledSources(rootDir, utamConfigPath).map((file) => path.resolve(file)),
    ...renamedFrom.keys(),
  ]);
  for (const source of [...sources].sort()) {
    const rename = renamedFrom.get(source);
    if (rename) {
      add(rename.name, source);
    } else if (!replacedTargets.has(source)) {
      add(path.basename(source, UTAM_EXT), source);
    }
  }

  return [...byName.values()].filter((entry) => entry.sources.length > 1);
}

/** The description's text lines, whichever of UTAM's shapes it has (a string, or an object with `text`). */
function descriptionText(json: Record<string, unknown>): unknown[] {
  const description = json['description'];
  if (typeof description === 'string') {
    return [description];
  }
  if (description && typeof description === 'object' && !Array.isArray(description)) {
    const text = (description as Record<string, unknown>)['text'];
    return Array.isArray(text) ? text : [];
  }
  return [];
}

/**
 * Rewrites the generator's `Page Object: <old>` description entry to the new name, and adds the
 * {@link RENAMED_MARKER} line. Other text is kept, including a description set through generator config.
 */
function renameDescription(json: Record<string, unknown>, oldName: string, newName: string): void {
  const text = descriptionText(json).map((line) =>
    line === `Page Object: ${oldName}` ? `Page Object: ${newName}` : line,
  );
  text.push(`${RENAMED_MARKER}${oldName}`);

  const description = json['description'];
  if (description && typeof description === 'object' && !Array.isArray(description)) {
    (description as Record<string, unknown>)['text'] = text;
  } else {
    json['description'] = { text };
  }
}

/** Whether `file` is a page object this stage wrote, which a rename may replace. */
function isRenamedByThisStage(file: string): boolean {
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return false;
    }
    return descriptionText(json as Record<string, unknown>).some(
      (line) => typeof line === 'string' && line.startsWith(RENAMED_MARKER),
    );
  } catch {
    return false;
  }
}

/**
 * The renamed page object's content, with its description updated and its formatting kept.
 *
 * @throws Naming the file, when it is not valid JSON.
 */
function renderRename(rename: PageObjectRename): string {
  const content = fs.readFileSync(rename.from, 'utf-8');
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Cannot rename ${rename.from}: ${(error as Error).message}. Nothing was renamed.`, {
      cause: error,
    });
  }
  renameDescription(json, path.basename(rename.from, UTAM_EXT), rename.name);

  let output = JSON.stringify(json, null, detectIndentation(content));
  if (content.endsWith('\n') && !output.endsWith('\n')) {
    output += '\n';
  }
  return output;
}

/**
 * Renames the page objects `utam-generate` wrote for an LWC bundle's secondary templates to
 * `<bundle><Template>`, so same-named templates in different bundles stop compiling to one file.
 * The primary template, the one named after the bundle, keeps its name. Frame page objects
 * (`<template>_<frame>`) take the same prefix.
 *
 * Runs after `utam-generate` and `applyUtamOverrides`, which still see the generated names. Skips
 * when there is no generator config, since the page objects are then not generated. Renames nothing
 * when a final name would collide with another page object the compiler reads.
 *
 * @param options - Naming options.
 * @returns The renames, any collisions, and page objects that match no template.
 * @throws When a config file is not valid JSON, when the generator config or a rules file beside a
 * template does not write page objects into `__utam__` beside each template, or when a page object to
 * rename is not valid JSON. Nothing is renamed in any of these cases.
 */
export function nameSecondaryPageObjects(
  options: NameSecondaryPageObjectsOptions = {},
): NameSecondaryPageObjectsResult {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const dryRun = Boolean(options.dryRun);
  const result: NameSecondaryPageObjectsResult = { renames: [], collisions: [], unmatched: [], dryRun };

  const generatorConfigPath = path.resolve(rootDir, options.generatorConfigPath ?? 'generator.config.json');
  const generatorConfig = readJsonConfig(generatorConfigPath);
  if (!generatorConfig) {
    result.skipped = `No generator config at ${generatorConfigPath}, so no generated page objects to name`;
    return result;
  }
  assertGeneratorLayout(generatorConfigPath, generatorConfig);

  for (const bundleDir of findBundles(rootDir, options.sourceDirs)) {
    const plan = planBundle(bundleDir, path.basename(bundleDir));
    result.renames.push(...plan.renames);
    result.unmatched.push(...plan.unmatched);
  }

  result.collisions = findCollisions(
    result.renames,
    rootDir,
    path.resolve(rootDir, options.utamConfigPath ?? 'utam.config.json'),
  );
  if (result.collisions.length > 0 || dryRun) {
    return result;
  }

  // Render every file before writing any, so one unreadable page object leaves the folder as it was.
  // Then remove every source before writing any target: one rename's target can be another's source
  // (`B` becomes `aB` while `aB` becomes `aAB`), and removing that source afterwards would delete it.
  const rendered = result.renames.map((rename) => ({ rename, output: renderRename(rename) }));
  for (const { rename } of rendered) {
    fs.rmSync(rename.from);
  }
  for (const { rename, output } of rendered) {
    fs.writeFileSync(rename.to, output, 'utf-8');
  }
  return result;
}
