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

import { describe, it, expect } from 'vitest';
import {
  getTestEnvironment,
  DEFAULT_ALLOWED_HOST_PATTERNS,
  isHostAllowed,
  validateAndParseSecureUrl,
  loginAsUser,
  goToExperiencePage,
  goToApplication,
  goToCreateNewRecord,
  goToRecord,
  goToRelatedList,
  logUtamHtml,
  scaffoldProject,
  executeBuildPipeline,
  generateLwcRules,
  applyUtamOverrides,
  rewriteUtamNamespaces,
  generateCucumberSteps,
} from '../src/index.js';

describe('@simplysf/simply-utam re-exports', () => {
  it('should re-export runtime helpers from core', () => {
    expect(typeof getTestEnvironment).toBe('function');
    expect(DEFAULT_ALLOWED_HOST_PATTERNS).toHaveLength(4);
    expect(typeof isHostAllowed).toBe('function');
    expect(typeof validateAndParseSecureUrl).toBe('function');
    expect(typeof loginAsUser).toBe('function');
    expect(typeof goToExperiencePage).toBe('function');
    expect(typeof goToApplication).toBe('function');
    expect(typeof goToCreateNewRecord).toBe('function');
    expect(typeof goToRecord).toBe('function');
    expect(typeof goToRelatedList).toBe('function');
    expect(typeof logUtamHtml).toBe('function');
  });

  it('should re-export build, transformation, and scaffolding utilities from core', () => {
    expect(typeof scaffoldProject).toBe('function');
    expect(typeof executeBuildPipeline).toBe('function');
    expect(typeof generateLwcRules).toBe('function');
    expect(typeof applyUtamOverrides).toBe('function');
    expect(typeof rewriteUtamNamespaces).toBe('function');
    expect(typeof generateCucumberSteps).toBe('function');
  });
});
