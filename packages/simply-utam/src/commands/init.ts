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
import { scaffoldProject, type ScaffoldResult } from '@simplysf/simply-utam-core';

/**
 * CLI command to scaffold SimplyUTAM configurations, Wireit tasks, and namespace maps.
 */
export default class Init extends Command {
  public static override summary =
    'Scaffold UTAM configurations, Wireit tasks, and namespace maps in a Salesforce project.';

  public static override description =
    'Inspects the target project, generates generator.config.json, utam.config.json, wdio.conf.mjs, and .utam/namespace-map.json, and non-destructively injects standard Wireit tasks into package.json.';

  public static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --source-dir force-app --app-name my-app',
    '<%= config.bin %> <%= command.id %> --dry-run',
  ];

  public static override enableJsonFlag = true;

  public static override flags = {
    'project-dir': Flags.string({
      summary: 'Root directory of the consumer project.',
      default: '.',
    }),
    'source-dir': Flags.string({
      char: 's',
      summary:
        'Primary Salesforce source directory (auto-detected from sfdx-project.json if omitted).',
    }),
    'app-name': Flags.string({
      char: 'a',
      summary: 'Application name for UTAM namespaces (defaults to package.json name).',
    }),
    force: Flags.boolean({
      char: 'f',
      summary: 'Overwrite existing configuration files.',
      default: false,
    }),
    'dry-run': Flags.boolean({
      char: 'd',
      summary: 'Preview modifications without writing to disk.',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      summary: 'Enable detailed output.',
      default: false,
    }),
  };

  public async run(): Promise<ScaffoldResult> {
    const { flags } = await this.parse(Init);
    const resolvedTarget = path.resolve(flags['project-dir']);

    const result = await scaffoldProject({
      projectDir: flags['project-dir'],
      sourceDir: flags['source-dir'],
      appName: flags['app-name'],
      force: flags.force,
      dryRun: flags['dry-run'],
    });

    if (flags['dry-run']) {
      this.log(`[dry-run] Project scaffolding preview for: ${resolvedTarget}`);
      if (result.createdFiles.length > 0) {
        this.log(`Files that would be created: ${result.createdFiles.join(', ')}`);
      }
      if (result.skippedFiles.length > 0) {
        this.log(
          `Files that would be skipped (already exist, use --force to overwrite): ${result.skippedFiles.join(', ')}`,
        );
      }
      if (result.modifiedFiles.length > 0) {
        this.log(`Files that would be updated: ${result.modifiedFiles.join(', ')}`);
      }
    } else {
      this.log(`Scaffolding SimplyUTAM in: ${resolvedTarget}`);
      if (result.createdFiles.length > 0) {
        this.log(`Created files: ${result.createdFiles.join(', ')}`);
      }
      if (result.skippedFiles.length > 0) {
        this.log(
          `Skipped existing files (use --force to overwrite): ${result.skippedFiles.join(', ')}`,
        );
      }
      if (result.modifiedFiles.length > 0) {
        this.log(`Updated files: ${result.modifiedFiles.join(', ')}`);
      }
    }

    if (result.missingDependencies.length > 0) {
      this.log(`\nRecommended devDependencies missing: ${result.missingDependencies.join(' ')}`);
      this.log(`Run: npm install -D ${result.missingDependencies.join(' ')}`);
    }

    return result;
  }
}
