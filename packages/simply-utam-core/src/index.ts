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

export { TestEnvironment, USERNAME_ENV, type EnvLike, type TestEnvironmentOptions } from './test-environment.js';
export { applicationPath, lightningAppName, newRecordPath, recordPath, relatedListPath } from './lightning-paths.js';
export {
  LightningNavigator,
  type FrontdoorUrlSource,
  type LightningNavigatorOptions,
  type NavigableBrowser,
} from './navigator.js';
export { formatUtamHtml, getUtamHtml, logUtamHtml, type UtamElementLike, type UtamHtml } from './utam-html.js';
