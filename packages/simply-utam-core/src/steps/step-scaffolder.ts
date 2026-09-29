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
import { ParameterTypeRegistry } from '@cucumber/cucumber-expressions';
import { discoverProject } from '../discovery/index.js';
import { extractStepsFromGherkin, ParsedGherkinStep } from './gherkin-parser.js';
import {
  extractStepExpressionsFromContent,
  compileStepExpressions,
  matchStepAgainstExpressions,
  normalizeExpression,
  RawExtractedExpression,
  CompiledStepExpression,
} from './expression-matcher.js';
import { generateStepSnippet, GeneratedStepSnippet, formatCode } from './snippet-generator.js';

export interface GenerateStepsOptions {
  rootDir?: string;
  features?: string | string[];
  steps?: string | string[];
  outputFile?: string;
  dryRun?: boolean;
  verbose?: boolean;
}

export interface GenerateStepsResult {
  featureFilesScanned: number;
  stepFilesScanned: number;
  totalFeatureSteps: number;
  matchedStepsCount: number;
  undefinedStepsCount: number;
  uniqueSnippetsGenerated: number;
  dryRun: boolean;
  outputFile: string;
  snippets: GeneratedStepSnippet[];
  generatedCode?: string;
}

/**
 * Resolves one or more glob patterns or file paths into absolute file paths.
 *
 * @param patterns - Pattern or list of glob patterns to resolve.
 * @param rootDir - Root directory to resolve relative paths against.
 * @returns Array of unique resolved absolute file paths.
 */
export function resolveGlobs(patterns: string | string[], rootDir: string): string[] {
  const files: string[] = [];
  const list = Array.isArray(patterns) ? patterns : [patterns];

  for (const pattern of list) {
    if (!pattern) continue;
    const normalized = pattern.replace(/\\/g, '/');
    try {
      const matched = fs.globSync(normalized, { cwd: rootDir });
      for (const m of matched) {
        files.push(path.resolve(rootDir, m));
      }
    } catch {
      // If globSync fails, check if pattern is a direct file path
      const direct = path.resolve(rootDir, pattern);
      if (fs.existsSync(direct)) {
        files.push(direct);
      }
    }
  }

  return Array.from(new Set(files));
}

interface StepExpressionIndex {
  compiledExpressions: CompiledStepExpression[];
  existingNormalizedExpressions: Set<string>;
  registry: ParameterTypeRegistry;
}

function collectExistingExpressions(stepFiles: string[], targetOutput: string): StepExpressionIndex {
  const rawExpressions: RawExtractedExpression[] = [];

  for (const stepFile of stepFiles) {
    try {
      if (fs.existsSync(stepFile)) {
        const content = fs.readFileSync(stepFile, 'utf-8');
        rawExpressions.push(...extractStepExpressionsFromContent(content));
      }
    } catch {
      // Ignore unreadable step files
    }
  }

  if (fs.existsSync(targetOutput)) {
    try {
      const content = fs.readFileSync(targetOutput, 'utf-8');
      rawExpressions.push(...extractStepExpressionsFromContent(content));
    } catch {
      // Ignore read errors
    }
  }

  const registry = new ParameterTypeRegistry();
  const compiledExpressions = compileStepExpressions(rawExpressions, registry);
  const existingNormalizedExpressions = new Set<string>();
  for (const raw of rawExpressions) {
    existingNormalizedExpressions.add(normalizeExpression(raw.pattern));
  }

  return { compiledExpressions, existingNormalizedExpressions, registry };
}

function collectStepsFromFeatures(featureFiles: string[], rootDir: string): ParsedGherkinStep[] {
  const allParsedSteps: ParsedGherkinStep[] = [];
  for (const featureFile of featureFiles) {
    try {
      const content = fs.readFileSync(featureFile, 'utf-8');
      const relativePath = path.relative(rootDir, featureFile);
      const steps = extractStepsFromGherkin(content, relativePath);
      allParsedSteps.push(...steps);
    } catch {
      // Ignore unreadable feature files
    }
  }
  return allParsedSteps;
}

async function writeScaffoldedSnippets(
  uniqueSnippets: GeneratedStepSnippet[],
  targetOutput: string,
  dryRun: boolean,
): Promise<string | undefined> {
  if (uniqueSnippets.length === 0) {
    return undefined;
  }

  let fileContent = fs.existsSync(targetOutput)
    ? fs.readFileSync(targetOutput, 'utf-8').trim() + '\n\n'
    : "import { Given, When, Then } from '@wdio/cucumber-framework';\n\n";

  for (const snippet of uniqueSnippets) {
    fileContent += snippet.fullText + '\n\n';
  }

  const generatedCode = await formatCode(fileContent);

  if (!dryRun) {
    const parentDir = path.dirname(targetOutput);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(targetOutput, generatedCode, 'utf-8');
  }

  return generatedCode;
}

/**
 * Determines the default output target file path for scaffolded step definitions.
 *
 * If existing step definition files are found, places generated.steps.mjs in the same directory.
 * Otherwise, inspects project discovery for package directories (e.g. sfdx-source, force-app)
 * and checks candidate test/utam directory locations.
 *
 * @param rootDir - Root directory of the project.
 * @param stepFiles - List of resolved existing step definition file paths.
 * @returns Absolute path to target generated.steps.mjs file.
 */
export function resolveDefaultTargetOutput(rootDir: string, stepFiles: readonly string[] = []): string {
  if (stepFiles.length > 0) {
    const primaryDir = path.dirname(stepFiles[0]);
    return path.join(primaryDir, 'generated.steps.mjs');
  }

  const discovery = discoverProject(rootDir);
  const sourceDir = discovery.defaultPackageDirectory ?? discovery.packageDirectories[0] ?? 'force-app';

  const candidateDirs = [
    path.join(rootDir, sourceDir, 'test', 'utam', 'step_definitions'),
    path.join(rootDir, sourceDir, 'tests', 'utam', 'step_definitions'),
    path.join(rootDir, sourceDir, 'test', 'utam'),
    path.join(rootDir, sourceDir, 'tests', 'utam'),
    path.join(rootDir, 'test', 'utam', 'step_definitions'),
    path.join(rootDir, 'tests', 'utam', 'step_definitions'),
    path.join(rootDir, 'test', 'utam'),
    path.join(rootDir, 'tests', 'utam'),
  ];

  for (const dir of candidateDirs) {
    if (fs.existsSync(dir)) {
      if (dir.endsWith('step_definitions')) {
        return path.join(dir, 'generated.steps.mjs');
      }
      return path.join(dir, 'step_definitions', 'generated.steps.mjs');
    }
  }

  return path.resolve(rootDir, sourceDir, 'test/utam/step_definitions/generated.steps.mjs');
}

/**
 * Scans feature files, discovers undefined Gherkin steps against existing step definition files,
 * deduplicates snippets by expression, and non-destructively scaffolds new step definitions.
 *
 * @param options - Step generation configuration options.
 * @returns Summary of scanned features, matched steps, and generated snippet definitions.
 */
export async function generateCucumberSteps(options: GenerateStepsOptions = {}): Promise<GenerateStepsResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const dryRun = Boolean(options.dryRun);

  const featurePatterns = options.features ?? [
    'sfdx-source/**/*.feature',
    'force-app/**/*.feature',
    'test/**/*.feature',
    '**/*.feature',
  ];
  const stepPatterns = options.steps ?? [
    'sfdx-source/**/*.steps.{js,mjs,ts}',
    'force-app/**/*.steps.{js,mjs,ts}',
    'test/**/*.steps.{js,mjs,ts}',
  ];

  const featureFiles = resolveGlobs(featurePatterns, rootDir).filter((f) => f.endsWith('.feature'));
  const stepFiles = resolveGlobs(stepPatterns, rootDir);

  const targetOutput = options.outputFile
    ? path.isAbsolute(options.outputFile)
      ? options.outputFile
      : path.resolve(rootDir, options.outputFile)
    : resolveDefaultTargetOutput(rootDir, stepFiles);

  const { compiledExpressions, existingNormalizedExpressions, registry } = collectExistingExpressions(
    stepFiles,
    targetOutput,
  );

  const allParsedSteps = collectStepsFromFeatures(featureFiles, rootDir);

  let matchedStepsCount = 0;
  const undefinedSteps: ParsedGherkinStep[] = [];

  for (const step of allParsedSteps) {
    if (matchStepAgainstExpressions(step.text, compiledExpressions)) {
      matchedStepsCount++;
    } else {
      undefinedSteps.push(step);
    }
  }

  const uniqueSnippets: GeneratedStepSnippet[] = [];
  const seenExpressionsInRun = new Set<string>();

  for (const step of undefinedSteps) {
    const snippet = generateStepSnippet(step, registry);
    const normalized = normalizeExpression(snippet.expression);

    if (existingNormalizedExpressions.has(normalized)) {
      matchedStepsCount++;
      continue;
    }

    if (seenExpressionsInRun.has(normalized)) {
      continue;
    }

    seenExpressionsInRun.add(normalized);
    uniqueSnippets.push(snippet);
  }

  const generatedCode = await writeScaffoldedSnippets(uniqueSnippets, targetOutput, dryRun);

  return {
    featureFilesScanned: featureFiles.length,
    stepFilesScanned: stepFiles.length,
    totalFeatureSteps: allParsedSteps.length,
    matchedStepsCount,
    undefinedStepsCount: undefinedSteps.length,
    uniqueSnippetsGenerated: uniqueSnippets.length,
    dryRun,
    outputFile: targetOutput,
    snippets: uniqueSnippets,
    generatedCode,
  };
}
