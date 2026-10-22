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
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = path.join(packageDir, 'skills');

describe('agent skills', () => {
  it('ships the skills folder in the package', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8')) as { files: string[] };
    expect(pkg.files).toContain('/skills');
  });

  it('names each skill in its frontmatter after its folder', () => {
    const names = fs.readdirSync(skillsDir);
    expect(names).toContain('utam-dom-snapshots');
    for (const name of names) {
      const skill = fs.readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf-8');
      expect(skill).toMatch(new RegExp(`^---\\nname: ${name}\\ndescription: .+\\n---\\n`));
    }
  });

  it('gives the DOM snapshot skill both page-object recipes, with valid JSON', () => {
    const skill = fs.readFileSync(path.join(skillsDir, 'utam-dom-snapshots', 'SKILL.md'), 'utf-8');
    expect(skill).toContain('### Attach your own page object below the last shipped one');
    expect(skill).toContain('### Scope a shipped root page object to the visible copy');
    for (const [, json] of skill.matchAll(/```json\n([\s\S]*?)```/g))
      expect(() => JSON.parse(json) as unknown).not.toThrow();
  });
});
