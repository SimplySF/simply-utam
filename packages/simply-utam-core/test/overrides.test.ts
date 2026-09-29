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
import { detectIndentation, walkElements, mergeElements, applyUtamOverrides } from '../src/overrides/index.js';

describe('Overrides Merger Service', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utam-overrides-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('detectIndentation', () => {
    it('detects 2-space indentation', () => {
      expect(detectIndentation('{\n  "name": "test"\n}')).toBe('  ');
    });

    it('detects 4-space indentation', () => {
      expect(detectIndentation('{\n    "name": "test"\n}')).toBe('    ');
    });

    it('detects tab indentation', () => {
      expect(detectIndentation('{\n\t"name": "test"\n}')).toBe('\t');
    });

    it('falls back to default 4 spaces when no indented key found', () => {
      expect(detectIndentation('{"name": "test"}')).toBe('    ');
    });
  });

  describe('mergeElements', () => {
    it('deep merges nested properties without destroying existing properties', () => {
      const target: Record<string, unknown> = {
        name: 'button',
        public: true,
        type: 'salesforce-pageobjects/lightning/pageObjects/button',
        selector: {
          css: 'lightning-button',
        },
      };

      const source: Record<string, unknown> = {
        load: true,
        wait: true,
        selector: {
          css: 'button.custom-override',
        },
      };

      mergeElements(target, source);

      expect(target).toEqual({
        name: 'button',
        public: true,
        type: 'salesforce-pageobjects/lightning/pageObjects/button',
        selector: {
          css: 'button.custom-override',
        },
        load: true,
        wait: true,
      });
    });
  });

  describe('walkElements', () => {
    it('traverses top-level, nested, and shadow DOM elements', () => {
      const ast = {
        shadow: {
          elements: [
            {
              name: 'element1',
              elements: [
                {
                  name: 'nestedElement',
                },
              ],
            },
            {
              name: 'element2',
              shadow: {
                elements: [
                  {
                    name: 'nestedShadowElement',
                  },
                ],
              },
            },
          ],
        },
      };

      const names: string[] = [];
      walkElements(ast, (el) => {
        names.push(el['name'] as string);
      });

      expect(names).toEqual(['element1', 'nestedElement', 'element2', 'nestedShadowElement']);
    });
  });

  describe('applyUtamOverrides', () => {
    it('applies overrides to target UTAM JSON files preserving indentation', () => {
      const compDir = path.join(tempDir, 'force-app', 'lwc', 'myComp');
      const utamDir = path.join(compDir, '__utam__');
      fs.mkdirSync(utamDir, { recursive: true });

      const overrides = [
        {
          name: 'headerBtn',
          element: {
            load: true,
            wait: true,
          },
        },
        {
          name: 'childText',
          element: {
            public: false,
          },
        },
      ];

      const initialUtam = {
        shadow: {
          elements: [
            {
              name: 'headerBtn',
              type: 'salesforce-pageobjects/lightning/pageObjects/button',
              elements: [
                {
                  name: 'childText',
                  public: true,
                },
              ],
            },
          ],
        },
      };

      const overrideFile = path.join(compDir, 'myComp.utam-overrides.json');
      const utamFile = path.join(utamDir, 'myComp.utam.json');

      fs.writeFileSync(overrideFile, JSON.stringify(overrides, null, 2), 'utf-8');
      // Write target with 2 spaces
      fs.writeFileSync(utamFile, JSON.stringify(initialUtam, null, 2) + '\n', 'utf-8');

      const result = applyUtamOverrides({
        rootDir: tempDir,
        sourceDirs: ['force-app'],
      });

      expect(result.scannedFilesCount).toBe(1);
      expect(result.modifiedFilesCount).toBe(1);
      expect(result.totalOverridesApplied).toBe(2);

      const updatedContent = fs.readFileSync(utamFile, 'utf-8');
      expect(detectIndentation(updatedContent)).toBe('  ');

      interface UtamStructure {
        shadow: {
          elements: Array<{
            load?: boolean;
            wait?: boolean;
            elements?: Array<{ public?: boolean }>;
          }>;
        };
      }

      const updated = JSON.parse(updatedContent) as UtamStructure;
      expect(updated.shadow.elements[0].load).toBe(true);
      expect(updated.shadow.elements[0].wait).toBe(true);
      expect(updated.shadow.elements[0].elements?.[0]?.public).toBe(false);
    });

    it('respects dryRun without altering files on disk', () => {
      const compDir = path.join(tempDir, 'force-app', 'lwc', 'dryComp');
      const utamDir = path.join(compDir, '__utam__');
      fs.mkdirSync(utamDir, { recursive: true });

      const overrides = [{ name: 'item', element: { wait: true } }];
      const initialUtam = { elements: [{ name: 'item', wait: false }] };

      const overrideFile = path.join(compDir, 'dryComp.utam-overrides.json');
      const utamFile = path.join(utamDir, 'dryComp.utam.json');

      fs.writeFileSync(overrideFile, JSON.stringify(overrides, null, 2), 'utf-8');
      fs.writeFileSync(utamFile, JSON.stringify(initialUtam, null, 2), 'utf-8');

      const result = applyUtamOverrides({
        rootDir: tempDir,
        sourceDirs: ['force-app'],
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(result.totalOverridesApplied).toBe(1);

      // Verify file unchanged on disk
      const diskContent = JSON.parse(fs.readFileSync(utamFile, 'utf-8')) as {
        elements: Array<{ wait: boolean }>;
      };
      expect(diskContent.elements[0].wait).toBe(false);
    });

    it('gracefully handles malformed overrides, non-array overrides, and missing UTAM files', () => {
      const comp1 = path.join(tempDir, 'force-app', 'lwc', 'malformedJsonComp');
      fs.mkdirSync(comp1, { recursive: true });
      fs.writeFileSync(path.join(comp1, 'malformedJsonComp.utam-overrides.json'), 'INVALID{', 'utf-8');

      const comp2 = path.join(tempDir, 'force-app', 'lwc', 'notArrayComp');
      fs.mkdirSync(comp2, { recursive: true });
      fs.writeFileSync(path.join(comp2, 'notArrayComp.utam-overrides.json'), '{"not": "array"}', 'utf-8');

      const comp3 = path.join(tempDir, 'force-app', 'lwc', 'missingUtamComp');
      fs.mkdirSync(comp3, { recursive: true });
      fs.writeFileSync(path.join(comp3, 'missingUtamComp.utam-overrides.json'), '[]', 'utf-8');

      const comp4 = path.join(tempDir, 'force-app', 'lwc', 'invalidUtamComp');
      const comp4Utam = path.join(comp4, '__utam__');
      fs.mkdirSync(comp4Utam, { recursive: true });
      fs.writeFileSync(
        path.join(comp4, 'invalidUtamComp.utam-overrides.json'),
        '[{"name":"x","element":{"a":1}}]',
        'utf-8',
      );
      fs.writeFileSync(path.join(comp4Utam, 'invalidUtamComp.utam.json'), 'BAD_JSON{', 'utf-8');

      const result = applyUtamOverrides({
        rootDir: tempDir,
        sourceDirs: ['force-app'],
      });

      expect(result.scannedFilesCount).toBe(4);
      expect(result.modifiedFilesCount).toBe(0);
      expect(result.results.some((r) => r.error?.includes('Failed to parse overrides file'))).toBe(true);
      expect(result.results.some((r) => r.error?.includes('not a JSON array'))).toBe(true);
      expect(result.results.some((r) => r.error?.includes('Target generated UTAM file does not exist'))).toBe(true);
      expect(result.results.some((r) => r.error?.includes('Failed to parse target UTAM JSON'))).toBe(true);
    });
  });
});
