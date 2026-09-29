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
import { discoverProject } from '../discovery/index.js';

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
  '@cucumber/cucumber',
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
   * If true, forces overwriting of existing config files.
   */
  force?: boolean;
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
  const normalizedSource = sourceDir.replace(/^[./\\]+/, '').replace(/\\/g, '/');
  const raw = loadTemplate('generator.config.json', templatesDir, {
    sourceDir: normalizedSource,
    appName,
  });
  return JSON.parse(raw) as Record<string, unknown>;
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
export function generateWdioConfig(
  sourceDir: string,
  templatesDir = DEFAULT_TEMPLATES_DIR,
): string {
  const normalizedSource = sourceDir.replace(/^[./\\]+/, '').replace(/\\/g, '/');
  return loadTemplate('wdio.conf.mjs', templatesDir, {
    sourceDir: normalizedSource,
  });
}

/**
 * Generates the .utam/namespace-map.json content by loading its external template.
 *
 * @param appName - The application namespace name.
 * @param templatesDir - Optional custom directory containing the template file.
 * @returns Parsed JSON object for namespace-map.json.
 */
export function generateNamespaceMap(
  appName: string,
  templatesDir = DEFAULT_TEMPLATES_DIR,
): Record<string, unknown> {
  const raw = loadTemplate('namespace-map.json', templatesDir, {
    appName,
  });
  return JSON.parse(raw) as Record<string, unknown>;
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

function resolveSourceDir(projectDir: string, explicitSourceDir?: string): string {
  if (explicitSourceDir) {
    return explicitSourceDir;
  }
  const discovery = discoverProject(projectDir);
  if (discovery.sfdxProjectFile && discovery.packageDirectories.length > 0) {
    return discovery.defaultPackageDirectory ?? discovery.packageDirectories[0];
  }
  if (discovery.packageDirectories.length > 0) {
    return discovery.packageDirectories[0];
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
 * Scaffolds standard UTAM configurations, Wireit tasks, and namespace maps in a project directory.
 *
 * @param options - Scaffolding options.
 * @returns Results describing created, skipped, and modified files.
 */
export function scaffoldProject(options?: ScaffoldOptions): Promise<ScaffoldResult> {
  const projectDir = path.resolve(options?.projectDir ?? process.cwd());
  const templatesDir = options?.templatesDir ?? DEFAULT_TEMPLATES_DIR;
  const dryRun = options?.dryRun ?? false;
  const force = options?.force ?? false;

  const sourceDir = resolveSourceDir(projectDir, options?.sourceDir);

  const packageJsonPath = path.join(projectDir, 'package.json');
  let packageJsonData: Record<string, unknown> | null = null;
  if (fs.existsSync(packageJsonPath)) {
    try {
      packageJsonData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as Record<
        string,
        unknown
      >;
    } catch {
      // Continue on read error
    }
  }

  const appName = resolveAppName(packageJsonData, options?.appName);

  const filesToCreate = [
    {
      relativePath: 'generator.config.json',
      content:
        JSON.stringify(generateGeneratorConfig(sourceDir, appName, templatesDir), null, 2) + '\n',
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

  const { createdFiles, skippedFiles } = writeScaffoldFiles(projectDir, filesToCreate, force, dryRun);
  const modifiedFiles: string[] = [];
  let updatedPackageJson: Record<string, unknown> | undefined;

  if (packageJsonData) {
    const injection = injectWireitConfiguration(packageJsonData, templatesDir);
    if (injection.updated) {
      modifiedFiles.push('package.json');
      updatedPackageJson = injection.packageJson;
      if (!dryRun) {
        fs.writeFileSync(
          packageJsonPath,
          JSON.stringify(injection.packageJson, null, 2) + '\n',
          'utf-8',
        );
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
  });
}
