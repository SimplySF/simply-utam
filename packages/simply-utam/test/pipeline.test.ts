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
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeBuildPipeline } from '../src/pipeline-runner.js';

const ROOT_META = `<LightningComponentBundle><targets><target>lightning__AppPage</target></targets></LightningComponentBundle>`;

describe('executeBuildPipeline', () => {
  let tempDir: string;
  let lwcDir: string;
  let calls: string[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simply-utam-pipeline-test-'));
    lwcDir = path.join(tempDir, 'force-app', 'main', 'default', 'lwc');
    calls = [];
    fs.writeFileSync(
      path.join(tempDir, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }),
    );
    fs.writeFileSync(
      path.join(tempDir, 'generator.config.json'),
      JSON.stringify({ inputRootDir: './force-app', outputDir: '__utam__', relativeOutputDir: true }),
    );
    fs.writeFileSync(path.join(tempDir, 'utam.config.json'), JSON.stringify({ pageObjectsRootDir: './' }));
    for (const table of ['ordersTable', 'casesTable']) {
      fs.mkdirSync(path.join(lwcDir, table), { recursive: true });
      fs.writeFileSync(path.join(lwcDir, table, `${table}.js-meta.xml`), ROOT_META);
      fs.writeFileSync(path.join(lwcDir, table, 'picklistTemplate.html'), '<template><button></button></template>');
    }
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /** Stands in for `utam-generate` and `utam`: the generator writes one page object per template. */
  async function spawnCommand(command: string): Promise<{ code: number; stdout: string; stderr: string }> {
    const name = path.basename(command);
    calls.push(name);
    if (name.startsWith('utam-generate')) {
      for (const table of ['ordersTable', 'casesTable']) {
        const utamDir = path.join(lwcDir, table, '__utam__');
        fs.mkdirSync(utamDir, { recursive: true });
        fs.writeFileSync(
          path.join(utamDir, 'picklistTemplate.utam.json'),
          JSON.stringify(
            {
              description: { text: ['Page Object: picklistTemplate'] },
              shadow: { elements: [{ name: 'button', selector: { css: 'button' } }] },
            },
            null,
            4,
          ),
        );
      }
    }
    return { code: 0, stdout: '', stderr: '' };
  }

  function utamFiles(table: string): string[] {
    return fs.readdirSync(path.join(lwcDir, table, '__utam__')).sort();
  }

  it('renames secondary template page objects between overrides and rewrite', async () => {
    // An overrides file named after the template still applies, because overrides runs first.
    fs.writeFileSync(
      path.join(lwcDir, 'ordersTable', 'picklistTemplate.utam-overrides.json'),
      JSON.stringify([{ name: 'button', element: { public: true } }]),
    );
    const stages: string[] = [];

    const result = await executeBuildPipeline({
      projectDir: tempDir,
      spawnCommand,
      onStage: (stage, status) => {
        if (status !== 'start') stages.push(`${stage}:${status}`);
      },
    });

    expect(result.success).toBe(true);
    expect(result.pageObjectsRenamed).toBe(2);
    expect(result.overridesApplied).toBe(1);
    expect(stages).toEqual([
      'rules:success',
      'utam-generate:success',
      'overrides:success',
      'names:success',
      'rewrite:skip',
      'utam:success',
    ]);
    expect(utamFiles('ordersTable')).toEqual(['ordersTablePicklistTemplate.utam.json']);
    expect(utamFiles('casesTable')).toEqual(['casesTablePicklistTemplate.utam.json']);
    const renamed = JSON.parse(
      fs.readFileSync(path.join(lwcDir, 'ordersTable', '__utam__', 'ordersTablePicklistTemplate.utam.json'), 'utf-8'),
    ) as { shadow: { elements: Array<{ public?: boolean }> } };
    expect(renamed.shadow.elements[0]?.public).toBe(true);
  });

  it('writes no rules file for a component without a primary template', async () => {
    await executeBuildPipeline({ projectDir: tempDir, spawnCommand });

    expect(fs.existsSync(path.join(lwcDir, 'ordersTable', 'ordersTable.rules.json'))).toBe(false);
  });

  it('leaves the stage out with skipNames', async () => {
    const result = await executeBuildPipeline({ projectDir: tempDir, spawnCommand, skipNames: true });

    expect(result.success).toBe(true);
    expect(result.pageObjectsRenamed).toBe(0);
    expect(utamFiles('ordersTable')).toEqual(['picklistTemplate.utam.json']);
  });

  it('stops before the compiler when a new name would collide', async () => {
    const testUtam = path.join(tempDir, 'force-app', 'test', '__utam__');
    fs.mkdirSync(testUtam, { recursive: true });
    fs.writeFileSync(path.join(testUtam, 'ordersTablePicklistTemplate.utam.json'), '{}');

    const result = await executeBuildPipeline({ projectDir: tempDir, spawnCommand });

    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/^Page object naming failed: .*ordersTablePicklistTemplate/);
    expect(result.compilerExecuted).toBe(false);
    expect(calls.some((call) => call.startsWith('utam-generate'))).toBe(true);
    expect(calls.some((call) => call === 'utam' || call === 'utam.cmd')).toBe(false);
  });

  it('skips the stage with a warning for a generator config that writes one output folder', async () => {
    fs.writeFileSync(path.join(tempDir, 'generator.config.json'), JSON.stringify({ inputRootDir: './force-app' }));

    const result = await executeBuildPipeline({ projectDir: tempDir, spawnCommand });

    expect(result.success).toBe(true);
    expect(result.pageObjectsRenamed).toBe(0);
    expect(result.warnings).toEqual([expect.stringContaining('relativeOutputDir: false')]);
    expect(calls.some((call) => call === 'utam' || call === 'utam.cmd')).toBe(true);
  });

  it('passes on the rules warnings', async () => {
    fs.writeFileSync(path.join(lwcDir, 'ordersTable', 'ordersTable.html'), '<template></template>');
    fs.writeFileSync(path.join(lwcDir, 'ordersTable', 'orders.html'), '<template></template>');

    const result = await executeBuildPipeline({ projectDir: tempDir, spawnCommand });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('ordersTable/orders.html can take ordersTable.rules.json');
  });
});
