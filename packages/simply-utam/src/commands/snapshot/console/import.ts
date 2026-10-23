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
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Command, Flags } from '@oclif/core';
import {
  DomSnapshotError,
  MANUAL_RUN_ID,
  importDomSnapshot,
  writeDomSnapshot,
  type DomSnapshotMeta,
} from '@simplysf/simply-utam-core';
import { ClipboardUnavailableError, systemClipboard, type Clipboard } from '../../../clipboard.js';
import { BAD_INPUT, headerFor, projectDirFlag } from '../../../snapshot-flags.js';

export type ImportResult = { file: string; meta: DomSnapshotMeta };

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Save a DOM snapshot captured outside a test run, such as by the console snippet.
 */
export default class SnapshotConsoleImport extends Command {
  public static override summary = 'Save the DOM snapshot the console snippet copied, or any snapshot file.';

  public static override description =
    'Reads the clipboard by default, or --file (- for standard input). Checks the snapshot, saves it to .utam/snapshots/manual/ as manual--<label or number>.json and to latest.json, and prints the header every snapshot command prints. The rest of the snapshot is kept as captured.';

  public static override examples = [
    '<%= config.bin %> <%= command.id %> --label "account list"',
    '<%= config.bin %> <%= command.id %> --file ~/Downloads/dom-snapshot-20261019T120000.json',
    'pbpaste | <%= config.bin %> <%= command.id %> --file -',
  ];

  public static override enableJsonFlag = true;

  public static override flags = {
    file: Flags.string({
      summary: 'Snapshot file to read instead of the clipboard, relative to the current folder; - for standard input.',
    }),
    label: Flags.string({ summary: 'Label for the snapshot, used in its file name and header.' }),
    ...projectDirFlag,
  };

  /** The clipboard read without --file; tests replace it. */
  public clipboard: Clipboard = systemClipboard();

  /** Standard input, for `--file -`; tests replace it. */
  public stdin: NodeJS.ReadableStream = process.stdin;

  public async run(): Promise<ImportResult> {
    const { flags } = await this.parse(SnapshotConsoleImport);
    const source = flags.file === '-' ? 'standard input' : (flags.file ?? 'clipboard');
    let text: string;
    try {
      text =
        flags.file === '-'
          ? await readAll(this.stdin)
          : flags.file
            ? await fs.readFile(path.resolve(flags.file), 'utf8')
            : await this.clipboard.read();
    } catch (error) {
      if (error instanceof ClipboardUnavailableError)
        this.error(`Can't read the clipboard: ${error.message}. Use --file <path>, or --file - for standard input.`, {
          exit: BAD_INPUT,
        });
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        this.error(`No such file: ${source}`, { exit: BAD_INPUT });
      throw error;
    }
    if (!text.trim()) {
      this.error(
        `The ${source} is empty. Run the snippet (\`npx simply-utam snapshot console snippet --copy\`) in the page's DevTools console first.`,
        { exit: BAD_INPUT },
      );
    }

    let snapshot;
    try {
      snapshot = importDomSnapshot(text, { label: flags.label });
    } catch (error) {
      if (error instanceof DomSnapshotError)
        this.error(`The ${source} doesn't hold a DOM snapshot: ${error.message}`, { exit: BAD_INPUT });
      throw error;
    }
    if (snapshot.meta.mask === 'full') this.warn('This snapshot was captured with mask "full": it keeps record data.');

    const projectDir = flags['project-dir'];
    const file = await writeDomSnapshot(snapshot, { projectDir, runId: MANUAL_RUN_ID });
    // From the snapshot in memory: the header doesn't show the package versions the file gains.
    const header = headerFor(projectDir, path.join(projectDir, file), snapshot);
    this.log(`DOM snapshot saved to ${file}`);
    for (const line of header) this.log(line);
    return { file, meta: snapshot.meta };
  }
}
