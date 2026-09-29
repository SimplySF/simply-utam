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
import { rewriteUtamNamespaces, type RewriteNamespacesResult } from '@simplysf/simply-utam-core';

/**
 * CLI command to rewrite component namespace prefixes across generated *.utam.json schemas.
 */
export default class Rewrite extends Command {
  public static override summary = 'Rewrite namespace prefixes across generated UTAM page object schemas.';

  public static override description =
    'Reads namespace mappings from a configuration file (or defaults to .utam/namespace-map.json) and replaces target component namespaces in *.utam.json schemas.';

  public static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --config .utam/namespace-map.json',
    '<%= config.bin %> <%= command.id %> --dry-run',
  ];

  public static override enableJsonFlag = true;

  public static override flags = {
    source: Flags.string({
      char: 's',
      summary: 'Specific source directory or directories to scan (defaults to discovered package directories).',
      multiple: true,
    }),
    config: Flags.string({
      char: 'c',
      summary: 'Path to namespace mapping configuration file.',
      default: '.utam/namespace-map.json',
    }),
    'project-dir': Flags.string({
      summary: 'Root directory of the project.',
      default: '.',
    }),
    'dry-run': Flags.boolean({
      char: 'd',
      summary: 'Preview namespace rewrites without modifying files on disk.',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      summary: 'Enable detailed output.',
      default: false,
    }),
  };

  public async run(): Promise<RewriteNamespacesResult> {
    const { flags } = await this.parse(Rewrite);

    const result = rewriteUtamNamespaces({
      rootDir: flags['project-dir'],
      sourceDirs: flags.source,
      configFile: flags.config,
      dryRun: flags['dry-run'],
      verbose: flags.verbose,
    });

    if (result.configMissingOrEmpty) {
      if (result.notice) {
        this.log(result.notice);
      }
      return result;
    }

    if (flags['dry-run']) {
      this.log('[dry-run] Namespace rewrite preview:');
    }

    this.log(
      `Scanned ${result.filesScanned} UTAM schemas; modified ${result.filesModified} files (${result.totalReplacements} namespace replacements).`,
    );

    if (flags.verbose) {
      for (const res of result.results) {
        if (res.applied) {
          this.log(`  - Rewrote ${res.filePath} (${res.changes.length} replacements)`);
        }
      }
    }

    return result;
  }
}
