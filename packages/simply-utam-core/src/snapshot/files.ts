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

/** `20261016T120000`: sorts in time order, so run folders do too. */
function timestamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, '').slice(0, 15);
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
 * `.utam/snapshots/latest.json`. The run id comes from `UTAM_SNAPSHOT_RUN_ID`, or the current time.
 * A name already taken gets a number; files are created exclusively, so two workers can't both take
 * one name. Records the installed `salesforce-pageobjects` version in `meta.pageObjectPackages`.
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
  if (Object.keys(packages).length > 0) snapshot.meta.pageObjectPackages = packages;

  const dir = path.join(SNAPSHOTS_DIR, cleanPart(env[SNAPSHOT_RUN_ID_ENV] ?? '') || timestamp());
  await fs.mkdir(path.join(projectDir, dir), { recursive: true });

  const json = serializeDomSnapshot(snapshot);
  const { name, numbered } = baseName(snapshot);
  for (let n = 1; ; n++) {
    const file = path.join(dir, numbered ? `${name}--${n}.json` : n === 1 ? `${name}.json` : `${name}-${n}.json`);
    try {
      // Names are tried one at a time: `wx` fails on a name another writer already took.
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(path.join(projectDir, file), json, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST' && n < 1000) continue;
      throw error;
    }
    // eslint-disable-next-line no-await-in-loop -- runs once, after the loop's last attempt
    await fs.writeFile(path.join(projectDir, LATEST_SNAPSHOT), json);
    return file;
  }
}

/**
 * Delete all but the newest `keepRuns` run folders under `.utam/snapshots/`. Run folders are
 * named by run id, a timestamp, so the newest sort last. `latest.json` is kept.
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
    .sort();
  const removed = runs.slice(0, Math.max(0, runs.length - keepRuns)).map((run) => path.join(SNAPSHOTS_DIR, run));
  await Promise.all(removed.map((dir) => fs.rm(path.join(projectDir, dir), { recursive: true, force: true })));
  return removed;
}
