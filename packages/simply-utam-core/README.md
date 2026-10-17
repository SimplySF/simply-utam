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

| Export                                                       | Description                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `TestEnvironment`                                            | The org under test. `new TestEnvironment({ username?, env?, allowedDomains? })` throws when neither a username nor `UTAM_USERNAME` is set. |
| `testEnvironment.getOrg()`                                   | The authenticated `Org`. Authenticates on first call and shares the result; a failure is not cached.                                       |
| `testEnvironment.getConnection()`                            | The underlying `@salesforce/core` Connection.                                                                                              |
| `testEnvironment.init()`                                     | Authenticates eagerly, for a runner hook that wants auth failures reported before any test starts. Optional.                               |
| `testEnvironment.buildFrontdoorUrl(returnUrl?)`              | A one-time URL that logs a browser in and lands on `returnUrl`.                                                                            |
| `testEnvironment.buildExperienceFrontdoorUrl(prefix?, ret?)` | One-time single-access login URL for Experience Cloud sites.                                                                               |
| `testEnvironment.getOrgId()`                                 | Dynamically queries the 15- or 18-character Salesforce Organization ID.                                                                    |
| `testEnvironment.getUserIdByUsername(username)`              | Resolves a target username to its Salesforce User record ID.                                                                               |
| `testEnvironment.getNetworkIdByPrefix(prefix?)`              | Resolves an Experience site prefix to its corresponding Network ID.                                                                        |
| `testEnvironment.buildExperienceUrl(prefix?, path?)`         | Constructs a fully qualified secure Experience Cloud site URL.                                                                             |
| `getTestEnvironment(options?)`                               | Retrieves the global singleton `TestEnvironment` instance.                                                                                 |
| `setTestEnvironment(instance)`                               | Overrides the global `TestEnvironment` singleton.                                                                                          |
| `resetTestEnvironment()`                                     | Resets and unsets the global `TestEnvironment` singleton.                                                                                  |
| `isHostAllowed(host, instanceUrl?, allowedDomains?)`         | Validates a hostname against Salesforce default patterns and custom overrides.                                                             |
| `validateAndParseSecureUrl(secureUrl, siteId, validator?)`   | Validates and parses a raw secure URL retrieved from SiteDetail.                                                                           |
| `DEFAULT_ALLOWED_HOST_PATTERNS`                              | Default trusted Salesforce domain RegExp matchers.                                                                                         |
| `USERNAME_ENV`                                               | `'UTAM_USERNAME'`.                                                                                                                         |
| `TestEnvironmentOptions`, `EnvLike`                          | Types for the constructor options and an environment-shaped map.                                                                           |

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
| `goToRelatedList`, `resolveBrowser`                                   | Standalone helper to open related list and resolve browser instance.                              |
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

| Export                                            | Description                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `discoverProject(rootDir?)`                       | Discovers `sfdx-project.json`, package directories, namespaces, and LWC components. |
| `findLwcDirectories(dirPath)`                     | Recursively locates directories named `lwc`.                                        |
| `discoverComponentsInPackageDir(pkgDir, rootDir)` | Finds all LWC components and metadata inside a given package directory.             |

### `.forceignore` Management

| Export                                                                          | Description                                                                                         |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ensureForceignore(options?)`                                                   | Adds missing UTAM rules to a project's `.forceignore`, creating it when `sfdx-project.json` exists. |
| `mergeForceignore(content, options?)`                                           | Pure merge of missing rules into `.forceignore` content; never changes an existing line.            |
| `resolveUtamTestIgnoreRules(testDirs, packageDirs)`                             | Rules for UTAM test folders that sit inside a package directory, relative to the project root.      |
| `SIMPLY_UTAM_FORCEIGNORE_RULES`                                                 | The rules for UTAM artifacts in LWC bundles, with the existing patterns accepted as covering each.  |
| `FORCEIGNORE_HEADER`, `FORCEIGNORE_FILE`                                        | The `# Ignore UTAM` comment that heads our rules, and the `.forceignore` file name.                 |
| `DEFAULT_FORCEIGNORE_REGION`                                                    | Default `# -- START CUSTOMIZATION` / `# -- END CUSTOMIZATION` region markers.                       |
| `ForceignoreRule`, `ForceignoreResult`, `ForceignorePlacement`                  | Types: a rule, what happened to the file, and where rules were written.                             |
| `MergeForceignoreOptions`, `MergeForceignoreResult`, `EnsureForceignoreOptions` | Option and result types for the functions above.                                                    |

### `.gitignore` Management

| Export                                                               | Description                                                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ensureGitignore(options?)`                                          | Adds `.utam/snapshots/` to a project's `.gitignore` under a `# Ignore UTAM` comment, creating the file when it's missing. |
| `mergeGitignore(content, options?)`                                  | Pure merge of missing rules into `.gitignore` content; never changes an existing line. Shares `.forceignore`'s merge.     |
| `SIMPLY_UTAM_GITIGNORE_RULES`, `GITIGNORE_FILE`                      | The rule (an existing `.utam/` rule counts as covering it), and the `.gitignore` file name.                               |
| `GitignoreResult`, `MergeGitignoreOptions`, `EnsureGitignoreOptions` | Result and option types for the functions above.                                                                          |

### Rules Generation

| Export                                     | Description                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `generateLwcRules(options?)`               | Scans LWC components and generates or updates `<component>.rules.json` files. |
| `convertLwcNameToHtml(componentName, ns?)` | Converts component name to kebab-case HTML tag with namespace prefix.         |
| `getTargetsFromMeta(xmlContent)`           | Extracts targets from `<targets>` in a `*.js-meta.xml` file.                  |
| `ROOT_TARGETS`                             | Target page names that designate an LWC as a root component.                  |

### Overrides Merger

| Export                            | Description                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `applyUtamOverrides(options?)`    | Deep merges `*.utam-overrides.json` definitions into generated `*.utam.json` files. |
| `findUtamOverridesFiles(dirPath)` | Locates all `*.utam-overrides.json` files in a directory tree.                      |
| `detectIndentation(content)`      | Detects indentation formatting of a JSON file (2 spaces, 4 spaces, or tabs).        |
| `mergeElements(target, source)`   | Deep merges override properties into a target AST node.                             |
| `walkElements(node, callback)`    | Traverses AST nodes across root elements, nested elements, and shadow DOM roots.    |

### Namespace Rewriting

| Export                                      | Description                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `rewriteUtamNamespaces(options?)`           | Rewrites namespace prefixes across `*.utam.json` files according to mapping config. |
| `findUtamJsonFiles(dirPath)`                | Locates all `*.utam.json` schema files in a directory tree.                         |
| `updateValueWithMappings(value, map, list)` | Replaces namespace prefixes in AST values based on longest-match sorting.           |

### Step Scaffolding Engine

| Export                                        | Description                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `generateCucumberSteps(options?)`             | Scans Gherkin features, compiles existing step expressions, and scaffolds skeletons. |
| `parseGherkinDocument(content)`               | Parses Gherkin source text into an AST document representation.                      |
| `extractStepsFromGherkin(content, path?)`     | Extracts all scenario and background steps, normalizing And/But keywords.            |
| `extractStepExpressionsFromContent(content)`  | Statically extracts registered step expressions from definition code.                |
| `compileStepExpressions(raw, registry?)`      | Compiles string and RegExp expressions using `@cucumber/cucumber-expressions`.       |
| `matchStepAgainstExpressions(stepText, list)` | Matches a feature step text against compiled expressions.                            |
| `generateStepSnippet(step, registry?)`        | Generates an idiomatic async step snippet with Cucumber expressions.                 |
| `formatParameterNames(names, table?, doc?)`   | Formats parameter names to eliminate collisions and add dataTable/docString.         |
| `formatCode(code)`                            | Formats generated TypeScript / JavaScript code using Prettier.                       |
| `resolveGlobs(patterns, rootDir)`             | Resolves one or more glob patterns or file paths.                                    |

### Project Scaffolding

| Export                                                       | Description                                                                                          |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `scaffoldProject(options?)`                                  | Scaffolds configuration files, template files, Wireit tasks, and `.forceignore` rules.               |
| `injectWireitConfiguration(packageJson, dir)`                | Injects standard UTAM Wireit scripts and tasks non-destructively into package.json.                  |
| `checkMissingDependencies(pkg, required?)`                   | Detects missing recommended devDependencies.                                                         |
| `loadTemplate(name, dir?, tokens?)`                          | Loads an external scaffold template, performing `{{token}}` replacements.                            |
| `generateGeneratorConfig(sourceDir, appName)`                | Generates parsed `generator.config.json` content.                                                    |
| `generateUtamConfig(templatesDir?)`                          | Generates parsed `utam.config.json` content.                                                         |
| `generateWdioConfig(sourceDir, dir?)`                        | Generates formatted `wdio.conf.mjs` content.                                                         |
| `generateNamespaceMap(appName, dir?)`                        | Generates parsed `namespace-map.json` content.                                                       |
| `generateHelloFeature(dir?)`                                 | Generates formatted `hello.feature` starter smoke test content.                                      |
| `generateHelloSteps(dir?)`                                   | Generates formatted `hello.steps.mjs` starter step definition content.                               |
| `generateSnapshotGuide(dir?)`, `generateSnapshotSteps(dir?)` | Generates the DOM snapshot usage guide (`SNAPSHOTS.md`) and capture step (`dom-snapshot.steps.mjs`). |
| `DEFAULT_TEMPLATES_DIR`                                      | Path to starter config templates directory.                                                          |
| `DEFAULT_REQUIRED_DEV_DEPENDENCIES`                          | List of standard recommended UTAM devDependencies.                                                   |

### DOM Snapshots

Capture a shadow-aware, masked snapshot of the page a WebdriverIO test is on, write it under
`.utam/snapshots/`, and query it and the page-object index. Each query returns `{ lines, json }`:
text to print, capped at an output limit, and the same answer as data. `init` scaffolds a usage
guide for people and agents, [`SNAPSHOTS.md`](templates/SNAPSHOTS.md), into the project's UTAM test
folder. See [design 0003](../../docs/design/0003-dom-snapshots.md).

| Export                                                                                                             | Description                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `captureDomSnapshot(options?)`                                                                                     | Runs the walker in the page through `browser.execute` (the global `browser` by default) or any `SnapshotPage`, and returns the snapshot. Never throws: on a failure it logs a warning through `log` and returns `undefined`.             |
| `writeDomSnapshot(snapshot, options?)`                                                                             | Writes the snapshot to `.utam/snapshots/<run id>/<name>.json` and a copy to `latest.json`, replaced through a rename; returns the path. The run id comes from `UTAM_SNAPSHOT_RUN_ID`.                                                    |
| `pruneDomSnapshots(options?)`                                                                                      | Deletes all but the newest `keepRuns` run folders (default 10); returns the folders deleted. Run ids must sort in time order; numbers in them compare as numbers (`build-9` before `build-10`).                                          |
| `snapshotRunId(date?)`                                                                                             | A run id for `UTAM_SNAPSHOT_RUN_ID`: the time (now by default) as `20261016T120000`. The scaffolded `onPrepare` hook sets it.                                                                                                            |
| `readDomSnapshot(file)`, `parseDomSnapshot(json)`                                                                  | Reads or parses a snapshot, checks its `format` and `version`, and numbers its node handles (`n1`, `n2`, …). Throws `DomSnapshotError` otherwise.                                                                                        |
| `serializeDomSnapshot(snapshot)`                                                                                   | The snapshot as file JSON: node addresses, without the handles added on read.                                                                                                                                                            |
| `findNodes(snapshot, options)`                                                                                     | Nodes matching text, an attribute, a tag or a class, visible first; or with `css`, a CSS selector as UTAM's `findElement` runs it, in document order, the first marked, in the document or `within` a node's light DOM or `shadow` root. |
| `querySnapshot(snapshot, selector, scope?)`                                                                        | The nodes a CSS selector matches in a scope, in document order, as data, with notes on what the snapshot can't judge, such as names on pruned wrappers.                                                                                  |
| `componentPath(snapshot, handle, options?)`, `componentPathByText(snapshot, text, options?)`                       | The custom elements from the document down to a node, annotated from the page-object index: page objects, routes, root selector and scope warnings.                                                                                      |
| `subtree(snapshot, handle?, options?)`                                                                             | The tree under a node to a depth, shadow root first, then light DOM.                                                                                                                                                                     |
| `nodeDetails(snapshot, handle, options?)`, `nodeAncestors(snapshot, handle, options?)`                             | One node in full; or its ancestors, nearest first, with each shadow crossing.                                                                                                                                                            |
| `utamErrorHint(snapshot, index?)`, `snapshotHeader(snapshot, options?)`                                            | For UTAM's not-found error, the `find --css` that repeats its search; and the header every snapshot command prints.                                                                                                                      |
| `buildPageObjectIndex(options?)`                                                                                   | Indexes the installed `salesforce-pageobjects` and the project's own page objects (from `utam.config.json`) by the tags they cover. Missing sources become warnings.                                                                     |
| `lookupPageObject(index, query, options?)`                                                                         | The page objects for a tag, or one page object by name, import path or short name: import path, methods with what they do, and public and private elements.                                                                              |
| `searchPageObjects(index, words, options?)`                                                                        | Page objects whose name, import path, tags or description contain every word, name matches first.                                                                                                                                        |
| `DomSnapshotError`                                                                                                 | Thrown for input that isn't a snapshot this version can read.                                                                                                                                                                            |
| `DOM_SNAPSHOT_FORMAT`, `DOM_SNAPSHOT_VERSION`                                                                      | `'simply-utam-dom-snapshot'`, `1`.                                                                                                                                                                                                       |
| `LATEST_SNAPSHOT`, `DEFAULT_OUTPUT_LIMIT`                                                                          | `'.utam/snapshots/latest.json'`, and `200`, the default text output limit in lines.                                                                                                                                                      |
| `SNAPSHOT_MASK_ENV`, `SNAPSHOT_RUN_ID_ENV`                                                                         | `'UTAM_SNAPSHOT_MASK'` (`labels`, `structure` or `full`), `'UTAM_SNAPSHOT_RUN_ID'`. Read through each function's `env` option.                                                                                                           |
| `DomSnapshot`, `DomNode`, `DomSnapshotMeta`                                                                        | Types: a snapshot, one element in it, and its metadata.                                                                                                                                                                                  |
| `ShadowMode`, `SnapshotMask`, `SnapshotTrigger`                                                                    | Types: `native`, `synthetic`, `unknown` or `unreadable`; the mask mode; `failure`, `step` or `manual`.                                                                                                                                   |
| `SnapshotBrowser`, `SnapshotPage`, `SnapshotFileSystem`                                                            | Structural types: what capture needs of a browser, any other way to run the walker, and the file system calls (`mkdir`, `writeFile`, `readdir`, `rm`, `rename`).                                                                         |
| `PageObjectIndex`, `PageObjectEntry`, `PageObjectElement`                                                          | Types: the index, one page object, and one of its elements.                                                                                                                                                                              |
| `PageObjectMethod`, `PageObjectArg`, `PageObjectMatch`                                                             | Types: a method with its parameters and `compose` summary, a parameter, and why a query matched a page object.                                                                                                                           |
| `FindOptions`, `FindResult`, `FoundNode`, `SelectorScope`, `SelectorMatches`                                       | Option and result types for `find` and the selector check.                                                                                                                                                                               |
| `PathOptions`, `PathResult`, `PathByTextResult`, `PathStep`, `PathAnnotation`, `ReachableThrough`, `ScopeMismatch` | Option and result types for `path`.                                                                                                                                                                                                      |
| `SubtreeOptions`, `NodeDetails`, `AncestorLine`, `AncestorsResult`, `UtamErrorHint`, `SnapshotHeaderOptions`       | Option and result types for `tree`, `node` and the header.                                                                                                                                                                               |
| `LookupResult`, `SearchResult`, `SearchResultLine`, `QueryResult`                                                  | Result types for the queries above.                                                                                                                                                                                                      |
| `CaptureDomSnapshotOptions`, `WriteDomSnapshotOptions`, `PruneDomSnapshotsOptions`                                 | Option types for capture and files.                                                                                                                                                                                                      |
| `BuildPageObjectIndexOptions`, `QueryOutputOptions`                                                                | Option types for the index and its queries.                                                                                                                                                                                              |

WebdriverIO and UTAM are not dependencies: the browser and UTAM objects are typed structurally, so
the package works with whichever versions your test project already uses.

## Issues

Please report any issues at https://github.com/SimplySF/simply-utam/issues

## Contributing

This package is part of the [`simply-utam`](https://github.com/SimplySF/simply-utam) monorepo. See [CONTRIBUTING.md](CONTRIBUTING.md) for what's specific to this package, and the repo's [root CONTRIBUTING.md](https://github.com/SimplySF/simply-utam/blob/main/CONTRIBUTING.md) for repo structure, setup, commit conventions, and how to submit a pull request. Please also read our [Code of Conduct](https://github.com/SimplySF/simply-utam/blob/main/CODE_OF_CONDUCT.md).

## License

Licensed under the [Apache-2.0](https://raw.githubusercontent.com/SimplySF/simply-utam/main/LICENSE.txt) license.
