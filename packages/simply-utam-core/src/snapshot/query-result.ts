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

/** The default cap on a query's text output, in lines. */
export const DEFAULT_OUTPUT_LIMIT = 200;

/** A query's result: lines to print, and the same answer as data. */
export type QueryResult<T> = { lines: string[]; json: T };

/** Options every query with text output takes. */
export type QueryOutputOptions = {
  /** The text output limit in lines. Defaults to `DEFAULT_OUTPUT_LIMIT`. */
  limit?: number;
};

/**
 * Cut text output at `limit` lines, with a last line saying how much was left out and what to do.
 *
 * @param lines The full output.
 * @param limit The output limit in lines.
 * @param hint What to do to see the rest.
 */
export function limitLines(lines: string[], limit: number, hint: string): string[] {
  if (lines.length <= limit) return lines;
  return [...lines.slice(0, limit), `… ${lines.length - limit} more lines not shown (output limit ${limit}). ${hint}`];
}
