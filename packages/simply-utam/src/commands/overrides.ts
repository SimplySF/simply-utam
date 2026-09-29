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

import { Command, Flags } from '@oclif/core';
import { applyUtamOverrides, type ApplyOverridesResult } from '@simplysf/simply-utam-core';

/**
 * CLI command to merge *.utam-overrides.json files into generated UTAM schemas.
 */
export default class Overrides extends Command {
  public static override summary =
    'Merge *.utam-overrides.json files into generated UTAM page object schemas.';

  public static override description =
    'Recursively searches source directories for *.utam-overrides.json files, locates corresponding compiled *.utam.json schemas, and performs deep AST merging while preserving JSON indentation.';

  public static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --source force-app',
    '<%= config.bin %> <%= command.id %> --dry-run',
  ];

  public static override enableJsonFlag = true;

  public static override flags = {
    source: Flags.string({
      char: 's',
      summary:
        'Specific source directory or directories to scan (defaults to discovered package directories).',
      multiple: true,
    }),
    'project-dir': Flags.string({
      summary: 'Root directory of the project.',
      default: '.',
    }),
    'dry-run': Flags.boolean({
      char: 'd',
      summary: 'Preview overrides without modifying files on disk.',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      summary: 'Enable detailed output.',
      default: false,
    }),
  };

  public async run(): Promise<ApplyOverridesResult> {
    const { flags } = await this.parse(Overrides);

    const result = applyUtamOverrides({
      rootDir: flags['project-dir'],
      sourceDirs: flags.source,
      dryRun: flags['dry-run'],
      verbose: flags.verbose,
    });

    if (flags['dry-run']) {
      this.log('[dry-run] UTAM overrides preview:');
    }

    this.log(
      `Scanned ${result.scannedFilesCount} override files; modified ${result.modifiedFilesCount} UTAM schemas (${result.totalOverridesApplied} overrides applied).`,
    );

    if (flags.verbose) {
      for (const res of result.results) {
        if (res.applied) {
          this.log(`  - Applied to ${res.generatedUtamFilePath}`);
        } else if (res.error) {
          this.log(`  - Error on ${res.overrideFilePath}: ${res.error}`);
        }
      }
    }

    return result;
  }
}
