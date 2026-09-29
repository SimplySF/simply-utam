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
  rewriteUtamNamespaces,
} from '@simplysf/simply-utam-core';

export interface BuildPipelineOptions {
  projectDir?: string;
  sourceDirs?: string[];
  generatorConfigPath?: string;
  utamConfigPath?: string;
  namespaceMapPath?: string;
  dryRun?: boolean;
  spawnCommand?: (
    command: string,
    args: string[],
    cwd: string,
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
  onStage?: (
    stage: string,
    status: 'start' | 'success' | 'skip' | 'error',
    message?: string,
  ) => void;
}

export interface BuildPipelineResult {
  success: boolean;
  rulesModified: number;
  overridesApplied: number;
  namespacesRewritten: number;
  generatorExecuted: boolean;
  compilerExecuted: boolean;
  errors: string[];
}

type CommandRunner = (
  cmd: string,
  args: string[],
  cwd: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;

type StageLogger = (
  stage: string,
  status: 'start' | 'success' | 'skip' | 'error',
  message?: string,
) => void;

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
): { modified: number; error?: string } {
  onStage?.('rules', 'start');
  try {
    const res = generateLwcRules({ rootDir: projectDir, sourceDirs, dryRun });
    const count = res.filesCreated.length + res.filesUpdated.length;
    onStage?.('rules', 'success', `Generated rules for ${count} components`);
    return { modified: count };
  } catch (err) {
    const msg = (err as Error).message;
    onStage?.('rules', 'error', msg);
    return { modified: 0, error: `Rules generation failed: ${msg}` };
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

/**
 * Executes the complete SimplyUTAM compilation build pipeline sequentially:
 * rules -> utam-generate -> overrides -> rewrite -> utam compiler.
 *
 * @param options - Build pipeline execution options.
 * @returns Summary of execution results across all pipeline stages.
 */
export async function executeBuildPipeline(
  options?: BuildPipelineOptions,
): Promise<BuildPipelineResult> {
  const projectDir = path.resolve(options?.projectDir ?? process.cwd());
  const dryRun = options?.dryRun ?? false;
  const runner = options?.spawnCommand ?? defaultSpawn;
  const onStage = options?.onStage;

  const sourceDirs = resolveSourceDirs(projectDir, options?.sourceDirs);

  // Stage 1: rules
  const rules = executeRulesStage(projectDir, sourceDirs, dryRun, onStage);
  if (rules.error) {
    return {
      success: false,
      rulesModified: rules.modified,
      overridesApplied: 0,
      namespacesRewritten: 0,
      generatorExecuted: false,
      compilerExecuted: false,
      errors: [rules.error],
    };
  }

  // Stage 2: utam-generate
  const gen = await executeGeneratorStage(
    projectDir,
    options?.generatorConfigPath ?? 'generator.config.json',
    dryRun,
    runner,
    onStage,
  );
  if (gen.error) {
    return {
      success: false,
      rulesModified: rules.modified,
      overridesApplied: 0,
      namespacesRewritten: 0,
      generatorExecuted: gen.executed,
      compilerExecuted: false,
      errors: [gen.error],
    };
  }

  // Stage 3: overrides
  const over = executeOverridesStage(projectDir, sourceDirs, dryRun, onStage);
  if (over.error) {
    return {
      success: false,
      rulesModified: rules.modified,
      overridesApplied: over.modified,
      namespacesRewritten: 0,
      generatorExecuted: gen.executed,
      compilerExecuted: false,
      errors: [over.error],
    };
  }

  // Stage 4: rewrite
  const rew = executeRewriteStage(
    projectDir,
    sourceDirs,
    options?.namespaceMapPath ?? path.join('.utam', 'namespace-map.json'),
    dryRun,
    onStage,
  );
  if (rew.error) {
    return {
      success: false,
      rulesModified: rules.modified,
      overridesApplied: over.modified,
      namespacesRewritten: rew.modified,
      generatorExecuted: gen.executed,
      compilerExecuted: false,
      errors: [rew.error],
    };
  }

  // Stage 5: utam compiler
  const comp = await executeCompilerStage(
    projectDir,
    options?.utamConfigPath ?? 'utam.config.json',
    dryRun,
    runner,
    onStage,
  );
  if (comp.error) {
    return {
      success: false,
      rulesModified: rules.modified,
      overridesApplied: over.modified,
      namespacesRewritten: rew.modified,
      generatorExecuted: gen.executed,
      compilerExecuted: comp.executed,
      errors: [comp.error],
    };
  }

  return {
    success: true,
    rulesModified: rules.modified,
    overridesApplied: over.modified,
    namespacesRewritten: rew.modified,
    generatorExecuted: gen.executed,
    compilerExecuted: comp.executed,
    errors: [],
  };
}
