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

import * as path from 'node:path';
import { Command, Flags } from '@oclif/core';
import { nameSecondaryPageObjects, type NameSecondaryPageObjectsResult } from '@simplysf/simply-utam-core';

/**
 * CLI command to give page objects generated from secondary LWC templates unique names.
 */
export default class Names extends Command {
  public static override summary =
    'Rename page objects generated from secondary LWC templates to <component><Template>.';

  public static override description =
    'The UTAM compiler names each page object after its .utam.json file and writes them all to one folder, so two bundles with a template of the same name (such as a datatable custom type template) overwrite each other. Run after utam-generate and overrides, this renames the page objects of every template not named after its bundle to <bundle><Template>; frame page objects take the same prefix. Fails, renaming nothing, when a new name would match another page object the compiler reads, and warns about page objects that already share a name. Skips with a warning when the generator config does not write page objects into __utam__ beside each template.';

  public static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --source force-app',
    '<%= config.bin %> <%= command.id %> --dry-run --verbose',
  ];

  public static override enableJsonFlag = true;

  public static override flags = {
    source: Flags.string({
      char: 's',
      summary: 'Specific source directory or directories to scan (defaults to discovered package directories).',
      multiple: true,
    }),
    'project-dir': Flags.string({
      summary: 'Root directory of the project.',
      default: '.',
    }),
    'generator-config': Flags.string({
      summary: 'Path to generator.config.json.',
      default: 'generator.config.json',
    }),
    'utam-config': Flags.string({
      summary:
        'Path to utam.config.json, whose pageObjectsFileMask sets which page objects a new name is checked against.',
      default: 'utam.config.json',
    }),
    'dry-run': Flags.boolean({
      char: 'd',
      summary: 'Preview renames without modifying files on disk.',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      summary: 'Enable detailed output.',
      default: false,
    }),
  };

  public async run(): Promise<NameSecondaryPageObjectsResult> {
    const { flags } = await this.parse(Names);

    const result = nameSecondaryPageObjects({
      rootDir: flags['project-dir'],
      sourceDirs: flags.source,
      generatorConfigPath: flags['generator-config'],
      utamConfigPath: flags['utam-config'],
      dryRun: flags['dry-run'],
    });

    for (const warning of result.warnings) {
      this.warn(warning);
    }

    if (result.skipped) {
      this.log(`${result.skipped}. Skipping.`);
      return result;
    }

    if (result.collisions.length > 0) {
      const lines = result.collisions.map(
        (collision) =>
          `  - ${collision.name}: ${collision.sources.map((source) => path.relative(flags['project-dir'], source)).join(', ')}`,
      );
      this.error(
        `These page objects would compile to the same file, so nothing was renamed. Rename one of each, or add an "ignore" entry for its template in the generator config:\n${lines.join('\n')}`,
        { exit: 1 },
      );
    }

    if (flags['dry-run']) {
      this.log('[dry-run] Page object names preview:');
    }

    this.log(
      `${flags['dry-run'] ? 'Would rename' : 'Renamed'} ${result.renames.length} secondary template page objects.`,
    );

    if (flags.verbose) {
      for (const rename of result.renames) {
        this.log(`  - ${path.relative(flags['project-dir'], rename.from)} -> ${rename.name}`);
      }
      for (const unmatched of result.unmatched) {
        this.log(`  - Left alone, matches no template: ${path.relative(flags['project-dir'], unmatched)}`);
      }
    }

    return result;
  }
}
