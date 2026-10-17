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

import { Args, Command, Flags } from '@oclif/core';
import {
  DomSnapshotError,
  nodeAncestors,
  nodeDetails,
  type AncestorsResult,
  type NodeDetails,
} from '@simplysf/simply-utam-core';
import { BAD_INPUT, fileFlag, limitFlag, loadSnapshot, projectDirFlag } from '../../snapshot-flags.js';

/**
 * Print one node in full.
 */
export default class SnapshotNode extends Command {
  public static override summary = 'Show everything a snapshot recorded about one node.';

  public static override description =
    'Its handle and its address (child positions from the page root, s for a step into a shadow root; the same in another snapshot of the same page). Every recorded attribute, unclipped; its own text and shadow text; its size and position; whether it is hidden, and under which node; its parent; and each of its light DOM and shadow root children in one line. With --ancestors, its ancestors instead, nearest first, one line each, with a line wherever the chain leaves a shadow root: for picking a container to scope a selector with.';

  public static override examples = [
    '<%= config.bin %> <%= command.id %> n5012',
    '<%= config.bin %> <%= command.id %> --node n5012',
    '<%= config.bin %> <%= command.id %> n5012 --ancestors',
  ];

  public static override enableJsonFlag = true;

  public static override args = {
    id: Args.string({ description: 'The node handle, such as n5012 (from find, path or tree).' }),
  };

  public static override flags = {
    node: Flags.string({ summary: 'The node handle, instead of the argument.' }),
    ancestors: Flags.boolean({ summary: "List the node's ancestors, nearest first, instead.", default: false }),
    ...fileFlag,
    ...projectDirFlag,
    ...limitFlag,
  };

  public async run(): Promise<NodeDetails | AncestorsResult> {
    const { args, flags } = await this.parse(SnapshotNode);
    const id = args.id ?? flags.node;
    if (!id) this.error('Give a node handle: snapshot node <n…>.', { exit: BAD_INPUT });
    try {
      const { snapshot, header } = await loadSnapshot(flags['project-dir'], flags.file);
      const result = flags.ancestors ? nodeAncestors(snapshot, id, { limit: flags.limit }) : nodeDetails(snapshot, id);
      for (const line of [...header, ...result.lines]) this.log(line);
      return result.json;
    } catch (error) {
      if (error instanceof DomSnapshotError) this.error(error.message, { exit: BAD_INPUT });
      throw error;
    }
  }
}
