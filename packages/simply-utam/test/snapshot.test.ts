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
import { fileURLToPath } from 'node:url';
import { Command, Config } from '@oclif/core';
import type {
  AncestorsResult,
  DomNode,
  FindResult,
  LookupResult,
  NodeDetails,
  PathResult,
  SearchResult,
} from '@simplysf/simply-utam-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import SnapshotFind from '../src/commands/snapshot/find.js';
import SnapshotLookup from '../src/commands/snapshot/lookup.js';
import SnapshotNode from '../src/commands/snapshot/node.js';
import SnapshotPath from '../src/commands/snapshot/path.js';
import SnapshotTree from '../src/commands/snapshot/tree.js';

function writeFiles(dir: string, files: Record<string, unknown>): void {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(dir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
  }
}

/**
 * A failure snapshot as the walker writes it: a record page host with a heading in its shadow root.
 * Handles, numbered on read: html n1, body n2, the host n3, its h1 n4, the button n5.
 */
const failureSnapshot = {
  format: 'simply-utam-dom-snapshot',
  version: 1,
  meta: {
    capturedAt: '2026-10-16T12:00:00.000Z',
    trigger: 'failure',
    url: 'https://acme.lightning.force.com/lightning/r/Account/•id/view',
    title: '•4 | •7 | Salesforce',
    viewport: [1280, 900],
    scenario: 'Record title',
    step: 'Then the title is "Acme"',
    error: "Can't find element with locator 'h1' inside its scope shadow root\nExpected: something",
    mask: 'labels',
    truncated: null,
  },
  root: {
    address: '0',
    tag: 'html',
    children: [
      {
        address: '0.1',
        tag: 'body',
        children: [
          {
            address: '0.1.0',
            tag: 'one-record-home-flexipage2',
            rect: [0, 0, 10, 10],
            shadow: { mode: 'synthetic', children: [{ address: '0.1.0.s.0', tag: 'h1', text: '•4' }] },
          },
          { address: '0.1.1', tag: 'button', text: 'Save', rect: [0, 0, 10, 10] },
        ],
      },
    ],
  },
};

let config: Config;
let projectDir: string;

// Loading the oclif config imports every command module; see cli.test.ts.
beforeAll(async () => {
  config = await Config.load(fileURLToPath(new URL('..', import.meta.url)));
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simply-utam-snapshot-cli-'));
  writeFiles(projectDir, {
    'package.json': { name: 'my-app' },
    'utam.config.json': { pageObjectsRootDir: './', pageObjectsFileMask: ['**/__utam__/**/*.utam.json'] },
    'test/__utam__/recordPage.utam.json': {
      root: true,
      selector: { css: 'one-record-home-flexipage2' },
      description: 'The record page.',
      shadow: { elements: [{ name: 'title', public: true, selector: { css: 'h1' } }] },
    },
    '.utam/snapshots/latest.json': failureSnapshot,
  });
}, 60_000);

afterAll(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

afterEach(() => {
  process.exitCode = undefined;
});

type CommandClass = new (argv: string[], config: Config) => Command & { run(): Promise<unknown> };

async function run(
  CommandClass: CommandClass,
  argv: string[],
): Promise<{ result: unknown; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const command = new CommandClass([...argv, '--project-dir', projectDir], config);
  command.log = (message?: string): void => {
    out.push(message ?? '');
  };
  command.warn = (input: string | Error): string | Error => {
    err.push(String(input));
    return input;
  };
  const result = await command.run();
  return { result, out, err };
}

describe('snapshot lookup', () => {
  it('prints the page objects for a tag and returns them as data', async () => {
    const { result, out, err } = await run(SnapshotLookup, ['one-record-home-flexipage2']);
    expect(out).toContain('my-app/pageObjects/recordPage (root, project)');
    expect(out).toContain('    getTitle()  title: "h1" [shadow]');
    expect((result as LookupResult).matches[0].entry.name).toBe('my-app/pageObjects/recordPage');
    expect(err.join('\n')).toMatch(/salesforce-pageobjects is not installed/);
  });

  it('looks a page object up by its short name', async () => {
    const { result } = await run(SnapshotLookup, ['recordPage']);
    expect((result as LookupResult).matches.map((match) => match.via)).toEqual(['name']);
  });

  it('searches with --search', async () => {
    const { result, out } = await run(SnapshotLookup, ['--search', 'record page']);
    expect((result as SearchResult).results.map((line) => line.name)).toEqual(['my-app/pageObjects/recordPage']);
    expect(out[0]).toBe('1 page objects match "record page" (name matches first, then tag, then description):');
  });

  it('applies --limit to the text output', async () => {
    const { out } = await run(SnapshotLookup, ['recordPage', '--limit', '2']);
    expect(out.at(-1)).toMatch(/more lines not shown \(output limit 2\)/);
  });

  it('exits 2 with neither a tag nor --search, or with both', async () => {
    await expect(run(SnapshotLookup, [])).rejects.toMatchObject({ oclif: { exit: 2 } });
    await expect(run(SnapshotLookup, ['recordPage', '--search', 'record'])).rejects.toMatchObject({
      oclif: { exit: 2 },
    });
  });
});

describe('snapshot find, path, tree and node', () => {
  it("reads the project's latest snapshot and prints the header first, with UTAM's search to repeat", async () => {
    const { out } = await run(SnapshotFind, ['--text', 'save']);
    expect(out.slice(0, 7)).toEqual([
      `Snapshot ${path.relative(process.cwd(), path.join(projectDir, '.utam/snapshots/latest.json'))}: failure, 2026-10-16T12:00:00.000Z, https://acme.lightning.force.com/lightning/r/Account/•id/view, mask labels`,
      '  scenario: Record title',
      '  step: Then the title is "Acme"',
      "  error: Can't find element with locator 'h1' inside its scope shadow root",
      '         Expected: something',
      '  UTAM searched its scope element\'s shadow root (shadow.elements) for "h1". To repeat its search here:',
      '    npx simply-utam snapshot find --css "h1" --within n3 --shadow   (my-app/pageObjects/recordPage, element "title")',
    ]);
    expect(out.slice(7)).toEqual(['1 visible, 0 hidden matches for text "save"', 'n5       button "Save"']);
  });

  it('finds by CSS in a scope, and returns the matches as data', async () => {
    const { result, out } = await run(SnapshotFind, ['--css', 'h1', '--within', 'n3', '--shadow']);
    expect(out).toContain('n4       h1 "•4"  ← findElement / utam.load takes this one');
    expect((result as FindResult).visible.map((node) => node.id)).toEqual(['n4']);
  });

  it('refuses --shadow without --css and --within, rather than ignoring it', async () => {
    await expect(run(SnapshotFind, ['--text', 'Save', '--shadow'])).rejects.toMatchObject({ oclif: { exit: 2 } });
    await expect(run(SnapshotFind, ['--css', 'h1', '--shadow'])).rejects.toMatchObject({ oclif: { exit: 2 } });
    await expect(run(SnapshotFind, ['--css', 'h1'])).resolves.toBeDefined();
  });

  it('reads --file instead of the latest snapshot', async () => {
    const other = path.join(projectDir, 'other.json');
    fs.writeFileSync(
      other,
      JSON.stringify({ ...failureSnapshot, meta: { ...failureSnapshot.meta, error: undefined } }),
    );
    const { out } = await run(SnapshotFind, ['--tag', 'button', '--file', other]);
    expect(out[0]).toMatch(/^Snapshot .*other\.json: failure/);
    expect(out.some((line) => line.includes('UTAM searched'))).toBe(false);
  });

  it('prints the path with page objects, and exits 1 when --text finds no single visible match', async () => {
    const { result, out } = await run(SnapshotPath, ['--node', 'n4']);
    expect((result as PathResult).steps.map((step) => step.id)).toEqual(['n3', 'n4']);
    expect(out).toContain(
      '    ↳ reachable through my-app/pageObjects/recordPage, element "title" "h1" (public, shadow, getTitle())',
    );
    const byText = await run(SnapshotPath, ['--text', 'nothing like it']);
    expect(byText.out.at(-1)).toMatch(/^No path printed: nothing matches "nothing like it"/);
    expect(process.exitCode).toBe(1);
  });

  it('prints a tree to a depth, a node in full, and its ancestors', async () => {
    const tree = await run(SnapshotTree, ['--node', 'n3', '--depth', '1']);
    expect(tree.out.slice(-3)).toEqual([
      'one-record-home-flexipage2  [n3]',
      '  #shadow(synthetic)',
      '    h1 "•4"  [n4]',
    ]);
    expect((tree.result as DomNode).id).toBe('n3');
    const node = await run(SnapshotNode, ['n4']);
    expect(node.out).toContain('h1  [n4]  at 0.1.0.s.0');
    expect((node.result as NodeDetails).parent).toMatchObject({ id: 'n3', via: 'shadow' });
    const byFlag = await run(SnapshotNode, ['--node', 'n4', '--ancestors']);
    expect((byFlag.result as AncestorsResult).ancestors[0]).toEqual({
      kind: 'shadowRoot',
      host: 'n3',
      mode: 'synthetic',
    });
  });

  it('applies --limit to a node in full, and refuses a limit below 1', async () => {
    const full = await run(SnapshotNode, ['n4']);
    const limited = await run(SnapshotNode, ['n4', '--limit', '1']);
    // The header is printed in full; the node's own lines are cut after the first.
    const first = full.out.indexOf('h1  [n4]  at 0.1.0.s.0');
    expect(limited.out).toEqual([
      ...full.out.slice(0, first + 1),
      `… ${full.out.length - first - 1} more lines not shown (output limit 1). Raise --limit.`,
    ]);
    for (const limit of ['0', '-1'])
      // eslint-disable-next-line no-await-in-loop
      await expect(run(SnapshotNode, ['n4', '--limit', limit])).rejects.toThrow(/greater than or equal to 1/);
  });

  it('exits 2 on bad input: no snapshot, an address, an unknown handle, or a bad selector', async () => {
    await expect(
      run(SnapshotFind, ['--tag', 'a', '--file', path.join(projectDir, 'missing.json')]),
    ).rejects.toMatchObject({ oclif: { exit: 2 } });
    await expect(run(SnapshotNode, ['0.1.1'])).rejects.toThrow(/0\.1\.1 is an address, not a node handle.*that's n5/);
    await expect(run(SnapshotNode, ['n99'])).rejects.toMatchObject({ oclif: { exit: 2 } });
    await expect(run(SnapshotNode, [])).rejects.toMatchObject({ oclif: { exit: 2 } });
    await expect(run(SnapshotFind, ['--css', 'a['])).rejects.toMatchObject({ oclif: { exit: 2 } });
    await expect(run(SnapshotFind, [])).rejects.toMatchObject({ oclif: { exit: 2 } });
    await expect(run(SnapshotTree, ['--node', 'n99'])).rejects.toMatchObject({ oclif: { exit: 2 } });
    await expect(run(SnapshotPath, ['--node', 'n99'])).rejects.toMatchObject({ oclif: { exit: 2 } });
  });
});
