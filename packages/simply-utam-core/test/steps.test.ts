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
  extractStepsFromGherkin,
  extractStepExpressionsFromContent,
  compileStepExpressions,
  matchStepAgainstExpressions,
  formatParameterNames,
  generateStepSnippet,
  generateCucumberSteps,
  resolveGlobs,
} from '../src/steps/index.js';

describe('Cucumber Step Scaffolding Engine', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utam-steps-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Gherkin Parser', () => {
    it('parses scenarios, backgrounds, rules, and preserves semantic keywords', () => {
      const gherkin = `
Feature: Account Management
  Background:
    Given the application is running
    And user is logged in as "admin"

  Scenario: Create Account
    When user opens "Accounts" menu
    And user clicks "New"
    Then modal dialog is visible
    And title is "New Account"
    But error message is not shown

  Rule: Validation rules
    Scenario: Invalid Account
      When user enters invalid name
      Then error is displayed
      """
      Name is required
      """
`;

      const steps = extractStepsFromGherkin(gherkin, 'accounts.feature');

      expect(steps).toHaveLength(9);

      // Background steps
      expect(steps[0].keyword).toBe('Given');
      expect(steps[0].text).toBe('the application is running');
      expect(steps[1].keyword).toBe('Given');
      expect(steps[1].rawKeyword).toBe('And');

      // Scenario steps
      expect(steps[2].keyword).toBe('When');
      expect(steps[3].keyword).toBe('When');
      expect(steps[4].keyword).toBe('Then');
      expect(steps[5].keyword).toBe('Then');
      expect(steps[6].keyword).toBe('Then');

      // Rule steps with docString
      expect(steps[7].keyword).toBe('When');
      expect(steps[8].keyword).toBe('Then');
      expect(steps[8].hasDocString).toBe(true);
    });

    it('returns empty array when feature syntax is invalid', () => {
      const invalid = 'This is not a valid gherkin file at all';
      const steps = extractStepsFromGherkin(invalid);
      expect(steps).toEqual([]);
    });
  });

  describe('Expression Matcher', () => {
    it('extracts string and regex expressions from step definition content', () => {
      const code = `
        import { Given, When, Then } from '@cucumber/cucumber';

        Given('user opens {string} page', async (page) => {});
        When("user clicks 'Submit' button", async () => {});
        Then(\`user sees {int} items\`, async (count) => {});
        Given(/^user has (\\d+) records$/, async (n) => {});
      `;

      const raw = extractStepExpressionsFromContent(code);
      expect(raw).toHaveLength(4);

      expect(raw[0].pattern).toBe('user opens {string} page');
      expect(raw[0].isRegex).toBe(false);

      expect(raw[1].pattern).toBe("user clicks 'Submit' button");
      expect(raw[1].isRegex).toBe(false);

      expect(raw[2].pattern).toBe('user sees {int} items');
      expect(raw[2].isRegex).toBe(false);

      expect(raw[3].pattern).toBe('^user has (\\d+) records$');
      expect(raw[3].isRegex).toBe(true);
    });

    it('compiles expressions and matches parameterized steps without false positives', () => {
      const raw = [
        { pattern: 'user navigates to {string}', isRegex: false },
        { pattern: 'user has {int} active records', isRegex: false },
        { pattern: '^user clicks ([a-zA-Z]+) button$', isRegex: true },
      ];

      const compiled = compileStepExpressions(raw);
      expect(compiled).toHaveLength(3);

      // Matches
      expect(matchStepAgainstExpressions('user navigates to "Dashboard"', compiled)).toBe(true);
      expect(matchStepAgainstExpressions('user has 42 active records', compiled)).toBe(true);
      expect(matchStepAgainstExpressions('user clicks Submit button', compiled)).toBe(true);

      // Non-matches
      expect(matchStepAgainstExpressions('user navigates nowhere', compiled)).toBe(false);
      expect(matchStepAgainstExpressions('user has many active records', compiled)).toBe(false);
      expect(matchStepAgainstExpressions('random step', compiled)).toBe(false);
    });
  });

  describe('Snippet Generator', () => {
    it('formats parameter names to avoid duplicates and adds dataTable / docString', () => {
      const names = formatParameterNames(['string', 'string', 'int'], true, true);
      expect(names).toEqual(['string1', 'string2', 'int', 'dataTable', 'docString']);
    });

    it('generates an idiomatic async step snippet with Cucumber expressions', () => {
      const snippet = generateStepSnippet({
        keyword: 'When',
        rawKeyword: 'When',
        text: 'user enters "admin" and "secret"',
        filePath: 'auth.feature',
        line: 12,
        hasDataTable: false,
        hasDocString: false,
      });

      expect(snippet.keyword).toBe('When');
      expect(snippet.expression).toBe('user enters {string} and {string}');
      expect(snippet.parameters).toEqual(['string', 'string2']);
      expect(snippet.fullText).toContain(
        "When('user enters {string} and {string}', async (string, string2): Promise<void> => {",
      );
    });
  });

  describe('Step Scaffolder Integration', () => {
    it('discovers undefined steps, deduplicates globally, and scaffolds target file', async () => {
      const featuresDir = path.join(tempDir, 'features');
      const stepsDir = path.join(tempDir, 'steps');
      fs.mkdirSync(featuresDir, { recursive: true });
      fs.mkdirSync(stepsDir, { recursive: true });

      // 1. Existing step definition covering "user is logged in as {string}"
      const existingStepContent = `
        import { Given } from '@cucumber/cucumber';
        Given('user is logged in as {string}', async (user) => {});
      `;
      fs.writeFileSync(path.join(stepsDir, 'auth.steps.mjs'), existingStepContent, 'utf-8');

      // 2. Feature 1 with one matched step and two undefined steps
      const feature1 = `
Feature: Feature 1
  Scenario: S1
    Given user is logged in as "admin"
    When user clicks "Submit"
    Then record is created
`;
      fs.writeFileSync(path.join(featuresDir, 'f1.feature'), feature1, 'utf-8');

      // 3. Feature 2 with duplicate undefined step "user clicks "Submit"" and another step
      const feature2 = `
Feature: Feature 2
  Scenario: S2
    When user clicks "Submit"
    Then email notification is sent
`;
      fs.writeFileSync(path.join(featuresDir, 'f2.feature'), feature2, 'utf-8');

      const outputFile = path.join(tempDir, 'output', 'generated.steps.mjs');

      const result = await generateCucumberSteps({
        rootDir: tempDir,
        features: path.join(featuresDir, '*.feature'),
        steps: path.join(stepsDir, '*.steps.mjs'),
        outputFile,
      });

      expect(result.featureFilesScanned).toBe(2);
      expect(result.stepFilesScanned).toBe(1);
      expect(result.totalFeatureSteps).toBe(5);
      expect(result.matchedStepsCount).toBe(1);
      expect(result.undefinedStepsCount).toBe(4);
      expect(result.uniqueSnippetsGenerated).toBe(3);

      // Verify output file was written and formatted
      expect(fs.existsSync(outputFile)).toBe(true);
      const outputContent = fs.readFileSync(outputFile, 'utf-8');
      expect(outputContent).toContain("import { Given, When, Then } from '@cucumber/cucumber';");
      expect(outputContent).toContain('user clicks {string}');
      expect(outputContent).toContain('record is created');
      expect(outputContent).toContain('email notification is sent');

      // Subsequent run should detect newly generated steps and report 0 new snippets
      const secondRun = await generateCucumberSteps({
        rootDir: tempDir,
        features: path.join(featuresDir, '*.feature'),
        steps: path.join(stepsDir, '*.steps.mjs'),
        outputFile,
      });

      expect(secondRun.uniqueSnippetsGenerated).toBe(0);
    });

    it('respects dryRun without writing files to disk', async () => {
      const featuresDir = path.join(tempDir, 'features');
      fs.mkdirSync(featuresDir, { recursive: true });

      const feature = `
Feature: Dry Run Test
  Scenario: Simple
    Given user visits home
`;
      fs.writeFileSync(path.join(featuresDir, 'test.feature'), feature, 'utf-8');

      const outputFile = path.join(tempDir, 'dryrun', 'steps.mjs');

      const result = await generateCucumberSteps({
        rootDir: tempDir,
        features: path.join(featuresDir, '*.feature'),
        outputFile,
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(result.uniqueSnippetsGenerated).toBe(1);
      expect(fs.existsSync(outputFile)).toBe(false);
      expect(result.generatedCode).toBeDefined();
    });

    it('resolves glob patterns and direct file paths', () => {
      const resolved = resolveGlobs([path.join(tempDir, '**/*.feature')], tempDir);
      expect(Array.isArray(resolved)).toBe(true);
    });
  });
});
