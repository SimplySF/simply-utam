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
