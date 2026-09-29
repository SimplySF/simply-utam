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

// Everything exported from this file is this package's public API and is semver-covered: adding
// an export is a minor/patch change, but removing or renaming one is breaking.
// `test/index.test.ts` pins the exported-key list so an accidental removal fails a test instead
// of silently shipping in a patch release.
//
// Nothing here depends on WebdriverIO or UTAM at runtime: the browser and UTAM objects are typed
// structurally, so consumers bring whichever versions their test project already uses.

export {
  TestEnvironment,
  USERNAME_ENV,
  DEFAULT_ALLOWED_HOST_PATTERNS,
  isHostAllowed,
  validateAndParseSecureUrl,
  getTestEnvironment,
  setTestEnvironment,
  resetTestEnvironment,
  type EnvLike,
  type TestEnvironmentOptions,
} from './test-environment.js';

export { applicationPath, lightningAppName, newRecordPath, recordPath, relatedListPath } from './lightning-paths.js';

export {
  LightningNavigator,
  goToLoginUrl,
  goToExperiencePage,
  loginAsUser,
  loginAsExperienceUser,
  goToApplication,
  goToCreateNewRecord,
  goToRecord,
  goToRelatedList,
  resolveBrowser,
  type FrontdoorUrlSource,
  type LightningNavigatorOptions,
  type NavigableBrowser,
} from './navigator.js';

export { formatUtamHtml, getUtamHtml, logUtamHtml, type UtamElementLike, type UtamHtml } from './utam-html.js';

export {
  findLwcDirectories,
  discoverComponentsInPackageDir,
  discoverProject,
  type SfdxPackageDirectory,
  type SfdxProjectConfig,
  type DiscoveredLwcComponent,
  type DiscoveredProject,
} from './discovery/index.js';

export {
  ROOT_TARGETS,
  convertLwcNameToHtml,
  getTargetsFromMeta,
  generateLwcRules,
  type GenerateRulesOptions,
  type RuleAction,
  type GenerateRulesResult,
} from './rules/index.js';

export {
  detectIndentation,
  findUtamOverridesFiles,
  walkElements,
  mergeElements,
  applyUtamOverrides,
  type ApplyOverridesOptions,
  type OverrideChange,
  type FileOverrideResult,
  type ApplyOverridesResult,
  type UtamOverrideItem,
} from './overrides/index.js';

export {
  findUtamJsonFiles,
  updateValueWithMappings,
  rewriteUtamNamespaces,
  type RewriteNamespacesOptions,
  type NamespaceReplacement,
  type FileRewriteResult,
  type RewriteNamespacesResult,
} from './namespaces/index.js';

export {
  parseGherkinDocument,
  extractStepsFromGherkin,
  normalizeExpression,
  extractStepExpressionsFromContent,
  compileStepExpressions,
  matchStepAgainstExpressions,
  formatParameterNames,
  generateStepSnippet,
  formatCode,
  resolveGlobs,
  generateCucumberSteps,
  type StepSemanticKeyword,
  type ParsedGherkinStep,
  type RawExtractedExpression,
  type CompiledStepExpression,
  type GeneratedStepSnippet,
  type GenerateStepsOptions,
  type GenerateStepsResult,
} from './steps/index.js';

export {
  DEFAULT_TEMPLATES_DIR,
  DEFAULT_REQUIRED_DEV_DEPENDENCIES,
  loadTemplate,
  generateGeneratorConfig,
  generateUtamConfig,
  generateWdioConfig,
  generateNamespaceMap,
  injectWireitConfiguration,
  checkMissingDependencies,
  scaffoldProject,
  type ScaffoldOptions,
  type ScaffoldResult,
} from './scaffold/index.js';
