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
import {
  generateGeneratorConfig,
  generateUtamConfig,
  generateWdioConfig,
  generateNamespaceMap,
  generateHelloFeature,
  generateHelloSteps,
  generateSnapshotGuide,
  generateSnapshotSteps,
  injectWireitConfiguration,
  checkMissingDependencies,
  scaffoldProject,
  loadTemplate,
  DEFAULT_TEMPLATES_DIR,
} from '../src/scaffold/index.js';

describe('scaffold service', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simply-utam-scaffold-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('template loader', () => {
    it('DEFAULT_TEMPLATES_DIR should exist and contain all 7 standard template files', () => {
      expect(fs.existsSync(DEFAULT_TEMPLATES_DIR)).toBe(true);
      expect(fs.existsSync(path.join(DEFAULT_TEMPLATES_DIR, 'generator.config.json'))).toBe(true);
      expect(fs.existsSync(path.join(DEFAULT_TEMPLATES_DIR, 'utam.config.json'))).toBe(true);
      expect(fs.existsSync(path.join(DEFAULT_TEMPLATES_DIR, 'wdio.conf.mjs'))).toBe(true);
      expect(fs.existsSync(path.join(DEFAULT_TEMPLATES_DIR, 'namespace-map.json'))).toBe(true);
      expect(fs.existsSync(path.join(DEFAULT_TEMPLATES_DIR, 'wireit.json'))).toBe(true);
      expect(fs.existsSync(path.join(DEFAULT_TEMPLATES_DIR, 'hello.feature'))).toBe(true);
      expect(fs.existsSync(path.join(DEFAULT_TEMPLATES_DIR, 'hello.steps.mjs'))).toBe(true);
    });

    it('loadTemplate should perform token replacement', () => {
      const result = loadTemplate('generator.config.json', DEFAULT_TEMPLATES_DIR, {
        sourceDir: 'my-custom-src',
        appName: 'my-custom-app',
      });
      expect(result).toContain('"inputRootDir": "./my-custom-src"');
      expect(result).toContain('"c": "my-custom-app/pageObjects/"');
    });

    it('loadTemplate should throw when template file does not exist', () => {
      expect(() => loadTemplate('missing-template.json', tempDir)).toThrow("Scaffold template not found: '");
    });
  });

  describe('configuration generators', () => {
    it('generateGeneratorConfig should produce valid UTAM generator configuration', () => {
      const config = generateGeneratorConfig('force-app', 'my-app');
      expect(config['inputRootDir']).toBe('./force-app');
      expect(config['outputDir']).toBe('__utam__');
      expect(config['namespaces']).toEqual({
        lightning: 'salesforce-pageobjects/lightning/pageObjects/',
        c: 'my-app/pageObjects/',
      });
    });

    it('keeps a leading ../ and strips a leading ./ in config paths', () => {
      expect(generateGeneratorConfig('../shared/force-app', 'a')['inputRootDir']).toBe('./../shared/force-app');
      expect(generateGeneratorConfig('./force-app', 'a')['inputRootDir']).toBe('./force-app');
      expect(generateGeneratorConfig('.', 'a')['inputRootDir']).toBe('./');
      expect(generateWdioConfig('../shared/force-app')).toContain("'../shared/force-app/**/test/*.feature'");
      expect(generateWdioConfig('.')).toContain("'./**/test/*.feature'");
      expect(generateWdioConfig('force-app\\main')).toContain("'force-app/main/**/test/*.feature'");
    });

    it('uses an absolute source path as is, such as a folder on another Windows drive', () => {
      expect(generateGeneratorConfig('D:\\src\\force-app', 'a')['inputRootDir']).toBe('D:/src/force-app');
      expect(generateGeneratorConfig('/abs/force-app', 'a')['inputRootDir']).toBe('/abs/force-app');
      expect(generateWdioConfig('D:\\src\\force-app')).toContain("'D:/src/force-app/**/test/*.feature'");
    });

    it('generateUtamConfig should produce valid compiler configuration', () => {
      const config = generateUtamConfig();
      expect(config['pageObjectsOutputDir']).toBe('pageObjects');
      expect(config['moduleTarget']).toBe('module');
      expect(config['skipCommonJs']).toBe(true);
    });

    it('generateWdioConfig should embed source directory in wdio specs and steps paths', () => {
      const config = generateWdioConfig('sfdx-source');
      expect(config).toContain("specs: ['sfdx-source/**/test/*.feature'");
      expect(config).toContain("require: ['sfdx-source/**/test/*.steps.mjs'");
      expect(config).toContain("runner: 'local'");
    });

    it('generateNamespaceMap should map application pageObjects to shared library', () => {
      const map = generateNamespaceMap('test-app');
      expect(map['test-app/pageObjects/shared']).toBe('shared-components-pageobjects/pageObjects/shared');
    });

    it('generateHelloFeature should produce valid starter Gherkin feature file', () => {
      const feature = generateHelloFeature();
      expect(feature).toContain('Feature: Salesforce UI Smoke Test');
      expect(feature).toContain('Scenario: Log in and navigate to Salesforce Home');
      expect(feature).toContain('Given I open the Salesforce application "Sales"');
    });

    it('generateHelloSteps should produce valid starter step definition script', () => {
      const steps = generateHelloSteps();
      expect(steps).toContain("import { Given } from '@wdio/cucumber-framework';");
      expect(steps).toContain("import { goToApplication } from '@simplysf/simply-utam';");
      expect(steps).toContain("Given('I open the Salesforce application {string}'");
    });
  });

  describe('injectWireitConfiguration', () => {
    it('should inject scripts and wireit tasks into an empty package.json', () => {
      const pkg = { name: 'my-pkg' };
      const res = injectWireitConfiguration(pkg);

      expect(res.updated).toBe(true);
      expect(res.addedScripts).toHaveLength(6);
      expect(res.addedTasks).toHaveLength(6);

      const scripts = res.packageJson['scripts'] as Record<string, string>;
      expect(scripts['build:utam-rules']).toBe('wireit');
      expect(scripts['build:utam-generate']).toBe('wireit');
      expect(scripts['build:utam-overrides']).toBe('wireit');
      expect(scripts['build:utam-rewrite-namespaces']).toBe('wireit');
      expect(scripts['build:utam']).toBe('wireit');
      expect(scripts['test:ui']).toBe('wireit');

      const wireit = res.packageJson['wireit'] as Record<string, unknown>;
      expect(wireit['build:utam-rules']).toBeDefined();
      expect(wireit['build:utam-generate']).toBeDefined();
    });

    it('should not overwrite existing scripts or tasks', () => {
      const pkg = {
        name: 'custom',
        scripts: {
          'build:utam-rules': 'custom-command',
        },
        wireit: {
          'build:utam-rules': { command: 'echo custom' },
        },
      };

      const res = injectWireitConfiguration(pkg);
      expect(res.addedScripts).not.toContain('build:utam-rules');
      expect(res.addedTasks).not.toContain('build:utam-rules');

      const scripts = res.packageJson['scripts'] as Record<string, string>;
      expect(scripts['build:utam-rules']).toBe('custom-command');
    });

    it('should report updated=false if all tasks and scripts are present', () => {
      const pkg = { name: 'complete' };
      const initial = injectWireitConfiguration(pkg);
      const second = injectWireitConfiguration(initial.packageJson);

      expect(second.updated).toBe(false);
      expect(second.addedScripts).toHaveLength(0);
      expect(second.addedTasks).toHaveLength(0);
    });
  });

  describe('checkMissingDependencies', () => {
    it('should identify missing required devDependencies', () => {
      const missing = checkMissingDependencies({});
      expect(missing).toContain('wireit');
      expect(missing).toContain('utam');
      expect(missing).toContain('@wdio/cucumber-framework');
      expect(missing).toContain('chromedriver');
      expect(missing).toContain('@wdio/allure-reporter');
      expect(missing).toContain('allure-commandline');
      expect(missing).toContain('@simplysf/simply-utam');
    });

    it('should recognize present dependencies in dependencies or devDependencies', () => {
      const pkg = {
        devDependencies: {
          wireit: '^0.14.0',
          utam: '^3.3.0',
        },
        dependencies: {
          '@simplysf/simply-utam': '^0.1.0',
        },
      };

      const missing = checkMissingDependencies(pkg);
      expect(missing).not.toContain('wireit');
      expect(missing).not.toContain('utam');
      expect(missing).not.toContain('@simplysf/simply-utam');
      expect(missing).toContain('salesforce-pageobjects');
    });
  });

  describe('scaffoldProject', () => {
    it('should scaffold config files and starter test files when test directory does not exist', async () => {
      const pkgPath = path.join(tempDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify({ name: 'my-sfdx-project' }), 'utf-8');

      const result = await scaffoldProject({
        projectDir: tempDir,
        sourceDir: 'force-app',
      });

      // Six scaffold files, the DOM snapshot guide and capture step, and .gitignore.
      expect(result.createdFiles).toHaveLength(9);
      expect(result.createdFiles).toContain(path.join('force-app', 'test', 'utam', 'SNAPSHOTS.md'));
      expect(result.createdFiles).toContain(
        path.join('force-app', 'test', 'utam', 'step_definitions', 'dom-snapshot.steps.mjs'),
      );
      expect(result.createdFiles).toContain('.gitignore');
      expect(result.snapshotHooksMissing).toBe(false);
      expect(result.createdFiles).toContain('generator.config.json');
      expect(result.createdFiles).toContain('utam.config.json');
      expect(result.createdFiles).toContain('wdio.conf.mjs');
      expect(result.createdFiles).toContain(path.join('.utam', 'namespace-map.json'));
      expect(result.createdFiles).toContain(path.join('force-app', 'test', 'utam', 'features', 'hello.feature'));
      expect(result.createdFiles).toContain(
        path.join('force-app', 'test', 'utam', 'step_definitions', 'hello.steps.mjs'),
      );
      expect(result.modifiedFiles).toContain('package.json');

      expect(fs.existsSync(path.join(tempDir, 'generator.config.json'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'utam.config.json'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'wdio.conf.mjs'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.utam', 'namespace-map.json'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'force-app', 'test', 'utam', 'features', 'hello.feature'))).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, 'force-app', 'test', 'utam', 'step_definitions', 'hello.steps.mjs')),
      ).toBe(true);

      const updatedPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
        scripts: Record<string, string>;
      };
      expect(updatedPkg.scripts['build:utam']).toBe('wireit');
    });

    it('should not scaffold hello world test if test/utam already exists', async () => {
      const existingUtamDir = path.join(tempDir, 'force-app', 'test', 'utam');
      fs.mkdirSync(existingUtamDir, { recursive: true });

      const result = await scaffoldProject({
        projectDir: tempDir,
        sourceDir: 'force-app',
      });

      // The snapshot guide and capture step are new files, so they go into the existing folder.
      expect(result.createdFiles).toHaveLength(7);
      expect(fs.existsSync(path.join(existingUtamDir, 'features', 'hello.feature'))).toBe(false);
      expect(fs.existsSync(path.join(existingUtamDir, 'SNAPSHOTS.md'))).toBe(true);
      expect(fs.existsSync(path.join(existingUtamDir, 'step_definitions', 'dom-snapshot.steps.mjs'))).toBe(true);
    });

    it('should skip existing files unless force is true', async () => {
      const genPath = path.join(tempDir, 'generator.config.json');
      fs.writeFileSync(genPath, '{"custom": true}', 'utf-8');

      const initial = await scaffoldProject({
        projectDir: tempDir,
        sourceDir: 'force-app',
      });

      expect(initial.skippedFiles).toContain('generator.config.json');
      expect(fs.readFileSync(genPath, 'utf-8')).toBe('{"custom": true}');

      const forced = await scaffoldProject({
        projectDir: tempDir,
        sourceDir: 'force-app',
        force: true,
      });

      expect(forced.createdFiles).toContain('generator.config.json');
      expect(fs.readFileSync(genPath, 'utf-8')).not.toBe('{"custom": true}');
    });

    it('should not modify files on disk during dryRun', async () => {
      const result = await scaffoldProject({
        projectDir: tempDir,
        sourceDir: 'force-app',
        dryRun: true,
      });

      expect(result.createdFiles).toHaveLength(9);
      expect(fs.existsSync(path.join(tempDir, 'generator.config.json'))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, '.gitignore'))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, 'utam.config.json'))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, 'force-app', 'test', 'utam', 'features', 'hello.feature'))).toBe(false);
    });
  });

  describe('scaffoldProject .forceignore', () => {
    const writeSfdxProject = (packagePath = 'force-app'): void => {
      fs.writeFileSync(
        path.join(tempDir, 'sfdx-project.json'),
        JSON.stringify({ packageDirectories: [{ path: packagePath, default: true }] }),
        'utf-8',
      );
    };
    const readForceignore = (): string => fs.readFileSync(path.join(tempDir, '.forceignore'), 'utf-8');

    it('creates .forceignore with the UTAM rules and the scaffolded test folder', async () => {
      writeSfdxProject();

      const result = await scaffoldProject({ projectDir: tempDir });

      expect(result.createdFiles).toContain('.forceignore');
      expect(result.forceignore?.action).toBe('created');
      expect(readForceignore()).toBe(
        [
          '# Ignore UTAM',
          '**/__utam__/**',
          '**/lwc/**/*.rules.json',
          '**/*.utam-overrides.json',
          'force-app/test/utam/',
          '',
        ].join('\n'),
      );
    });

    it('adds only missing rules to an existing file and lists it as modified', async () => {
      writeSfdxProject();
      fs.writeFileSync(
        path.join(tempDir, '.forceignore'),
        '# Ignore UTAM\n**/__utam__/**\n**/*.rules.json\n**/*.utam-overrides.json\n',
        'utf-8',
      );

      const result = await scaffoldProject({ projectDir: tempDir });

      expect(result.modifiedFiles).toContain('.forceignore');
      expect(result.forceignore?.addedPatterns).toStrictEqual(['force-app/test/utam/']);
      expect(readForceignore()).toBe(
        '# Ignore UTAM\n**/__utam__/**\n**/*.rules.json\n**/*.utam-overrides.json\nforce-app/test/utam/\n',
      );
    });

    it('covers an existing test folder inside a package directory', async () => {
      writeSfdxProject();
      fs.mkdirSync(path.join(tempDir, 'force-app', 'tests', 'utam'), { recursive: true });

      const result = await scaffoldProject({ projectDir: tempDir });

      expect(result.forceignore?.addedPatterns).toContain('force-app/tests/utam/');
      expect(result.forceignore?.addedPatterns).not.toContain('force-app/test/utam/');
    });

    it('gives no rule to a test folder at the project root', async () => {
      writeSfdxProject();
      fs.mkdirSync(path.join(tempDir, 'test', 'utam'), { recursive: true });

      const result = await scaffoldProject({ projectDir: tempDir });

      expect(result.forceignore?.addedPatterns).toStrictEqual([
        '**/__utam__/**',
        '**/lwc/**/*.rules.json',
        '**/*.utam-overrides.json',
      ]);
    });

    it('inserts into a custom customization region', async () => {
      writeSfdxProject();
      fs.writeFileSync(path.join(tempDir, '.forceignore'), '# LOCAL START\nteam/\n# LOCAL END\n', 'utf-8');

      const result = await scaffoldProject({
        projectDir: tempDir,
        forceignoreRegionStart: '# LOCAL START',
        forceignoreRegionEnd: '# LOCAL END',
      });

      expect(result.forceignore?.placement).toBe('region');
      expect(readForceignore().endsWith('force-app/test/utam/\n# LOCAL END\n')).toBe(true);
    });

    it('reports but does not write .forceignore during dryRun', async () => {
      writeSfdxProject();

      const result = await scaffoldProject({ projectDir: tempDir, dryRun: true });

      expect(result.createdFiles).toContain('.forceignore');
      expect(fs.existsSync(path.join(tempDir, '.forceignore'))).toBe(false);
    });

    it('leaves .forceignore alone and omits the result when disabled', async () => {
      writeSfdxProject();

      const result = await scaffoldProject({ projectDir: tempDir, forceignore: false });

      expect(result.forceignore).toBeUndefined();
      expect(fs.existsSync(path.join(tempDir, '.forceignore'))).toBe(false);
    });

    it('turns an absolute source directory into a project-relative rule and paths', async () => {
      writeSfdxProject();

      const result = await scaffoldProject({ projectDir: tempDir, sourceDir: path.join(tempDir, 'force-app') });

      expect(result.forceignore?.addedPatterns).toContain('force-app/test/utam/');
      expect(result.createdFiles).toContain(path.join('force-app', 'test', 'utam', 'features', 'hello.feature'));
      expect(fs.existsSync(path.join(tempDir, 'force-app', 'test', 'utam', 'features', 'hello.feature'))).toBe(true);
    });

    it('finishes scaffolding and updates package.json when .forceignore cannot be read', async () => {
      writeSfdxProject();
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'p' }), 'utf-8');
      fs.mkdirSync(path.join(tempDir, '.forceignore'));

      const result = await scaffoldProject({ projectDir: tempDir });

      expect(result.forceignore?.action).toBe('failed');
      expect(result.modifiedFiles).toStrictEqual(['package.json']);
      expect(result.createdFiles).not.toContain('.forceignore');
    });

    it('with force, adds rules for both the existing and the scaffolded test folders', async () => {
      writeSfdxProject();
      fs.mkdirSync(path.join(tempDir, 'force-app', 'tests', 'utam'), { recursive: true });

      const result = await scaffoldProject({ projectDir: tempDir, force: true });

      expect(result.forceignore?.addedPatterns).toContain('force-app/tests/utam/');
      expect(result.forceignore?.addedPatterns).toContain('force-app/test/utam/');
    });

    // GitHub's Windows runners keep the temp folder on C: and the checkout on D:, which is the only
    // way to get a source folder on another drive than the project.
    const tempRoot = path.parse(os.tmpdir()).root.toLowerCase();
    const cwdRoot = path.parse(process.cwd()).root.toLowerCase();
    it.runIf(process.platform === 'win32' && tempRoot !== cwdRoot)(
      'scaffolds into a source folder on another Windows drive',
      async () => {
        writeSfdxProject();
        const otherDriveSource = fs.mkdtempSync(path.join(process.cwd(), '.simply-utam-other-drive-'));
        try {
          const result = await scaffoldProject({ projectDir: tempDir, sourceDir: otherDriveSource });

          const helloFeature = path.join(otherDriveSource, 'test', 'utam', 'features', 'hello.feature');
          expect(fs.existsSync(helloFeature)).toBe(true);
          expect(result.createdFiles).toContain(
            path.join(otherDriveSource, 'test', 'utam', 'features', 'hello.feature'),
          );
          expect(fs.readdirSync(tempDir).some((name) => /^[a-z]:$/i.test(name))).toBe(false);
          expect(result.forceignore?.addedPatterns).toStrictEqual([
            '**/__utam__/**',
            '**/lwc/**/*.rules.json',
            '**/*.utam-overrides.json',
          ]);
        } finally {
          fs.rmSync(otherDriveSource, { recursive: true, force: true });
        }
      },
    );

    it('skips projects without sfdx-project.json or .forceignore', async () => {
      const result = await scaffoldProject({ projectDir: tempDir, sourceDir: 'force-app' });

      expect(result.forceignore?.action).toBe('skipped');
      expect(result.createdFiles).not.toContain('.forceignore');
    });
  });

  describe('DOM snapshots', () => {
    it('adds capture on failure, pruning, the custom command and a step timeout above UTAM waits to wdio.conf.mjs', () => {
      const config = generateWdioConfig('force-app');
      expect(config).toContain(
        "import { captureDomSnapshot, pruneDomSnapshots, serializeDomSnapshot, writeDomSnapshot } from '@simplysf/simply-utam';",
      );
      expect(config).toContain('await pruneDomSnapshots({ keepRuns: 10 });');
      expect(config).toContain("browser.addCommand('domSnapshot'");
      expect(config).toContain("trigger: 'failure'");
      expect(config).toContain('timeout: (DEBUG ? DEBUG_TIMEOUT : EXPLICIT_TIMEOUT) + STEP_TIMEOUT_MARGIN,');
      expect(config).toContain('waitforTimeout: DEBUG ? DEBUG_TIMEOUT : EXPLICIT_TIMEOUT,');
      expect(config).toContain('disableWebdriverScreenshotsReporting: false');
      expect(config).not.toContain('Screenshotes');
      // The failure capture runs before the screenshot, so it sees the page as the step left it.
      expect(config.indexOf("trigger: 'failure'")).toBeLessThan(
        config.indexOf('await browser.takeScreenshot();\n    }\n  },\n  afterScenario'),
      );
    });

    it('scaffolds the capture step and the usage guide with both recipes', () => {
      const steps = generateSnapshotSteps();
      expect(steps).toContain("When('I capture the DOM snapshot', async function ()");
      expect(steps).toContain("When('I capture the DOM snapshot {string}', async function (label)");
      const guide = generateSnapshotGuide();
      expect(guide).toMatch(/^---\nname: utam-dom-snapshots\ndescription: .+\n---\n/);
      expect(guide).toContain('### Attach your own page object below the last shipped one');
      expect(guide).toContain('### Scope a shipped root page object to the visible copy');
      for (const [, json] of guide.matchAll(/```json\n([\s\S]*?)```/g))
        expect(() => JSON.parse(json) as unknown).not.toThrow();
    });

    it('notes when a kept wdio.conf.mjs does not capture DOM snapshots', async () => {
      fs.writeFileSync(path.join(tempDir, 'wdio.conf.mjs'), 'export const config = {};\n');
      const missing = await scaffoldProject({ projectDir: tempDir, sourceDir: 'force-app' });
      expect(missing.skippedFiles).toContain('wdio.conf.mjs');
      expect(missing.snapshotHooksMissing).toBe(true);

      fs.writeFileSync(path.join(tempDir, 'wdio.conf.mjs'), 'import { captureDomSnapshot } from "x";\n');
      const present = await scaffoldProject({ projectDir: tempDir, sourceDir: 'force-app' });
      expect(present.snapshotHooksMissing).toBe(false);
    });

    it('leaves .gitignore alone with gitignore: false', async () => {
      const result = await scaffoldProject({ projectDir: tempDir, sourceDir: 'force-app', gitignore: false });
      expect(result.gitignore).toBeUndefined();
      expect(fs.existsSync(path.join(tempDir, '.gitignore'))).toBe(false);
    });
  });
});
