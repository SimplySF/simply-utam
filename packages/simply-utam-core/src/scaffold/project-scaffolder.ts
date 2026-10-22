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
import { fileURLToPath } from 'node:url';
import { parseSfdxProject, type SfdxProjectDetails } from '../discovery/sfdx-project.js';
import { isAbsoluteOnAnyPlatform, isOutsideProject, toPosixRelative } from '../path-utils.js';
import {
  SIMPLY_UTAM_FORCEIGNORE_RULES,
  ensureForceignore,
  resolveUtamTestIgnoreRules,
  type ForceignoreResult,
} from '../forceignore/index.js';
import { ensureGitignore, type GitignoreResult } from '../gitignore/index.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Default location of external scaffold template files.
 * Resolves to the templates directory in @simplysf/simply-utam-core whether in src or lib.
 */
export const DEFAULT_TEMPLATES_DIR = path.resolve(currentDir, '..', '..', 'templates');

/**
 * Standard recommended devDependencies for consuming UTAM with SimplyUTAM.
 */
export const DEFAULT_REQUIRED_DEV_DEPENDENCIES: string[] = [
  'wireit',
  'utam',
  'salesforce-pageobjects',
  'wdio-utam-service',
  'chromedriver',
  '@wdio/cli',
  '@wdio/local-runner',
  '@wdio/cucumber-framework',
  '@wdio/spec-reporter',
  '@wdio/allure-reporter',
  'allure-commandline',
  '@salesforce/core',
  '@simplysf/simply-utam',
];

/**
 * Options for project scaffolding.
 */
export interface ScaffoldOptions {
  /**
   * Root directory of the consumer project. Defaults to current working directory.
   */
  projectDir?: string;

  /**
   * Primary Salesforce source directory. If not specified, automatically detected from sfdx-project.json.
   */
  sourceDir?: string;

  /**
   * Application name / namespace used in UTAM generator namespaces and namespace maps.
   */
  appName?: string;

  /**
   * Directory containing external template files. Defaults to the package's templates/ folder.
   */
  templatesDir?: string;

  /**
   * If true, previews planned file changes without writing to disk.
   */
  dryRun?: boolean;

  /**
   * If true, forces overwriting of existing config files. Does not affect .forceignore, which is only
   * ever added to.
   */
  force?: boolean;

  /**
   * If false, leaves .forceignore untouched. Defaults to true.
   */
  forceignore?: boolean;

  /**
   * Exact line that starts the .forceignore customization region. Defaults to '# -- START CUSTOMIZATION'.
   */
  forceignoreRegionStart?: string;

  /**
   * Exact line that ends the .forceignore customization region. Defaults to '# -- END CUSTOMIZATION'.
   */
  forceignoreRegionEnd?: string;

  /**
   * If false, leaves .gitignore untouched. Defaults to true.
   */
  gitignore?: boolean;
}

/**
 * Result details from executing project scaffolding.
 */
export interface ScaffoldResult {
  /**
   * Paths of files newly created on disk.
   */
  createdFiles: string[];

  /**
   * Paths of existing files that were preserved without overwrite.
   */
  skippedFiles: string[];

  /**
   * Paths of existing files that were updated (such as package.json).
   */
  modifiedFiles: string[];

  /**
   * The updated package.json representation, if modified.
   */
  updatedPackageJson?: Record<string, unknown>;

  /**
   * List of recommended devDependencies missing from the consumer's package.json.
   */
  missingDependencies: string[];

  /**
   * What happened to .forceignore. Absent when the forceignore option is false.
   */
  forceignore?: ForceignoreResult;

  /**
   * What happened to .gitignore. Absent when the gitignore option is false.
   */
  gitignore?: GitignoreResult;

  /**
   * True when an existing wdio.conf.mjs was kept and doesn't capture DOM snapshots: its hooks have to
   * be added by hand.
   */
  snapshotHooksMissing: boolean;

  /**
   * What happened to the package.json "exports" entry for page objects. Absent without a package.json.
   */
  pageObjectExports?: PageObjectExportsResult;

  /**
   * Problems scaffolding found but could not fix, such as an existing config that uses a different
   * namespace than the one scaffolding would write.
   */
  warnings: string[];
}

/**
 * What ensurePageObjectExports did to package.json "exports": 'added' when the entry was written,
 * 'unchanged' when "exports" already has it, 'skipped' when it could not be added safely.
 *
 * subpath is the "exports" key for page objects, such as './pageObjects/*'; a skipped result has none
 * when the page object folder can't be exported. createdExports is true when package.json had no
 * "exports" and now has one, which closes the package to imports of its root and of any subpath it
 * does not list. reason says why the entry was skipped.
 */
export type PageObjectExportsResult =
  | { action: 'added'; subpath: string; createdExports: boolean }
  | { action: 'unchanged'; subpath: string; createdExports: false }
  | { action: 'skipped'; subpath?: string; createdExports: false; reason: string };

/**
 * Loads an external template file from disk, performing token replacements.
 *
 * @param templateName - The filename of the template to load.
 * @param templatesDir - The directory containing template files.
 * @param tokens - Key-value replacements for {{token}} placeholders.
 * @returns The resolved template content string.
 * @throws If the template file does not exist.
 */
export function loadTemplate(
  templateName: string,
  templatesDir = DEFAULT_TEMPLATES_DIR,
  tokens: Record<string, string> = {},
): string {
  const filePath = path.join(templatesDir, templateName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Scaffold template not found: '${filePath}'`);
  }

  let content = fs.readFileSync(filePath, 'utf-8');
  for (const [key, value] of Object.entries(tokens)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    content = content.replace(pattern, value);
  }
  return content;
}

/**
 * Generates the generator.config.json content by loading its external template.
 *
 * @param sourceDir - The Salesforce source directory.
 * @param appName - The application namespace name.
 * @param templatesDir - Optional custom directory containing the template file.
 * @returns Parsed JSON object for generator.config.json.
 */
export function generateGeneratorConfig(
  sourceDir: string,
  appName: string,
  templatesDir = DEFAULT_TEMPLATES_DIR,
): Record<string, unknown> {
  const source = toPosixRelative(sourceDir);
  const raw = loadTemplate('generator.config.json', templatesDir, {
    sourceDir: source,
    appName,
  });
  const config = JSON.parse(raw) as Record<string, unknown>;
  // The template prefixes the source with './', which is wrong for an absolute path, such as a source
  // folder on another Windows drive than the project.
  if (isAbsoluteOnAnyPlatform(source) && 'inputRootDir' in config) {
    config['inputRootDir'] = source;
  }
  return config;
}

/**
 * Generates the utam.config.json content by loading its external template.
 *
 * @param templatesDir - Optional custom directory containing the template file.
 * @returns Parsed JSON object for utam.config.json.
 */
export function generateUtamConfig(templatesDir = DEFAULT_TEMPLATES_DIR): Record<string, unknown> {
  const raw = loadTemplate('utam.config.json', templatesDir);
  return JSON.parse(raw) as Record<string, unknown>;
}

/**
 * Generates the wdio.conf.mjs configuration script content by loading its external template.
 *
 * @param sourceDir - The primary Salesforce source directory.
 * @param templatesDir - Optional custom directory containing the template file.
 * @returns Formatted JavaScript module text for wdio.conf.mjs.
 */
export function generateWdioConfig(sourceDir: string, templatesDir = DEFAULT_TEMPLATES_DIR): string {
  return loadTemplate('wdio.conf.mjs', templatesDir, {
    sourceDir: toPosixRelative(sourceDir) || '.',
  });
}

/**
 * Generates the .utam/namespace-map.json content by loading its external template.
 *
 * @param appName - The application namespace name.
 * @param templatesDir - Optional custom directory containing the template file.
 * @returns Parsed JSON object for namespace-map.json.
 */
export function generateNamespaceMap(appName: string, templatesDir = DEFAULT_TEMPLATES_DIR): Record<string, unknown> {
  const raw = loadTemplate('namespace-map.json', templatesDir, {
    appName,
  });
  return JSON.parse(raw) as Record<string, unknown>;
}

/**
 * Generates the hello.feature starter Gherkin feature file content by loading its external template.
 *
 * @param templatesDir - Optional custom directory containing the template file.
 * @returns Formatted Gherkin feature file text for hello.feature.
 */
export function generateHelloFeature(templatesDir = DEFAULT_TEMPLATES_DIR): string {
  try {
    return loadTemplate('hello.feature', templatesDir);
  } catch {
    return `Feature: Salesforce UI Smoke Test\n\n  Scenario: Log in and navigate to Salesforce Home\n    Given I open the Salesforce application "Sales"\n`;
  }
}

/**
 * Generates the hello.steps.mjs starter Cucumber step definition script content by loading its external template.
 *
 * @param templatesDir - Optional custom directory containing the template file.
 * @returns Formatted JavaScript module text for hello.steps.mjs.
 */
export function generateHelloSteps(templatesDir = DEFAULT_TEMPLATES_DIR): string {
  try {
    return loadTemplate('hello.steps.mjs', templatesDir);
  } catch {
    return `import { Given } from '@wdio/cucumber-framework';\nimport { goToApplication } from '@simplysf/simply-utam';\n\nGiven('I open the Salesforce application {string}', async (appName) => {\n  // Authenticates via Salesforce CLI frontdoor URL and opens the application home page\n  await goToApplication(appName);\n});\n`;
  }
}

/**
 * Generates the SNAPSHOTS.md usage guide for DOM snapshots by loading its external template.
 *
 * @param templatesDir - Optional custom directory containing the template file.
 * @returns The guide's Markdown text.
 */
export function generateSnapshotGuide(templatesDir = DEFAULT_TEMPLATES_DIR): string {
  return loadTemplate('SNAPSHOTS.md', templatesDir);
}

/**
 * Generates the dom-snapshot.steps.mjs step definitions (`I capture the DOM snapshot`) by loading
 * their external template.
 *
 * @param templatesDir - Optional custom directory containing the template file.
 * @returns The step definitions' JavaScript module text.
 */
export function generateSnapshotSteps(templatesDir = DEFAULT_TEMPLATES_DIR): string {
  return loadTemplate('dom-snapshot.steps.mjs', templatesDir);
}

/**
 * Non-destructively injects standard UTAM Wireit scripts and task configurations into a package.json object.
 * Loads task definitions from external wireit.json template.
 *
 * @param packageJson - The existing package.json object.
 * @param templatesDir - Optional custom directory containing the template file.
 * @returns An object containing the modified package.json and lists of added keys.
 */
export function injectWireitConfiguration(
  packageJson: Record<string, unknown>,
  templatesDir = DEFAULT_TEMPLATES_DIR,
): {
  updated: boolean;
  packageJson: Record<string, unknown>;
  addedScripts: string[];
  addedTasks: string[];
} {
  const result = JSON.parse(JSON.stringify(packageJson)) as Record<string, unknown>;
  result['scripts'] ??= {};
  result['wireit'] ??= {};
  const scripts = result['scripts'] as Record<string, unknown>;
  const wireit = result['wireit'] as Record<string, unknown>;

  const rawWireitTemplate = loadTemplate('wireit.json', templatesDir);
  const wireitConfig = JSON.parse(rawWireitTemplate) as {
    scripts?: Record<string, string>;
    wireit?: Record<string, unknown>;
  };

  const standardScripts = wireitConfig.scripts ?? {};
  const standardTasks = wireitConfig.wireit ?? {};

  const addedScripts: string[] = [];
  for (const [scriptName, scriptCommand] of Object.entries(standardScripts)) {
    if (!scripts[scriptName]) {
      scripts[scriptName] = scriptCommand;
      addedScripts.push(scriptName);
    }
  }

  const addedTasks: string[] = [];
  for (const [taskName, taskConfig] of Object.entries(standardTasks)) {
    if (!wireit[taskName]) {
      wireit[taskName] = taskConfig;
      addedTasks.push(taskName);
    }
  }

  const updated = addedScripts.length > 0 || addedTasks.length > 0;
  return { updated, packageJson: result, addedScripts, addedTasks };
}

/**
 * Adds the package.json "exports" entry that lets compiled page objects import each other. The UTAM
 * compiler writes those imports as extensionless subpaths of the project's own package name
 * ('my-app/pageObjects/bar'), taken from the generator namespace, which Node resolves only through
 * "exports", so the entry maps them to the .js files in the output folder. Only ever adds the one key:
 * an existing entry is never changed, and an "exports" that can't be extended without restructuring it
 * is left alone.
 *
 * @param packageJson - The existing package.json object.
 * @param outputDir - The page object output folder, pageObjectsOutputDir in utam.config.json.
 * @param importDir - The part of the namespace after the package name, 'pageObjects' for 'my-app/pageObjects/'.
 * @returns The package.json object, updated or as given, and what was done.
 */
export function ensurePageObjectExports(
  packageJson: Record<string, unknown>,
  outputDir = 'pageObjects',
  importDir = 'pageObjects',
): { packageJson: Record<string, unknown>; result: PageObjectExportsResult } {
  const skip = (reason: string, subpath?: string): ReturnType<typeof ensurePageObjectExports> => ({
    packageJson,
    result: { action: 'skipped', subpath, createdExports: false, reason },
  });
  const dir = toPosixRelative(outputDir);
  if (!dir || isOutsideProject(dir)) {
    return skip(`the page object folder "${outputDir}" is not inside the project, so it can't be exported`);
  }
  const imports = toPosixRelative(importDir);
  if (isOutsideProject(imports)) {
    return skip(`the namespace path "${importDir}" is not a subpath of the package, so it can't be exported`);
  }
  const subpath = imports ? `./${imports}/*` : './*';
  const target = `./${dir}/*.js`;

  const exportsField = packageJson['exports'];
  if (exportsField === undefined) {
    return {
      packageJson: { ...packageJson, exports: { [subpath]: target } },
      result: { action: 'added', subpath, createdExports: true },
    };
  }
  if (exportsField === null || typeof exportsField !== 'object' || Array.isArray(exportsField)) {
    return skip(`"exports" is not an object of subpaths`, subpath);
  }
  const keys = Object.keys(exportsField);
  if (keys.some((key) => !key.startsWith('.'))) {
    return skip(`"exports" is an object of conditions, not subpaths`, subpath);
  }
  // Only the exact key counts: a broader pattern such as "./*": "./*" may map to the extensionless path,
  // and the more specific key added here takes precedence over it.
  if (keys.includes(subpath)) {
    return { packageJson, result: { action: 'unchanged', subpath, createdExports: false } };
  }
  return {
    packageJson: { ...packageJson, exports: { ...exportsField, [subpath]: target } },
    result: { action: 'added', subpath, createdExports: false },
  };
}

/**
 * Checks a package.json object for missing recommended devDependencies.
 *
 * @param packageJson - The target package.json object.
 * @param requiredDependencies - Optional list of required dependency names.
 * @returns Array of dependency names missing from both devDependencies and dependencies.
 */
export function checkMissingDependencies(
  packageJson: Record<string, unknown>,
  requiredDependencies = DEFAULT_REQUIRED_DEV_DEPENDENCIES,
): string[] {
  const devDeps = (packageJson['devDependencies'] as Record<string, string>) || {};
  const deps = (packageJson['dependencies'] as Record<string, string>) || {};

  return requiredDependencies.filter((dep) => !devDeps[dep] && !deps[dep]);
}

function resolveSourceDir(sfdxProject: SfdxProjectDetails, explicitSourceDir?: string): string {
  if (explicitSourceDir) {
    return explicitSourceDir;
  }
  if (sfdxProject.sfdxProjectFile && sfdxProject.packageDirectories.length > 0) {
    return sfdxProject.defaultPackageDirectory ?? sfdxProject.packageDirectories[0];
  }
  if (sfdxProject.packageDirectories.length > 0) {
    return sfdxProject.packageDirectories[0];
  }
  return 'force-app';
}

// The full package name, scope included: page objects import each other by this name, and Node only
// resolves a package's own name when it matches package.json "name" exactly.
function resolveAppName(packageJsonData: Record<string, unknown> | null, explicitAppName?: string): string {
  if (explicitAppName) {
    return explicitAppName;
  }
  if (typeof packageJsonData?.['name'] === 'string') {
    return packageJsonData['name'];
  }
  return 'salesforce-app';
}

/**
 * Reads a config file that scaffolding keeps, which is any that exists unless force is set. Undefined
 * when the file is written fresh or can't be parsed as a JSON object.
 */
function readKeptConfig(projectDir: string, relativePath: string, force: boolean): Record<string, unknown> | undefined {
  const filePath = path.join(projectDir, relativePath);
  if (force || !fs.existsSync(filePath)) {
    return undefined;
  }
  try {
    const config: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return config !== null && typeof config === 'object' ? (config as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The namespace page objects are generated under: the one in a generator.config.json that scaffolding
 * keeps, or the one it writes from appName.
 */
function resolveNamespace(projectDir: string, force: boolean, appName: string): { namespace: string; kept: boolean } {
  const namespaces = readKeptConfig(projectDir, 'generator.config.json', force)?.['namespaces'];
  const namespace = (namespaces as Record<string, unknown> | undefined)?.['c'];
  return typeof namespace === 'string'
    ? { namespace, kept: true }
    : { namespace: `${appName}/pageObjects/`, kept: false };
}

/**
 * The page object output folder: pageObjectsOutputDir from the kept utam.config.json, or from the one
 * init writes when there is none or it can't be read.
 */
function resolvePageObjectsOutputDir(projectDir: string, force: boolean, utamConfig: Record<string, unknown>): string {
  const outputDir = (readKeptConfig(projectDir, 'utam.config.json', force) ?? utamConfig)['pageObjectsOutputDir'];
  return typeof outputDir === 'string' ? outputDir : 'pageObjects';
}

/**
 * Moves namespace map keys from the namespace scaffolding derives from appName to the one page objects
 * are actually generated under, so a kept generator.config.json and a new map agree.
 */
function rebaseNamespaceMap(map: Record<string, unknown>, from: string, to: string): Record<string, unknown> {
  if (from === to) {
    return map;
  }
  return Object.fromEntries(
    Object.entries(map).map(([key, value]) => [key.startsWith(from) ? to + key.slice(from.length) : key, value]),
  );
}

/**
 * Explains why imports under a namespace outside the package name can't resolve. A kept
 * generator.config.json with the namespace older versions derived from a scoped package name, which
 * dropped the scope ("my-app" for "@acme/my-app"), gets the commands that fix or keep it.
 */
function namespaceMismatchWarning(namespace: string, kept: boolean, packageName: unknown, appName: string): string {
  if (typeof packageName === 'string') {
    const stripped = packageName.replace(/^@[^/]+\//, '');
    if (kept && stripped !== packageName && stripped !== appName && namespace === `${stripped}/pageObjects/`) {
      return (
        `generator.config.json uses the namespace "${stripped}", which drops the scope from "${packageName}", ` +
        `so page object imports cannot resolve by the package's own name. Re-run with --force to use ` +
        `"${appName}", or keep the old namespace with --app-name ${stripped}.`
      );
    }
  }
  // The package part of the namespace: two segments when scoped, one otherwise.
  const alias = namespace
    .split('/')
    .slice(0, namespace.startsWith('@') ? 2 : 1)
    .join('/');
  const where = kept ? ' in generator.config.json' : '';
  if (alias === packageName) {
    return (
      `The namespace "${namespace}"${where} has no path after the package name, so page object imports ` +
      `cannot map to files through "exports". Use "${alias}/pageObjects/".`
    );
  }
  const named = typeof packageName === 'string' ? `the package name "${packageName}"` : 'no package name';
  return (
    `The namespace "${alias}"${where} differs from ${named}, so page object imports cannot resolve through ` +
    `"exports". Use the package name, or alias the namespace with a dependency ("${alias}": "file:." ` +
    `with npm, "link:." with pnpm) and a loader that resolves extensionless paths.`
  );
}

/**
 * Plans the page object "exports" entry. Skipped when the namespace is not under the package name,
 * because a package resolves only its own name through "exports".
 */
function planPageObjectExports(
  packageJson: Record<string, unknown>,
  generated: { namespace: string; kept: boolean },
  appName: string,
  outputDir: string,
): { packageJson: Record<string, unknown>; result: PageObjectExportsResult; warning?: string } {
  const { namespace, kept } = generated;
  const packageName = packageJson['name'];
  if (typeof packageName !== 'string' || !namespace.startsWith(`${packageName}/`)) {
    return {
      packageJson,
      result: { action: 'skipped', createdExports: false, reason: 'the namespace is not under the package name' },
      warning: namespaceMismatchWarning(namespace, kept, packageName, appName),
    };
  }
  const planned = ensurePageObjectExports(packageJson, outputDir, namespace.slice(packageName.length + 1));
  if (planned.result.action !== 'skipped') {
    return planned;
  }
  const { subpath, reason } = planned.result;
  const advice = subpath
    ? ` Add "${subpath}" to it yourself, mapped to the .js files, so page objects can import each other.`
    : '';
  return { ...planned, warning: `Did not change package.json "exports": ${reason}.${advice}` };
}

/**
 * Plans the package.json changes: the Wireit tasks and the page object "exports" entry. packageJson is
 * absent when neither changes anything.
 */
function updatePackageJson(
  packageJsonData: Record<string, unknown>,
  templatesDir: string,
  generated: { namespace: string; kept: boolean },
  appName: string,
  outputDir: string,
): { packageJson?: Record<string, unknown>; pageObjectExports: PageObjectExportsResult; warning?: string } {
  const injection = injectWireitConfiguration(packageJsonData, templatesDir);
  const planned = planPageObjectExports(injection.packageJson, generated, appName, outputDir);
  const changed = injection.updated || planned.result.action === 'added';
  return {
    packageJson: changed ? planned.packageJson : undefined,
    pageObjectExports: planned.result,
    warning: planned.warning,
  };
}

function writeScaffoldFiles(
  projectDir: string,
  filesToCreate: Array<{ relativePath: string; content: string }>,
  force: boolean,
  dryRun: boolean,
): { createdFiles: string[]; skippedFiles: string[] } {
  const createdFiles: string[] = [];
  const skippedFiles: string[] = [];

  for (const item of filesToCreate) {
    // resolve, not join: relativePath is absolute when the source folder is on another Windows drive.
    const targetPath = path.resolve(projectDir, item.relativePath);
    if (fs.existsSync(targetPath) && !force) {
      skippedFiles.push(item.relativePath);
    } else {
      createdFiles.push(item.relativePath);
      if (!dryRun) {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, item.content, 'utf-8');
      }
    }
  }

  return { createdFiles, skippedFiles };
}

/**
 * Plans the hello-world test files and lists the UTAM test folders the project will have.
 * The starter files are only scaffolded when no UTAM test folder exists yet, unless forced.
 */
function planUtamTests(
  projectDir: string,
  sourceDir: string,
  templatesDir: string,
  force: boolean,
): { files: Array<{ relativePath: string; content: string }>; testDirs: string[] } {
  const scaffoldDir = path.join(sourceDir, 'test', 'utam');
  const candidateUtamDirs = [
    scaffoldDir,
    path.join(sourceDir, 'tests', 'utam'),
    path.join('test', 'utam'),
    path.join('tests', 'utam'),
  ];
  const existingUtamDirs = candidateUtamDirs.filter((dir) => fs.existsSync(path.resolve(projectDir, dir)));

  if (existingUtamDirs.length > 0 && !force) {
    return { files: [], testDirs: existingUtamDirs };
  }

  return {
    files: [
      {
        relativePath: path.join(scaffoldDir, 'features', 'hello.feature'),
        content: generateHelloFeature(templatesDir),
      },
      {
        relativePath: path.join(scaffoldDir, 'step_definitions', 'hello.steps.mjs'),
        content: generateHelloSteps(templatesDir),
      },
    ],
    testDirs: [...existingUtamDirs, scaffoldDir],
  };
}

/**
 * The DOM snapshot guide and capture step, in the UTAM test folder. They're new files, so an existing
 * project gets them too.
 */
function planSnapshotFiles(testDir: string, templatesDir: string): Array<{ relativePath: string; content: string }> {
  return [
    { relativePath: path.join(testDir, 'SNAPSHOTS.md'), content: generateSnapshotGuide(templatesDir) },
    {
      relativePath: path.join(testDir, 'step_definitions', 'dom-snapshot.steps.mjs'),
      content: generateSnapshotSteps(templatesDir),
    },
  ];
}

/** Whether a wdio.conf.mjs that scaffolding kept captures DOM snapshots on failure. */
function lacksSnapshotHooks(projectDir: string, skippedFiles: string[]): boolean {
  if (!skippedFiles.includes('wdio.conf.mjs')) {
    return false;
  }
  try {
    return !fs.readFileSync(path.join(projectDir, 'wdio.conf.mjs'), 'utf-8').includes('captureDomSnapshot');
  } catch {
    return false;
  }
}

function recordIgnoreFile(
  ignoreFile: ForceignoreResult | GitignoreResult | undefined,
  createdFiles: string[],
  modifiedFiles: string[],
): void {
  if (ignoreFile?.action === 'created') {
    createdFiles.push(ignoreFile.path);
  } else if (ignoreFile?.action === 'appended' || ignoreFile?.action === 'inserted') {
    modifiedFiles.push(ignoreFile.path);
  }
}

function updateForceignore(
  projectDir: string,
  sourceDir: string,
  testDirs: string[],
  sfdxProject: SfdxProjectDetails,
  options?: ScaffoldOptions,
): ForceignoreResult | undefined {
  if (options?.forceignore === false) {
    return undefined;
  }
  const packageDirectories = [...sfdxProject.packageDirectories, sourceDir];
  return ensureForceignore({
    projectDir,
    rules: [...SIMPLY_UTAM_FORCEIGNORE_RULES, ...resolveUtamTestIgnoreRules(testDirs, packageDirectories)],
    regionStart: options?.forceignoreRegionStart,
    regionEnd: options?.forceignoreRegionEnd,
    dryRun: options?.dryRun,
  });
}

function updateGitignore(projectDir: string, options?: ScaffoldOptions): GitignoreResult | undefined {
  if (options?.gitignore === false) {
    return undefined;
  }
  return ensureGitignore({ projectDir, dryRun: options?.dryRun });
}

/**
 * Scaffolds standard UTAM configurations, Wireit tasks, and namespace maps in a project directory, and adds
 * the .forceignore rules that keep UTAM artifacts out of Salesforce deploys.
 *
 * @param options - Scaffolding options.
 * @returns Results describing created, skipped, and modified files.
 */
export function scaffoldProject(options?: ScaffoldOptions): Promise<ScaffoldResult> {
  const projectDir = path.resolve(options?.projectDir ?? process.cwd());
  const templatesDir = options?.templatesDir ?? DEFAULT_TEMPLATES_DIR;
  const dryRun = options?.dryRun ?? false;
  const force = options?.force ?? false;

  // Reads sfdx-project.json only; no source folders are scanned.
  const sfdxProject = parseSfdxProject(projectDir);

  // Project-relative from here on, so an absolute --source-dir lands in the right place on disk and in
  // .forceignore.
  const sourceDir =
    path.relative(projectDir, path.resolve(projectDir, resolveSourceDir(sfdxProject, options?.sourceDir))) || '.';

  const packageJsonPath = path.join(projectDir, 'package.json');
  let packageJsonData: Record<string, unknown> | null = null;
  if (fs.existsSync(packageJsonPath)) {
    try {
      packageJsonData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      // Continue on read error
    }
  }

  const appName = resolveAppName(packageJsonData, options?.appName);
  const utamConfig = generateUtamConfig(templatesDir);
  const generated = resolveNamespace(projectDir, force, appName);
  const namespaceMap = rebaseNamespaceMap(
    generateNamespaceMap(appName, templatesDir),
    `${appName}/pageObjects/`,
    generated.namespace,
  );

  const filesToCreate = [
    {
      relativePath: 'generator.config.json',
      content: JSON.stringify(generateGeneratorConfig(sourceDir, appName, templatesDir), null, 2) + '\n',
    },
    {
      relativePath: 'utam.config.json',
      content: JSON.stringify(utamConfig, null, 2) + '\n',
    },
    {
      relativePath: 'wdio.conf.mjs',
      content: generateWdioConfig(sourceDir, templatesDir),
    },
    {
      relativePath: path.join('.utam', 'namespace-map.json'),
      content: JSON.stringify(namespaceMap, null, 2) + '\n',
    },
  ];

  const utamTests = planUtamTests(projectDir, sourceDir, templatesDir, force);
  filesToCreate.push(...utamTests.files, ...planSnapshotFiles(utamTests.testDirs[0], templatesDir));

  const { createdFiles, skippedFiles } = writeScaffoldFiles(projectDir, filesToCreate, force, dryRun);
  const modifiedFiles: string[] = [];
  const warnings: string[] = [];
  let updatedPackageJson: Record<string, unknown> | undefined;

  const forceignore = updateForceignore(projectDir, sourceDir, utamTests.testDirs, sfdxProject, options);
  recordIgnoreFile(forceignore, createdFiles, modifiedFiles);
  const gitignore = updateGitignore(projectDir, options);
  recordIgnoreFile(gitignore, createdFiles, modifiedFiles);

  let pageObjectExports: PageObjectExportsResult | undefined;
  if (packageJsonData) {
    const update = updatePackageJson(
      packageJsonData,
      templatesDir,
      generated,
      appName,
      resolvePageObjectsOutputDir(projectDir, force, utamConfig),
    );
    pageObjectExports = update.pageObjectExports;
    if (update.warning) {
      warnings.push(update.warning);
    }
    if (update.packageJson) {
      modifiedFiles.push('package.json');
      updatedPackageJson = update.packageJson;
      if (!dryRun) {
        fs.writeFileSync(packageJsonPath, JSON.stringify(updatedPackageJson, null, 2) + '\n', 'utf-8');
      }
    }
  }

  const missingDependencies = packageJsonData
    ? checkMissingDependencies(packageJsonData)
    : [...DEFAULT_REQUIRED_DEV_DEPENDENCIES];

  return Promise.resolve({
    createdFiles,
    skippedFiles,
    modifiedFiles,
    updatedPackageJson,
    missingDependencies,
    forceignore,
    gitignore,
    snapshotHooksMissing: lacksSnapshotHooks(projectDir, skippedFiles),
    pageObjectExports,
    warnings,
  });
}
