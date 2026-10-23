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
import * as path from 'node:path';
import type { EnvLike } from '../test-environment.js';
import { serializeDomSnapshot, type DomSnapshot } from './format.js';
import { discoverPageObjectPackages, readNamespaceConfig } from './page-object-packages.js';

/** Set once per test run (the scaffolded `onPrepare` hook does), so every worker writes to one folder. */
export const SNAPSHOT_RUN_ID_ENV = 'UTAM_SNAPSHOT_RUN_ID';
/** Where snapshots are written, relative to the project. */
export const SNAPSHOTS_DIR = '.utam/snapshots';
/** The run id for captures made outside a test run, such as from the console; pruning keeps its folder. */
export const MANUAL_RUN_ID = 'manual';
/** A copy of the most recent snapshot, relative to the project: the query commands' default. */
export const LATEST_SNAPSHOT = `${SNAPSHOTS_DIR}/latest.json`;

/** The file system calls `writeDomSnapshot` and `pruneDomSnapshots` make. */
export type SnapshotFileSystem = {
  mkdir(dir: string, options: { recursive: true }): Promise<unknown>;
  writeFile(file: string, data: string, options?: { flag?: string }): Promise<void>;
  readdir(dir: string, options: { withFileTypes: true }): Promise<Array<{ name: string; isDirectory(): boolean }>>;
  stat(target: string): Promise<{ mtimeMs: number }>;
  rm(target: string, options: { recursive: true; force: true }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
};

export type WriteDomSnapshotOptions = {
  /** The project folder. Defaults to the current directory. */
  projectDir?: string;
  /**
   * The run folder's id, such as `MANUAL_RUN_ID`. Defaults to `UTAM_SNAPSHOT_RUN_ID`, then the time this
   * process first wrote a snapshot.
   */
  runId?: string;
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
 * A run id for `UTAM_SNAPSHOT_RUN_ID`: the time as `20261016T120000`.
 *
 * @param date The time; now when omitted.
 */
export function snapshotRunId(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, '').slice(0, 15);
}

const MAX_NAME_TRIES = 1000;

/**
 * Replace `file` in one step, so a reader never sees it half-written while another worker writes it.
 * Where the rename can't replace it (on Windows, while another process has it open or renames onto
 * it too), the temporary file is removed and `file` is written in place instead, as
 * `ensureForceignore` does.
 */
async function replaceFile(fs: SnapshotFileSystem, file: string, data: string): Promise<void> {
  const temp = `${file}.${process.pid}-${Math.random().toString(36).slice(2, 10)}.tmp`;
  await fs.writeFile(temp, data);
  try {
    await fs.rename(temp, file);
  } catch {
    await fs.rm(temp, { recursive: true, force: true });
    await fs.writeFile(file, data);
  }
}

/**
 * `<scenario>--<step>` for a failure; `<scenario>--<label>`, or the scenario numbered, otherwise. A
 * capture with no scenario, such as one taken by hand, uses `manual` in its place.
 */
function baseName(snapshot: DomSnapshot): { name: string; numbered: boolean } {
  const { meta } = snapshot;
  if (meta.trigger === 'failure') {
    const scenario = cleanPart(meta.scenario ?? '') || 'scenario';
    return { name: `${scenario}--${cleanPart(meta.step ?? '') || 'step'}`, numbered: false };
  }
  const scenario = cleanPart(meta.scenario ?? '') || 'manual';
  const label = cleanPart(meta.label ?? '');
  return label ? { name: `${scenario}--${label}`, numbered: false } : { name: scenario, numbered: true };
}

/** The run id for captures made outside a run that set one: the time of this process's first capture. */
let processRunId: string | undefined;

/** Each project folder's page-object package versions, looked up once per process. */
const packageVersions = new Map<string, Record<string, string>>();

/**
 * The version of each page-object package the index reads for this project. Packages don't change
 * during a test run, so it's read once per project folder, not on every write.
 */
function installedPageObjectPackages(projectDir: string): Record<string, string> {
  const dir = path.resolve(projectDir);
  let versions = packageVersions.get(dir);
  if (!versions) {
    const { packages } = discoverPageObjectPackages(dir, readNamespaceConfig(dir));
    versions = Object.fromEntries(packages.flatMap((pkg) => (pkg.version ? [[pkg.name, pkg.version]] : [])));
    packageVersions.set(dir, versions);
  }
  return versions;
}

/**
 * Write a snapshot to `.utam/snapshots/<run id>/<name>.json`, and a copy as
 * `.utam/snapshots/latest.json`, replaced in one step through a temporary file and a rename. The run
 * id comes from `runId`, then `UTAM_SNAPSHOT_RUN_ID`, then the time this process first wrote a snapshot.
 * A name already taken gets a number; files are created exclusively, so two workers can't both take
 * one name. Records the version of each page-object package the project's namespaces map to in the
 * file's `meta.pageObjectPackages`, leaving `snapshot` unchanged; the versions are looked up once per
 * project folder in a process.
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

  // Without a run id, captures share one folder per process, so pruning counts them as one run.
  const dir = path.join(
    SNAPSHOTS_DIR,
    cleanPart(options.runId ?? env[SNAPSHOT_RUN_ID_ENV] ?? '') || (processRunId ??= snapshotRunId()),
  );
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
 * Delete all but the newest `keepRuns` run folders under `.utam/snapshots/`. A folder's age is when
 * it was last written to, so run ids of any form mix: a custom `build-42` and a timestamp compare by
 * when their snapshots were written. Folders written at the same moment compare by name, numbers in
 * it as numbers (`build-9` before `build-10`). `latest.json` is kept, and so is the `manual` folder
 * of captures made by hand, which isn't counted as a run.
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
  const named = entries
    .filter((entry) => entry.isDirectory() && entry.name !== MANUAL_RUN_ID)
    .map((entry) => entry.name);
  const dated = await Promise.all(
    named.map(async (name) => {
      try {
        return { name, mtimeMs: (await fs.stat(path.join(projectDir, SNAPSHOTS_DIR, name))).mtimeMs };
      } catch (error) {
        // Already gone, perhaps pruned by another run.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    }),
  );
  const runs = dated
    .filter((run) => run !== undefined)
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name, 'en', { numeric: true }))
    .map((run) => run.name);
  const removed = runs.slice(0, Math.max(0, runs.length - keepRuns)).map((run) => path.join(SNAPSHOTS_DIR, run));
  await Promise.all(removed.map((dir) => fs.rm(path.join(projectDir, dir), { recursive: true, force: true })));
  return removed;
}
