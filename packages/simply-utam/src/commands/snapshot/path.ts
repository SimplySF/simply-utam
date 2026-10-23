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
import {
  buildPageObjectIndex,
  componentPath,
  componentPathByText,
  DomSnapshotError,
  type FindResult,
  type PageObjectIndex,
  type PathResult,
} from '@simplysf/simply-utam-core';
import { BAD_INPUT, fileFlag, limitFlag, loadSnapshot, projectDirFlag } from '../../snapshot-flags.js';

/**
 * Show the component path to a node, with what the page-object index knows about each element.
 */
export default class SnapshotPath extends Command {
  public static override summary =
    'Show the custom elements from the document down to a node, with their page objects.';

  public static override description =
    'Marks each shadow crossing and each hidden ancestor, and annotates each custom element with its page object (import path, and root when utam.load can load it), a likely route through a page object above it ("reachable through"), or "no page object found". With --text, prints the path only when exactly one visible node matches; otherwise lists the candidates and exits with code 1.';

  public static override examples = [
    '<%= config.bin %> <%= command.id %> --node n5012',
    '<%= config.bin %> <%= command.id %> --text "Account Name"',
  ];

  public static override enableJsonFlag = true;

  public static override flags = {
    node: Flags.string({
      summary: 'The target node handle, such as n5012 (from find or tree).',
      exactlyOne: ['node', 'text'],
    }),
    text: Flags.string({
      summary: 'Find the target by text; it must have exactly one visible match.',
      exactlyOne: ['node', 'text'],
    }),
    ...fileFlag,
    ...projectDirFlag,
    ...limitFlag,
  };

  public async run(): Promise<PathResult | { candidates: FindResult }> {
    const { flags } = await this.parse(SnapshotPath);
    try {
      // Built once, after the snapshot is read, so a missing snapshot doesn't index every package first.
      let built: PageObjectIndex | undefined;
      const pageObjects = (): PageObjectIndex => {
        if (!built) {
          built = buildPageObjectIndex({ projectDir: flags['project-dir'] });
          for (const warning of built.warnings) this.warn(warning);
        }
        return built;
      };
      const { snapshot, header } = await loadSnapshot(flags['project-dir'], flags.file, pageObjects);
      const options = { index: pageObjects(), limit: flags.limit };
      if (flags.node !== undefined) {
        const result = componentPath(snapshot, flags.node, options);
        for (const line of [...header, ...result.lines]) this.log(line);
        return result.json;
      }
      const result = componentPathByText(snapshot, flags.text!, options);
      for (const line of [...header, ...result.lines]) this.log(line);
      process.exitCode = result.exitCode;
      return result.json;
    } catch (error) {
      if (error instanceof DomSnapshotError) this.error(error.message, { exit: BAD_INPUT });
      throw error;
    }
  }
}
