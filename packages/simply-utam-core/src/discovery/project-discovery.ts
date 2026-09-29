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

export interface SfdxPackageDirectory {
  [key: string]: unknown;
  default?: boolean;
  package?: string;
  path: string;
  versionName?: string;
  versionNumber?: string;
}

export interface SfdxProjectConfig {
  [key: string]: unknown;
  namespace?: string;
  packageDirectories: SfdxPackageDirectory[];
  sfdcLoginUrl?: string;
  sourceApiVersion?: string;
}

export interface DiscoveredLwcComponent {
  name: string;
  directory: string;
  packageDirectory: string;
  metaFile: string | null;
  hasMetaFile: boolean;
}

export interface DiscoveredProject {
  rootDir: string;
  sfdxProjectFile: string | null;
  packageJsonFile: string | null;
  packageName: string | null;
  namespace: string | null;
  packageDirectories: string[];
  defaultPackageDirectory: string | null;
  lwcComponents: DiscoveredLwcComponent[];
}

/**
 * Recursively locates all folders named 'lwc' inside the specified directory.
 *
 * @param dirPath - Directory path to search within.
 * @returns Array of absolute paths to discovered 'lwc' directories.
 */
export function findLwcDirectories(dirPath: string): string[] {
  let lwcDirs: string[] = [];
  try {
    if (!fs.existsSync(dirPath)) {
      return [];
    }
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'lwc') {
          lwcDirs.push(fullPath);
        } else if (
          entry.name !== 'node_modules' &&
          entry.name !== '.git' &&
          entry.name !== 'dist' &&
          entry.name !== 'lib' &&
          entry.name !== '.wireit' &&
          entry.name !== '.sfdx' &&
          entry.name !== '.sf'
        ) {
          lwcDirs = lwcDirs.concat(findLwcDirectories(fullPath));
        }
      }
    }
  } catch {
    // Gracefully handle permission or read errors
  }
  return lwcDirs;
}

/**
 * Discovers LWC components within the given package directory.
 *
 * @param packageDirPath - Path of the package directory.
 * @param rootDir - Root directory of the project.
 * @returns Array of discovered LWC components with metadata.
 */
export function discoverComponentsInPackageDir(
  packageDirPath: string,
  rootDir: string,
): DiscoveredLwcComponent[] {
  const components: DiscoveredLwcComponent[] = [];
  const absolutePkgDir = path.isAbsolute(packageDirPath)
    ? packageDirPath
    : path.resolve(rootDir, packageDirPath);

  if (!fs.existsSync(absolutePkgDir)) {
    return components;
  }

  const lwcDirs = findLwcDirectories(absolutePkgDir);

  for (const lwcDir of lwcDirs) {
    try {
      const entries = fs.readdirSync(lwcDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const componentName = entry.name;
          if (componentName.startsWith('.') || componentName === '__tests__') {
            continue;
          }
          const componentDir = path.join(lwcDir, componentName);
          const metaFilePath = path.join(componentDir, `${componentName}.js-meta.xml`);
          const hasMetaFile = fs.existsSync(metaFilePath);

          components.push({
            name: componentName,
            directory: componentDir,
            packageDirectory: packageDirPath,
            metaFile: hasMetaFile ? metaFilePath : null,
            hasMetaFile,
          });
        }
      }
    } catch {
      // Gracefully handle directory read errors
    }
  }

  return components;
}

interface SfdxProjectDetails {
  sfdxProjectFile: string | null;
  namespace: string | null;
  packageDirectories: string[];
  defaultPackageDirectory: string | null;
}

function parseSfdxProject(resolvedRoot: string): SfdxProjectDetails {
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

interface PackageJsonDetails {
  packageJsonFile: string | null;
  packageName: string | null;
}

function parsePackageJson(resolvedRoot: string): PackageJsonDetails {
  let packageJsonFile: string | null = null;
  let packageName: string | null = null;

  const candidate = path.join(resolvedRoot, 'package.json');
  if (fs.existsSync(candidate)) {
    packageJsonFile = candidate;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as Record<string, unknown>;
      if (typeof parsed['name'] === 'string') {
        packageName = parsed['name'];
      }
    } catch {
      // Continue with null on parse error
    }
  }

  return { packageJsonFile, packageName };
}

/**
 * Inspects a Salesforce project workspace and extracts configuration, package directories,
 * packaging namespace, and discovered LWC components.
 *
 * @param rootDir - Root workspace directory to discover.
 * @returns Discovered project configuration and LWC components.
 */
export function discoverProject(rootDir: string = process.cwd()): DiscoveredProject {
  const resolvedRoot = path.resolve(rootDir);
  const sfdx = parseSfdxProject(resolvedRoot);
  const pkg = parsePackageJson(resolvedRoot);

  const lwcComponents: DiscoveredLwcComponent[] = [];
  for (const pkgDir of sfdx.packageDirectories) {
    lwcComponents.push(...discoverComponentsInPackageDir(pkgDir, resolvedRoot));
  }

  return {
    rootDir: resolvedRoot,
    sfdxProjectFile: sfdx.sfdxProjectFile,
    packageJsonFile: pkg.packageJsonFile,
    packageName: pkg.packageName,
    namespace: sfdx.namespace,
    packageDirectories: sfdx.packageDirectories,
    defaultPackageDirectory: sfdx.defaultPackageDirectory,
    lwcComponents,
  };
}
