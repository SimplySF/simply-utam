# @simplysf/simply-utam-core

[![NPM](https://img.shields.io/npm/v/@simplysf/simply-utam-core?label=@simplysf/simply-utam-core)](https://npmjs.com/@simplysf/simply-utam-core) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://raw.githubusercontent.com/SimplySF/simply-utam/main/LICENSE.txt)

Org authentication, Lightning navigation, UTAM compilation helpers, AST transformations, and debugging helpers for
[UTAM](https://utam.dev/) UI tests against Salesforce, built by [SimplySF](https://github.com/SimplySF).

It logs the test browser in to an org you have already authorized with the Salesforce CLI — no
passwords in the test project — and opens Lightning pages directly, so a test starts on the page it
is about instead of clicking its way there. It also provides zero-config build transformations for LWC root rules,
AST overrides, namespace mapping, and offline Cucumber step scaffolding.

## Install

```bash
npm install --save-dev @simplysf/simply-utam-core
```

Requires Node.js 22 or later, and an org authorized with `sf org login web` (or any other `sf org
login` flow) on the machine running the tests.

## Usage

Point `UTAM_USERNAME` at the org's username or alias, then navigate from a WebdriverIO spec:

```ts
import { LightningNavigator, logUtamHtml } from '@simplysf/simply-utam-core';
import AccountDetail from '../pageObjects/accountDetail'; // your compiled UTAM page object

const navigator = new LightningNavigator();

describe('Account record', () => {
  it('opens on the detail page', async () => {
    await navigator.goToRecord('MyApp', '001000000000001AAA');

    const accountDetail = await utam.load(AccountDetail);
    await logUtamHtml(accountDetail); // prints the selector and rendered HTML when a locator misbehaves
  });
});
```

`LightningNavigator` uses WebdriverIO's global `browser` by default and a `TestEnvironment` for
`UTAM_USERNAME`; pass either explicitly to override:

```ts
const navigator = new LightningNavigator({
  environment: new TestEnvironment({ username: 'qa-sandbox' }),
  browser,
});
```

App names are developer names. A bare name is treated as a custom app in the default namespace
(`MyApp` opens `c__MyApp`); a namespaced name such as `standard__Sales` is used as given.

### How login works

`TestEnvironment` loads the org from the Salesforce CLI's auth store with `@salesforce/core` and asks
Salesforce's [single-access endpoint](https://help.salesforce.com/s/articleView?id=xcloud.frontdoor_singleaccess.htm&type=5)
for a one-time frontdoor URL. The access token never appears in a URL, so it does not end up in
browser history, WebDriver logs, or a screenshot of the address bar. The org is authenticated once per
`TestEnvironment` and shared by every navigation.

## API

Everything below is exported from the package root and is semver-covered. Anything not listed is
internal.

### Org authentication & Environment

| Export                                                        | Description                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `TestEnvironment`                                             | The org under test. `new TestEnvironment({ username?, env?, allowedDomains? })` throws when neither a username nor `UTAM_USERNAME` is set. |
| `testEnvironment.getOrg()`                                    | The authenticated `Org`. Authenticates on first call and shares the result; a failure is not cached.                      |
| `testEnvironment.getConnection()`                             | The underlying `@salesforce/core` Connection.                                                                            |
| `testEnvironment.init()`                                      | Authenticates eagerly, for a runner hook that wants auth failures reported before any test starts. Optional.              |
| `testEnvironment.buildFrontdoorUrl(returnUrl?)`               | A one-time URL that logs a browser in and lands on `returnUrl`.                                                           |
| `testEnvironment.buildExperienceFrontdoorUrl(prefix?, ret?)`  | One-time single-access login URL for Experience Cloud sites.                                                              |
| `testEnvironment.getOrgId()`                                  | Dynamically queries the 15- or 18-character Salesforce Organization ID.                                                   |
| `testEnvironment.getUserIdByUsername(username)`               | Resolves a target username to its Salesforce User record ID.                                                             |
| `testEnvironment.getNetworkIdByPrefix(prefix?)`               | Resolves an Experience site prefix to its corresponding Network ID.                                                      |
| `testEnvironment.buildExperienceUrl(prefix?, path?)`          | Constructs a fully qualified secure Experience Cloud site URL.                                                            |
| `getTestEnvironment(options?)`                                | Retrieves the global singleton `TestEnvironment` instance.                                                                |
| `setTestEnvironment(instance)`                                | Overrides the global `TestEnvironment` singleton.                                                                         |
| `resetTestEnvironment()`                                      | Resets and unsets the global `TestEnvironment` singleton.                                                                 |
| `isHostAllowed(host, instanceUrl?, allowedDomains?)`          | Validates a hostname against Salesforce default patterns and custom overrides.                                           |
| `validateAndParseSecureUrl(secureUrl, siteId, validator?)`    | Validates and parses a raw secure URL retrieved from SiteDetail.                                                          |
| `DEFAULT_ALLOWED_HOST_PATTERNS`                               | Default trusted Salesforce domain RegExp matchers.                                                                        |
| `USERNAME_ENV`                                                | `'UTAM_USERNAME'`.                                                                                                        |
| `TestEnvironmentOptions`, `EnvLike`                           | Types for the constructor options and an environment-shaped map.                                                          |

### Navigation

| Export                                                                | Description                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `LightningNavigator`                                                  | `new LightningNavigator({ environment?, browser? })`; every method logs in and opens a page.      |
| `navigator.goToLoginUrl(returnUrl?)`                                  | Log in and open any path, or the org's default landing page.                                      |
| `navigator.goToApplication(app)`                                      | An app's home page.                                                                               |
| `navigator.goToCreateNewRecord(app, objectApiName)`                   | An object's new-record form.                                                                      |
| `navigator.goToRecord(app, recordId)`                                 | A record's detail page.                                                                           |
| `navigator.goToRelatedList(app, recordId, relatedListName)`           | One of a record's related lists.                                                                  |
| `navigator.goToExperiencePage(sitePrefix, pageName)`                  | Log in and navigate directly to an Experience Cloud community page.                               |
| `navigator.loginAsUser(username, returnUrl?)`                         | Impersonate a user via admin session and redirect to target page.                                 |
| `navigator.loginAsExperienceUser(username, sitePrefix, pageName)`     | Impersonate a user and switch network to an Experience Cloud site.                                |
| `goToLoginUrl`, `goToExperiencePage`, `loginAsUser`                   | Standalone functional wrappers for navigation methods.                                            |
| `goToApplication`, `goToCreateNewRecord`, `goToRecord`                | Standalone functional wrappers for record and app navigation.                                     |
| `goToRelatedList`, `resolveBrowser`                                   | Standalone helper to open related list and resolve browser instance.                             |
| `applicationPath`, `newRecordPath`, `recordPath`, `relatedListPath`   | The Lightning paths the methods above open, for a caller building its own URLs.                   |
| `lightningAppName(app)`                                               | The namespacing rule: `MyApp` becomes `c__MyApp`, a namespaced name is unchanged.                 |
| `NavigableBrowser`, `FrontdoorUrlSource`, `LightningNavigatorOptions` | Structural types: anything with `navigateTo(url)`, anything with `buildFrontdoorUrl(returnUrl?)`. |

### Debugging

| Export                          | Description                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `logUtamHtml(utamObject, log?)` | Logs the selector a UTAM object resolved through and its HTML, shadow roots included. |
| `getUtamHtml(utamObject)`       | The same `{ selector, html }` without logging it, e.g. to attach to a test report.    |
| `formatUtamHtml(utamHtml)`      | The colored block `logUtamHtml` writes.                                               |
| `UtamElementLike`, `UtamHtml`   | Types: any UTAM page object or element, and what it resolved to.                      |

### Discovery

| Export                                            | Description                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `discoverProject(rootDir?)`                       | Discovers `sfdx-project.json`, package directories, namespaces, and LWC components.   |
| `findLwcDirectories(dirPath)`                     | Recursively locates directories named `lwc`.                                          |
| `discoverComponentsInPackageDir(pkgDir, rootDir)` | Finds all LWC components and metadata inside a given package directory.               |

### Rules Generation

| Export                                       | Description                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `generateLwcRules(options?)`                 | Scans LWC components and generates or updates `<component>.rules.json` files.         |
| `convertLwcNameToHtml(componentName, ns?)`   | Converts component name to kebab-case HTML tag with namespace prefix.                 |
| `getTargetsFromMeta(xmlContent)`             | Extracts targets from `<targets>` in a `*.js-meta.xml` file.                          |
| `ROOT_TARGETS`                               | Target page names that designate an LWC as a root component.                          |

### Overrides Merger

| Export                                       | Description                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `applyUtamOverrides(options?)`               | Deep merges `*.utam-overrides.json` definitions into generated `*.utam.json` files.   |
| `findUtamOverridesFiles(dirPath)`            | Locates all `*.utam-overrides.json` files in a directory tree.                        |
| `detectIndentation(content)`                 | Detects indentation formatting of a JSON file (2 spaces, 4 spaces, or tabs).          |
| `mergeElements(target, source)`              | Deep merges override properties into a target AST node.                               |
| `walkElements(node, callback)`               | Traverses AST nodes across root elements, nested elements, and shadow DOM roots.      |

### Namespace Rewriting

| Export                                       | Description                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `rewriteUtamNamespaces(options?)`            | Rewrites namespace prefixes across `*.utam.json` files according to mapping config.   |
| `findUtamJsonFiles(dirPath)`                 | Locates all `*.utam.json` schema files in a directory tree.                           |
| `updateValueWithMappings(value, map, list)`  | Replaces namespace prefixes in AST values based on longest-match sorting.             |

### Step Scaffolding Engine

| Export                                       | Description                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `generateCucumberSteps(options?)`            | Scans Gherkin features, compiles existing step expressions, and scaffolds skeletons.  |
| `parseGherkinDocument(content)`              | Parses Gherkin source text into an AST document representation.                       |
| `extractStepsFromGherkin(content, path?)`    | Extracts all scenario and background steps, normalizing And/But keywords.             |
| `extractStepExpressionsFromContent(content)` | Statically extracts registered step expressions from definition code.                 |
| `compileStepExpressions(raw, registry?)`     | Compiles string and RegExp expressions using `@cucumber/cucumber-expressions`.        |
| `matchStepAgainstExpressions(stepText, list)`| Matches a feature step text against compiled expressions.                             |
| `generateStepSnippet(step, registry?)`       | Generates an idiomatic async step snippet with Cucumber expressions.                  |
| `formatParameterNames(names, table?, doc?)`  | Formats parameter names to eliminate collisions and add dataTable/docString.          |
| `formatCode(code)`                           | Formats generated TypeScript / JavaScript code using Prettier.                        |
| `resolveGlobs(patterns, rootDir)`            | Resolves one or more glob patterns or file paths.                                     |

### Project Scaffolding

| Export                                       | Description                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `scaffoldProject(options?)`                  | Scaffolds configuration files, template files, and injects Wireit tasks into package. |
| `injectWireitConfiguration(packageJson, dir)`| Injects standard UTAM Wireit scripts and tasks non-destructively into package.json.   |
| `checkMissingDependencies(pkg, required?)`   | Detects missing recommended devDependencies.                                          |
| `loadTemplate(name, dir?, tokens?)`          | Loads an external scaffold template, performing `{{token}}` replacements.             |
| `generateGeneratorConfig(sourceDir, appName)`| Generates parsed `generator.config.json` content.                                     |
| `generateUtamConfig(templatesDir?)`          | Generates parsed `utam.config.json` content.                                          |
| `generateWdioConfig(sourceDir, dir?)`        | Generates formatted `wdio.conf.mjs` content.                                          |
| `generateNamespaceMap(appName, dir?)`        | Generates parsed `namespace-map.json` content.                                        |
| `generateHelloFeature(dir?)`                 | Generates formatted `hello.feature` starter smoke test content.                       |
| `generateHelloSteps(dir?)`                   | Generates formatted `hello.steps.mjs` starter step definition content.                |
| `DEFAULT_TEMPLATES_DIR`                      | Path to starter config templates directory.                                           |
| `DEFAULT_REQUIRED_DEV_DEPENDENCIES`          | List of standard recommended UTAM devDependencies.                                    |

WebdriverIO and UTAM are not dependencies: the browser and UTAM objects are typed structurally, so
the package works with whichever versions your test project already uses.

## Issues

Please report any issues at https://github.com/SimplySF/simply-utam/issues

## Contributing

This package is part of the [`simply-utam`](https://github.com/SimplySF/simply-utam) monorepo. See [CONTRIBUTING.md](CONTRIBUTING.md) for what's specific to this package, and the repo's [root CONTRIBUTING.md](https://github.com/SimplySF/simply-utam/blob/main/CONTRIBUTING.md) for repo structure, setup, commit conventions, and how to submit a pull request. Please also read our [Code of Conduct](https://github.com/SimplySF/simply-utam/blob/main/CODE_OF_CONDUCT.md).

## License

Licensed under the [Apache-2.0](https://raw.githubusercontent.com/SimplySF/simply-utam/main/LICENSE.txt) license.
