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

import fs from 'node:fs';
import path from 'node:path';
import type { SfdxProjectConfig } from './project-discovery.js';

export interface SfdxProjectDetails {
  sfdxProjectFile: string | null;
  namespace: string | null;
  packageDirectories: string[];
  defaultPackageDirectory: string | null;
}

/**
 * Reads sfdx-project.json without scanning any source folders. Internal: not re-exported from the
 * discovery barrel, so it isn't part of the public API.
 *
 * @param resolvedRoot - Absolute project root.
 * @returns The sfdx-project.json path, namespace, and package directories.
 */
export function parseSfdxProject(resolvedRoot: string): SfdxProjectDetails {
  let sfdxProjectFile: string | null = null;
  let namespace: string | null = null;
  const packageDirectories: string[] = [];
  let defaultPackageDirectory: string | null = null;

  const candidate = path.join(resolvedRoot, 'sfdx-project.json');
  if (fs.existsSync(candidate)) {
    sfdxProjectFile = candidate;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as SfdxProjectConfig;
      if (typeof parsed.namespace === 'string' && parsed.namespace.trim()) {
        namespace = parsed.namespace.trim();
      }
      if (Array.isArray(parsed.packageDirectories)) {
        for (const pkgDir of parsed.packageDirectories) {
          if (typeof pkgDir?.path === 'string') {
            packageDirectories.push(pkgDir.path);
            if (pkgDir.default === true && !defaultPackageDirectory) {
              defaultPackageDirectory = pkgDir.path;
            }
          }
        }
      }
    } catch {
      // Continue with empty defaults on JSON read error
    }
  }

  if (packageDirectories.length === 0) {
    for (const fallback of ['force-app', 'sfdx-source', 'src']) {
      if (fs.existsSync(path.join(resolvedRoot, fallback))) {
        packageDirectories.push(fallback);
      }
    }
  }

  if (!defaultPackageDirectory && packageDirectories.length > 0) {
    defaultPackageDirectory = packageDirectories[0];
  }

  return { sfdxProjectFile, namespace, packageDirectories, defaultPackageDirectory };
}
