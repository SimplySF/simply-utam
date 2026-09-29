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
import { generateCucumberSteps, type GenerateStepsResult } from '@simplysf/simply-utam-core';

/**
 * CLI command to detect missing Cucumber steps and scaffold definition templates.
 */
export default class Steps extends Command {
  public static override summary =
    'Scaffold missing Cucumber step definitions based on Gherkin feature files.';

  public static override description =
    'Parses Gherkin .feature files, compiles registered step expressions from existing step definition files, detects true missing steps without false positives, and appends formatted snippet templates.';

  public static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --features "tests/**/*.feature" --steps "tests/**/*.steps.ts"',
    '<%= config.bin %> <%= command.id %> --dry-run',
  ];

  public static override enableJsonFlag = true;

  public static override flags = {
    features: Flags.string({
      char: 'f',
      summary: 'Glob pattern(s) for Gherkin feature files.',
      multiple: true,
      default: ['**/test/*.feature', '**/test/**/*.feature'],
    }),
    steps: Flags.string({
      char: 's',
      summary: 'Glob pattern(s) for existing Cucumber step definitions.',
      multiple: true,
      default: ['**/test/*.steps.{js,mjs,ts}', '**/test/**/*.steps.{js,mjs,ts}'],
    }),
    output: Flags.string({
      char: 'o',
      summary:
        'Target file path for scaffolded step definitions (defaults to first matched step file or new generated.steps.mjs).',
    }),
    'project-dir': Flags.string({
      summary: 'Root directory of the project.',
      default: '.',
    }),
    'dry-run': Flags.boolean({
      char: 'd',
      summary: 'Preview generated step snippets without modifying files on disk.',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      summary: 'Enable detailed output.',
      default: false,
    }),
  };

  public async run(): Promise<GenerateStepsResult> {
    const { flags } = await this.parse(Steps);

    const result = await generateCucumberSteps({
      rootDir: flags['project-dir'],
      features: flags.features,
      steps: flags.steps,
      outputFile: flags.output,
      dryRun: flags['dry-run'],
      verbose: flags.verbose,
    });

    if (flags['dry-run']) {
      this.log('[dry-run] Step scaffolding preview:');
    }

    this.log(
      `Scanned ${result.featureFilesScanned} feature files and ${result.stepFilesScanned} step files.`,
    );

    if (result.undefinedStepsCount === 0) {
      this.log('All steps have matching definitions. No new step snippets needed.');
      return result;
    }

    this.log(
      `Detected ${result.undefinedStepsCount} undefined step(s). Target: ${result.outputFile}`,
    );

    if ((flags.verbose || flags['dry-run']) && result.generatedCode) {
      this.log('\n--- Generated Snippets ---');
      this.log(result.generatedCode);
      this.log('---------------------------\n');
    }

    return result;
  }
}
