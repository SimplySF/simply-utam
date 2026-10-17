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
import { Config } from '@oclif/core';
import type { LookupResult, SearchResult } from '@simplysf/simply-utam-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import SnapshotLookup from '../src/commands/snapshot/lookup.js';

function writeFiles(dir: string, files: Record<string, unknown>): void {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(dir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, JSON.stringify(content));
  }
}

describe('snapshot lookup', () => {
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
    });
  }, 60_000);

  afterAll(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  async function run(argv: string[]): Promise<{ result: unknown; out: string; err: string }> {
    const out: string[] = [];
    const err: string[] = [];
    const command = new SnapshotLookup([...argv, '--project-dir', projectDir], config);
    command.log = (message?: string): void => {
      out.push(message ?? '');
    };
    command.warn = (input: string | Error): string | Error => {
      err.push(String(input));
      return input;
    };
    const result = await command.run();
    return { result, out: out.join('\n'), err: err.join('\n') };
  }

  it('prints the page objects for a tag and returns them as data', async () => {
    const { result, out, err } = await run(['one-record-home-flexipage2']);
    expect(out).toContain('my-app/pageObjects/recordPage (root, project)');
    expect(out).toContain('    getTitle()  title: "h1" [shadow]');
    expect((result as LookupResult).matches[0].entry.name).toBe('my-app/pageObjects/recordPage');
    expect(err).toMatch(/salesforce-pageobjects is not installed/);
  });

  it('looks a page object up by its short name', async () => {
    const { result } = await run(['recordPage']);
    expect((result as LookupResult).matches.map((match) => match.via)).toEqual(['name']);
  });

  it('searches with --search', async () => {
    const { result, out } = await run(['--search', 'record page']);
    expect((result as SearchResult).results.map((line) => line.name)).toEqual(['my-app/pageObjects/recordPage']);
    expect(out).toContain('1 page objects match "record page"');
  });

  it('applies --limit to the text output', async () => {
    const { out } = await run(['recordPage', '--limit', '2']);
    expect(out).toMatch(/more lines not shown \(output limit 2\)/);
  });

  it('exits 2 with neither a tag nor --search, or with both', async () => {
    await expect(run([])).rejects.toMatchObject({ oclif: { exit: 2 } });
    await expect(run(['recordPage', '--search', 'record'])).rejects.toMatchObject({ oclif: { exit: 2 } });
  });
});
