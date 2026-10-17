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

export {
  DOM_SNAPSHOT_FORMAT,
  DOM_SNAPSHOT_VERSION,
  DomSnapshotError,
  parseDomSnapshot,
  readDomSnapshot,
  serializeDomSnapshot,
  type DomNode,
  type DomSnapshot,
  type DomSnapshotMeta,
  type ShadowMode,
  type SnapshotMask,
  type SnapshotTrigger,
} from './format.js';
export {
  SNAPSHOT_MASK_ENV,
  captureDomSnapshot,
  type CaptureDomSnapshotOptions,
  type SnapshotBrowser,
  type SnapshotPage,
} from './capture.js';
export {
  LATEST_SNAPSHOT,
  SNAPSHOT_RUN_ID_ENV,
  pruneDomSnapshots,
  snapshotRunId,
  writeDomSnapshot,
  type PruneDomSnapshotsOptions,
  type SnapshotFileSystem,
  type WriteDomSnapshotOptions,
} from './files.js';
export { DEFAULT_OUTPUT_LIMIT, type QueryOutputOptions, type QueryResult } from './query-result.js';
export {
  buildPageObjectIndex,
  type BuildPageObjectIndexOptions,
  type PageObjectArg,
  type PageObjectElement,
  type PageObjectEntry,
  type PageObjectIndex,
  type PageObjectMatch,
  type PageObjectMethod,
} from './page-object-index.js';
export {
  lookupPageObject,
  searchPageObjects,
  type LookupResult,
  type SearchResult,
  type SearchResultLine,
} from './lookup.js';
export { findNodes, type FindOptions, type FindResult } from './find.js';
export type { FoundNode } from './locate.js';
export { querySnapshot, type SelectorMatches, type SelectorScope } from './selector.js';
export {
  componentPath,
  componentPathByText,
  type PathAnnotation,
  type PathByTextResult,
  type PathOptions,
  type PathResult,
  type PathStep,
  type ReachableThrough,
  type ScopeMismatch,
} from './path.js';
export {
  nodeAncestors,
  nodeDetails,
  subtree,
  type AncestorLine,
  type AncestorsResult,
  type NodeDetails,
  type SubtreeOptions,
} from './tree.js';
export { snapshotHeader, utamErrorHint, type SnapshotHeaderOptions, type UtamErrorHint } from './header.js';
