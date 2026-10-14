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

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  FORCEIGNORE_HEADER,
  SIMPLY_UTAM_FORCEIGNORE_RULES,
  ensureForceignore,
  mergeForceignore,
  resolveUtamTestIgnoreRules,
} from '../src/forceignore/index.js';

const ALL_PATTERNS = SIMPLY_UTAM_FORCEIGNORE_RULES.map((rule) => rule.pattern);
const UTAM_BLOCK = [FORCEIGNORE_HEADER, ...ALL_PATTERNS].join('\n');

const BOM = String.fromCharCode(0xfeff);
const lines = (...parts: string[]): string => parts.map((part) => `${part}\n`).join('');

describe('forceignore management', () => {
  describe('mergeForceignore', () => {
    it('writes the whole block into empty content', () => {
      const result = mergeForceignore('');

      expect(result.content).toBe(`${UTAM_BLOCK}\n`);
      expect(result.action).toBe('inserted');
      expect(result.placement).toBe('end');
      expect(result.addedPatterns).toStrictEqual(ALL_PATTERNS);
    });

    it('appends a new block after existing lines, separated by a blank line', () => {
      const original = lines('package.xml', '**/jsconfig.json');
      const result = mergeForceignore(original);

      expect(result.content).toBe(`${original}\n${UTAM_BLOCK}\n`);
      expect(result.placement).toBe('end');
    });

    it('does not add a second blank line when the file already ends with one', () => {
      const original = lines('package.xml', '');
      const result = mergeForceignore(original);

      expect(result.content).toBe(`${original}${UTAM_BLOCK}\n`);
    });

    it('adds only missing rules to an existing # Ignore UTAM block', () => {
      const original = lines('package.xml', '', FORCEIGNORE_HEADER, '**/__utam__/**', '', '# Other', 'foo/');
      const result = mergeForceignore(original);

      expect(result.action).toBe('appended');
      expect(result.placement).toBe('block');
      expect(result.addedPatterns).toStrictEqual(['**/lwc/**/*.rules.json', '**/*.utam-overrides.json']);
      expect(result.content).toBe(
        lines(
          'package.xml',
          '',
          FORCEIGNORE_HEADER,
          '**/__utam__/**',
          '**/lwc/**/*.rules.json',
          '**/*.utam-overrides.json',
          '',
          '# Other',
          'foo/',
        ),
      );
    });

    it('stops the block at a comment directly below it', () => {
      const original = lines(FORCEIGNORE_HEADER, '**/__utam__/**', '# Team rules', 'team/');
      const result = mergeForceignore(original);

      expect(result.content).toBe(
        lines(
          FORCEIGNORE_HEADER,
          '**/__utam__/**',
          '**/lwc/**/*.rules.json',
          '**/*.utam-overrides.json',
          '# Team rules',
          'team/',
        ),
      );
    });

    it('accepts the broader **/*.rules.json as covering the scoped rule', () => {
      const original = lines(FORCEIGNORE_HEADER, '**/__utam__/**', '**/*.rules.json', '**/*.utam-overrides.json');
      const result = mergeForceignore(original);

      expect(result.action).toBe('unchanged');
      expect(result.content).toBe(original);
      expect(result.addedPatterns).toStrictEqual([]);
    });

    it('treats rules found anywhere in the file as covered', () => {
      const original = lines('**/__utam__/', 'package.xml', '  **/lwc/**/*.rules.json  ', '**/*.utam-overrides.json');

      expect(mergeForceignore(original).action).toBe('unchanged');
    });

    it('accepts the unprefixed gitignore spellings, which match at any depth', () => {
      const original = lines('__utam__/', '*.rules.json', '*.utam-overrides.json');

      expect(mergeForceignore(original).action).toBe('unchanged');
    });

    it('does not count commented-out or negated copies as covering a rule', () => {
      const original = lines('# **/__utam__/**', '!**/*.utam-overrides.json', '**/*.rules.json');
      const result = mergeForceignore(original);

      expect(result.addedPatterns).toStrictEqual(['**/__utam__/**', '**/*.utam-overrides.json']);
    });

    it('inserts a new block directly above the region end marker', () => {
      const original = lines(
        'package.xml',
        '# -- START CUSTOMIZATION',
        'team/one',
        'team/two',
        '# -- END CUSTOMIZATION',
        'after/',
      );
      const result = mergeForceignore(original);

      expect(result.placement).toBe('region');
      expect(result.content).toBe(
        lines(
          'package.xml',
          '# -- START CUSTOMIZATION',
          'team/one',
          'team/two',
          '',
          UTAM_BLOCK,
          '# -- END CUSTOMIZATION',
          'after/',
        ),
      );
    });

    it('adds to an existing block inside the region rather than starting a new one', () => {
      const original = lines(
        '# -- START CUSTOMIZATION',
        'team/one',
        '',
        FORCEIGNORE_HEADER,
        '**/__utam__/**',
        '',
        'team/two',
        '# -- END CUSTOMIZATION',
      );
      const result = mergeForceignore(original);

      expect(result.placement).toBe('block');
      expect(result.content).toBe(
        lines(
          '# -- START CUSTOMIZATION',
          'team/one',
          '',
          FORCEIGNORE_HEADER,
          '**/__utam__/**',
          '**/lwc/**/*.rules.json',
          '**/*.utam-overrides.json',
          '',
          'team/two',
          '# -- END CUSTOMIZATION',
        ),
      );
    });

    it('matches custom region markers exactly', () => {
      const original = lines('# BEGIN LOCAL', 'team/', '# FINISH LOCAL', 'after/');
      const result = mergeForceignore(original, { regionStart: '# BEGIN LOCAL', regionEnd: '# FINISH LOCAL' });

      expect(result.placement).toBe('region');
      expect(result.content).toBe(lines('# BEGIN LOCAL', 'team/', '', UTAM_BLOCK, '# FINISH LOCAL', 'after/'));
    });

    it('ignores marker lines that differ in case or carry extra text', () => {
      const original = lines('# -- start customization', 'team/', '# -- END CUSTOMIZATION (local)');
      const result = mergeForceignore(original);

      expect(result.placement).toBe('end');
      expect(result.warnings).toStrictEqual([]);
    });

    it.each([
      ['a start marker without an end', ['# -- START CUSTOMIZATION', 'team/']],
      ['an end marker without a start', ['team/', '# -- END CUSTOMIZATION']],
      ['an end marker before the start', ['# -- END CUSTOMIZATION', 'team/', '# -- START CUSTOMIZATION']],
      [
        'two regions',
        ['# -- START CUSTOMIZATION', '# -- END CUSTOMIZATION', '# -- START CUSTOMIZATION', '# -- END CUSTOMIZATION'],
      ],
    ])('falls back to the end of the file with a warning for %s', (_label, body) => {
      const original = lines(...body);
      const result = mergeForceignore(original);

      expect(result.placement).toBe('end');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('malformed');
      expect(result.content).toBe(`${original}\n${UTAM_BLOCK}\n`);
    });

    it('trims region markers before matching', () => {
      const original = lines('# BEGIN LOCAL', 'team/', '# FINISH LOCAL');
      const result = mergeForceignore(original, { regionStart: '  # BEGIN LOCAL ', regionEnd: '# FINISH LOCAL\t' });

      expect(result.placement).toBe('region');
    });

    it('never treats blank lines as an empty region marker', () => {
      const original = lines('package.xml', '', 'team/', '');
      const result = mergeForceignore(original, { regionEnd: '   ' });

      expect(result.placement).toBe('end');
      expect(result.warnings[0]).toContain('marker is empty');
      expect(result.content).toBe(`${original}${UTAM_BLOCK}\n`);
    });

    it('uses CRLF for new lines when the file uses CRLF', () => {
      const original = 'package.xml\r\n**/jsconfig.json\r\n';
      const result = mergeForceignore(original);

      expect(result.content).toBe(`${original}\r\n${[FORCEIGNORE_HEADER, ...ALL_PATTERNS].join('\r\n')}\r\n`);
    });

    it('leaves the line endings of existing lines untouched in a mixed file', () => {
      const original = 'one\r\ntwo\nthree\r\n';
      const result = mergeForceignore(original);

      expect(result.content.startsWith(original)).toBe(true);
    });

    it('follows the line ending of the line the rules are inserted after', () => {
      const original = 'one\n# -- START CUSTOMIZATION\r\nteam/\r\n# -- END CUSTOMIZATION\n';
      const result = mergeForceignore(original);

      expect(result.content).toBe(
        'one\n# -- START CUSTOMIZATION\r\nteam/\r\n\r\n' +
          [FORCEIGNORE_HEADER, ...ALL_PATTERNS].map((line) => `${line}\r\n`).join('') +
          '# -- END CUSTOMIZATION\n',
      );
    });

    it('uses the majority line ending when the previous line has none', () => {
      const result = mergeForceignore('one\r\ntwo\nthree\nfour');

      expect(result.content).toBe(`one\r\ntwo\nthree\nfour\n\n${UTAM_BLOCK}\n`);
    });

    it('keeps a byte-order mark', () => {
      const result = mergeForceignore(`${BOM}package.xml\n`);

      expect(result.content).toBe(`${BOM}package.xml\n\n${UTAM_BLOCK}\n`);
    });

    it('adds a newline to a last line that lacks one before adding rules', () => {
      const result = mergeForceignore('package.xml');

      expect(result.content).toBe(`package.xml\n\n${UTAM_BLOCK}\n`);
    });

    it('adds a newline to a block line that lacks one before appending to it', () => {
      const result = mergeForceignore(`${FORCEIGNORE_HEADER}\n**/__utam__/**`);

      expect(result.content).toBe(`${UTAM_BLOCK}\n`);
    });

    it('gives the same result when run twice', () => {
      const original = lines('package.xml', '# -- START CUSTOMIZATION', 'team/', '# -- END CUSTOMIZATION');
      const once = mergeForceignore(original);
      const twice = mergeForceignore(once.content);

      expect(twice.action).toBe('unchanged');
      expect(twice.content).toBe(once.content);
    });

    it('writes custom rules, accepting their alternatives', () => {
      const rules = [{ pattern: 'force-app/test/utam/', alternatives: ['force-app/test/utam/**'] }];

      expect(mergeForceignore(lines('force-app/test/utam/**'), { rules }).action).toBe('unchanged');
      expect(mergeForceignore('', { rules }).content).toBe(lines(FORCEIGNORE_HEADER, 'force-app/test/utam/'));
    });
  });

  describe('resolveUtamTestIgnoreRules', () => {
    it('ties a test folder inside a package directory to the project root', () => {
      const rules = resolveUtamTestIgnoreRules(['force-app/test/utam'], ['force-app']);

      expect(rules).toHaveLength(1);
      expect(rules[0].pattern).toBe('force-app/test/utam/');
      expect(rules[0].alternatives).toContain('force-app/test/utam/**');
      expect(rules[0].alternatives).toContain('/force-app/test/utam/');
    });

    it('gives no rule for a test folder outside every package directory', () => {
      expect(resolveUtamTestIgnoreRules(['test/utam'], ['force-app'])).toStrictEqual([]);
      expect(resolveUtamTestIgnoreRules(['force-app-other/test/utam'], ['force-app'])).toStrictEqual([]);
    });

    it('converts Windows separators and strips leading ./', () => {
      const rules = resolveUtamTestIgnoreRules(['force-app\\test\\utam', './force-app/test/utam'], ['./force-app/']);

      expect(rules.map((rule) => rule.pattern)).toStrictEqual(['force-app/test/utam/']);
    });

    it('gives no rule to absolute paths or paths outside the project root', () => {
      const rules = resolveUtamTestIgnoreRules(
        ['/abs/force-app/test/utam', '../other/test/utam', '..'],
        ['.', '/abs/force-app', '../other'],
      );

      expect(rules).toStrictEqual([]);
    });

    it('gives no rule to a path on another Windows drive', () => {
      const rules = resolveUtamTestIgnoreRules(['D:\\src\\force-app\\test\\utam'], ['D:\\src\\force-app']);

      expect(rules).toStrictEqual([]);
    });

    it('escapes characters that .forceignore would read as wildcards', () => {
      const [rule] = resolveUtamTestIgnoreRules(['force-app[1]/test/utam'], ['force-app[1]']);

      expect(rule.pattern).toBe('force-app\\[1\\]/test/utam/');
      expect(rule.alternatives).toContain('force-app\\[1\\]/test/utam/**');
      expect(rule.alternatives).toContain('/force-app\\[1\\]/test/utam/');
      expect(resolveUtamTestIgnoreRules(['a*b/test/utam'], ['a*b'])[0].pattern).toBe('a\\*b/test/utam/');
    });

    it('escapes a leading # or ! so the rule is not read as a comment or negation', () => {
      const [hash] = resolveUtamTestIgnoreRules(['#app/test/utam'], ['#app']);
      const [bang] = resolveUtamTestIgnoreRules(['!app/test/utam'], ['!app']);

      expect(hash.pattern).toBe('\\#app/test/utam/');
      expect(hash.alternatives).toContain('/#app/test/utam/');
      expect(bang.pattern).toBe('\\!app/test/utam/');
    });

    it('counts an existing escaped rule as covering a bracketed folder', () => {
      const rules = resolveUtamTestIgnoreRules(['force-app[1]/test/utam'], ['force-app[1]']);

      expect(mergeForceignore(lines('force-app\\[1\\]/test/utam/**'), { rules }).action).toBe('unchanged');
      expect(mergeForceignore(lines('force-app[1]/test/utam/'), { rules }).addedPatterns).toStrictEqual([
        'force-app\\[1\\]/test/utam/',
      ]);
    });

    it('covers every folder when a package directory is the project root', () => {
      const rules = resolveUtamTestIgnoreRules(['test/utam'], ['.']);

      expect(rules.map((rule) => rule.pattern)).toStrictEqual(['test/utam/']);
    });
  });

  describe('ensureForceignore', () => {
    let tempDir: string;
    let forceignorePath: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simply-utam-forceignore-test-'));
      forceignorePath = path.join(tempDir, '.forceignore');
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('creates .forceignore when sfdx-project.json exists', () => {
      fs.writeFileSync(path.join(tempDir, 'sfdx-project.json'), '{"packageDirectories":[]}', 'utf-8');

      const result = ensureForceignore({ projectDir: tempDir });

      expect(result.action).toBe('created');
      expect(fs.readFileSync(forceignorePath, 'utf-8')).toBe(`${UTAM_BLOCK}\n`);
    });

    it('skips a project with neither .forceignore nor sfdx-project.json', () => {
      const result = ensureForceignore({ projectDir: tempDir });

      expect(result.action).toBe('skipped');
      expect(fs.existsSync(forceignorePath)).toBe(false);
    });

    it('updates an existing file and reports where rules went', () => {
      fs.writeFileSync(forceignorePath, lines('package.xml'), 'utf-8');

      const result = ensureForceignore({ projectDir: tempDir });

      expect(result.action).toBe('inserted');
      expect(result.placement).toBe('end');
      expect(fs.readFileSync(forceignorePath, 'utf-8')).toBe(`package.xml\n\n${UTAM_BLOCK}\n`);
    });

    it('leaves a fully covered file untouched', () => {
      const original = lines('**/__utam__/**', '**/*.rules.json', '**/*.utam-overrides.json');
      fs.writeFileSync(forceignorePath, original, 'utf-8');

      expect(ensureForceignore({ projectDir: tempDir }).action).toBe('unchanged');
      expect(fs.readFileSync(forceignorePath, 'utf-8')).toBe(original);
    });

    it('reports a read error as failed instead of throwing', () => {
      fs.mkdirSync(forceignorePath);

      const result = ensureForceignore({ projectDir: tempDir });

      expect(result.action).toBe('failed');
      expect(result.addedPatterns).toStrictEqual([]);
      expect(result.warnings[0]).toContain('Could not update .forceignore');
    });

    it('leaves no temporary file behind and keeps the file mode', () => {
      fs.writeFileSync(forceignorePath, lines('package.xml'), 'utf-8');
      if (process.platform !== 'win32') {
        fs.chmodSync(forceignorePath, 0o640);
      }

      ensureForceignore({ projectDir: tempDir });

      expect(fs.readdirSync(tempDir)).toStrictEqual(['.forceignore']);
      if (process.platform !== 'win32') {
        expect(fs.statSync(forceignorePath).mode & 0o777).toBe(0o640);
      }
    });

    it.skipIf(process.platform === 'win32')('writes through a symlinked .forceignore', () => {
      const realPath = path.join(tempDir, 'shared.forceignore');
      fs.writeFileSync(realPath, lines('package.xml'), 'utf-8');
      fs.symlinkSync(realPath, forceignorePath);

      ensureForceignore({ projectDir: tempDir });

      expect(fs.lstatSync(forceignorePath).isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(realPath, 'utf-8')).toBe(`package.xml\n\n${UTAM_BLOCK}\n`);
    });

    // Permission tests need POSIX modes and a non-root user, who can't bypass them.
    const canTestPermissions = process.platform !== 'win32' && process.getuid?.() !== 0;

    it.runIf(canTestPermissions)('writes in place when the folder does not allow new files', () => {
      fs.writeFileSync(forceignorePath, lines('package.xml'), 'utf-8');
      fs.chmodSync(tempDir, 0o555);
      try {
        const result = ensureForceignore({ projectDir: tempDir });

        expect(result.action).toBe('inserted');
        expect(fs.readFileSync(forceignorePath, 'utf-8')).toBe(`package.xml\n\n${UTAM_BLOCK}\n`);
        expect(fs.readdirSync(tempDir)).toStrictEqual(['.forceignore']);
      } finally {
        fs.chmodSync(tempDir, 0o755);
      }
    });

    it.runIf(canTestPermissions)('reports a failed write without leaving a temporary file behind', () => {
      fs.writeFileSync(forceignorePath, lines('package.xml'), 'utf-8');
      fs.chmodSync(forceignorePath, 0o444);
      fs.chmodSync(tempDir, 0o555);
      try {
        const result = ensureForceignore({ projectDir: tempDir });

        expect(result.action).toBe('failed');
        expect(result.warnings[0]).toContain('Could not update .forceignore');
        expect(fs.readFileSync(forceignorePath, 'utf-8')).toBe(lines('package.xml'));
        expect(fs.readdirSync(tempDir)).toStrictEqual(['.forceignore']);
      } finally {
        fs.chmodSync(tempDir, 0o755);
      }
    });

    it.runIf(canTestPermissions)('leaves a read-only .forceignore alone even when the folder is writable', () => {
      fs.writeFileSync(forceignorePath, lines('package.xml'), 'utf-8');
      fs.chmodSync(forceignorePath, 0o444);

      const result = ensureForceignore({ projectDir: tempDir });

      expect(result.action).toBe('failed');
      expect(fs.readFileSync(forceignorePath, 'utf-8')).toBe(lines('package.xml'));
      expect(fs.statSync(forceignorePath).mode & 0o777).toBe(0o444);
      expect(fs.readdirSync(tempDir)).toStrictEqual(['.forceignore']);
    });

    it('writes nothing during a dry run', () => {
      fs.writeFileSync(forceignorePath, lines('package.xml'), 'utf-8');

      const result = ensureForceignore({ projectDir: tempDir, dryRun: true });

      expect(result.action).toBe('inserted');
      expect(result.addedPatterns).toStrictEqual(ALL_PATTERNS);
      expect(fs.readFileSync(forceignorePath, 'utf-8')).toBe(lines('package.xml'));
    });
  });
});
