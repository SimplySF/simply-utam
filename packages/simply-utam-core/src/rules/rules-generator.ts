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

export const ROOT_TARGETS = [
  'lightningCommunity__Page',
  'lightning__AppPage',
  'lightning__HomePage',
  'lightning__RecordPage',
] as const;

export interface GenerateRulesOptions {
  rootDir?: string;
  sourceDirs?: string[];
  namespace?: string;
  dryRun?: boolean;
  verbose?: boolean;
}

export interface RuleAction {
  componentName: string;
  componentDir: string;
  rulesFilePath: string;
  selector: string;
  action: 'created' | 'updated' | 'skipped';
  reason?: string;
}

export interface GenerateRulesResult {
  totalComponentsScanned: number;
  rootComponentsIdentified: number;
  filesCreated: string[];
  filesUpdated: string[];
  dryRun: boolean;
  actions: RuleAction[];
}

interface RulesStructure {
  [key: string]: unknown;
  root?: boolean;
  selector?: {
    [key: string]: unknown;
    css?: string;
  };
}

/**
 * Converts camelCase or PascalCase component name to kebab-case HTML tag with namespace prefix.
 * e.g., myComponent -> c-my-component, sampleHome with namespace 'custom' -> custom-sample-home
 *
 * @param componentName - The LWC component name.
 * @param namespace - Optional packaging namespace.
 * @returns Kebab-cased HTML tag name.
 */
export function convertLwcNameToHtml(componentName: string, namespace?: string | null): string {
  if (!componentName?.trim()) {
    return '';
  }
  const cleanName = componentName.trim();
  let kebab = cleanName.replace(/([A-Z])/g, '-$1').toLowerCase();
  if (kebab.startsWith('-')) {
    kebab = kebab.substring(1);
  }
  const prefix = namespace?.trim() ? namespace.trim() : 'c';
  return `${prefix}-${kebab}`;
}

/**
 * Parses targets inside <targets>...</targets> block in a js-meta.xml content,
 * stripping XML comments to avoid matching commented-out targets.
 *
 * @param xmlContent - Raw XML content string of the js-meta.xml file.
 * @returns Array of target string identifiers.
 */
export function getTargetsFromMeta(xmlContent: string): string[] {
  // Strip XML comments
  const cleanXml = xmlContent.replace(/<!--[\s\S]*?-->/g, '');

  const targetsMatch = cleanXml.match(/<targets(?:\s[^>]*)?>([\s\S]*?)<\/targets>/);
  if (!targetsMatch) {
    return [];
  }
  const targetsSection = targetsMatch[1];
  const targetMatches = [...targetsSection.matchAll(/<target(?:\s[^>]*)?>([\s\S]*?)<\/target>/g)];
  return targetMatches.map((match) => match[1].trim()).filter(Boolean);
}

function processComponentRules(
  componentDir: string,
  componentName: string,
  namespace: string | undefined,
  dryRun: boolean,
): RuleAction {
  const rulesFilePath = path.join(componentDir, `${componentName}.rules.json`);
  const metaFilePath = path.join(componentDir, `${componentName}.js-meta.xml`);

  if (!fs.existsSync(metaFilePath)) {
    return {
      componentName,
      componentDir,
      rulesFilePath,
      selector: '',
      action: 'skipped',
      reason: 'Missing js-meta.xml file',
    };
  }

  let xmlContent: string;
  try {
    xmlContent = fs.readFileSync(metaFilePath, 'utf-8');
  } catch {
    return {
      componentName,
      componentDir,
      rulesFilePath,
      selector: '',
      action: 'skipped',
      reason: 'Failed to read js-meta.xml file',
    };
  }

  const targets = getTargetsFromMeta(xmlContent);
  const isRoot = targets.some((target) =>
    (ROOT_TARGETS as readonly string[]).includes(target),
  );

  if (!isRoot) {
    return {
      componentName,
      componentDir,
      rulesFilePath,
      selector: '',
      action: 'skipped',
      reason: `Not a root component (targets: ${targets.join(', ') || 'none'})`,
    };
  }

  const selector = convertLwcNameToHtml(componentName, namespace);
  let rulesJson: RulesStructure = {};
  let isExisting = false;

  if (fs.existsSync(rulesFilePath)) {
    isExisting = true;
    try {
      rulesJson = JSON.parse(fs.readFileSync(rulesFilePath, 'utf-8')) as RulesStructure;
    } catch {
      rulesJson = {};
    }
  }

  rulesJson.root = true;
  if (!rulesJson.selector || typeof rulesJson.selector !== 'object') {
    rulesJson.selector = {};
  }
  rulesJson.selector.css = selector;

  if (!dryRun) {
    const jsonString = JSON.stringify(rulesJson, null, 2) + '\n';
    fs.writeFileSync(rulesFilePath, jsonString, 'utf-8');
  }

  return {
    componentName,
    componentDir,
    rulesFilePath,
    selector,
    action: isExisting ? 'updated' : 'created',
  };
}

function scanLwcDirRules(
  lwcDir: string,
  namespace: string | undefined,
  dryRun: boolean,
  result: GenerateRulesResult,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(lwcDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const componentName = entry.name;
    if (componentName.startsWith('.') || componentName === '__tests__') {
      continue;
    }
    result.totalComponentsScanned++;

    const action = processComponentRules(
      path.join(lwcDir, componentName),
      componentName,
      namespace,
      dryRun,
    );

    if (action.action === 'created') {
      result.rootComponentsIdentified++;
      result.filesCreated.push(action.rulesFilePath);
    } else if (action.action === 'updated') {
      result.rootComponentsIdentified++;
      result.filesUpdated.push(action.rulesFilePath);
    }

    result.actions.push(action);
  }
}

/**
 * Scans discovered LWC components, identifies root targets, and creates or updates
 * <componentName>.rules.json files.
 *
 * @param options - Rules generation options.
 * @returns Results describing scanned components and generated rules files.
 */
export function generateLwcRules(options: GenerateRulesOptions = {}): GenerateRulesResult {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const dryRun = Boolean(options.dryRun);

  let sourceDirs = options.sourceDirs;
  let namespace = options.namespace;

  if (!sourceDirs || sourceDirs.length === 0 || namespace === undefined) {
    const discovered = discoverProject(rootDir);
    if (!sourceDirs || sourceDirs.length === 0) {
      sourceDirs =
        discovered.packageDirectories.length > 0
          ? discovered.packageDirectories
          : ['./sfdx-source'];
    }
    namespace ??= discovered.namespace ?? undefined;
  }

  const result: GenerateRulesResult = {
    totalComponentsScanned: 0,
    rootComponentsIdentified: 0,
    filesCreated: [],
    filesUpdated: [],
    dryRun,
    actions: [],
  };

  for (const sourceDir of sourceDirs) {
    const resolvedSource = path.isAbsolute(sourceDir)
      ? sourceDir
      : path.resolve(rootDir, sourceDir);

    if (!fs.existsSync(resolvedSource)) {
      continue;
    }

    const lwcDirs = findLwcDirectories(resolvedSource);
    for (const lwcDir of lwcDirs) {
      scanLwcDirRules(lwcDir, namespace, dryRun, result);
    }
  }

  return result;
}
