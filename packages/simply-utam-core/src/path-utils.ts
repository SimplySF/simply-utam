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

// Internal helpers. Not exported from src/index.ts, so they aren't part of the public API.

/**
 * Normalizes a project-relative path for use in .forceignore rules and config templates: forward
 * slashes, no leading './', no trailing slash, and '' for the project root. A leading '../' is kept.
 *
 * @param dir - A path relative to the project root, with either separator.
 * @returns The normalized path.
 */
export function toPosixRelative(dir: string): string {
  return dir
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '')
    .replace(/^\.$/, '');
}

/**
 * Whether a path is absolute on either platform, e.g. '/abs', 'D:\\src' or 'D:/src'. On Windows,
 * path.relative returns an absolute path when the two paths are on different drives.
 *
 * @param dir - Any path, with either separator.
 * @returns True if the path is absolute on POSIX or Windows.
 */
export function isAbsoluteOnAnyPlatform(dir: string): boolean {
  return path.posix.isAbsolute(dir) || path.win32.isAbsolute(dir);
}

/**
 * Whether a path normalized by toPosixRelative points outside the project root: absolute, or starting
 * with '..'.
 *
 * @param dir - A path normalized by toPosixRelative.
 * @returns True if the path is outside the project root.
 */
export function isOutsideProject(dir: string): boolean {
  return isAbsoluteOnAnyPlatform(dir) || dir === '..' || dir.startsWith('../');
}
