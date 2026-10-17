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

import { readFile } from 'node:fs/promises';

export const DOM_SNAPSHOT_FORMAT = 'simply-utam-dom-snapshot';
export const DOM_SNAPSHOT_VERSION = 1;

/** What took a snapshot: a failed step, a capture step, or the `browser.domSnapshot` command. */
export type SnapshotTrigger = 'failure' | 'step' | 'manual';
export type SnapshotMask = 'labels' | 'structure' | 'full';
/**
 * How a shadow root was recorded. `unreadable` marks a custom element that most likely renders into
 * a closed shadow root, which neither the walker nor UTAM can see into.
 */
export type ShadowMode = 'native' | 'synthetic' | 'unknown' | 'unreadable';

/** One element in a snapshot. */
export type DomNode = {
  /**
   * The node's handle, `n1`, `n2`, …: what commands take. Not stored in the file; added when a
   * snapshot is read, numbered in the order `tree` prints nodes.
   */
  id: string;
  /** Child positions from the page root, with `s` for a step into a shadow root, such as `0.1.4.s.2`. */
  address: string;
  tag: string;
  attrs?: Record<string, string>;
  text?: string;
  children?: DomNode[];
  shadow?: { mode: ShadowMode; children: DomNode[]; text?: string };
  /** The top node of a hidden subtree. */
  hidden?: true;
  /** `[x, y, width, height]`, for visible elements. */
  rect?: [number, number, number, number];
  /** An `iframe`'s source, query string removed. */
  src?: string;
  /** An `iframe` whose content isn't in the snapshot. */
  notCaptured?: true;
};

export type DomSnapshotMeta = {
  capturedAt: string;
  trigger: SnapshotTrigger;
  url: string;
  title: string;
  viewport: [number, number];
  label?: string;
  scenario?: string;
  step?: string;
  error?: string;
  mask: SnapshotMask;
  truncated: { reasons: Array<'nodes' | 'hiddenNodes' | 'time'> } | null;
  /** The focus element's address, when a focus was found. */
  focus?: string;
  /** The installed version of each page-object package, when written inside a project. */
  pageObjectPackages?: Record<string, string>;
};

export type DomSnapshot = {
  format: typeof DOM_SNAPSHOT_FORMAT;
  version: number;
  meta: DomSnapshotMeta;
  root: DomNode;
};

/** Thrown for input that isn't a snapshot this version can read. The CLI exits with code 2 on it. */
export class DomSnapshotError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'DomSnapshotError';
  }
}

/**
 * Give every node a short handle (`n1`, `n2`, …) as its `id`, numbered in the order `tree` prints
 * them: a node's shadow root children first, then its light children. Within one tree scope, a
 * smaller handle comes earlier in document order.
 *
 * @param snapshot The snapshot; changed in place.
 */
export function numberNodes(snapshot: DomSnapshot): DomSnapshot {
  let next = 1;
  const visit = (node: DomNode): void => {
    node.id = `n${next++}`;
    for (const child of node.shadow?.children ?? []) visit(child);
    for (const child of node.children ?? []) visit(child);
  };
  visit(snapshot.root);
  return snapshot;
}

/**
 * Parse snapshot JSON, check its `format` and `version`, and number its handles.
 *
 * @param json The snapshot's JSON text.
 */
export function parseDomSnapshot(json: string): DomSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new DomSnapshotError(`Not JSON: ${(error as Error).message}`);
  }
  const candidate = value as Partial<DomSnapshot> | null;
  if (!candidate || typeof candidate !== 'object' || candidate.format !== DOM_SNAPSHOT_FORMAT) {
    throw new DomSnapshotError(
      `Not a DOM snapshot: format is ${JSON.stringify(candidate?.format)}, expected "${DOM_SNAPSHOT_FORMAT}"`,
    );
  }
  if (typeof candidate.version !== 'number' || candidate.version > DOM_SNAPSHOT_VERSION) {
    throw new DomSnapshotError(
      `${DOM_SNAPSHOT_FORMAT} version ${String(candidate.version)} is newer than this reader understands (${DOM_SNAPSHOT_VERSION})`,
    );
  }
  if (!candidate.meta || typeof candidate.root?.address !== 'string') {
    throw new DomSnapshotError('Not a DOM snapshot: no meta, or no root node with an address');
  }
  return numberNodes(candidate as DomSnapshot);
}

/**
 * A snapshot as JSON text for a file: everything but the handles, which are added on read.
 *
 * @param snapshot The snapshot.
 */
export function serializeDomSnapshot(snapshot: DomSnapshot): string {
  return JSON.stringify(snapshot, function (this: unknown, key: string, value: unknown) {
    // A node's handle; `attrs.id` sits under `attrs`, which has no `address`.
    const isHandle = key === 'id' && typeof this === 'object' && this !== null && 'address' in this;
    return isHandle ? undefined : value;
  });
}

/**
 * Read a snapshot file, check it, and number its handles.
 *
 * @param file The snapshot file.
 */
export async function readDomSnapshot(file: string): Promise<DomSnapshot> {
  let json: string;
  try {
    json = await readFile(file, 'utf8');
  } catch (error) {
    throw new DomSnapshotError(`Cannot read ${file}: ${(error as Error).message}`);
  }
  return parseDomSnapshot(json);
}
