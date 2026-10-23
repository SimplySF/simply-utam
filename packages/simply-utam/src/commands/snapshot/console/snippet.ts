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
import { domSnapshotSnippet, type SnapshotMask } from '@simplysf/simply-utam-core';
import { ClipboardUnavailableError, systemClipboard, type Clipboard } from '../../../clipboard.js';
import { BAD_INPUT } from '../../../snapshot-flags.js';

export type SnippetResult = { snippet: string; copied: boolean };

/**
 * Print the console snippet that captures a DOM snapshot, or copy it to the clipboard.
 */
export default class SnapshotConsoleSnippet extends Command {
  public static override summary = "The snippet to paste into a browser's DevTools console to capture a DOM snapshot.";

  public static override description =
    "Paste it into the console of the page to capture, with the console's context set to top. It runs the same walker a test run does, masks the page there, copies the snapshot JSON to the clipboard and prints a summary; save it with `snapshot console import`. Where the console's copy() isn't available, it downloads the JSON instead, for `import --file`. The mask is fixed in the snippet.";

  public static override examples = [
    '<%= config.bin %> <%= command.id %> --copy',
    '<%= config.bin %> <%= command.id %> --mask structure --copy',
    '<%= config.bin %> <%= command.id %> > snippet.js',
  ];

  public static override enableJsonFlag = true;

  public static override flags = {
    copy: Flags.boolean({ summary: 'Copy the snippet to the clipboard instead of printing it.', default: false }),
    mask: Flags.string({
      summary: 'Mask mode, from least kept to most. Defaults to UTAM_SNAPSHOT_MASK, then labels.',
      options: ['structure', 'labels', 'aria', 'full'],
    }),
    focus: Flags.string({
      summary: 'Where the walk starts: auto (the active Lightning page or console tab), none, or a CSS selector.',
      default: 'auto',
    }),
    'max-nodes': Flags.integer({ summary: 'Most visible nodes to capture.', min: 1 }),
    'max-hidden-nodes': Flags.integer({ summary: 'Most hidden nodes to capture.', min: 1 }),
  };

  /** The clipboard `--copy` writes to; tests replace it. */
  public clipboard: Clipboard = systemClipboard();

  public async run(): Promise<SnippetResult> {
    const { flags } = await this.parse(SnapshotConsoleSnippet);
    const snippet = domSnapshotSnippet({
      mask: flags.mask as SnapshotMask | undefined,
      focus: flags.focus,
      maxNodes: flags['max-nodes'],
      maxHiddenNodes: flags['max-hidden-nodes'],
      log: (message) => this.warn(message),
    });
    if (!flags.copy) {
      this.log(snippet);
      return { snippet, copied: false };
    }
    try {
      await this.clipboard.write(snippet);
    } catch (error) {
      if (!(error instanceof ClipboardUnavailableError)) throw error;
      this.error(`Can't copy the snippet: ${error.message}. Run without --copy to print it.`, { exit: BAD_INPUT });
    }
    this.log(
      'Snippet copied. Paste it into the DevTools console of the page to capture (context: top), then run `npx simply-utam snapshot console import`.',
    );
    return { snippet, copied: true };
  }
}
