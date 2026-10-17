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
import { DomSnapshotError, findNodes, type FindResult } from '@simplysf/simply-utam-core';
import { BAD_INPUT, fileFlag, limitFlag, loadSnapshot, projectDirFlag } from '../../snapshot-flags.js';

/**
 * Find nodes in a DOM snapshot by text, attribute or tag.
 */
export default class SnapshotFind extends Command {
  public static override summary = 'Find nodes in a DOM snapshot by text, attribute, class, tag or CSS selector.';

  public static override description =
    "Text matching is case-insensitive and substring, over each node's own text, its shadow text and its attribute values (not class). Record values are masked, so search by labels. Visible matches are listed first, in document order; hidden matches are counted, or listed with --all. --attr name=value is a case-insensitive substring match; --class matches one whole class token. --css tests a selector as UTAM's findElement would: every match in document order, the first (the one UTAM takes) marked, hidden ones included. It searches the document, or with --within a node's light DOM (a page object's elements) or, adding --shadow, its shadow root (shadow elements).";

  public static override examples = [
    '<%= config.bin %> <%= command.id %> --text "Account Name"',
    '<%= config.bin %> <%= command.id %> --tag records-record-layout-item --all',
    '<%= config.bin %> <%= command.id %> --attr title=Edit',
    '<%= config.bin %> <%= command.id %> --css "lightning-button.slds-button_brand"',
    '<%= config.bin %> <%= command.id %> --css "lightning-input" --within n5012 --shadow',
  ];

  public static override enableJsonFlag = true;

  public static override flags = {
    text: Flags.string({ summary: 'Text to match (case-insensitive substring).' }),
    attr: Flags.string({ summary: 'Attribute to match: `name` (present) or `name=value` (substring).' }),
    tag: Flags.string({ summary: 'Tag name to match exactly.' }),
    class: Flags.string({ summary: 'A whole class token to match, as `.name` would (case-sensitive).' }),
    css: Flags.string({
      summary: 'A CSS selector to test as UTAM would: all matches in document order, the first marked.',
      exclusive: ['text', 'attr', 'tag', 'class'],
    }),
    within: Flags.string({ summary: 'With --css: search under this node (its light DOM).', dependsOn: ['css'] }),
    shadow: Flags.boolean({
      summary: "With --css and --within: search the node's shadow root instead.",
      default: false,
    }),
    all: Flags.boolean({ summary: 'List hidden matches in full rather than as a count.', default: false }),
    ...fileFlag,
    ...projectDirFlag,
    ...limitFlag,
  };

  public async run(): Promise<FindResult> {
    const { flags } = await this.parse(SnapshotFind);
    if ([flags.text, flags.attr, flags.tag, flags.class, flags.css].every((value) => value === undefined)) {
      this.error('Give --text, --attr, --class, --tag or --css.', { exit: BAD_INPUT });
    }
    try {
      const { snapshot, header } = await loadSnapshot(flags['project-dir'], flags.file);
      const result = findNodes(snapshot, {
        text: flags.text,
        attr: flags.attr,
        tag: flags.tag,
        class: flags.class,
        css: flags.css,
        within: flags.within,
        shadow: flags.shadow,
        all: flags.all,
        limit: flags.limit,
      });
      for (const line of [...header, ...result.lines]) this.log(line);
      return result.json;
    } catch (error) {
      if (error instanceof DomSnapshotError) this.error(error.message, { exit: BAD_INPUT });
      throw error;
    }
  }
}
