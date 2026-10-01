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
import { findUtamJsonFiles, updateValueWithMappings, rewriteUtamNamespaces } from '../src/namespaces/index.js';

describe('Namespace Rewriter Service', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utam-namespaces-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('findUtamJsonFiles', () => {
    it('locates *.utam.json files and ignores pageObjects or .git', () => {
      const validDir = path.join(tempDir, 'force-app', 'lwc', 'myComp', '__utam__');
      const ignoredDir = path.join(tempDir, 'pageObjects', '__utam__');
      fs.mkdirSync(validDir, { recursive: true });
      fs.mkdirSync(ignoredDir, { recursive: true });

      fs.writeFileSync(path.join(validDir, 'myComp.utam.json'), '{}', 'utf-8');
      fs.writeFileSync(path.join(ignoredDir, 'ignored.utam.json'), '{}', 'utf-8');

      const found = findUtamJsonFiles(tempDir);
      expect(found).toHaveLength(1);
      expect(found[0]).toBe(path.join(validDir, 'myComp.utam.json'));
    });
  });

  describe('updateValueWithMappings', () => {
    it('sorts mappings in descending order of prefix length so specific prefixes match first', () => {
      const rawEntries: Array<[string, string]> = [
        ['my-app/pageObjects', 'base-pkg/pageObjects'],
        ['my-app/pageObjects/shared', 'shared-pkg/pageObjects/shared'],
      ];
      const mappings: Array<[string, string]> = rawEntries.sort((a, b) => b[0].length - a[0].length);

      const changes: Array<{ original: string; updated: string }> = [];

      const input = {
        elementSpecific: {
          type: 'my-app/pageObjects/shared/customModal',
        },
        elementGeneral: {
          type: 'my-app/pageObjects/genericButton',
        },
      };

      const result = updateValueWithMappings(input, mappings, changes) as typeof input;

      expect(result.elementSpecific.type).toBe('shared-pkg/pageObjects/shared/customModal');
      expect(result.elementGeneral.type).toBe('base-pkg/pageObjects/genericButton');
      expect(changes).toHaveLength(2);
    });

    it('performs exact index-0 prefix replacement without regex substitution side-effects', () => {
      const mappings: Array<[string, string]> = [['my-app/prefix', 'target-$1/new']];
      const changes: Array<{ original: string; updated: string }> = [];
      const input = 'my-app/prefix/subpath';
      const output = updateValueWithMappings(input, mappings, changes);
      expect(output).toBe('target-$1/new/subpath');
    });
  });

  describe('rewriteUtamNamespaces', () => {
    it('gracefully exits with code/notice when config file is missing', () => {
      const result = rewriteUtamNamespaces({
        rootDir: tempDir,
        configFile: 'nonexistent-config.json',
      });

      expect(result.configMissingOrEmpty).toBe(true);
      expect(result.filesModified).toBe(0);
      expect(result.notice).toContain('Namespace configuration file not found');
    });

    it('gracefully exits when config file contains empty mapping object', () => {
      const emptyConfigPath = path.join(tempDir, 'empty-config.json');
      fs.writeFileSync(emptyConfigPath, JSON.stringify({}), 'utf-8');

      const result = rewriteUtamNamespaces({
        rootDir: tempDir,
        configFile: emptyConfigPath,
      });

      expect(result.configMissingOrEmpty).toBe(true);
      expect(result.filesModified).toBe(0);
      expect(result.notice).toContain('Namespace mapping object is empty');
    });

    it('gracefully handles malformed namespace config and malformed target UTAM JSON', () => {
      const badConfig = path.join(tempDir, 'bad-config.json');
      fs.writeFileSync(badConfig, 'INVALID_JSON{', 'utf-8');

      const configResult = rewriteUtamNamespaces({
        rootDir: tempDir,
        configFile: badConfig,
      });

      expect(configResult.configMissingOrEmpty).toBe(true);
      expect(configResult.notice).toContain('Failed to parse namespace config file');

      // Now test bad UTAM json with valid config
      const utamDir = path.join(tempDir, 'force-app', 'lwc', 'badUtam', '__utam__');
      fs.mkdirSync(utamDir, { recursive: true });
      fs.writeFileSync(path.join(utamDir, 'badUtam.utam.json'), 'BAD_JSON{', 'utf-8');

      const utamResult = rewriteUtamNamespaces({
        rootDir: tempDir,
        sourceDirs: ['force-app'],
        mappings: { 'prefix/': 'newPrefix/' },
      });

      expect(utamResult.filesScanned).toBe(1);
      expect(utamResult.filesModified).toBe(0);
      expect(utamResult.results[0].error).toContain('Failed to parse UTAM JSON');
    });

    it('rewrites namespaces in UTAM files preserving indentation and trailing newline', () => {
      const utamDir = path.join(tempDir, 'force-app', 'lwc', 'myComp', '__utam__');
      fs.mkdirSync(utamDir, { recursive: true });

      const utamFile = path.join(utamDir, 'myComp.utam.json');
      const initialJson = {
        elements: [
          {
            name: 'sharedWidget',
            type: 'my-sfdx-app/pageObjects/shared/modal',
          },
        ],
        methods: [
          {
            name: 'getModal',
            compose: [
              {
                apply: 'my-sfdx-app/pageObjects/shared/modal',
              },
            ],
          },
        ],
      };

      // 2-space indented
      fs.writeFileSync(utamFile, JSON.stringify(initialJson, null, 2) + '\n', 'utf-8');

      const result = rewriteUtamNamespaces({
        rootDir: tempDir,
        sourceDirs: ['force-app'],
        mappings: {
          'my-sfdx-app/pageObjects/shared': 'shared-components-pageobjects/pageObjects/shared',
        },
      });

      expect(result.filesScanned).toBe(1);
      expect(result.filesModified).toBe(1);
      expect(result.totalReplacements).toBe(2);

      const content = fs.readFileSync(utamFile, 'utf-8');
      expect(content.endsWith('\n')).toBe(true);

      interface RewrittenUtam {
        elements: Array<{ type: string }>;
        methods: Array<{ compose: Array<{ apply: string }> }>;
      }

      const updated = JSON.parse(content) as RewrittenUtam;
      expect(updated.elements[0].type).toBe('shared-components-pageobjects/pageObjects/shared/modal');
      expect(updated.methods[0].compose[0].apply).toBe('shared-components-pageobjects/pageObjects/shared/modal');
    });

    it('respects dryRun without altering files on disk', () => {
      const utamDir = path.join(tempDir, 'force-app', 'lwc', 'dryComp', '__utam__');
      fs.mkdirSync(utamDir, { recursive: true });

      const utamFile = path.join(utamDir, 'dryComp.utam.json');
      const initialJson = {
        elements: [{ type: 'my-sfdx-app/pageObjects/test' }],
      };
      fs.writeFileSync(utamFile, JSON.stringify(initialJson, null, 2), 'utf-8');

      const result = rewriteUtamNamespaces({
        rootDir: tempDir,
        sourceDirs: ['force-app'],
        mappings: {
          'my-sfdx-app/pageObjects': 'new-pkg/pageObjects',
        },
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(result.totalReplacements).toBe(1);

      // Verify file unchanged on disk
      const diskJson = JSON.parse(fs.readFileSync(utamFile, 'utf-8')) as {
        elements: Array<{ type: string }>;
      };
      expect(diskJson.elements[0].type).toBe('my-sfdx-app/pageObjects/test');
    });
  });
});
