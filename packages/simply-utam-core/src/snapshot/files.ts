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

import * as nodeFs from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import type { EnvLike } from '../test-environment.js';
import { serializeDomSnapshot, type DomSnapshot } from './format.js';

/** Set once per test run (the scaffolded `onPrepare` hook does), so every worker writes to one folder. */
export const SNAPSHOT_RUN_ID_ENV = 'UTAM_SNAPSHOT_RUN_ID';
/** Where snapshots are written, relative to the project. */
export const SNAPSHOTS_DIR = '.utam/snapshots';
/** A copy of the most recent snapshot, relative to the project: the query commands' default. */
export const LATEST_SNAPSHOT = `${SNAPSHOTS_DIR}/latest.json`;

/** The file system calls `writeDomSnapshot` and `pruneDomSnapshots` make. */
export type SnapshotFileSystem = {
  mkdir(dir: string, options: { recursive: true }): Promise<unknown>;
  writeFile(file: string, data: string, options?: { flag?: string }): Promise<void>;
  readdir(dir: string, options: { withFileTypes: true }): Promise<Array<{ name: string; isDirectory(): boolean }>>;
  rm(target: string, options: { recursive: true; force: true }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
};

export type WriteDomSnapshotOptions = {
  /** The project folder. Defaults to the current directory. */
  projectDir?: string;
  /** Where `UTAM_SNAPSHOT_RUN_ID` is read from. Defaults to `process.env`. */
  env?: EnvLike;
  fs?: SnapshotFileSystem;
  /** Page-object package versions to record; looked up from `projectDir` when omitted. */
  pageObjectPackages?: Record<string, string>;
};

export type PruneDomSnapshotsOptions = {
  /** The project folder. Defaults to the current directory. */
  projectDir?: string;
  /** How many run folders to keep, newest first. Defaults to 10. */
  keepRuns?: number;
  fs?: SnapshotFileSystem;
};

const MAX_PART = 60;

function cleanPart(value: string): string {
  return value
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_PART);
}

/**
 * A run id for `UTAM_SNAPSHOT_RUN_ID`: the time as `20261016T120000`, which sorts in time order, so
 * run folders do too.
 *
 * @param date The time; now when omitted.
 */
export function snapshotRunId(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, '').slice(0, 15);
}

const MAX_NAME_TRIES = 1000;

/** Replace `file` in one step, so a reader never sees it half-written while another worker writes it. */
async function replaceFile(fs: SnapshotFileSystem, file: string, data: string): Promise<void> {
  const temp = `${file}.${process.pid}-${Math.random().toString(36).slice(2, 10)}.tmp`;
  await fs.writeFile(temp, data);
  try {
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { recursive: true, force: true });
    throw error;
  }
}

/** `<scenario>--<step>` for a failure; `<scenario>--<label>`, or the scenario numbered, otherwise. */
function baseName(snapshot: DomSnapshot): { name: string; numbered: boolean } {
  const { meta } = snapshot;
  const scenario = cleanPart(meta.scenario ?? '') || 'scenario';
  if (meta.trigger === 'failure')
    return { name: `${scenario}--${cleanPart(meta.step ?? '') || 'step'}`, numbered: false };
  const label = cleanPart(meta.label ?? '');
  return label ? { name: `${scenario}--${label}`, numbered: false } : { name: scenario, numbered: true };
}

function installedPageObjectPackages(projectDir: string): Record<string, string> {
  try {
    const require = createRequire(path.join(path.resolve(projectDir), 'package.json'));
    const pkg = require('salesforce-pageobjects/package.json') as { version: string };
    return { 'salesforce-pageobjects': pkg.version };
  } catch {
    return {};
  }
}

/**
 * Write a snapshot to `.utam/snapshots/<run id>/<name>.json`, and a copy as
 * `.utam/snapshots/latest.json`, replaced in one step through a temporary file and a rename. The run
 * id comes from `UTAM_SNAPSHOT_RUN_ID`, or the current time.
 * A name already taken gets a number; files are created exclusively, so two workers can't both take
 * one name. Records the installed `salesforce-pageobjects` version in the file's
 * `meta.pageObjectPackages`, leaving `snapshot` unchanged.
 *
 * @param snapshot The snapshot to write.
 * @param options Where and how to write it.
 * @returns The path of the file written, relative to the project folder.
 */
export async function writeDomSnapshot(snapshot: DomSnapshot, options: WriteDomSnapshotOptions = {}): Promise<string> {
  const projectDir = options.projectDir ?? process.cwd();
  const fs = options.fs ?? nodeFs;
  const env = options.env ?? process.env;
  const packages = options.pageObjectPackages ?? installedPageObjectPackages(projectDir);
  // The caller's snapshot is left as it is; only the file gets the versions.
  const written =
    Object.keys(packages).length > 0
      ? { ...snapshot, meta: { ...snapshot.meta, pageObjectPackages: packages } }
      : snapshot;

  const dir = path.join(SNAPSHOTS_DIR, cleanPart(env[SNAPSHOT_RUN_ID_ENV] ?? '') || snapshotRunId());
  await fs.mkdir(path.join(projectDir, dir), { recursive: true });

  const json = serializeDomSnapshot(written);
  const { name, numbered } = baseName(snapshot);
  for (let n = 1; ; n++) {
    const file = path.join(dir, numbered ? `${name}--${n}.json` : n === 1 ? `${name}.json` : `${name}-${n}.json`);
    try {
      // Names are tried one at a time: `wx` fails on a name another writer already took.
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(path.join(projectDir, file), json, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (n < MAX_NAME_TRIES) continue;
      throw new Error(
        `Can't name a snapshot in ${dir}: ${MAX_NAME_TRIES} files named after ${name} already exist. Prune the folder or set another ${SNAPSHOT_RUN_ID_ENV}.`,
        { cause: error },
      );
    }
    // eslint-disable-next-line no-await-in-loop -- runs once, after the loop's last attempt
    await replaceFile(fs, path.join(projectDir, LATEST_SNAPSHOT), json);
    return file;
  }
}

/**
 * Delete all but the newest `keepRuns` run folders under `.utam/snapshots/`. Run folders are
 * named by run id, so run ids must sort in time order: a timestamp does, and numbers in a custom id
 * compare as numbers (`build-9` before `build-10`). The newest sort last. `latest.json` is kept.
 *
 * @param options The project, how many runs to keep, and the file system.
 * @returns The run folders deleted, relative to the project folder.
 */
export async function pruneDomSnapshots(options: PruneDomSnapshotsOptions = {}): Promise<string[]> {
  const projectDir = options.projectDir ?? process.cwd();
  const fs = options.fs ?? nodeFs;
  const keepRuns = Math.max(0, options.keepRuns ?? 10);
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(path.join(projectDir, SNAPSHOTS_DIR), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const runs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const removed = runs.slice(0, Math.max(0, runs.length - keepRuns)).map((run) => path.join(SNAPSHOTS_DIR, run));
  await Promise.all(removed.map((dir) => fs.rm(path.join(projectDir, dir), { recursive: true, force: true })));
  return removed;
}
