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

import * as path from 'node:path';
import { Flags } from '@oclif/core';
import {
  DEFAULT_OUTPUT_LIMIT,
  LATEST_SNAPSHOT,
  buildPageObjectIndex,
  readDomSnapshot,
  snapshotHeader,
  type DomSnapshot,
  type PageObjectIndex,
} from '@simplysf/simply-utam-core';

/** Flags the `snapshot` commands share. */
export const fileFlag = {
  file: Flags.string({
    summary: `Snapshot file to read, relative to the current folder (not --project-dir). Defaults to ${LATEST_SNAPSHOT} in the project, the most recent snapshot.`,
  }),
};

export const projectDirFlag = {
  'project-dir': Flags.string({
    summary: 'Root directory of the test project.',
    default: '.',
  }),
};

export const limitFlag = {
  limit: Flags.integer({
    summary: `Maximum lines of text output (default ${DEFAULT_OUTPUT_LIMIT}).`,
    default: DEFAULT_OUTPUT_LIMIT,
    min: 1,
  }),
};

/** Exit code 2: bad input, such as a missing snapshot, an unknown handle, or conflicting arguments. */
export const BAD_INPUT = 2;

/** A snapshot a query command was pointed at, and its header. */
export type LoadedSnapshot = { snapshot: DomSnapshot; header: string[] };

/**
 * Read the snapshot a query command was pointed at, and the header that names it.
 *
 * @param projectDir The test project.
 * @param file The `--file` flag; the project's latest snapshot when omitted.
 * @param index The page-object index, when the command has built it; otherwise it's built only for
 * UTAM's not-found error.
 */
export async function loadSnapshot(
  projectDir: string,
  file?: string,
  index?: PageObjectIndex,
): Promise<LoadedSnapshot> {
  const resolved = file ? path.resolve(file) : path.resolve(projectDir, LATEST_SNAPSHOT);
  const snapshot = await readDomSnapshot(resolved);
  const header = snapshotHeader(snapshot, {
    file: path.relative(process.cwd(), resolved) || resolved,
    index: index ?? ((): PageObjectIndex => buildPageObjectIndex({ projectDir })),
  });
  return { snapshot, header };
}
