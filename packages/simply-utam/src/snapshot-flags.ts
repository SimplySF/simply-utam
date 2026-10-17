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

import { Flags } from '@oclif/core';
import { DEFAULT_OUTPUT_LIMIT } from '@simplysf/simply-utam-core';

/** Flags the `snapshot` commands share. */
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
  }),
};

/** Exit code 2: bad input, such as a missing snapshot, an unknown handle, or conflicting arguments. */
export const BAD_INPUT = 2;
