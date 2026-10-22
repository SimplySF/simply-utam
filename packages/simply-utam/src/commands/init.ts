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
import {
  DEFAULT_FORCEIGNORE_REGION,
  scaffoldProject,
  type ForceignoreResult,
  type GitignoreResult,
  type ScaffoldResult,
} from '@simplysf/simply-utam-core';

const SNAPSHOT_HOOKS_DOCS =
  'https://github.com/SimplySF/simply-utam/tree/main/packages/simply-utam#dom-snapshots-in-an-existing-project';

/**
 * CLI command to scaffold SimplyUTAM configurations, Wireit tasks, and namespace maps.
 */
export default class Init extends Command {
  public static override summary =
    'Scaffold UTAM configurations, Wireit tasks, and namespace maps in a Salesforce project.';

  public static override description =
    'Inspects the target project, generates generator.config.json, utam.config.json, wdio.conf.mjs, and .utam/namespace-map.json, adds the DOM snapshot guide (SNAPSHOTS.md) and capture step to the UTAM test folder, non-destructively injects standard Wireit tasks into package.json, and adds any missing UTAM rules to .forceignore and .gitignore under a "# Ignore UTAM" comment without changing existing lines.';

  public static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --source-dir force-app --app-name my-app',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --forceignore-region-start "# BEGIN LOCAL" --forceignore-region-end "# END LOCAL"',
  ];

  public static override enableJsonFlag = true;

  public static override flags = {
    'project-dir': Flags.string({
      summary: 'Root directory of the consumer project.',
      default: '.',
    }),
    'source-dir': Flags.string({
      char: 's',
      summary: 'Primary Salesforce source directory (auto-detected from sfdx-project.json if omitted).',
    }),
    'app-name': Flags.string({
      char: 'a',
      summary: 'Application name for UTAM namespaces (defaults to package.json name, scope included).',
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
    forceignore: Flags.boolean({
      summary: 'Add missing UTAM rules to .forceignore.',
      default: true,
      allowNo: true,
    }),
    'forceignore-region-start': Flags.string({
      summary: 'Exact line that starts the .forceignore customization region.',
      default: DEFAULT_FORCEIGNORE_REGION.start,
    }),
    'forceignore-region-end': Flags.string({
      summary: 'Exact line that ends the .forceignore customization region.',
      default: DEFAULT_FORCEIGNORE_REGION.end,
    }),
    gitignore: Flags.boolean({
      summary: 'Add .utam/snapshots/ to .gitignore, so DOM snapshots stay out of git.',
      default: true,
      allowNo: true,
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
      forceignore: flags.forceignore,
      forceignoreRegionStart: flags['forceignore-region-start'],
      forceignoreRegionEnd: flags['forceignore-region-end'],
      gitignore: flags.gitignore,
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
        this.log(`Skipped existing files (use --force to overwrite): ${result.skippedFiles.join(', ')}`);
      }
      if (result.modifiedFiles.length > 0) {
        this.log(`Updated files: ${result.modifiedFiles.join(', ')}`);
      }
    }

    if (result.forceignore) {
      this.logIgnoreFile(result.forceignore, flags['dry-run'], 'UTAM artifacts');
    }
    if (result.gitignore) {
      this.logIgnoreFile(result.gitignore, flags['dry-run'], 'DOM snapshots');
    }
    if (result.snapshotHooksMissing) {
      this.log(
        '\nwdio.conf.mjs already exists, so it was kept, and it does not capture DOM snapshots on failure. ' +
          `To add that, copy the onPrepare, before and afterStep hooks from ${SNAPSHOT_HOOKS_DOCS}`,
      );
    }

    const pageObjectExports = result.pageObjectExports;
    if (pageObjectExports?.action === 'added') {
      const verb = flags['dry-run'] ? 'Would add' : 'Added';
      this.log(
        `${verb} "${pageObjectExports.subpath}" to package.json "exports" so page objects can import each other.`,
      );
      if (pageObjectExports.createdExports) {
        this.log(
          'package.json had no "exports", so imports of the package root and of other subpaths no longer resolve. ' +
            'Add them to "exports" if anything imports them.',
        );
      }
    }

    for (const warning of result.warnings) {
      this.warn(warning);
    }

    if (result.missingDependencies.length > 0) {
      this.log(`\nRecommended devDependencies missing: ${result.missingDependencies.join(' ')}`);
      this.log(`Run: npm install -D ${result.missingDependencies.join(' ')}`);
    }

    return result;
  }

  private logIgnoreFile(file: ForceignoreResult | GitignoreResult, dryRun: boolean, covers: string): void {
    const where = {
      block: 'under the existing "# Ignore UTAM" comment',
      region: 'inside the customization region',
      end: 'at the end of the file',
    };
    const created = file.action === 'created';
    if (file.addedPatterns.length > 0) {
      const verb = dryRun ? (created ? 'Would create' : 'Would update') : created ? 'Created' : 'Updated';
      const placement = file.placement && !created ? ` (${where[file.placement]})` : '';
      this.log(`${verb} ${file.path}: added ${file.addedPatterns.join(', ')}${placement}`);
    } else if (file.action === 'unchanged') {
      this.log(`${file.path} already covers ${covers}.`);
    } else if (file.action === 'skipped') {
      this.log(
        `Skipped ${file.path}: no ${file.path} or sfdx-project.json found. ` +
          'Point --project-dir at the folder that contains sfdx-project.json, or add the UTAM rules yourself.',
      );
    }
    for (const warning of file.warnings) {
      this.warn(warning);
    }
  }
}
