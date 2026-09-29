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
import { generateLwcRules, type GenerateRulesResult } from '@simplysf/simply-utam-core';

/**
 * CLI command to scan LWC components and generate UTAM .rules.json schemas.
 */
export default class Rules extends Command {
  public static override summary = 'Scan LWC component definitions and generate UTAM .rules.json files.';

  public static override description =
    'Discovers root components in package directories matching target page types and generates or updates corresponding *.rules.json schemas.';

  public static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --source force-app/main/default/lwc',
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
    namespace: Flags.string({
      char: 'n',
      summary: 'LWC namespace prefix for selector generation (defaults to c).',
    }),
    'project-dir': Flags.string({
      summary: 'Root directory of the project.',
      default: '.',
    }),
    'dry-run': Flags.boolean({
      char: 'd',
      summary: 'Preview generated rules without writing to disk.',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      summary: 'Enable detailed output.',
      default: false,
    }),
  };

  public async run(): Promise<GenerateRulesResult> {
    const { flags } = await this.parse(Rules);

    const result = generateLwcRules({
      rootDir: flags['project-dir'],
      sourceDirs: flags.source,
      namespace: flags.namespace,
      dryRun: flags['dry-run'],
      verbose: flags.verbose,
    });

    if (flags['dry-run']) {
      this.log('[dry-run] Rules generation preview:');
    }

    this.log(
      `Scanned ${result.totalComponentsScanned} components; identified ${result.rootComponentsIdentified} root components.`,
    );

    if (result.filesCreated.length > 0) {
      this.log(`Created ${result.filesCreated.length} rules files.`);
    }

    if (result.filesUpdated.length > 0) {
      this.log(`Updated ${result.filesUpdated.length} rules files.`);
    }

    if (flags.verbose) {
      for (const action of result.actions) {
        this.log(`  - ${action.componentName}: ${action.action} (${action.rulesFilePath})`);
      }
    }

    return result;
  }
}
