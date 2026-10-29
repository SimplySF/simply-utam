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
import { spawn } from 'node:child_process';
import {
  discoverProject,
  generateLwcRules,
  applyUtamOverrides,
  nameSecondaryPageObjects,
  rewriteUtamNamespaces,
} from '@simplysf/simply-utam-core';

export interface BuildPipelineOptions {
  projectDir?: string;
  sourceDirs?: string[];
  generatorConfigPath?: string;
  utamConfigPath?: string;
  namespaceMapPath?: string;
  /** Leave out the `names` stage, keeping the generated names of secondary template page objects. */
  skipNames?: boolean;
  dryRun?: boolean;
  spawnCommand?: (
    command: string,
    args: string[],
    cwd: string,
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
  onStage?: (stage: string, status: 'start' | 'success' | 'skip' | 'error', message?: string) => void;
}

export interface BuildPipelineResult {
  success: boolean;
  rulesModified: number;
  overridesApplied: number;
  pageObjectsRenamed: number;
  namespacesRewritten: number;
  generatorExecuted: boolean;
  compilerExecuted: boolean;
  errors: string[];
  /** Warnings from the stages that ran, such as a template that can take a component's rules file. */
  warnings: string[];
}

type CommandRunner = (
  cmd: string,
  args: string[],
  cwd: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;

type StageLogger = (stage: string, status: 'start' | 'success' | 'skip' | 'error', message?: string) => void;

function defaultSpawn(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const proc = spawn(command, args, { cwd, shell: isWindows });
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });

    proc.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

function resolveBinary(binaryName: string, projectDir: string): string {
  const localBin = path.join(
    projectDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${binaryName}.cmd` : binaryName,
  );
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  return binaryName;
}

function resolveSourceDirs(projectDir: string, explicitSourceDirs?: string[]): string[] {
  if (explicitSourceDirs && explicitSourceDirs.length > 0) {
    return explicitSourceDirs.map((d) => path.resolve(projectDir, d));
  }
  const discovery = discoverProject(projectDir);
  if (discovery.packageDirectories.length > 0) {
    return discovery.packageDirectories.map((d) => path.resolve(projectDir, d));
  }
  return [projectDir];
}

async function runStageProcess(
  binaryName: string,
  configPath: string,
  projectDir: string,
  runner: CommandRunner,
): Promise<{ success: boolean; error?: string }> {
  const bin = resolveBinary(binaryName, projectDir);
  const res = await runner(bin, ['-c', configPath], projectDir);
  if (res.code !== 0) {
    const errorMsg = res.stderr || res.stdout || `Process exited with code ${res.code}`;
    return { success: false, error: errorMsg };
  }
  return { success: true };
}

function executeRulesStage(
  projectDir: string,
  sourceDirs: string[],
  dryRun: boolean,
  onStage?: StageLogger,
): { modified: number; warnings: string[]; error?: string } {
  onStage?.('rules', 'start');
  try {
    const res = generateLwcRules({ rootDir: projectDir, sourceDirs, dryRun });
    const count = res.filesCreated.length + res.filesUpdated.length;
    onStage?.('rules', 'success', `Generated rules for ${count} components`);
    return { modified: count, warnings: res.warnings };
  } catch (err) {
    const msg = (err as Error).message;
    onStage?.('rules', 'error', msg);
    return { modified: 0, warnings: [], error: `Rules generation failed: ${msg}` };
  }
}

async function executeGeneratorStage(
  projectDir: string,
  configRel: string,
  dryRun: boolean,
  runner: CommandRunner,
  onStage?: StageLogger,
): Promise<{ executed: boolean; error?: string }> {
  const configPath = path.resolve(projectDir, configRel);
  if (!fs.existsSync(configPath)) {
    onStage?.('utam-generate', 'skip', `Config '${configRel}' not found`);
    return { executed: false };
  }

  onStage?.('utam-generate', 'start');
  if (dryRun) {
    onStage?.('utam-generate', 'success', '(dry-run: skipped process execution)');
    return { executed: true };
  }

  const stageRes = await runStageProcess('utam-generate', configPath, projectDir, runner);
  if (!stageRes.success) {
    onStage?.('utam-generate', 'error', stageRes.error);
    return { executed: false, error: `utam-generate failed: ${stageRes.error ?? ''}` };
  }

  onStage?.('utam-generate', 'success');
  return { executed: true };
}

function executeOverridesStage(
  projectDir: string,
  sourceDirs: string[],
  dryRun: boolean,
  onStage?: StageLogger,
): { modified: number; error?: string } {
  onStage?.('overrides', 'start');
  try {
    const res = applyUtamOverrides({ rootDir: projectDir, sourceDirs, dryRun });
    onStage?.('overrides', 'success', `Applied overrides to ${res.modifiedFilesCount} schemas`);
    return { modified: res.modifiedFilesCount };
  } catch (err) {
    const msg = (err as Error).message;
    onStage?.('overrides', 'error', msg);
    return { modified: 0, error: `Overrides failed: ${msg}` };
  }
}

function executeNamesStage(
  projectDir: string,
  sourceDirs: string[],
  generatorConfigRel: string,
  utamConfigRel: string,
  skip: boolean,
  dryRun: boolean,
  onStage?: StageLogger,
): { modified: number; error?: string } {
  if (skip) {
    onStage?.('names', 'skip', 'Skipped with skipNames');
    return { modified: 0 };
  }

  onStage?.('names', 'start');
  try {
    const res = nameSecondaryPageObjects({
      rootDir: projectDir,
      sourceDirs,
      generatorConfigPath: generatorConfigRel,
      utamConfigPath: utamConfigRel,
      dryRun,
    });
    if (res.skipped) {
      onStage?.('names', 'skip', res.skipped);
      return { modified: 0 };
    }
    if (res.collisions.length > 0) {
      const names = res.collisions.map((collision) => `${collision.name} (${collision.sources.join(', ')})`);
      const msg = `These page objects would compile to the same file, so nothing was renamed: ${names.join('; ')}`;
      onStage?.('names', 'error', msg);
      return { modified: 0, error: `Page object naming failed: ${msg}` };
    }
    onStage?.('names', 'success', `Renamed ${res.renames.length} secondary template page objects`);
    return { modified: res.renames.length };
  } catch (err) {
    const msg = (err as Error).message;
    onStage?.('names', 'error', msg);
    return { modified: 0, error: `Page object naming failed: ${msg}` };
  }
}

function executeRewriteStage(
  projectDir: string,
  sourceDirs: string[],
  mapPathRel: string,
  dryRun: boolean,
  onStage?: StageLogger,
): { modified: number; error?: string } {
  const mapPath = path.resolve(projectDir, mapPathRel);
  if (!fs.existsSync(mapPath)) {
    onStage?.('rewrite', 'skip', `Namespace map '${mapPathRel}' not found`);
    return { modified: 0 };
  }

  onStage?.('rewrite', 'start');
  try {
    const res = rewriteUtamNamespaces({ rootDir: projectDir, sourceDirs, configFile: mapPath, dryRun });
    if (res.configMissingOrEmpty) {
      onStage?.('rewrite', 'skip', 'Namespace map is empty');
      return { modified: 0 };
    }
    onStage?.('rewrite', 'success', `Rewrote namespaces in ${res.filesModified} schemas`);
    return { modified: res.filesModified };
  } catch (err) {
    const msg = (err as Error).message;
    onStage?.('rewrite', 'error', msg);
    return { modified: 0, error: `Namespace rewrite failed: ${msg}` };
  }
}

async function executeCompilerStage(
  projectDir: string,
  configRel: string,
  dryRun: boolean,
  runner: CommandRunner,
  onStage?: StageLogger,
): Promise<{ executed: boolean; error?: string }> {
  const configPath = path.resolve(projectDir, configRel);
  if (!fs.existsSync(configPath)) {
    onStage?.('utam', 'skip', `Config '${configRel}' not found`);
    return { executed: false };
  }

  onStage?.('utam', 'start');
  if (dryRun) {
    onStage?.('utam', 'success', '(dry-run: skipped process execution)');
    return { executed: true };
  }

  const stageRes = await runStageProcess('utam', configPath, projectDir, runner);
  if (!stageRes.success) {
    onStage?.('utam', 'error', stageRes.error);
    return { executed: false, error: `utam compiler failed: ${stageRes.error ?? ''}` };
  }

  onStage?.('utam', 'success');
  return { executed: true };
}

/** The pipeline options with their defaults filled in. */
function resolveOptions(options?: BuildPipelineOptions): {
  projectDir: string;
  dryRun: boolean;
  runner: CommandRunner;
  onStage?: StageLogger;
  generatorConfigPath: string;
  utamConfigPath: string;
  namespaceMapPath: string;
  skipNames: boolean;
} {
  return {
    projectDir: path.resolve(options?.projectDir ?? process.cwd()),
    dryRun: options?.dryRun ?? false,
    runner: options?.spawnCommand ?? defaultSpawn,
    onStage: options?.onStage,
    generatorConfigPath: options?.generatorConfigPath ?? 'generator.config.json',
    utamConfigPath: options?.utamConfigPath ?? 'utam.config.json',
    namespaceMapPath: options?.namespaceMapPath ?? path.join('.utam', 'namespace-map.json'),
    skipNames: options?.skipNames ?? false,
  };
}

/**
 * Executes the complete SimplyUTAM compilation build pipeline sequentially:
 * rules -> utam-generate -> overrides -> names -> rewrite -> utam compiler.
 *
 * @param options - Build pipeline execution options.
 * @returns Summary of execution results across all pipeline stages.
 */
export async function executeBuildPipeline(options?: BuildPipelineOptions): Promise<BuildPipelineResult> {
  const { projectDir, dryRun, runner, onStage, generatorConfigPath, utamConfigPath, namespaceMapPath, skipNames } =
    resolveOptions(options);

  const sourceDirs = resolveSourceDirs(projectDir, options?.sourceDirs);

  const result: BuildPipelineResult = {
    success: false,
    rulesModified: 0,
    overridesApplied: 0,
    pageObjectsRenamed: 0,
    namespacesRewritten: 0,
    generatorExecuted: false,
    compilerExecuted: false,
    errors: [],
    warnings: [],
  };
  const fail = (error: string): BuildPipelineResult => ({ ...result, errors: [error] });

  // Stage 1: rules
  const rules = executeRulesStage(projectDir, sourceDirs, dryRun, onStage);
  result.rulesModified = rules.modified;
  result.warnings.push(...rules.warnings);
  if (rules.error) {
    return fail(rules.error);
  }

  // Stage 2: utam-generate
  const gen = await executeGeneratorStage(projectDir, generatorConfigPath, dryRun, runner, onStage);
  result.generatorExecuted = gen.executed;
  if (gen.error) {
    return fail(gen.error);
  }

  // Stage 3: overrides
  const over = executeOverridesStage(projectDir, sourceDirs, dryRun, onStage);
  result.overridesApplied = over.modified;
  if (over.error) {
    return fail(over.error);
  }

  // Stage 4: names, after overrides so overrides files keep the template's own name
  const names = executeNamesStage(
    projectDir,
    sourceDirs,
    generatorConfigPath,
    utamConfigPath,
    skipNames,
    dryRun,
    onStage,
  );
  result.pageObjectsRenamed = names.modified;
  if (names.error) {
    return fail(names.error);
  }

  // Stage 5: rewrite
  const rew = executeRewriteStage(projectDir, sourceDirs, namespaceMapPath, dryRun, onStage);
  result.namespacesRewritten = rew.modified;
  if (rew.error) {
    return fail(rew.error);
  }

  // Stage 6: utam compiler
  const comp = await executeCompilerStage(projectDir, utamConfigPath, dryRun, runner, onStage);
  result.compilerExecuted = comp.executed;
  if (comp.error) {
    return fail(comp.error);
  }

  return { ...result, success: true };
}
