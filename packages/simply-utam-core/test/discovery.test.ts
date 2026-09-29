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
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  discoverProject,
  findLwcDirectories,
  discoverComponentsInPackageDir,
} from '../src/discovery/index.js';

describe('Project Discovery Service', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utam-discovery-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should discover sfdx-project.json with package directories and namespace', () => {
    const sfdxConfig = {
      packageDirectories: [
        { path: 'force-app', default: true },
        { path: 'modules/shared', default: false },
      ],
      namespace: 'custom_ns',
      sfdcLoginUrl: 'https://login.salesforce.com',
      sourceApiVersion: '62.0',
    };
    fs.writeFileSync(
      path.join(tempDir, 'sfdx-project.json'),
      JSON.stringify(sfdxConfig, null, 2),
      'utf-8',
    );

    const pkgJson = {
      name: 'test-consumer-app',
      version: '1.0.0',
    };
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf-8');

    // Create LWC component directories
    const lwcDir1 = path.join(tempDir, 'force-app', 'main', 'default', 'lwc', 'myComponent');
    fs.mkdirSync(lwcDir1, { recursive: true });
    fs.writeFileSync(
      path.join(lwcDir1, 'myComponent.js-meta.xml'),
      '<LightningComponentBundle></LightningComponentBundle>',
      'utf-8',
    );

    const lwcDir2 = path.join(tempDir, 'modules', 'shared', 'lwc', 'sharedWidget');
    fs.mkdirSync(lwcDir2, { recursive: true });

    const discovered = discoverProject(tempDir);

    expect(discovered.rootDir).toBe(path.resolve(tempDir));
    expect(discovered.sfdxProjectFile).toBe(path.join(path.resolve(tempDir), 'sfdx-project.json'));
    expect(discovered.packageName).toBe('test-consumer-app');
    expect(discovered.namespace).toBe('custom_ns');
    expect(discovered.packageDirectories).toEqual(['force-app', 'modules/shared']);
    expect(discovered.defaultPackageDirectory).toBe('force-app');
    expect(discovered.lwcComponents.length).toBe(2);

    const myComp = discovered.lwcComponents.find((c) => c.name === 'myComponent');
    expect(myComp).toBeDefined();
    expect(myComp?.hasMetaFile).toBe(true);

    const sharedComp = discovered.lwcComponents.find((c) => c.name === 'sharedWidget');
    expect(sharedComp).toBeDefined();
    expect(sharedComp?.hasMetaFile).toBe(false);
  });

  it('should fallback to common directories when sfdx-project.json is missing', () => {
    const sfdxSourceLwc = path.join(tempDir, 'sfdx-source', 'lwc', 'fallbackComp');
    fs.mkdirSync(sfdxSourceLwc, { recursive: true });
    fs.writeFileSync(path.join(sfdxSourceLwc, 'fallbackComp.js-meta.xml'), '<xml></xml>', 'utf-8');

    const discovered = discoverProject(tempDir);

    expect(discovered.sfdxProjectFile).toBeNull();
    expect(discovered.namespace).toBeNull();
    expect(discovered.packageDirectories).toContain('sfdx-source');
    expect(discovered.defaultPackageDirectory).toBe('sfdx-source');
    expect(discovered.lwcComponents.length).toBe(1);
    expect(discovered.lwcComponents[0].name).toBe('fallbackComp');
  });

  it('should ignore node_modules, .git, dist, lib, .wireit, .sfdx, and .sf in findLwcDirectories', () => {
    const ignoredDirs = [
      path.join(tempDir, 'node_modules', 'lwc'),
      path.join(tempDir, '.git', 'lwc'),
      path.join(tempDir, 'dist', 'lwc'),
      path.join(tempDir, 'lib', 'lwc'),
      path.join(tempDir, '.wireit', 'lwc'),
      path.join(tempDir, '.sfdx', 'lwc'),
      path.join(tempDir, '.sf', 'lwc'),
    ];
    for (const d of ignoredDirs) {
      fs.mkdirSync(d, { recursive: true });
    }

    const validLwc = path.join(tempDir, 'src', 'lwc');
    fs.mkdirSync(validLwc, { recursive: true });

    const found = findLwcDirectories(tempDir);
    expect(found).toHaveLength(1);
    expect(found[0]).toBe(validLwc);
  });

  it('should ignore __tests__ and dot folders under lwc', () => {
    const lwcDir = path.join(tempDir, 'force-app', 'lwc');
    const testsDir = path.join(lwcDir, '__tests__');
    const dotDir = path.join(lwcDir, '.vscode');
    const realComp = path.join(lwcDir, 'realComponent');

    fs.mkdirSync(testsDir, { recursive: true });
    fs.mkdirSync(dotDir, { recursive: true });
    fs.mkdirSync(realComp, { recursive: true });

    const components = discoverComponentsInPackageDir('force-app', tempDir);
    expect(components).toHaveLength(1);
    expect(components[0].name).toBe('realComponent');
  });
});
