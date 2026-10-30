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
import { discoverComponentsInPackageDir, discoverProject } from '../discovery/index.js';
import { detectIndentation } from '../overrides/index.js';
import { globFiles } from '../path-utils.js';

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

/** Added to a renamed page object's path while it is written, so the compiler's file mask never matches it. */
const TEMP_EXT = '.tmp';

export interface NameSecondaryPageObjectsOptions {
  rootDir?: string;
  sourceDirs?: string[];
  /** The `utam-generate` config, relative to `rootDir`. Defaults to `generator.config.json`. */
  generatorConfigPath?: string;
  /** The compiler config whose `pageObjectsFileMask` sets the collision check's scope. Defaults to `utam.config.json`. */
  utamConfigPath?: string;
  dryRun?: boolean;
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
  /** Final names a rename shares with another page object. Non-empty means nothing was renamed. */
  collisions: PageObjectNameCollision[];
  /**
   * What the stage could not fix: page objects that already shared a name before any rename, a
   * generator config that writes one output folder (the stage then skips), and templates whose rules
   * file sends their page objects outside `__utam__` (those templates are left alone).
   */
  warnings: string[];
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
 * Checks that the generator writes page objects into a `__utam__` folder beside each template, the
 * layout this stage (like `overrides`) reads them from. With a single output folder the generator
 * overwrites same-named templates itself, before any stage could rename them, so there is nothing
 * left for this stage to fix.
 *
 * @returns A warning when the layout is another one, otherwise `undefined`.
 */
function checkGeneratorLayout(configPath: string, config: Record<string, unknown>): string | undefined {
  const effective = { ...GENERATOR_DEFAULTS, ...config };
  const wrong = (Object.keys(EXPECTED_LAYOUT) as Array<keyof typeof EXPECTED_LAYOUT>).filter((key) =>
    key === 'outputDir' ? !isUtamFolder(effective.outputDir) : effective[key] !== EXPECTED_LAYOUT[key],
  );
  if (wrong.length === 0) {
    return undefined;
  }
  const found = wrong.map((key) => `${key}: ${JSON.stringify(effective[key])}`).join(', ');
  return `${configPath} does not write page objects into __utam__ beside each template (found ${found}), so the generator overwrites same-named templates itself and page objects were not named per component. Set "outputDir": "__utam__", "relativeOutputDir": true and "outputFileExtension": ".utam.json".`;
}

/** Whether an `outputDir` value names the `__utam__` folder, however it is spelled (`./__utam__`, `__utam__/`). */
function isUtamFolder(outputDir: unknown): boolean {
  return (
    typeof outputDir === 'string' && path.normalize(outputDir).replace(/[\\/]+$/, '') === EXPECTED_LAYOUT.outputDir
  );
}

/**
 * Finds the templates in `folder` whose rules file sets its own `outputDir`. The generator honours
 * it, so that template's page objects go somewhere other than `__utam__`, where this stage never
 * finds them. The generator gives a rules file to the first template, in the order the file system
 * lists them, whose name (up to its last `.`) the rules file's name starts with, so every such
 * template is counted.
 *
 * @returns The names of those templates, and a warning for each rules file.
 */
function findRulesOutputDirs(folder: string, templates: Template[]): { names: Set<string>; warnings: string[] } {
  const found = { names: new Set<string>(), warnings: [] as string[] };
  let files: string[];
  try {
    files = fs.readdirSync(folder).filter((file) => file.endsWith('.rules.json'));
  } catch {
    return found;
  }
  for (const file of files.sort()) {
    const rulesPath = path.join(folder, file);
    const outputDir = readJsonConfig(rulesPath)?.['outputDir'];
    if (outputDir === undefined || isUtamFolder(outputDir)) {
      continue;
    }
    const rulesName = path.parse(file).name;
    const claimants = templates.filter((template) => rulesName.startsWith(path.parse(template.file).name));
    if (claimants.length === 0) {
      continue;
    }
    for (const template of claimants) {
      found.names.add(template.name);
    }
    const listed = claimants.map((template) => path.basename(template.file)).join(', ');
    const pairs =
      claimants.length === 1
        ? `the generator writes the page objects of ${listed} outside __utam__, so they`
        : `the generator writes the page objects of one of ${listed} (the first it finds) outside __utam__, so all of their page objects`;
    found.warnings.push(
      `${rulesPath} sets "outputDir": ${JSON.stringify(outputDir)}, and ${pairs} were left with their generated names. Remove "outputDir" from the rules file.`,
    );
  }
  return found;
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

/** The name a page object generated from `template` gets, frame suffix (`_<frame>`) included. */
function renamedName(bundleName: string, template: Template, pageObjectName: string): string {
  return secondaryPageObjectName(bundleName, template.name) + pageObjectName.slice(template.name.length);
}

interface BundlePlan {
  renames: PageObjectRename[];
  unmatched: string[];
  warnings: string[];
}

function planBundle(bundleDir: string, bundleName: string): BundlePlan {
  const plan: BundlePlan = { renames: [], unmatched: [], warnings: [] };
  for (const [folder, templates] of findTemplates(bundleDir)) {
    const rulesOutputDirs = findRulesOutputDirs(folder, templates);
    plan.warnings.push(...rulesOutputDirs.warnings);
    const utamDir = path.join(folder, '__utam__');
    let files: string[];
    try {
      files = fs.readdirSync(utamDir).filter((file) => file.endsWith(UTAM_EXT));
    } catch {
      continue;
    }

    for (const file of files.sort()) {
      const pageObjectName = file.slice(0, -UTAM_EXT.length);
      const from = path.join(utamDir, file);

      // A page object an earlier run renamed is never renamed again. Its new name can read as a frame
      // of another template (`a_bX` as a frame of `a`, in bundle `a_b`) or as a template's own name
      // (`aB`, from `B.html`, when the bundle also has `aB.html`). It is expected here while its
      // template would still give it this name, and is listed as unmatched once it would not.
      const original = renamedFrom(from);
      if (original !== undefined) {
        const originalTemplate = matchTemplate(original, templates);
        if (!originalTemplate || renamedName(bundleName, originalTemplate, original) !== pageObjectName) {
          plan.unmatched.push(from);
        }
        continue;
      }

      const template = matchTemplate(pageObjectName, templates);
      if (!template) {
        plan.unmatched.push(from);
        continue;
      }
      // A page object of a template whose rules file sends its output elsewhere is one an earlier
      // layout left here, and is left alone like the template.
      if (template.name === bundleName || rulesOutputDirs.names.has(template.name)) {
        continue;
      }
      const name = renamedName(bundleName, template, pageObjectName);
      plan.renames.push({ template: template.file, from, to: path.join(utamDir, `${name}${UTAM_EXT}`), name });
    }
  }
  return plan;
}

/**
 * Orders paths the same way on every platform. A plain sort compares the separator too, and `\`
 * sorts after letters where `/` sorts before them, so `lwc\aB\…` would come before `lwc\a\…` on
 * Windows only, and results would list bundles and collision sources in a different order there.
 */
function comparePaths(a: string, b: string): number {
  const left = a.split(path.sep).join('/');
  const right = b.split(path.sep).join('/');
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Every LWC bundle folder under the source directories, or the project's package directories. */
function findBundles(rootDir: string, explicitSourceDirs?: string[]): string[] {
  let sourceDirs = explicitSourceDirs;
  if (!sourceDirs || sourceDirs.length === 0) {
    const discovered = discoverProject(rootDir);
    sourceDirs = discovered.packageDirectories.length > 0 ? discovered.packageDirectories : ['./sfdx-source'];
  }

  const bundles = new Set(
    sourceDirs.flatMap((sourceDir) =>
      discoverComponentsInPackageDir(sourceDir, rootDir).map((component) => component.directory),
    ),
  );
  return [...bundles].sort(comparePaths);
}

/** Every page object the compiler will read, per `utam.config.json`'s root and file mask. */
function compiledSources(utamConfigPath: string): string[] {
  const config = readJsonConfig(utamConfigPath) ?? {};
  const pageObjectsRoot = path.resolve(
    path.dirname(utamConfigPath),
    typeof config['pageObjectsRootDir'] === 'string' ? config['pageObjectsRootDir'] : '.',
  );
  const masks = Array.isArray(config['pageObjectsFileMask'])
    ? (config['pageObjectsFileMask'] as unknown[]).filter((mask): mask is string => typeof mask === 'string')
    : DEFAULT_PAGE_OBJECTS_FILE_MASK;
  return globFiles(pageObjectsRoot, masks);
}

/**
 * Final names that more than one source would compile to, compared ignoring case.
 *
 * @returns The ones a rename takes part in, now or on an earlier run, which stop the stage, apart
 * from those that were there before any rename, which the stage did not cause and does not fix.
 */
function findCollisions(
  renames: PageObjectRename[],
  utamConfigPath: string,
): { caused: PageObjectNameCollision[]; existing: PageObjectNameCollision[] } {
  const renameBySource = new Map(renames.map((rename) => [path.resolve(rename.from), rename]));
  // A target this stage wrote on an earlier run is replaced by its rename, so it is not a second
  // source. Any other file already at a target is someone's page object, and it collides.
  const replacedTargets = new Set(
    renames
      .map((rename) => path.resolve(rename.to))
      .filter((target) => !fs.existsSync(target) || renamedFrom(target) !== undefined),
  );
  const byName = new Map<string, { name: string; sources: string[] }>();
  const add = (name: string, source: string): void => {
    const entry = byName.get(name.toLowerCase()) ?? { name, sources: [] };
    entry.sources.push(source);
    byName.set(name.toLowerCase(), entry);
  };

  const sources = new Set([
    ...compiledSources(utamConfigPath).map((file) => path.resolve(file)),
    ...renameBySource.keys(),
  ]);
  for (const source of [...sources].sort(comparePaths)) {
    const rename = renameBySource.get(source);
    if (rename) {
      add(rename.name, source);
    } else if (!replacedTargets.has(source)) {
      add(path.basename(source, UTAM_EXT), source);
    }
  }

  // A page object an earlier run renamed counts as a rename too: run again without `utam-generate`,
  // its source is gone, but the clash is still one the stage made.
  const isRename = (source: string): boolean => renameBySource.has(source) || renamedFrom(source) !== undefined;
  const collisions = [...byName.values()].filter((entry) => entry.sources.length > 1);
  return {
    caused: collisions.filter((entry) => entry.sources.some(isRename)),
    existing: collisions.filter((entry) => !entry.sources.some(isRename)),
  };
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

/**
 * The generated name of a page object this stage wrote, read from its {@link RENAMED_MARKER} line.
 *
 * @returns The name, or `undefined` when `file` is not one this stage wrote (or is not valid JSON).
 */
function renamedFrom(file: string): string | undefined {
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return undefined;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return undefined;
  }
  const marker = descriptionText(json as Record<string, unknown>).find(
    (line): line is string => typeof line === 'string' && line.startsWith(RENAMED_MARKER),
  );
  return marker?.slice(RENAMED_MARKER.length);
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
 * Moves each page object to its new name without losing one when a write fails partway (a full disk,
 * or a file a virus scanner holds open on Windows).
 *
 * Every renamed file is rendered, then written beside its target as a temporary file, before any page
 * object changes, so an unreadable page object or a failed write leaves the folders as they were. The
 * temporary files are then moved into place, longest name first: one rename's target can be another's
 * source (`B` becomes `aB` while `aB` becomes `aAB`), and a rename's target is always longer than its
 * source, so a source's own rename is in place before another rename replaces it. Each target is
 * removed before its temporary file moves in, so the new file takes the target's spelling: on a
 * case-insensitive file system, moving onto `ab` would otherwise keep the name `ab` for `aB`. That is
 * safe, as the collision check leaves only a file this stage wrote, or a source already renamed, at a
 * target. A failure there leaves every page object under its old name, its new one, or both. Last, the
 * sources no rename replaced are removed. That is read from the file, not the path, because on a
 * case-insensitive file system a target can replace a source spelled differently (`aB` replaces `ab`).
 */
function writeRenames(renames: PageObjectRename[]): void {
  const rendered = renames.map((rename) => ({ rename, output: renderRename(rename), temp: `${rename.to}${TEMP_EXT}` }));
  const written = new Set<string>();
  try {
    for (const { output, temp } of rendered) {
      written.add(temp);
      fs.writeFileSync(temp, output, 'utf-8');
    }
    for (const { rename, temp } of rendered.toSorted((a, b) => b.rename.to.length - a.rename.to.length)) {
      fs.rmSync(rename.to, { force: true });
      fs.renameSync(temp, rename.to);
      written.delete(temp);
    }
  } finally {
    for (const temp of written) {
      fs.rmSync(temp, { force: true });
    }
  }
  for (const { rename } of rendered) {
    if (renamedFrom(rename.from) === undefined) {
      fs.rmSync(rename.from);
    }
  }
}

/**
 * Renames the page objects `utam-generate` wrote for an LWC bundle's secondary templates to
 * `<bundle><Template>`, so same-named templates in different bundles stop compiling to one file.
 * The primary template, the one named after the bundle, keeps its name. Frame page objects
 * (`<template>_<frame>`) take the same prefix.
 *
 * Runs after `utam-generate` and `applyUtamOverrides`, which still see the generated names. Skips
 * when there is no generator config, since the page objects are then not generated, and, with a
 * warning, when the generator config does not write them into `__utam__` beside each template. Leaves
 * a template alone, with a warning, when its rules file sends its page objects elsewhere. Renames
 * nothing when a final name would collide with another page object the compiler reads; page objects
 * that already shared a name before any rename only get a warning.
 *
 * @param options - Naming options.
 * @returns The renames, any collisions, warnings, and page objects that match no template.
 * @throws When a config file or a rules file is not valid JSON, or when a page object to rename is
 * not valid JSON or cannot be written. No page object is lost in any of these cases.
 */
export function nameSecondaryPageObjects(
  options: NameSecondaryPageObjectsOptions = {},
): NameSecondaryPageObjectsResult {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const dryRun = Boolean(options.dryRun);
  const result: NameSecondaryPageObjectsResult = { renames: [], collisions: [], warnings: [], unmatched: [], dryRun };

  const generatorConfigPath = path.resolve(rootDir, options.generatorConfigPath ?? 'generator.config.json');
  const generatorConfig = readJsonConfig(generatorConfigPath);
  if (!generatorConfig) {
    result.skipped = `No generator config at ${generatorConfigPath}, so no generated page objects to name`;
    return result;
  }
  const layoutWarning = checkGeneratorLayout(generatorConfigPath, generatorConfig);
  if (layoutWarning) {
    result.skipped = `${generatorConfigPath} does not write page objects into __utam__ beside each template`;
    result.warnings.push(layoutWarning);
    return result;
  }

  for (const bundleDir of findBundles(rootDir, options.sourceDirs)) {
    const plan = planBundle(bundleDir, path.basename(bundleDir));
    result.renames.push(...plan.renames);
    result.unmatched.push(...plan.unmatched);
    result.warnings.push(...plan.warnings);
  }

  const collisions = findCollisions(
    result.renames,
    path.resolve(rootDir, options.utamConfigPath ?? 'utam.config.json'),
  );
  result.collisions = collisions.caused;
  for (const collision of collisions.existing) {
    const sources = collision.sources.map((source) => path.relative(rootDir, source)).join(', ');
    result.warnings.push(
      `${sources} compile to one file, ${collision.name}, so the compiler keeps only one of them. No rename caused this; rename all but one, or add an "ignore" entry for a generated one's template in the generator config.`,
    );
  }
  if (result.collisions.length > 0 || dryRun) {
    return result;
  }

  writeRenames(result.renames);
  return result;
}
