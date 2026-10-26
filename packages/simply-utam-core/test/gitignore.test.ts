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
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GITIGNORE_FILE, ensureGitignore, mergeGitignore } from '../src/index.js';

const lines = (...parts: string[]): string => parts.map((part) => `${part}\n`).join('');

describe('gitignore management', () => {
  describe('mergeGitignore', () => {
    it('writes the rule under a # Ignore UTAM comment into empty content', () => {
      expect(mergeGitignore('')).toMatchObject({
        content: lines('# Ignore UTAM', '.utam/snapshots/'),
        action: 'inserted',
        placement: 'end',
        addedPatterns: ['.utam/snapshots/'],
      });
    });

    it('appends after existing lines, separated by a blank line, without changing them', () => {
      const existing = lines('node_modules/', '# local', '.env');
      const result = mergeGitignore(existing);
      expect(result.content).toBe(`${existing}\n${lines('# Ignore UTAM', '.utam/snapshots/')}`);
    });

    it('adds under an existing # Ignore UTAM comment', () => {
      const result = mergeGitignore(lines('# Ignore UTAM', 'pageObjects/', '', 'dist/'));
      expect(result).toMatchObject({ action: 'appended', placement: 'block' });
      expect(result.content).toBe(lines('# Ignore UTAM', 'pageObjects/', '.utam/snapshots/', '', 'dist/'));
    });

    it('accepts a rule that already ignores snapshots, or all of .utam', () => {
      for (const covered of ['.utam/snapshots', '/.utam/snapshots/', '.utam/', '/.utam', '.utam/**']) {
        expect(mergeGitignore(lines('dist/', covered)).action).toBe('unchanged');
      }
      expect(mergeGitignore(lines('# .utam/', '!.utam/snapshots/')).action).toBe('inserted');
    });

    it('keeps CRLF line endings and a byte-order mark, and gives the same result twice', () => {
      const bom = String.fromCharCode(0xfeff);
      const result = mergeGitignore(`${bom}dist/\r\n`);
      expect(result.content).toBe(`${bom}dist/\r\n\r\n# Ignore UTAM\r\n.utam/snapshots/\r\n`);
      expect(mergeGitignore(result.content).action).toBe('unchanged');
    });
  });

  describe('ensureGitignore', () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simply-utam-gitignore-'));
    });

    afterEach(() => {
      fs.rmSync(projectDir, { recursive: true, force: true });
    });

    const read = (): string => fs.readFileSync(path.join(projectDir, GITIGNORE_FILE), 'utf-8');

    it('creates .gitignore when it is missing', () => {
      expect(ensureGitignore({ projectDir })).toMatchObject({ path: '.gitignore', action: 'created' });
      expect(read()).toBe(lines('# Ignore UTAM', '.utam/snapshots/'));
    });

    it('updates an existing file, and leaves a covered one alone', () => {
      fs.writeFileSync(path.join(projectDir, GITIGNORE_FILE), lines('node_modules/'));
      expect(ensureGitignore({ projectDir }).action).toBe('inserted');
      expect(read()).toBe(lines('node_modules/', '', '# Ignore UTAM', '.utam/snapshots/'));
      expect(ensureGitignore({ projectDir }).action).toBe('unchanged');
    });

    it('writes nothing in a dry run', () => {
      expect(ensureGitignore({ projectDir, dryRun: true }).action).toBe('created');
      expect(fs.existsSync(path.join(projectDir, GITIGNORE_FILE))).toBe(false);
    });

    it('reports a file it cannot read as failed, without throwing', () => {
      fs.mkdirSync(path.join(projectDir, GITIGNORE_FILE));
      const result = ensureGitignore({ projectDir });
      expect(result.action).toBe('failed');
      expect(result.warnings[0]).toMatch(/^Could not update \.gitignore, so UTAM rules were not added: /);
    });
  });
});
