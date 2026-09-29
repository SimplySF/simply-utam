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

import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

/**
 * Pins down this package's public API surface. Types are erased at runtime and so can't be
 * checked here — TypeScript's own compilation of the barrel is what catches a type export being
 * removed or renamed. This test guards the *value* exports (functions, classes, constants) that
 * survive to runtime.
 *
 * Updating this list is expected when the API deliberately grows. A test failure from a removed
 * or renamed key is the signal to treat the change as breaking (see `src/index.ts`'s header).
 */
describe('@simplysf/simply-utam-core', () => {
  it('exports the expected set of runtime values', () => {
    expect(Object.keys(api).sort()).toStrictEqual(
      [
        // org authentication & environment
        'DEFAULT_ALLOWED_HOST_PATTERNS',
        'TestEnvironment',
        'USERNAME_ENV',
        'getTestEnvironment',
        'isHostAllowed',
        'resetTestEnvironment',
        'setTestEnvironment',
        'validateAndParseSecureUrl',

        // Lightning paths and navigation
        'LightningNavigator',
        'applicationPath',
        'goToApplication',
        'goToCreateNewRecord',
        'goToExperiencePage',
        'goToLoginUrl',
        'goToRecord',
        'goToRelatedList',
        'lightningAppName',
        'loginAsExperienceUser',
        'loginAsUser',
        'newRecordPath',
        'recordPath',
        'relatedListPath',
        'resolveBrowser',

        // debugging
        'formatUtamHtml',
        'getUtamHtml',
        'logUtamHtml',

        // discovery
        'discoverComponentsInPackageDir',
        'discoverProject',
        'findLwcDirectories',

        // rules
        'ROOT_TARGETS',
        'convertLwcNameToHtml',
        'generateLwcRules',
        'getTargetsFromMeta',

        // overrides
        'applyUtamOverrides',
        'detectIndentation',
        'findUtamOverridesFiles',
        'mergeElements',
        'walkElements',

        // namespaces
        'findUtamJsonFiles',
        'rewriteUtamNamespaces',
        'updateValueWithMappings',

        // steps
        'compileStepExpressions',
        'extractStepExpressionsFromContent',
        'extractStepsFromGherkin',
        'formatCode',
        'formatParameterNames',
        'generateCucumberSteps',
        'generateStepSnippet',
        'matchStepAgainstExpressions',
        'normalizeExpression',
        'parseGherkinDocument',
        'resolveGlobs',

        // scaffold
        'DEFAULT_REQUIRED_DEV_DEPENDENCIES',
        'DEFAULT_TEMPLATES_DIR',
        'checkMissingDependencies',
        'generateGeneratorConfig',
        'generateHelloFeature',
        'generateHelloSteps',
        'generateNamespaceMap',
        'generateUtamConfig',
        'generateWdioConfig',
        'injectWireitConfiguration',
        'loadTemplate',
        'scaffoldProject',
      ].sort(),
    );
  });
});
