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
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Config } from '@oclif/core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ClipboardUnavailableError, systemClipboard, type Clipboard, type CommandRunner } from '../src/clipboard.js';
import SnapshotConsoleImport, { type ImportResult } from '../src/commands/snapshot/console/import.js';
import SnapshotConsoleSnippet, { type SnippetResult } from '../src/commands/snapshot/console/snippet.js';

const snapshotJson = JSON.stringify({
  format: 'simply-utam-dom-snapshot',
  version: 1,
  meta: {
    capturedAt: '2026-10-19T12:00:00.000Z',
    trigger: 'manual',
    url: 'https://acme.lightning.force.com/lightning/o/Account/list',
    title: 'Accounts | Salesforce',
    viewport: [1280, 900],
    mask: 'labels',
    truncated: null,
  },
  root: { address: '0', tag: 'html', children: [{ address: '0.1', tag: 'body', children: [] }] },
});

/** A clipboard in memory; `unavailable` makes it throw as when no tool works. */
function fakeClipboard(text = '', unavailable = false): Clipboard & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    read: async (): Promise<string> => {
      if (unavailable) throw new ClipboardUnavailableError('no clipboard tool worked (tried pbpaste)');
      return text;
    },
    write: async (value: string): Promise<void> => {
      if (unavailable) throw new ClipboardUnavailableError('no clipboard tool worked (tried pbcopy)');
      written.push(value);
    },
  };
}

let config: Config;
let projectDir: string;

beforeAll(async () => {
  config = await Config.load(fileURLToPath(new URL('..', import.meta.url)));
}, 60_000);

beforeAll(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simply-utam-console-cli-'));
  fs.writeFileSync(path.join(projectDir, 'package.json'), '{"name":"my-app"}');
});

afterAll(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

afterEach(() => {
  process.exitCode = undefined;
});

type Output = { out: string[]; err: string[] };

async function snippet(
  argv: string[],
  clipboard: Clipboard = fakeClipboard(),
): Promise<Output & { result: SnippetResult }> {
  const command = new SnapshotConsoleSnippet(argv, config);
  return capture(command, clipboard, () => command.run());
}

async function importSnapshot(
  argv: string[],
  clipboard: Clipboard = fakeClipboard(snapshotJson),
  stdin?: string,
): Promise<Output & { result: ImportResult }> {
  const command = new SnapshotConsoleImport([...argv, '--project-dir', projectDir], config);
  if (stdin !== undefined) command.stdin = Readable.from([stdin]);
  return capture(command, clipboard, () => command.run());
}

async function capture<T>(
  command: SnapshotConsoleSnippet | SnapshotConsoleImport,
  clipboard: Clipboard,
  run: () => Promise<T>,
): Promise<Output & { result: T }> {
  const out: string[] = [];
  const err: string[] = [];
  command.clipboard = clipboard;
  command.log = (message?: string): void => {
    out.push(message ?? '');
  };
  command.warn = (input: string | Error): string | Error => {
    err.push(String(input));
    return input;
  };
  return { result: await run(), out, err };
}

describe('snapshot console snippet', () => {
  it('prints the snippet, with the mask and walker options fixed in it', async () => {
    const { result, out } = await snippet(['--mask', 'structure', '--max-nodes', '50']);
    expect(out).toEqual([result.snippet]);
    expect(result.copied).toBe(false);
    expect(result.snippet).toMatch(/^\(\(\) => \{/);
    expect(result.snippet).toContain('"trigger":"manual","mask":"structure","maxNodes":50,"focus":"auto"');
  });

  it('copies the snippet with --copy, and says what to do next', async () => {
    const clipboard = fakeClipboard();
    const { result, out } = await snippet(['--copy'], clipboard);
    expect(clipboard.written).toEqual([result.snippet]);
    expect(result.copied).toBe(true);
    expect(out.join('\n')).toContain('npx simply-utam snapshot console import');
  });

  it('warns on mask full', async () => {
    const { err } = await snippet(['--mask', 'full']);
    expect(err).toEqual(['DOM snapshot: mask "full" keeps record data in the snapshot.']);
  });

  it('exits 2 when --copy finds no clipboard tool', async () => {
    await expect(snippet(['--copy'], fakeClipboard('', true))).rejects.toMatchObject({
      message: expect.stringContaining('Run without --copy to print it.'),
      oclif: { exit: 2 },
    });
  });
});

describe('snapshot console import', () => {
  const manual = path.join('.utam', 'snapshots', 'manual');

  it('saves the clipboard to the manual folder and latest.json, and prints the header', async () => {
    const { result, out } = await importSnapshot(['--label', 'account list']);
    expect(result.file).toBe(path.join(manual, 'manual--account-list.json'));
    expect(result.meta).toMatchObject({ label: 'account list', trigger: 'manual' });
    expect(out[0]).toBe(`DOM snapshot saved to ${result.file}`);
    expect(out.join('\n')).toContain('https://acme.lightning.force.com/lightning/o/Account/list');
    expect(fs.readFileSync(path.join(projectDir, '.utam', 'snapshots', 'latest.json'), 'utf8')).toBe(
      fs.readFileSync(path.join(projectDir, result.file), 'utf8'),
    );
  });

  it('reads --file, and --file - from standard input', async () => {
    const file = path.join(projectDir, 'downloaded.json');
    fs.writeFileSync(file, snapshotJson);
    const fromFile = await importSnapshot(['--file', file], fakeClipboard('', true));
    expect(fromFile.result.file).toMatch(/manual--\d+\.json$/);
    const fromStdin = await importSnapshot(['--file', '-', '--label', 'piped'], fakeClipboard('', true), snapshotJson);
    expect(fromStdin.result.file).toBe(path.join(manual, 'manual--piped.json'));
  });

  it('warns when the snapshot keeps record data', async () => {
    const { err } = await importSnapshot([], fakeClipboard(snapshotJson.replace('"mask":"labels"', '"mask":"full"')));
    expect(err).toEqual(['This snapshot was captured with mask "full": it keeps record data.']);
  });

  it('exits 2 for an empty clipboard, text that is not a snapshot, a missing file, or no clipboard tool', async () => {
    const bad = (argv: string[], clipboard: Clipboard, message: string): Promise<void> =>
      expect(importSnapshot(argv, clipboard)).rejects.toMatchObject({
        message: expect.stringContaining(message),
        oclif: { exit: 2 },
      });
    await bad([], fakeClipboard('  \n'), 'The clipboard is empty.');
    await bad([], fakeClipboard('DOM snapshot of … copied'), "The clipboard doesn't hold a DOM snapshot: Not JSON");
    await bad(['--file', path.join(projectDir, 'missing.json')], fakeClipboard(), 'No such file');
    await bad([], fakeClipboard('', true), "Can't read the clipboard: no clipboard tool worked (tried pbpaste)");
  });
});

describe('systemClipboard', () => {
  /** A runner where only `available` commands exist; each call is recorded. */
  function runner(available: Record<string, string>): CommandRunner & { calls: string[] } {
    const calls: string[] = [];
    const run = async (command: string, _args: string[], input?: string): Promise<{ code: number; stdout: string }> => {
      calls.push(input === undefined ? command : `${command} <- ${input}`);
      if (!(command in available)) throw Object.assign(new Error(`spawn ${command} ENOENT`), { code: 'ENOENT' });
      return { code: 0, stdout: available[command] };
    };
    return Object.assign(run, { calls });
  }

  it('reads and writes with the platform tool', async () => {
    const run = runner({ pbpaste: 'text', pbcopy: '' });
    const clipboard = systemClipboard({ platform: 'darwin', run });
    expect(await clipboard.read()).toBe('text');
    await clipboard.write('snippet');
    expect(run.calls).toEqual(['pbpaste', 'pbcopy <- snippet']);
  });

  it('tries each Linux tool in turn, skipping one that is missing or fails', async () => {
    const failing: CommandRunner = async (command, args, input) =>
      command === 'wl-paste' ? { code: 1, stdout: '' } : run(command, args, input);
    const run = runner({ 'wl-paste': '', xsel: 'from xsel' });
    expect(await systemClipboard({ platform: 'linux', run: failing }).read()).toBe('from xsel');
    expect(run.calls).toEqual(['xclip', 'xsel']);
  });

  it('uses PowerShell on Windows, and says what it tried when nothing works', async () => {
    const run = runner({});
    await expect(systemClipboard({ platform: 'win32', run }).read()).rejects.toThrow(
      'no clipboard tool worked (tried powershell)',
    );
    await expect(systemClipboard({ platform: 'aix', run }).write('x')).rejects.toThrow(
      'no clipboard tool for this platform',
    );
  });
});
