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

import { spawn } from 'node:child_process';

/** What a command printed, and how it exited. */
export type CommandResult = { code: number | null; stdout: string };

/** Runs a command with `input` on its standard input. Rejects when the command can't start. */
export type CommandRunner = (command: string, args: string[], input?: string) => Promise<CommandResult>;

/** The system clipboard, as text. */
export type Clipboard = {
  read(): Promise<string>;
  write(text: string): Promise<void>;
};

type Tool = { command: string; args: string[] };

// Windows PowerShell writes the console's code page unless told otherwise.
const POWERSHELL = ['-NoProfile', '-NonInteractive', '-Command'];
const UTF8 = '[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::InputEncoding = [Text.Encoding]::UTF8; ';

const READ_TOOLS: Partial<Record<NodeJS.Platform, Tool[]>> = {
  darwin: [{ command: 'pbpaste', args: [] }],
  win32: [{ command: 'powershell', args: [...POWERSHELL, `${UTF8}Get-Clipboard -Raw`] }],
  linux: [
    { command: 'wl-paste', args: ['--no-newline'] },
    { command: 'xclip', args: ['-selection', 'clipboard', '-o'] },
    { command: 'xsel', args: ['--clipboard', '--output'] },
  ],
};

const WRITE_TOOLS: Partial<Record<NodeJS.Platform, Tool[]>> = {
  darwin: [{ command: 'pbcopy', args: [] }],
  win32: [{ command: 'powershell', args: [...POWERSHELL, `${UTF8}Set-Clipboard -Value ([Console]::In.ReadToEnd())`] }],
  linux: [
    { command: 'wl-copy', args: [] },
    { command: 'xclip', args: ['-selection', 'clipboard'] },
    { command: 'xsel', args: ['--clipboard', '--input'] },
  ],
};

/**
 * Runs a command, collecting its standard output when it's given no input. A command given input is
 * writing, and its output is ignored: `xclip` and `wl-copy` leave a process behind to serve the
 * clipboard, and one holding the output pipe would keep `close` from firing until the clipboard changes.
 */
export const runCommand: CommandRunner = (command, args, input) =>
  new Promise((resolve, reject) => {
    const reading = input === undefined;
    const child = spawn(command, args, { stdio: ['pipe', reading ? 'pipe' : 'ignore', 'ignore'], windowsHide: true });
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: Buffer.concat(chunks).toString('utf8') }));
    // A tool that exits without reading its input closes the pipe; `close` still reports how it exited.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input ?? '');
  });

/** Thrown when no clipboard tool for this platform works. */
export class ClipboardUnavailableError extends Error {}

async function firstWorking(tools: Tool[], run: CommandRunner, input?: string): Promise<string> {
  // Tools that ran but exited with an error, rather than not being installed.
  const failed: string[] = [];
  for (const tool of tools) {
    try {
      // Tools are tried one at a time: the first that works is the one to use.
      // eslint-disable-next-line no-await-in-loop
      const result = await run(tool.command, tool.args, input);
      if (result.code === 0) return result.stdout;
      failed.push(tool.command);
    } catch {
      // Not installed; try the next one.
    }
  }
  if (tools.length === 0) throw new ClipboardUnavailableError('no clipboard tool for this platform');
  const tried = tools.map((tool) => tool.command).join(', ');
  // Paste tools such as wl-paste and xclip exit with an error when the clipboard holds no text.
  const ranButFailed =
    failed.length === 0
      ? ''
      : `; ${failed.join(', ')} ran but failed${input === undefined ? ', as it does when the clipboard is empty' : ''}`;
  throw new ClipboardUnavailableError(`no clipboard tool worked (tried ${tried})${ranButFailed}`);
}

/**
 * The system clipboard, through the platform's own tools: `pbcopy` and `pbpaste` on macOS, PowerShell
 * on Windows, and `wl-copy`, `xclip` or `xsel` on Linux.
 *
 * @param options The platform (the current one by default) and how commands are run, for tests.
 */
export function systemClipboard(options: { platform?: NodeJS.Platform; run?: CommandRunner } = {}): Clipboard {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runCommand;
  return {
    read: (): Promise<string> => firstWorking(READ_TOOLS[platform] ?? [], run),
    async write(text: string): Promise<void> {
      await firstWorking(WRITE_TOOLS[platform] ?? [], run, text);
    },
  };
}
