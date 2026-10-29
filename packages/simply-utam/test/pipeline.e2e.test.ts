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

// Runs the build pipeline against the real `utam-generate` and `utam` compiler (a dev dependency),
// so the names stage is checked against what the generator actually writes, not against a fake that
// encodes the same assumptions as the code under test. See docs/design/0005.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeBuildPipeline } from '../src/pipeline-runner.js';

const PACKAGE_NODE_MODULES = fileURLToPath(new URL('../node_modules', import.meta.url));
const TIMEOUT = 120_000;

/** The scaffolded generator config, as `simply-utam init` writes it. */
const GENERATOR_CONFIG = {
  inputRootDir: './force-app',
  ignore: ['**/node_modules/**'],
  outputDir: '__utam__',
  relativeOutputDir: true,
  outputFileExtension: '.utam.json',
  overrideExisting: true,
  rulesFileMask: ['**/*.rules.json'],
  namespaces: { lightning: 'salesforce-pageobjects/lightning/pageObjects/', c: 'e2e-app/pageObjects/' },
};

const UTAM_CONFIG = {
  pageObjectsRootDir: './',
  pageObjectsFileMask: ['**/__utam__/**/*.utam.json'],
  pageObjectsOutputDir: 'pageObjects',
  moduleTarget: 'module',
  skipCommonJs: true,
};

const APP_PAGE_META = `<LightningComponentBundle><targets><target>lightning__AppPage</target></targets></LightningComponentBundle>`;

describe('executeBuildPipeline with the real UTAM generator and compiler', () => {
  let projectDir: string;
  let lwcDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simply-utam-e2e-'));
    lwcDir = path.join(projectDir, 'force-app', 'main', 'default', 'lwc');
    fs.writeFileSync(
      path.join(projectDir, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }),
    );
    fs.writeFileSync(path.join(projectDir, 'generator.config.json'), JSON.stringify(GENERATOR_CONFIG));
    fs.writeFileSync(path.join(projectDir, 'utam.config.json'), JSON.stringify(UTAM_CONFIG));
    // The pipeline runs `node_modules/.bin/utam-generate` and `utam` from the project.
    fs.symlinkSync(PACKAGE_NODE_MODULES, path.join(projectDir, 'node_modules'), 'junction');

    // Two components switching to a same-named template in render().
    for (const component of ['component_1', 'component_2']) {
      const dir = path.join(lwcDir, component);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${component}.html`), '<template><div class="main">main</div></template>');
      fs.writeFileSync(path.join(dir, 'fooTemplate.html'), '<template><button class="extra">extra</button></template>');
    }

    // Two datatables with custom type templates and no primary template, exposed on an App Page.
    for (const table of ['ordersTable', 'casesTable']) {
      const dir = path.join(lwcDir, table);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${table}.js`), "import LightningDatatable from 'lightning/datatable';\n");
      fs.writeFileSync(path.join(dir, `${table}.js-meta.xml`), APP_PAGE_META);
      fs.writeFileSync(
        path.join(dir, 'picklistTemplate.html'),
        '<template><span class="value">{typeAttributes.label}</span><button class="edit">Edit</button></template>',
      );
      fs.writeFileSync(
        path.join(dir, 'lookupTemplate.html'),
        '<template><lightning-badge label="x"></lightning-badge></template>',
      );
    }
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  function generatedFiles(): string[] {
    return fs
      .readdirSync(path.join(projectDir, 'force-app'), { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('.utam.json') || file.endsWith('.rules.json'))
      .map((file) => file.split(path.sep).join('/'))
      .sort();
  }

  function compiled(): string[] {
    return fs
      .readdirSync(path.join(projectDir, 'pageObjects'))
      .filter((file) => file.endsWith('.js'))
      .sort();
  }

  it(
    'compiles one page object per template, under per-component names',
    async () => {
      // Named after the template, so it still applies: overrides runs before names.
      fs.writeFileSync(
        path.join(lwcDir, 'ordersTable', 'picklistTemplate.utam-overrides.json'),
        JSON.stringify([{ name: 'button', element: { nullable: true } }]),
      );

      const result = await executeBuildPipeline({ projectDir });

      expect(result.errors).toEqual([]);
      expect(result.success).toBe(true);
      expect(result.pageObjectsRenamed).toBe(6);
      expect(compiled()).toEqual([
        'casesTableLookupTemplate.js',
        'casesTablePicklistTemplate.js',
        'component_1.js',
        'component_1FooTemplate.js',
        'component_2.js',
        'component_2FooTemplate.js',
        'ordersTableLookupTemplate.js',
        'ordersTablePicklistTemplate.js',
      ]);
      // The datatables get no rules file: there is no template for it to configure.
      expect(generatedFiles().filter((file) => file.endsWith('.rules.json'))).toEqual([]);

      const picklist = JSON.parse(
        fs.readFileSync(path.join(lwcDir, 'ordersTable', '__utam__', 'ordersTablePicklistTemplate.utam.json'), 'utf-8'),
      ) as { description: { text: string[] }; shadow: { elements: Array<{ name: string; nullable?: boolean }> } };
      expect(picklist.description.text).toContain('Page Object: ordersTablePicklistTemplate');
      expect(picklist.shadow.elements.find((element) => element.name === 'button')?.nullable).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'gives the same files on a second run, when the generator writes the old names again',
    async () => {
      await executeBuildPipeline({ projectDir });
      const firstRun = generatedFiles();

      const result = await executeBuildPipeline({ projectDir });

      expect(result.success).toBe(true);
      expect(generatedFiles()).toEqual(firstRun);
      expect(compiled()).toHaveLength(8);
    },
    TIMEOUT,
  );

  it(
    'with skipNames, compiles same-named templates to one file, which is the clash the stage prevents',
    async () => {
      const result = await executeBuildPipeline({ projectDir, skipNames: true });

      expect(result.success).toBe(true);
      expect(compiled()).toEqual([
        'component_1.js',
        'component_2.js',
        'fooTemplate.js',
        'lookupTemplate.js',
        'picklistTemplate.js',
      ]);
    },
    TIMEOUT,
  );

  it(
    'stops before compiling when a new name matches a hand-written page object',
    async () => {
      const testUtam = path.join(projectDir, 'force-app', 'test', 'utam', '__utam__');
      fs.mkdirSync(testUtam, { recursive: true });
      fs.writeFileSync(path.join(testUtam, 'component_1FooTemplate.utam.json'), JSON.stringify({ elements: [] }));

      const result = await executeBuildPipeline({ projectDir });

      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/^Page object naming failed: .*component_1FooTemplate/);
      expect(result.compilerExecuted).toBe(false);
      expect(fs.existsSync(path.join(projectDir, 'pageObjects'))).toBe(false);
    },
    TIMEOUT,
  );
});
