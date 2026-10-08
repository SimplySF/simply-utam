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
import { isAbsoluteOnAnyPlatform, toPosixRelative } from '../path-utils.js';
import {
  SIMPLY_UTAM_FORCEIGNORE_RULES,
  ensureForceignore,
  resolveUtamTestIgnoreRules,
  type ForceignoreResult,
} from '../forceignore/index.js';

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
}

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

function resolveAppName(packageJsonData: Record<string, unknown> | null, explicitAppName?: string): string {
  if (explicitAppName) {
    return explicitAppName;
  }
  if (typeof packageJsonData?.['name'] === 'string') {
    return packageJsonData['name'].replace(/^@[^/]+\//, '');
  }
  return 'salesforce-app';
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
    const targetPath = path.join(projectDir, item.relativePath);
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

function recordForceignore(
  forceignore: ForceignoreResult | undefined,
  createdFiles: string[],
  modifiedFiles: string[],
): void {
  if (forceignore?.action === 'created') {
    createdFiles.push(forceignore.path);
  } else if (forceignore?.action === 'appended' || forceignore?.action === 'inserted') {
    modifiedFiles.push(forceignore.path);
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

  const filesToCreate = [
    {
      relativePath: 'generator.config.json',
      content: JSON.stringify(generateGeneratorConfig(sourceDir, appName, templatesDir), null, 2) + '\n',
    },
    {
      relativePath: 'utam.config.json',
      content: JSON.stringify(generateUtamConfig(templatesDir), null, 2) + '\n',
    },
    {
      relativePath: 'wdio.conf.mjs',
      content: generateWdioConfig(sourceDir, templatesDir),
    },
    {
      relativePath: path.join('.utam', 'namespace-map.json'),
      content: JSON.stringify(generateNamespaceMap(appName, templatesDir), null, 2) + '\n',
    },
  ];

  const utamTests = planUtamTests(projectDir, sourceDir, templatesDir, force);
  filesToCreate.push(...utamTests.files);

  const { createdFiles, skippedFiles } = writeScaffoldFiles(projectDir, filesToCreate, force, dryRun);
  const modifiedFiles: string[] = [];
  let updatedPackageJson: Record<string, unknown> | undefined;

  const forceignore = updateForceignore(projectDir, sourceDir, utamTests.testDirs, sfdxProject, options);
  recordForceignore(forceignore, createdFiles, modifiedFiles);

  if (packageJsonData) {
    const injection = injectWireitConfiguration(packageJsonData, templatesDir);
    if (injection.updated) {
      modifiedFiles.push('package.json');
      updatedPackageJson = injection.packageJson;
      if (!dryRun) {
        fs.writeFileSync(packageJsonPath, JSON.stringify(injection.packageJson, null, 2) + '\n', 'utf-8');
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
  });
}
