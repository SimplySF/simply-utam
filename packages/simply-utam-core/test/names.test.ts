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
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { nameSecondaryPageObjects, secondaryPageObjectName } from '../src/names/index.js';

const SCAFFOLDED_GENERATOR_CONFIG = {
  inputRootDir: './force-app',
  ignore: ['**/node_modules/**'],
  outputDir: '__utam__',
  relativeOutputDir: true,
  outputFileExtension: '.utam.json',
  overrideExisting: true,
  rulesFileMask: ['**/*.rules.json'],
};

/** A page object as `utam-generate` writes it, four-space indented with no trailing newline. */
function generated(name: string): string {
  return JSON.stringify(
    {
      description: { author: 'UTAM generator', text: [`Page Object: ${name}`] },
      shadow: { elements: [{ public: true, name: 'button', selector: { css: 'button' } }] },
    },
    null,
    4,
  );
}

describe('secondaryPageObjectName', () => {
  it('appends the template name with its first letter upper-cased', () => {
    expect(secondaryPageObjectName('component_1', 'fooTemplate')).toBe('component_1FooTemplate');
    expect(secondaryPageObjectName('ordersTable', 'PicklistTemplate')).toBe('ordersTablePicklistTemplate');
  });
});

describe('nameSecondaryPageObjects', () => {
  let tempDir: string;
  let lwcDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utam-names-test-'));
    lwcDir = path.join(tempDir, 'force-app', 'main', 'default', 'lwc');
    fs.writeFileSync(path.join(tempDir, 'generator.config.json'), JSON.stringify(SCAFFOLDED_GENERATOR_CONFIG));
    fs.writeFileSync(
      path.join(tempDir, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /** Writes a bundle's templates and, for each name in `pageObjects`, a generated page object beside them. */
  function bundle(name: string, templates: string[], pageObjects: string[], subfolder = ''): string {
    const folder = path.join(lwcDir, name, subfolder);
    fs.mkdirSync(path.join(folder, '__utam__'), { recursive: true });
    for (const template of templates) {
      fs.writeFileSync(path.join(folder, template), '<template></template>');
    }
    for (const pageObject of pageObjects) {
      fs.writeFileSync(path.join(folder, '__utam__', `${pageObject}.utam.json`), generated(pageObject));
    }
    return path.join(folder, '__utam__');
  }

  function utamFiles(utamDir: string): string[] {
    return fs.readdirSync(utamDir).sort();
  }

  function run(
    options: Parameters<typeof nameSecondaryPageObjects>[0] = {},
  ): ReturnType<typeof nameSecondaryPageObjects> {
    return nameSecondaryPageObjects({ rootDir: tempDir, ...options });
  }

  it('leaves a bundle with only its primary template alone', () => {
    const utamDir = bundle('helloWorld', ['helloWorld.html'], ['helloWorld']);

    const result = run();

    expect(result.renames).toEqual([]);
    expect(result.unmatched).toEqual([]);
    expect(utamFiles(utamDir)).toEqual(['helloWorld.utam.json']);
  });

  it('renames a secondary template page object and the description that names it', () => {
    const utamDir = bundle('component_1', ['component_1.html', 'fooTemplate.html'], ['component_1', 'fooTemplate']);

    const result = run();

    expect(result.renames).toEqual([
      {
        template: path.join(lwcDir, 'component_1', 'fooTemplate.html'),
        from: path.join(utamDir, 'fooTemplate.utam.json'),
        to: path.join(utamDir, 'component_1FooTemplate.utam.json'),
        name: 'component_1FooTemplate',
      },
    ]);
    expect(utamFiles(utamDir)).toEqual(['component_1.utam.json', 'component_1FooTemplate.utam.json']);
    const content = fs.readFileSync(path.join(utamDir, 'component_1FooTemplate.utam.json'), 'utf-8');
    expect(content).toBe(generated('component_1FooTemplate'));
  });

  it('keeps a trailing newline and the file indentation', () => {
    const utamDir = bundle('component_1', ['fooTemplate.html'], []);
    const content = JSON.stringify({ description: { text: ['Page Object: fooTemplate'] } }, null, 2) + '\n';
    fs.writeFileSync(path.join(utamDir, 'fooTemplate.utam.json'), content);

    run();

    expect(fs.readFileSync(path.join(utamDir, 'component_1FooTemplate.utam.json'), 'utf-8')).toBe(
      content.replace('Page Object: fooTemplate', 'Page Object: component_1FooTemplate'),
    );
  });

  it('gives two bundles with the same secondary template different names', () => {
    const first = bundle('component_1', ['component_1.html', 'fooTemplate.html'], ['fooTemplate']);
    const second = bundle('component_2', ['component_2.html', 'fooTemplate.html'], ['fooTemplate']);

    const result = run();

    expect(result.collisions).toEqual([]);
    expect(utamFiles(first)).toEqual(['component_1FooTemplate.utam.json']);
    expect(utamFiles(second)).toEqual(['component_2FooTemplate.utam.json']);
  });

  it('renames every template of a datatable bundle, which has no primary template', () => {
    const utamDir = bundle(
      'ordersTable',
      ['picklistTemplate.html', 'lookupTemplate.html'],
      ['picklistTemplate', 'lookupTemplate'],
    );
    fs.writeFileSync(path.join(lwcDir, 'ordersTable', 'ordersTable.js'), 'export default class {}');

    const result = run();

    expect(result.renames.map((rename) => rename.name)).toEqual([
      'ordersTableLookupTemplate',
      'ordersTablePicklistTemplate',
    ]);
    expect(utamFiles(utamDir)).toEqual([
      'ordersTableLookupTemplate.utam.json',
      'ordersTablePicklistTemplate.utam.json',
    ]);
  });

  it('leaves and lists a page object that matches no template', () => {
    const utamDir = bundle('component_1', ['component_1.html'], ['component_1', 'handWritten']);

    const result = run();

    expect(result.unmatched).toEqual([path.join(utamDir, 'handWritten.utam.json')]);
    expect(utamFiles(utamDir)).toEqual(['component_1.utam.json', 'handWritten.utam.json']);
  });

  it('prefixes frame page objects of a secondary template and leaves those of the primary', () => {
    const utamDir = bundle(
      'component_1',
      ['component_1.html', 'foo.html', 'foo_bar.html'],
      ['component_1', 'component_1_frame', 'foo', 'foo_frame', 'foo_bar', 'foo_bar_frame'],
    );

    run();

    expect(utamFiles(utamDir)).toEqual([
      'component_1.utam.json',
      'component_1Foo.utam.json',
      'component_1Foo_bar.utam.json',
      'component_1Foo_bar_frame.utam.json',
      'component_1Foo_frame.utam.json',
      'component_1_frame.utam.json',
    ]);
  });

  it('renames page objects of templates in a bundle subfolder, prefixed with the bundle name', () => {
    const utamDir = bundle('ordersTable', ['picklist.html'], ['picklist'], 'templates');

    run();

    expect(utamFiles(utamDir)).toEqual(['ordersTablePicklist.utam.json']);
  });

  it('replaces the copy a previous run renamed, and lists nothing as unmatched on a second run', () => {
    const utamDir = bundle('component_1', ['fooTemplate.html'], ['fooTemplate']);
    fs.writeFileSync(path.join(utamDir, 'component_1FooTemplate.utam.json'), '{"stale": true}');

    const first = run();
    const second = run();

    expect(first.collisions).toEqual([]);
    expect(
      JSON.parse(fs.readFileSync(path.join(utamDir, 'component_1FooTemplate.utam.json'), 'utf-8')),
    ).not.toHaveProperty('stale');
    expect(second.renames).toEqual([]);
    expect(second.unmatched).toEqual([]);
    expect(utamFiles(utamDir)).toEqual(['component_1FooTemplate.utam.json']);
  });

  it('renames nothing when the rule gives two page objects one name', () => {
    const first = bundle('a', ['bC.html'], ['bC']);
    const second = bundle('aB', ['c.html'], ['c']);

    const result = run();

    expect(result.collisions).toEqual([
      { name: 'aBC', sources: [path.join(first, 'bC.utam.json'), path.join(second, 'c.utam.json')] },
    ]);
    expect(utamFiles(first)).toEqual(['bC.utam.json']);
    expect(utamFiles(second)).toEqual(['c.utam.json']);
  });

  it('counts names that differ only in case as a collision', () => {
    bundle('ordersTable', ['picklist.html'], ['picklist']);
    bundle('orders', ['tablePicklist.html'], ['tablePicklist']);
    bundle('ordersTablepicklist', ['ordersTablepicklist.html'], ['ordersTablepicklist']);

    const result = run();

    expect(result.collisions).toHaveLength(1);
    expect(result.collisions[0]?.sources).toHaveLength(3);
  });

  it('counts a hand-written page object the compiler reads as a collision', () => {
    bundle('component_1', ['fooTemplate.html'], ['fooTemplate']);
    const testUtam = path.join(tempDir, 'force-app', 'test', 'utam', '__utam__');
    fs.mkdirSync(testUtam, { recursive: true });
    fs.writeFileSync(path.join(testUtam, 'component_1FooTemplate.utam.json'), '{}');

    const result = run();

    expect(result.collisions.map((collision) => collision.name)).toEqual(['component_1FooTemplate']);
    expect(result.renames).toHaveLength(1);
    expect(fs.existsSync(path.join(lwcDir, 'component_1', '__utam__', 'fooTemplate.utam.json'))).toBe(true);
  });

  it("reads the compiler's file mask and root from utam.config.json", () => {
    bundle('component_1', ['fooTemplate.html'], ['fooTemplate']);
    const elsewhere = path.join(tempDir, 'shared', 'pos');
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.writeFileSync(path.join(elsewhere, 'component_1FooTemplate.utam.json'), '{}');

    expect(run().collisions).toEqual([]);

    fs.writeFileSync(
      path.join(tempDir, 'utam.config.json'),
      JSON.stringify({
        pageObjectsRootDir: './',
        pageObjectsFileMask: ['**/__utam__/**/*.utam.json', 'shared/**/*.utam.json'],
      }),
    );
    expect(run({ dryRun: true }).collisions.map((collision) => collision.name)).toEqual(['component_1FooTemplate']);
  });

  it('leaves a description set through generator config alone', () => {
    const utamDir = bundle('component_1', ['fooTemplate.html'], []);
    fs.writeFileSync(
      path.join(utamDir, 'fooTemplate.utam.json'),
      JSON.stringify({ description: { text: ['Our own words'] } }, null, 4),
    );

    run();

    const json = JSON.parse(fs.readFileSync(path.join(utamDir, 'component_1FooTemplate.utam.json'), 'utf-8')) as {
      description: { text: string[] };
    };
    expect(json.description.text).toEqual(['Our own words']);
  });

  it('reports renames without writing on a dry run', () => {
    const utamDir = bundle('component_1', ['fooTemplate.html'], ['fooTemplate']);

    const result = run({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.renames).toHaveLength(1);
    expect(utamFiles(utamDir)).toEqual(['fooTemplate.utam.json']);
  });

  it('skips when there is no generator config', () => {
    const utamDir = bundle('component_1', ['fooTemplate.html'], ['fooTemplate']);
    fs.rmSync(path.join(tempDir, 'generator.config.json'));

    const result = run();

    expect(result.skipped).toContain('No generator config');
    expect(utamFiles(utamDir)).toEqual(['fooTemplate.utam.json']);
  });

  it('reads the generator config from a given path', () => {
    bundle('component_1', ['fooTemplate.html'], ['fooTemplate']);
    fs.renameSync(path.join(tempDir, 'generator.config.json'), path.join(tempDir, 'gen.json'));

    expect(run({ generatorConfigPath: 'gen.json' }).renames).toHaveLength(1);
  });

  it('fails before renaming anything when the generator writes one output folder', () => {
    const utamDir = bundle('component_1', ['fooTemplate.html'], ['fooTemplate']);
    const withoutRelative: Partial<typeof SCAFFOLDED_GENERATOR_CONFIG> = { ...SCAFFOLDED_GENERATOR_CONFIG };
    delete withoutRelative.relativeOutputDir;
    fs.writeFileSync(path.join(tempDir, 'generator.config.json'), JSON.stringify(withoutRelative));

    expect(() => run()).toThrow(/relativeOutputDir: false/);
    expect(utamFiles(utamDir)).toEqual(['fooTemplate.utam.json']);
  });

  it('fails for another output folder name or extension', () => {
    fs.writeFileSync(
      path.join(tempDir, 'generator.config.json'),
      JSON.stringify({ ...SCAFFOLDED_GENERATOR_CONFIG, outputDir: 'po', outputFileExtension: '.json' }),
    );

    expect(() => run()).toThrow(/outputDir: "po", outputFileExtension: ".json"/);
  });

  it('only looks in the given source directories', () => {
    const utamDir = bundle('component_1', ['fooTemplate.html'], ['fooTemplate']);

    expect(run({ sourceDirs: [path.join(tempDir, 'other')] }).renames).toEqual([]);
    expect(utamFiles(utamDir)).toEqual(['fooTemplate.utam.json']);
  });
});
