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
import * as os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Init from '../src/commands/init.js';
import Rules from '../src/commands/rules.js';
import Overrides from '../src/commands/overrides.js';
import Rewrite from '../src/commands/rewrite.js';
import Steps from '../src/commands/steps.js';
import Build from '../src/commands/build.js';

describe('CLI command execution', () => {
  let tempDir: string;
  const pkgRoot = path.resolve('packages/simply-utam');
  const runOpts = { root: pkgRoot };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simply-utam-cli-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Init command', () => {
    it('should scaffold project files and update package.json', async () => {
      const pkgPath = path.join(tempDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify({ name: 'cli-test-project' }), 'utf-8');

      const result = await Init.run(['--project-dir', tempDir, '--source-dir', 'force-app'], runOpts);

      expect(result.createdFiles).toHaveLength(4);
      expect(result.modifiedFiles).toContain('package.json');
      expect(fs.existsSync(path.join(tempDir, 'generator.config.json'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'utam.config.json'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'wdio.conf.mjs'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.utam', 'namespace-map.json'))).toBe(true);
    });

    it('should respect --dry-run without creating files on disk', async () => {
      const result = await Init.run(['--project-dir', tempDir, '--dry-run'], runOpts);

      expect(result.createdFiles).toHaveLength(4);
      expect(fs.existsSync(path.join(tempDir, 'generator.config.json'))).toBe(false);
    });
  });

  describe('Rules command', () => {
    it('should discover components and generate rules files', async () => {
      const lwcDir = path.join(tempDir, 'force-app', 'main', 'default', 'lwc', 'myComp');
      fs.mkdirSync(lwcDir, { recursive: true });
      fs.writeFileSync(
        path.join(lwcDir, 'myComp.js-meta.xml'),
        `<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <targets>
        <target>lightning__RecordPage</target>
    </targets>
</LightningComponentBundle>`,
        'utf-8',
      );

      const result = await Rules.run(['--project-dir', tempDir, '--source', path.join(tempDir, 'force-app')], runOpts);

      expect(result.totalComponentsScanned).toBe(1);
      expect(result.rootComponentsIdentified).toBe(1);
      expect(result.filesCreated).toHaveLength(1);
      expect(fs.existsSync(path.join(lwcDir, 'myComp.rules.json'))).toBe(true);
    });

    it('should respect --dry-run without writing rules files', async () => {
      const lwcDir = path.join(tempDir, 'force-app', 'main', 'default', 'lwc', 'myComp');
      fs.mkdirSync(lwcDir, { recursive: true });
      fs.writeFileSync(
        path.join(lwcDir, 'myComp.js-meta.xml'),
        `<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <targets><target>lightning__RecordPage</target></targets>
</LightningComponentBundle>`,
        'utf-8',
      );

      const result = await Rules.run(
        ['--project-dir', tempDir, '--source', path.join(tempDir, 'force-app'), '--dry-run'],
        runOpts,
      );

      expect(result.filesCreated).toHaveLength(1);
      expect(fs.existsSync(path.join(lwcDir, 'myComp.rules.json'))).toBe(false);
    });
  });

  describe('Overrides command', () => {
    it('should merge overrides into matching utam.json files', async () => {
      const compDir = path.join(tempDir, 'force-app', 'main', 'default', 'lwc', 'myComp');
      const utamDir = path.join(compDir, '__utam__');
      fs.mkdirSync(utamDir, { recursive: true });

      const utamPath = path.join(utamDir, 'myComp.utam.json');
      fs.writeFileSync(
        utamPath,
        JSON.stringify({
          elements: [{ name: 'button', selector: { css: '.slds-button' } }],
        }),
        'utf-8',
      );

      const overridePath = path.join(compDir, 'myComp.utam-overrides.json');
      fs.writeFileSync(
        overridePath,
        JSON.stringify([
          {
            name: 'button',
            element: { shadow: { elements: [{ name: 'inner' }] } },
          },
        ]),
        'utf-8',
      );

      const result = await Overrides.run(
        ['--project-dir', tempDir, '--source', path.join(tempDir, 'force-app')],
        runOpts,
      );

      expect(result.modifiedFilesCount).toBe(1);
      expect(result.totalOverridesApplied).toBe(1);

      interface UtamAst {
        elements: Array<{ shadow?: unknown }>;
      }

      const updated = JSON.parse(fs.readFileSync(utamPath, 'utf-8')) as UtamAst;
      expect(updated.elements[0]?.shadow).toBeDefined();
    });

    it('should respect --dry-run without modifying utam.json', async () => {
      const compDir = path.join(tempDir, 'force-app', 'main', 'default', 'lwc', 'myComp');
      const utamDir = path.join(compDir, '__utam__');
      fs.mkdirSync(utamDir, { recursive: true });

      const utamPath = path.join(utamDir, 'myComp.utam.json');
      fs.writeFileSync(utamPath, JSON.stringify({ elements: [{ name: 'button' }] }), 'utf-8');

      const overridePath = path.join(compDir, 'myComp.utam-overrides.json');
      fs.writeFileSync(overridePath, JSON.stringify([{ name: 'button', element: { shadow: {} } }]), 'utf-8');

      const result = await Overrides.run(
        ['--project-dir', tempDir, '--source', path.join(tempDir, 'force-app'), '--dry-run'],
        runOpts,
      );

      expect(result.modifiedFilesCount).toBe(1);
      interface UtamAst {
        elements: Array<{ shadow?: unknown }>;
      }
      const original = JSON.parse(fs.readFileSync(utamPath, 'utf-8')) as UtamAst;
      expect(original.elements[0]?.shadow).toBeUndefined();
    });
  });

  describe('Rewrite command', () => {
    it('should gracefully handle missing or empty namespace map configuration', async () => {
      const result = await Rewrite.run(
        ['--project-dir', tempDir, '--config', path.join(tempDir, 'nonexistent-map.json')],
        runOpts,
      );

      expect(result.configMissingOrEmpty).toBe(true);
      expect(result.filesModified).toBe(0);
    });

    it('should rewrite component namespace prefixes when config is present', async () => {
      const mapPath = path.join(tempDir, 'namespace-map.json');
      fs.writeFileSync(
        mapPath,
        JSON.stringify({
          'c/pageObjects/myComp': 'shared/pageObjects/myComp',
        }),
        'utf-8',
      );

      const utamDir = path.join(tempDir, 'force-app', '__utam__');
      fs.mkdirSync(utamDir, { recursive: true });
      const schemaPath = path.join(utamDir, 'parent.utam.json');
      fs.writeFileSync(
        schemaPath,
        JSON.stringify({
          elements: [
            {
              name: 'customComp',
              type: 'c/pageObjects/myComp',
            },
          ],
        }),
        'utf-8',
      );

      const result = await Rewrite.run(
        ['--project-dir', tempDir, '--source', path.join(tempDir, 'force-app'), '--config', mapPath],
        runOpts,
      );

      expect(result.filesModified).toBe(1);
      expect(result.totalReplacements).toBe(1);

      interface RewrittenSchema {
        elements: Array<{ type: string }>;
      }

      const rewritten = JSON.parse(fs.readFileSync(schemaPath, 'utf-8')) as RewrittenSchema;
      expect(rewritten.elements[0]?.type).toBe('shared/pageObjects/myComp');
    });
  });

  describe('Steps command', () => {
    it('should detect undefined steps and scaffold snippets', async () => {
      const testDir = path.join(tempDir, 'test');
      fs.mkdirSync(testDir, { recursive: true });

      const featurePath = path.join(testDir, 'login.feature');
      fs.writeFileSync(
        featurePath,
        `Feature: User Login
  Scenario: Admin logs in
    Given user navigates to the login page
    When user enters valid credentials
    Then user is redirected to the home dashboard
`,
        'utf-8',
      );

      const stepsPath = path.join(testDir, 'login.steps.mjs');
      fs.writeFileSync(
        stepsPath,
        `import { Given } from '@cucumber/cucumber';
Given('user navigates to the login page', async () => {});
`,
        'utf-8',
      );

      const outputPath = path.join(testDir, 'generated.steps.mjs');
      const result = await Steps.run(
        ['--project-dir', tempDir, '--features', featurePath, '--steps', stepsPath, '--output', outputPath],
        runOpts,
      );

      expect(result.featureFilesScanned).toBe(1);
      expect(result.stepFilesScanned).toBe(1);
      expect(result.undefinedStepsCount).toBe(2);
      expect(fs.existsSync(outputPath)).toBe(true);

      const content = fs.readFileSync(outputPath, 'utf-8');
      expect(content).toContain("When('user enters valid credentials'");
      expect(content).toContain("Then('user is redirected to the home dashboard'");
    });

    it('should report zero missing steps if all steps are defined', async () => {
      const testDir = path.join(tempDir, 'test');
      fs.mkdirSync(testDir, { recursive: true });

      const featurePath = path.join(testDir, 'simple.feature');
      fs.writeFileSync(
        featurePath,
        `Feature: Simple
  Scenario: Step matches
    Given step is defined
`,
        'utf-8',
      );

      const stepsPath = path.join(testDir, 'simple.steps.mjs');
      fs.writeFileSync(
        stepsPath,
        `import { Given } from '@cucumber/cucumber';
Given('step is defined', async () => {});
`,
        'utf-8',
      );

      const result = await Steps.run(
        ['--project-dir', tempDir, '--features', featurePath, '--steps', stepsPath],
        runOpts,
      );

      expect(result.undefinedStepsCount).toBe(0);
    });
  });

  describe('Build command', () => {
    it('should run build pipeline with --dry-run without spawning processes', async () => {
      const result = await Build.run(['--project-dir', tempDir, '--dry-run'], runOpts);

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
