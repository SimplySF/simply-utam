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
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const packagesDir = fileURLToPath(new URL('./packages/', import.meta.url));

// Vitest's `projects` glob only inherits the parent `test` config for directories that have
// their own vitest config file; bare directories (all of ours) get nothing but CLI-flag
// overrides. Building explicit project entries here — one per package — makes each project
// actually inherit `include`, `environment`, and `globals` below, and also makes them resolve
// correctly regardless of which directory `vitest run` is invoked from (each package's
// `test:only` wireit task runs it from that package's own directory).
const packageProjects = fs
  .readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    test: {
      name: entry.name,
      root: fileURLToPath(new URL(`./packages/${entry.name}/`, import.meta.url)),
      globals: true,
      environment: 'node',
      include: ['test/**/*.test.ts'],
    },
  }));

export default defineConfig({
  root: rootDir,
  test: {
    projects: packageProjects,
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
  },
});
