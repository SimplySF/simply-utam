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
import { DomSnapshotError, subtree, type DomNode } from '@simplysf/simply-utam-core';
import { BAD_INPUT, fileFlag, limitFlag, loadSnapshot, projectDirFlag } from '../../snapshot-flags.js';

/**
 * Print the pruned tree under a node.
 */
export default class SnapshotTree extends Command {
  public static override summary = 'Print the pruned tree under a node, to a depth.';

  public static override description =
    'Each line is one node: tag, #id and .classes as CSS, other attributes, its own text and its shadow text, then its node handle (n…). "#shadow(mode)" lines mark a shadow root; "(hidden)" marks the top of a hidden subtree.';

  public static override examples = ['<%= config.bin %> <%= command.id %> --node n5012 --depth 3'];

  public static override enableJsonFlag = true;

  public static override flags = {
    node: Flags.string({ summary: 'The node to start at. Defaults to the snapshot root.' }),
    depth: Flags.integer({ summary: 'How many levels below the node to print.', default: 3 }),
    ...fileFlag,
    ...projectDirFlag,
    ...limitFlag,
  };

  public async run(): Promise<DomNode> {
    const { flags } = await this.parse(SnapshotTree);
    try {
      const { snapshot, header } = await loadSnapshot(flags['project-dir'], flags.file);
      const result = subtree(snapshot, flags.node, { depth: flags.depth, limit: flags.limit });
      for (const line of [...header, ...result.lines]) this.log(line);
      return result.json;
    } catch (error) {
      if (error instanceof DomSnapshotError) this.error(error.message, { exit: BAD_INPUT });
      throw error;
    }
  }
}
