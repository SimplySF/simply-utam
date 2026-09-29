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
import { convertLwcNameToHtml, getTargetsFromMeta, generateLwcRules } from '../src/rules/index.js';

describe('Rules Generator Service', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utam-rules-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('convertLwcNameToHtml', () => {
    it('converts camelCase and PascalCase to kebab-case with default c- prefix', () => {
      expect(convertLwcNameToHtml('sampleHome')).toBe('c-sample-home');
      expect(convertLwcNameToHtml('SampleHome')).toBe('c-sample-home');
      expect(convertLwcNameToHtml('mySuperComponent')).toBe('c-my-super-component');
    });

    it('handles acronyms with consecutive uppercase letters (FOOBarBaz, myFOOComponent)', () => {
      expect(convertLwcNameToHtml('FOOBarBaz')).toBe('c-f-o-o-bar-baz');
      expect(convertLwcNameToHtml('FOOComponent')).toBe('c-f-o-o-component');
      expect(convertLwcNameToHtml('myFOOComponent')).toBe('c-my-f-o-o-component');
      expect(convertLwcNameToHtml('fOOBarBaz')).toBe('c-f-o-o-bar-baz');
    });

    it('handles all-lowercase, empty, and whitespace strings safely', () => {
      expect(convertLwcNameToHtml('simple')).toBe('c-simple');
      expect(convertLwcNameToHtml('')).toBe('');
      expect(convertLwcNameToHtml('   ')).toBe('');
    });

    it('uses custom namespace prefix when provided', () => {
      expect(convertLwcNameToHtml('sampleHome', 'custom_ns')).toBe('custom_ns-sample-home');
      expect(convertLwcNameToHtml('SampleHome', 'ns')).toBe('ns-sample-home');
      expect(convertLwcNameToHtml('FOOBarBaz', 'my_ns')).toBe('my_ns-f-o-o-bar-baz');
      expect(convertLwcNameToHtml('sampleHome', '  trimmed_ns  ')).toBe('trimmed_ns-sample-home');
    });
  });

  describe('getTargetsFromMeta', () => {
    it('extracts targets from <targets> block with attributes and whitespace', () => {
      const xml = `
        <?xml version="1.0" encoding="UTF-8"?>
        <LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
          <isExposed>true</isExposed>
          <targets apiVersion="62.0">
            <target>lightning__RecordPage</target>
            <target>lightning__AppPage</target>
          </targets>
        </LightningComponentBundle>
      `;
      const targets = getTargetsFromMeta(xml);
      expect(targets).toEqual(['lightning__RecordPage', 'lightning__AppPage']);
    });

    it('ignores targets within XML comments', () => {
      const xml = `
        <LightningComponentBundle>
          <!-- <targets><target>lightningCommunity__Page</target></targets> -->
          <targets>
            <target>lightning__HomePage</target>
            <!-- <target>lightning__RecordPage</target> -->
          </targets>
        </LightningComponentBundle>
      `;
      const targets = getTargetsFromMeta(xml);
      expect(targets).toEqual(['lightning__HomePage']);
    });

    it('returns empty array when no targets tag exists', () => {
      const xml = `<LightningComponentBundle><isExposed>false</isExposed></LightningComponentBundle>`;
      expect(getTargetsFromMeta(xml)).toEqual([]);
    });
  });

  describe('generateLwcRules', () => {
    it('creates .rules.json for root components and preserves existing fields', () => {
      const lwcDir = path.join(tempDir, 'force-app', 'main', 'default', 'lwc');
      const rootCompDir = path.join(lwcDir, 'rootWidget');
      const childCompDir = path.join(lwcDir, 'childWidget');

      fs.mkdirSync(rootCompDir, { recursive: true });
      fs.mkdirSync(childCompDir, { recursive: true });

      // Root component with existing custom rule file
      fs.writeFileSync(
        path.join(rootCompDir, 'rootWidget.js-meta.xml'),
        `<LightningComponentBundle><targets><target>lightningCommunity__Page</target></targets></LightningComponentBundle>`,
        'utf-8',
      );
      fs.writeFileSync(
        path.join(rootCompDir, 'rootWidget.rules.json'),
        JSON.stringify({ customField: 'keepMe', selector: { custom: true } }, null, 2),
        'utf-8',
      );

      // Child component (not root)
      fs.writeFileSync(
        path.join(childCompDir, 'childWidget.js-meta.xml'),
        `<LightningComponentBundle><isExposed>false</isExposed></LightningComponentBundle>`,
        'utf-8',
      );

      const result = generateLwcRules({
        rootDir: tempDir,
        sourceDirs: ['force-app'],
        namespace: 'app',
      });

      expect(result.totalComponentsScanned).toBe(2);
      expect(result.rootComponentsIdentified).toBe(1);
      expect(result.filesUpdated.length).toBe(1);
      expect(result.filesCreated.length).toBe(0);

      // Read updated rules file
      const updatedRules = JSON.parse(
        fs.readFileSync(path.join(rootCompDir, 'rootWidget.rules.json'), 'utf-8'),
      ) as { root: boolean; selector: { css: string }; customField: string };
      expect(updatedRules.root).toBe(true);
      expect(updatedRules.selector.css).toBe('app-root-widget');
      expect(updatedRules.customField).toBe('keepMe');

      // Verify child component did not get a rules file
      expect(fs.existsSync(path.join(childCompDir, 'childWidget.rules.json'))).toBe(false);
    });

    it('handles component directory missing js-meta.xml and invalid rules.json', () => {
      const compDir = path.join(tempDir, 'force-app', 'lwc', 'missingMetaComp');
      fs.mkdirSync(compDir, { recursive: true });

      const invalidRulesComp = path.join(tempDir, 'force-app', 'lwc', 'invalidRulesComp');
      fs.mkdirSync(invalidRulesComp, { recursive: true });
      fs.writeFileSync(
        path.join(invalidRulesComp, 'invalidRulesComp.js-meta.xml'),
        `<LightningComponentBundle><targets><target>lightning__RecordPage</target></targets></LightningComponentBundle>`,
        'utf-8',
      );
      fs.writeFileSync(
        path.join(invalidRulesComp, 'invalidRulesComp.rules.json'),
        'INVALID_JSON{',
        'utf-8',
      );

      const result = generateLwcRules({
        rootDir: tempDir,
        sourceDirs: ['force-app'],
      });

      const skipped = result.actions.find((a) => a.componentName === 'missingMetaComp');
      expect(skipped).toBeDefined();
      expect(skipped?.action).toBe('skipped');
      expect(skipped?.reason).toContain('Missing js-meta.xml');

      const updated = result.actions.find((a) => a.componentName === 'invalidRulesComp');
      expect(updated).toBeDefined();
      expect(updated?.action).toBe('updated');
      const rules = JSON.parse(
        fs.readFileSync(path.join(invalidRulesComp, 'invalidRulesComp.rules.json'), 'utf-8'),
      ) as { root: boolean; selector: { css: string } };
      expect(rules.root).toBe(true);
      expect(rules.selector.css).toBe('c-invalid-rules-comp');
    });

    it('ignores __tests__ and hidden folders under lwc directory', () => {
      const testsDir = path.join(tempDir, 'force-app', 'lwc', '__tests__');
      const dotDir = path.join(tempDir, 'force-app', 'lwc', '.hiddenFolder');
      fs.mkdirSync(testsDir, { recursive: true });
      fs.mkdirSync(dotDir, { recursive: true });

      const result = generateLwcRules({
        rootDir: tempDir,
        sourceDirs: ['force-app'],
      });

      expect(result.totalComponentsScanned).toBe(0);
      expect(result.actions).toHaveLength(0);
    });

    it('respects dryRun without writing files to disk', () => {
      const compDir = path.join(tempDir, 'force-app', 'lwc', 'freshRoot');
      fs.mkdirSync(compDir, { recursive: true });
      fs.writeFileSync(
        path.join(compDir, 'freshRoot.js-meta.xml'),
        `<LightningComponentBundle><targets><target>lightning__RecordPage</target></targets></LightningComponentBundle>`,
        'utf-8',
      );

      const result = generateLwcRules({
        rootDir: tempDir,
        sourceDirs: ['force-app'],
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(result.rootComponentsIdentified).toBe(1);
      expect(result.filesCreated.length).toBe(1);

      // Verify file was NOT written
      expect(fs.existsSync(path.join(compDir, 'freshRoot.rules.json'))).toBe(false);
    });
  });
});
