# @simplysf/simply-utam-core

[![NPM](https://img.shields.io/npm/v/@simplysf/simply-utam-core?label=@simplysf/simply-utam-core)](https://npmjs.com/@simplysf/simply-utam-core) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://raw.githubusercontent.com/SimplySF/simply-utam/main/LICENSE.txt)

Org authentication, Lightning navigation, and debugging helpers for
[UTAM](https://utam.dev/) UI tests against Salesforce, built by [SimplySF](https://github.com/SimplySF).

It logs the test browser in to an org you have already authorized with the Salesforce CLI — no
passwords in the test project — and opens Lightning pages directly, so a test starts on the page it
is about instead of clicking its way there.

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

### Org authentication

| Export                                          | Description                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `TestEnvironment`                               | The org under test. `new TestEnvironment({ username?, env? })` throws when neither a username nor `UTAM_USERNAME` is set. |
| `testEnvironment.getOrg()`                      | The authenticated `Org`. Authenticates on first call and shares the result; a failure is not cached.                      |
| `testEnvironment.init()`                        | Authenticates eagerly, for a runner hook that wants auth failures reported before any test starts. Optional.              |
| `testEnvironment.buildFrontdoorUrl(returnUrl?)` | A one-time URL that logs a browser in and lands on `returnUrl`.                                                           |
| `USERNAME_ENV`                                  | `'UTAM_USERNAME'`.                                                                                                        |
| `TestEnvironmentOptions`, `EnvLike`             | Types for the constructor options and an environment-shaped map.                                                          |

### Navigation

| Export                                                                | Description                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `LightningNavigator`                                                  | `new LightningNavigator({ environment?, browser? })`; every method logs in and opens a page.      |
| `navigator.goToLoginUrl(returnUrl?)`                                  | Log in and open any path, or the org's default landing page.                                      |
| `navigator.goToApplication(app)`                                      | An app's home page.                                                                               |
| `navigator.goToCreateNewRecord(app, objectApiName)`                   | An object's new-record form.                                                                      |
| `navigator.goToRecord(app, recordId)`                                 | A record's detail page.                                                                           |
| `navigator.goToRelatedList(app, recordId, relatedListName)`           | One of a record's related lists.                                                                  |
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

WebdriverIO and UTAM are not dependencies: the browser and UTAM objects are typed structurally, so
the package works with whichever versions your test project already uses.

## Issues

Please report any issues at https://github.com/SimplySF/simply-utam/issues

## Contributing

This package is part of the [`simply-utam`](https://github.com/SimplySF/simply-utam) monorepo. See [CONTRIBUTING.md](CONTRIBUTING.md) for what's specific to this package, and the repo's [root CONTRIBUTING.md](https://github.com/SimplySF/simply-utam/blob/main/CONTRIBUTING.md) for repo structure, setup, commit conventions, and how to submit a pull request. Please also read our [Code of Conduct](https://github.com/SimplySF/simply-utam/blob/main/CODE_OF_CONDUCT.md).

## License

Licensed under the [Apache-2.0](https://raw.githubusercontent.com/SimplySF/simply-utam/main/LICENSE.txt) license.
