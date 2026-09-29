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
import { executeBuildPipeline, type BuildPipelineResult } from '../pipeline-runner.js';

/**
 * CLI command to run the complete SimplyUTAM compilation pipeline sequentially.
 */
export default class Build extends Command {
  public static override summary =
    'Run the end-to-end SimplyUTAM build pipeline (rules -> utam-generate -> overrides -> rewrite -> utam).';

  public static override description =
    'Standalone convenience runner executing all transformation and compilation stages sequentially. Note: Wireit tasks (configured via simply-utam init) remain the recommended mechanism for granular caching in everyday developer workflows.';

  public static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --dry-run',
  ];

  public static override enableJsonFlag = true;

  public static override flags = {
    source: Flags.string({
      char: 's',
      summary:
        'Specific source directory or directories to process (defaults to discovered package directories).',
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
      summary: 'Path to utam.config.json.',
      default: 'utam.config.json',
    }),
    'namespace-map': Flags.string({
      summary: 'Path to namespace-map.json.',
      default: '.utam/namespace-map.json',
    }),
    'dry-run': Flags.boolean({
      char: 'd',
      summary: 'Preview pipeline execution without invoking compilers or modifying files.',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      summary: 'Enable detailed output.',
      default: false,
    }),
  };

  public async run(): Promise<BuildPipelineResult> {
    const { flags } = await this.parse(Build);

    this.log('Executing SimplyUTAM build pipeline...');

    const result = await executeBuildPipeline({
      projectDir: flags['project-dir'],
      sourceDirs: flags.source,
      generatorConfigPath: flags['generator-config'],
      utamConfigPath: flags['utam-config'],
      namespaceMapPath: flags['namespace-map'],
      dryRun: flags['dry-run'],
      onStage: (stage, status, message) => {
        const symbol =
          status === 'success' ? '✓' : status === 'skip' ? '○' : status === 'error' ? '✗' : '►';
        const msgSuffix = message ? `: ${message}` : '';
        this.log(`  ${symbol} [${stage}] ${status}${msgSuffix}`);
      },
    });

    if (!result.success) {
      this.error(`Build pipeline failed:\n${result.errors.join('\n')}`, { exit: 1 });
    }

    this.log('\nSimplyUTAM build pipeline completed successfully.');
    return result;
  }
}
