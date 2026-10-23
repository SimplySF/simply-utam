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
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  DOM_SNAPSHOT_FORMAT,
  DomSnapshotError,
  LATEST_SNAPSHOT,
  MANUAL_RUN_ID,
  captureDomSnapshot,
  parseDomSnapshot,
  pruneDomSnapshots,
  readDomSnapshot,
  serializeDomSnapshot,
  snapshotRunId,
  writeDomSnapshot,
  type DomSnapshot,
  type SnapshotFileSystem,
  type WriteDomSnapshotOptions,
} from '../src/index.js';

/** A small snapshot as the walker writes it: addresses, no handles. */
function rawSnapshot(meta: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: DOM_SNAPSHOT_FORMAT,
    version: 1,
    meta: {
      capturedAt: '2026-10-16T12:00:00.000Z',
      trigger: 'manual',
      url: 'https://acme.lightning.force.com/lightning/page/home',
      title: 'Home | Salesforce',
      viewport: [1280, 900],
      mask: 'labels',
      truncated: null,
      ...meta,
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
              tag: 'c-app',
              attrs: { id: 'main' },
              shadow: { mode: 'synthetic', children: [{ address: '0.1.0.s.0', tag: 'c-inner' }] },
              children: [{ address: '0.1.0.0', tag: 'span', text: 'light' }],
            },
          ],
        },
      ],
    },
  });
}

const dirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simply-utam-snapshot-files-'));
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('format', () => {
  it('numbers handles on read, shadow children before light ones', () => {
    const snapshot = parseDomSnapshot(rawSnapshot());
    const app = snapshot.root.children![0].children![0];
    expect([snapshot.root.id, app.id, app.shadow!.children[0].id, app.children![0].id]).toEqual([
      'n1',
      'n3',
      'n4',
      'n5',
    ]);
  });

  it('writes the file without handles, keeping attributes named id, and reads it back the same', () => {
    const snapshot = parseDomSnapshot(rawSnapshot());
    const json = serializeDomSnapshot(snapshot);
    expect(json).not.toMatch(/"id":"n\d+"/);
    expect(json).toContain('"attrs":{"id":"main"}');
    expect(parseDomSnapshot(json)).toEqual(snapshot);
  });

  it('rejects JSON that is not a snapshot, another format, a newer version, or no addressed root', () => {
    expect(() => parseDomSnapshot('{ nope')).toThrow(/Not JSON/);
    expect(() => parseDomSnapshot('{"format":"x"}')).toThrow(/format is "x", expected "simply-utam-dom-snapshot"/);
    expect(() => parseDomSnapshot(rawSnapshot().replace('"version":1', '"version":2'))).toThrow(
      /version 2 is newer than this reader understands \(1\)/,
    );
    expect(() => parseDomSnapshot(rawSnapshot().replace('"address":"0",', ''))).toThrow(/no root node with an address/);
    expect(() => parseDomSnapshot('null')).toThrow(DomSnapshotError);
  });

  it('rejects a version that is not a whole number from 1', () => {
    for (const version of ['0', '-1', '1.5', '"1"'])
      expect(() => parseDomSnapshot(rawSnapshot().replace('"version":1', `"version":${version}`))).toThrow(
        `Not a DOM snapshot: version is ${version}, expected a whole number from 1`,
      );
  });

  it('reads a snapshot file, and names the file it cannot read', async () => {
    const file = path.join(tempDir(), 'snapshot.json');
    fs.writeFileSync(file, rawSnapshot());
    expect((await readDomSnapshot(file)).root.id).toBe('n1');
    await expect(readDomSnapshot(`${file}.missing`)).rejects.toThrow(/Cannot read .*snapshot\.json\.missing/);
  });
});

describe('captureDomSnapshot', () => {
  const browserReturning = (
    result: unknown,
  ): { execute: (script: string) => Promise<unknown> } & { scripts: string[] } => {
    const scripts: string[] = [];
    return {
      scripts,
      execute: async (script: string): Promise<unknown> => {
        scripts.push(script);
        return result;
      },
    };
  };

  it('runs the walker through browser.execute with the options, and adds the step context', async () => {
    const browser = browserReturning(rawSnapshot({ trigger: 'failure' }));
    const snapshot = await captureDomSnapshot({
      browser,
      trigger: 'failure',
      scenario: 'Create Account',
      step: 'When user clicks "New"',
      error: new Error('\u001b[31mexpected\u001b[39m "Acme"\nreceived "Other"'),
      maxNodes: 50,
      focus: 'auto',
      env: {},
    });
    expect(browser.scripts[0]).toMatch(/^return \(\/\*[\s\S]*function domSnapshotWalker\(input\)/);
    expect(browser.scripts[0]).toContain('"trigger":"failure","mask":"labels","maxNodes":50,"focus":"auto"');
    expect(snapshot?.meta).toMatchObject({
      scenario: 'Create Account',
      step: 'When user clicks "New"',
      error: 'expected "Acme"\nreceived "Other"',
    });
    expect(snapshot?.root.id).toBe('n1');
  });

  it('takes the mask from UTAM_SNAPSHOT_MASK through env, and warns when it is full', async () => {
    const browser = browserReturning(rawSnapshot());
    const logged: string[] = [];
    await captureDomSnapshot({ browser, env: { UTAM_SNAPSHOT_MASK: 'full' }, log: (m) => logged.push(m) });
    expect(browser.scripts[0]).toContain('"mask":"full"');
    expect(logged).toEqual(['DOM snapshot: mask "full" keeps record data in the snapshot.']);
    await captureDomSnapshot({ browser, env: { UTAM_SNAPSHOT_MASK: 'bogus' }, log: (m) => logged.push(m) });
    expect(browser.scripts[1]).toContain('"mask":"labels"');
  });

  it('runs through any SnapshotPage, with the backstop timeout', async () => {
    const calls: number[] = [];
    const snapshot = await captureDomSnapshot({
      page: { evaluate: async (_source, timeoutMs) => (calls.push(timeoutMs), rawSnapshot()) },
      timeoutMs: 1234,
    });
    expect(calls).toEqual([1234]);
    expect(snapshot?.meta.trigger).toBe('manual');
  });

  it('never throws: a failing script, no result, a hang or no browser each log and return undefined', async () => {
    const logged: string[] = [];
    const log = (message: string): number => logged.push(message);
    const failing = { execute: async (): Promise<unknown> => Promise.reject(new Error('no session')) };
    expect(await captureDomSnapshot({ browser: failing, log })).toBeUndefined();
    expect(await captureDomSnapshot({ browser: browserReturning(undefined), log })).toBeUndefined();
    const hanging = { evaluate: (): Promise<string> => new Promise<string>(() => undefined) };
    expect(await captureDomSnapshot({ page: hanging, timeoutMs: 5, log })).toBeUndefined();
    expect(await captureDomSnapshot({ log })).toBeUndefined();
    expect(logged).toEqual([
      'DOM snapshot not captured: no session',
      'DOM snapshot not captured: Not JSON: "undefined" is not valid JSON',
      'DOM snapshot not captured: timed out after 5 ms',
      'DOM snapshot not captured: no browser to capture',
    ]);
  });
});

describe('writeDomSnapshot', () => {
  const env = { UTAM_SNAPSHOT_RUN_ID: '20261016T120000' };
  const write = (snapshot: DomSnapshot, projectDir: string): Promise<string> =>
    writeDomSnapshot(snapshot, { projectDir, env, pageObjectPackages: {} });
  const run = (...parts: string[]): string => path.join('.utam', 'snapshots', '20261016T120000', ...parts);

  it('names a failure by scenario and step, cleaned and capped', async () => {
    const dir = tempDir();
    const snapshot = parseDomSnapshot(
      rawSnapshot({ trigger: 'failure', scenario: 'Create Account', step: `When user clicks "New" ${'x'.repeat(80)}` }),
    );
    const file = await write(snapshot, dir);
    expect(file).toBe(run(`Create-Account--When-user-clicks-New-${'x'.repeat(39)}.json`));
    const stored = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as { root: { id?: string } };
    expect(stored.root.id).toBeUndefined();
  });

  it('names a capture by scenario and label, or numbers it, adding a number when the name is taken', async () => {
    const dir = tempDir();
    const labeled = parseDomSnapshot(rawSnapshot({ trigger: 'step', scenario: 'S', label: 'after opening' }));
    const unlabeled = parseDomSnapshot(rawSnapshot({ trigger: 'manual', scenario: 'S' }));
    expect(await write(labeled, dir)).toBe(run('S--after-opening.json'));
    expect(await write(labeled, dir)).toBe(run('S--after-opening-2.json'));
    expect(await write(unlabeled, dir)).toBe(run('S--1.json'));
    expect(await write(unlabeled, dir)).toBe(run('S--2.json'));
  });

  it('writes to the runId folder when given, naming a capture with no scenario manual', async () => {
    const dir = tempDir();
    const labeled = parseDomSnapshot(rawSnapshot({ label: 'account list' }));
    const unlabeled = parseDomSnapshot(rawSnapshot());
    const manual = (file: string): string => path.join('.utam', 'snapshots', 'manual', file);
    const options = { projectDir: dir, runId: MANUAL_RUN_ID, env, pageObjectPackages: {} };
    expect(await writeDomSnapshot(labeled, options)).toBe(manual('manual--account-list.json'));
    expect(await writeDomSnapshot(unlabeled, options)).toBe(manual('manual--1.json'));
    const failure = parseDomSnapshot(rawSnapshot({ trigger: 'failure', step: 'Then x' }));
    expect(await writeDomSnapshot(failure, options)).toBe(manual('scenario--Then-x.json'));
  });

  it('gives two writers racing for one name a file each', async () => {
    const dir = tempDir();
    const snapshot = parseDomSnapshot(rawSnapshot({ trigger: 'step', scenario: 'S', label: 'x' }));
    const files = await Promise.all([write(snapshot, dir), write(snapshot, dir), write(snapshot, dir)]);
    expect(new Set(files).size).toBe(3);
  });

  it('copies the newest to latest.json, and uses the current time without a run id', async () => {
    const dir = tempDir();
    const snapshot = parseDomSnapshot(rawSnapshot({ trigger: 'step', scenario: 'S' }));
    const file = await writeDomSnapshot(snapshot, { projectDir: dir, env: {}, pageObjectPackages: {} });
    expect(file).toMatch(/^\.utam[/\\]snapshots[/\\]\d{8}T\d{6}[/\\]S--1\.json$/);
    expect(fs.readFileSync(path.join(dir, LATEST_SNAPSHOT), 'utf8')).toBe(
      fs.readFileSync(path.join(dir, file), 'utf8'),
    );
  });

  it('records the version of each page-object package a namespace maps to', async () => {
    const dir = tempDir();
    const files: Record<string, string> = {
      'package.json': '{"name":"p"}',
      'generator.config.json': '{"namespaces":{"lightning":"salesforce-pageobjects/lightning/pageObjects/"}}',
      '.utam/namespace-map.json': '{"p/pageObjects/shared":"shared-pageobjects/pageObjects/shared"}',
      'node_modules/salesforce-pageobjects/package.json': '{"name":"salesforce-pageobjects","version":"12.0.0"}',
      'node_modules/shared-pageobjects/package.json': '{"name":"shared-pageobjects","version":"2.1.0"}',
      'node_modules/unmapped-pageobjects/package.json': '{"name":"unmapped-pageobjects","version":"1.0.0"}',
    };
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), content);
    }
    const snapshot = parseDomSnapshot(rawSnapshot({ trigger: 'step', scenario: 'S' }));
    const file = await writeDomSnapshot(snapshot, { projectDir: dir, env });
    const written = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as DomSnapshot;
    expect(written.meta.pageObjectPackages).toEqual({
      'salesforce-pageobjects': '12.0.0',
      'shared-pageobjects': '2.1.0',
    });
    // The caller's snapshot isn't changed, so writing it again, or attaching it elsewhere, sees what it was given.
    expect(snapshot.meta.pageObjectPackages).toBeUndefined();
  });

  it('looks the versions up once per project folder, and takes versions it is given over them', async () => {
    const dir = tempDir();
    const pkg = path.join(dir, 'node_modules', 'salesforce-pageobjects', 'package.json');
    fs.mkdirSync(path.dirname(pkg), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p"}');
    fs.writeFileSync(
      path.join(dir, 'generator.config.json'),
      '{"namespaces":{"lightning":"salesforce-pageobjects/lightning/pageObjects/"}}',
    );
    fs.writeFileSync(pkg, '{"name":"salesforce-pageobjects","version":"12.0.0"}');
    const snapshot = parseDomSnapshot(rawSnapshot({ trigger: 'step', scenario: 'S' }));
    const versions = async (options: WriteDomSnapshotOptions): Promise<unknown> => {
      const file = await writeDomSnapshot(snapshot, { env, ...options });
      return (JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as DomSnapshot).meta.pageObjectPackages;
    };

    expect(await versions({ projectDir: dir })).toEqual({ 'salesforce-pageobjects': '12.0.0' });
    // A later write in the same process doesn't read the package again, by any spelling of the folder.
    fs.writeFileSync(pkg, '{"name":"salesforce-pageobjects","version":"13.0.0"}');
    expect(await versions({ projectDir: `${dir}${path.sep}` })).toEqual({ 'salesforce-pageobjects': '12.0.0' });
    expect(await versions({ projectDir: dir, pageObjectPackages: { 'salesforce-pageobjects': '9.9.9' } })).toEqual({
      'salesforce-pageobjects': '9.9.9',
    });
  });

  /** A file system in memory; `rename` throws `renameError` when set. */
  function memoryFs(renameError?: Error): {
    fileSystem: SnapshotFileSystem;
    files: Map<string, string>;
    calls: string[];
  } {
    const files = new Map<string, string>();
    const calls: string[] = [];
    const fileSystem: SnapshotFileSystem = {
      mkdir: async () => undefined,
      writeFile: async (file, data, options) => {
        calls.push(`write ${file}`);
        if (options?.flag === 'wx' && files.has(file)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
        files.set(file, data);
      },
      readdir: async () => [],
      stat: async () => ({ mtimeMs: 0 }),
      rm: async (target) => {
        calls.push(`rm ${target}`);
        files.delete(target);
      },
      rename: async (from, to) => {
        calls.push(`rename ${from} ${to}`);
        if (renameError) throw renameError;
        files.set(to, files.get(from)!);
        files.delete(from);
      },
    };
    return { fileSystem, files, calls };
  }

  it('writes through an injected file system', async () => {
    const memory = memoryFs();
    const snapshot = parseDomSnapshot(rawSnapshot({ trigger: 'step', scenario: 'S' }));
    await writeDomSnapshot(snapshot, { projectDir: '/p', env, fs: memory.fileSystem, pageObjectPackages: {} });
    expect([...memory.files.keys()].sort()).toEqual(
      [path.join('/p', LATEST_SNAPSHOT), path.join('/p', run('S--1.json'))].sort(),
    );
  });

  it('replaces latest.json by renaming a temporary file in the same folder over it', async () => {
    const memory = memoryFs();
    const snapshot = parseDomSnapshot(rawSnapshot({ trigger: 'step', scenario: 'S' }));
    await writeDomSnapshot(snapshot, { projectDir: '/p', env, fs: memory.fileSystem, pageObjectPackages: {} });
    const latest = path.join('/p', LATEST_SNAPSHOT);
    const rename = memory.calls.find((call) => call.startsWith('rename '))!;
    const [, temp, target] = rename.split(' ');
    expect(target).toBe(latest);
    expect(temp.startsWith(`${latest}.${process.pid}-`) && temp.endsWith('.tmp')).toBe(true);
    expect(memory.calls).toContain(`write ${temp}`);
    expect(memory.calls).not.toContain(`write ${latest}`);
  });

  it('removes the temporary file and writes latest.json in place when the rename fails', async () => {
    const memory = memoryFs(Object.assign(new Error('not permitted'), { code: 'EPERM' }));
    const snapshot = parseDomSnapshot(rawSnapshot({ trigger: 'step', scenario: 'S' }));
    const file = await writeDomSnapshot(snapshot, {
      projectDir: '/p',
      env,
      fs: memory.fileSystem,
      pageObjectPackages: {},
    });
    expect(file).toBe(run('S--1.json'));
    const latest = path.join('/p', LATEST_SNAPSHOT);
    const temp = memory.calls.find((call) => call.startsWith('rename '))!.split(' ')[1];
    expect(memory.calls.slice(-2)).toEqual([`rm ${temp}`, `write ${latest}`]);
    expect(memory.files.get(latest)).toBe(memory.files.get(path.join('/p', file)));
    expect([...memory.files.keys()].some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('puts captures with no run id in one folder per process', async () => {
    const memory = memoryFs();
    const snapshot = parseDomSnapshot(rawSnapshot({ trigger: 'step', scenario: 'S' }));
    const options = { projectDir: '/p', env: {}, fs: memory.fileSystem, pageObjectPackages: {} };
    const first = await writeDomSnapshot(snapshot, options);
    vi.useFakeTimers({ now: Date.now() + 5000 });
    try {
      const second = await writeDomSnapshot(snapshot, options);
      expect(path.dirname(second)).toBe(path.dirname(first));
      expect(path.basename(path.dirname(first))).toMatch(/^\d{8}T\d{6}$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('names the folder and base name when every numbered name is taken', async () => {
    const memory = memoryFs();
    const always: SnapshotFileSystem = {
      ...memory.fileSystem,
      writeFile: async () => {
        throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      },
    };
    const snapshot = parseDomSnapshot(rawSnapshot({ trigger: 'step', scenario: 'S', label: 'x' }));
    await expect(
      writeDomSnapshot(snapshot, { projectDir: '/p', env, fs: always, pageObjectPackages: {} }),
    ).rejects.toThrow(
      `Can't name a snapshot in ${run()}: 1000 files named after S--x already exist. Prune the folder or set another UTAM_SNAPSHOT_RUN_ID.`,
    );
  });
});

describe('snapshotRunId', () => {
  it('gives the time as a run id that sorts in time order', () => {
    expect(snapshotRunId(new Date('2026-10-16T12:34:56.789Z'))).toBe('20261016T123456');
    expect(snapshotRunId()).toMatch(/^\d{8}T\d{6}$/);
  });
});

describe('pruneDomSnapshots', () => {
  it('keeps the newest run folders and latest.json', async () => {
    const dir = tempDir();
    const snapshots = path.join(dir, '.utam', 'snapshots');
    for (const run of ['20261014T090000', '20261015T090000', '20261016T090000']) {
      fs.mkdirSync(path.join(snapshots, run), { recursive: true });
    }
    fs.writeFileSync(path.join(snapshots, 'latest.json'), '{}');
    const removed = await pruneDomSnapshots({ projectDir: dir, keepRuns: 2 });
    expect(removed).toEqual([path.join('.utam', 'snapshots', '20261014T090000')]);
    expect(fs.readdirSync(snapshots).sort()).toEqual(['20261015T090000', '20261016T090000', 'latest.json']);
  });

  it('keeps the manual folder and does not count it as a run', async () => {
    const dir = tempDir();
    const snapshots = path.join(dir, '.utam', 'snapshots');
    for (const run of ['20261015T090000', '20261016T090000', MANUAL_RUN_ID, 'run-9'])
      fs.mkdirSync(path.join(snapshots, run), { recursive: true });
    const removed = await pruneDomSnapshots({ projectDir: dir, keepRuns: 1 });
    expect(removed).toEqual([
      path.join('.utam', 'snapshots', '20261015T090000'),
      path.join('.utam', 'snapshots', '20261016T090000'),
    ]);
    expect(fs.readdirSync(snapshots).sort()).toEqual(['manual', 'run-9']);
  });

  it('keeps the runs written last, whatever their ids, so build ids and timestamps mix', async () => {
    const dir = tempDir();
    const snapshots = path.join(dir, '.utam', 'snapshots');
    // CI runs named by build number, older than the two local runs named by time.
    const written: Array<[string, string]> = [
      ['build-41', '2026-10-01T09:00:00Z'],
      ['build-42', '2026-10-02T09:00:00Z'],
      ['20261016T090000', '2026-10-16T09:00:00Z'],
      ['20261017T090000', '2026-10-17T09:00:00Z'],
    ];
    for (const [run, time] of written) {
      fs.mkdirSync(path.join(snapshots, run), { recursive: true });
      fs.utimesSync(path.join(snapshots, run), new Date(time), new Date(time));
    }
    const removed = await pruneDomSnapshots({ projectDir: dir, keepRuns: 2 });
    expect(removed).toEqual([path.join('.utam', 'snapshots', 'build-41'), path.join('.utam', 'snapshots', 'build-42')]);
    expect(fs.readdirSync(snapshots).sort()).toEqual(['20261016T090000', '20261017T090000']);
  });

  it('orders runs written at the same moment by name, numbers as numbers, so build-10 is newer than build-9', async () => {
    const dir = tempDir();
    const snapshots = path.join(dir, '.utam', 'snapshots');
    const time = new Date('2026-10-16T09:00:00Z');
    for (const run of ['build-10', 'build-8', 'build-9', 'build-11']) {
      fs.mkdirSync(path.join(snapshots, run), { recursive: true });
      fs.utimesSync(path.join(snapshots, run), time, time);
    }
    const removed = await pruneDomSnapshots({ projectDir: dir, keepRuns: 2 });
    expect(removed).toEqual([path.join('.utam', 'snapshots', 'build-8'), path.join('.utam', 'snapshots', 'build-9')]);
    expect(fs.readdirSync(snapshots).sort()).toEqual(['build-10', 'build-11']);
  });

  it('does nothing when there are no snapshots, and keeps 10 runs by default', async () => {
    const dir = tempDir();
    expect(await pruneDomSnapshots({ projectDir: dir })).toEqual([]);
    for (let i = 10; i < 22; i++)
      fs.mkdirSync(path.join(dir, '.utam', 'snapshots', `202610${i}T000000`), { recursive: true });
    expect(await pruneDomSnapshots({ projectDir: dir })).toHaveLength(2);
  });
});
