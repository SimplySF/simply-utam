# @simplysf/simply-utam

[![NPM](https://img.shields.io/npm/v/@simplysf/simply-utam?label=@simplysf/simply-utam)](https://npmjs.com/@simplysf/simply-utam) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://raw.githubusercontent.com/SimplySF/simply-utam/main/LICENSE.txt)

Salesforce UTAM UI testing and build automation CLI, built by [SimplySF](https://github.com/SimplySF).

The `simply-utam` CLI automates Salesforce UI testing build pipelines: scanning LWC definitions for root components, generating `.rules.json` files, merging deep JSON overrides into compiled UTAM page objects, rewriting namespace prefixes across packages, and scaffolding missing Cucumber step definitions.

## Installation

```bash
npm install --save-dev @simplysf/simply-utam
```

Requires Node.js 22 or later.

## Commands

- `simply-utam init`: Scaffolds starter UTAM configs (`generator.config.json`, `utam.config.json`, `wdio.conf.mjs`, `.utam/namespace-map.json`) and the DOM snapshot guide and capture step (`SNAPSHOTS.md`, `step_definitions/dom-snapshot.steps.mjs`) in the UTAM test folder, adds `.utam/snapshots/` to `.gitignore` (`--no-gitignore` to skip), non-destructively injects standard Wireit tasks into `package.json`, and adds any missing UTAM rules to `.forceignore` under a `# Ignore UTAM` comment so LWC bundles that contain UTAM files deploy successfully. Existing lines are never changed; new rules go inside the `# -- START CUSTOMIZATION` / `# -- END CUSTOMIZATION` region when one exists (`--forceignore-region-start` / `--forceignore-region-end` to change the markers, `--no-forceignore` to skip).
- `simply-utam rules`: Scans LWC component definitions and generates or updates UTAM `.rules.json` files for root components.
- `simply-utam overrides`: Deeply merges custom element assertions, wait conditions, and visibility rules from `*.utam-overrides.json` into generated `*.utam.json` files while preserving file indentation.
- `simply-utam rewrite`: Rewrites namespace prefixes across compiled `*.utam.json` files according to `.utam/namespace-map.json`.
- `simply-utam steps`: Statically analyzes Gherkin `.feature` files, compiles existing step expressions, detects true undefined steps, and appends formatted Cucumber expressions into target step files.
- `simply-utam build`: Convenience runner executing all compilation and transformation stages sequentially (`rules -> utam-generate -> overrides -> rewrite -> utam`).
- `simply-utam snapshot find`: Finds nodes in a DOM snapshot by `--text`, `--attr`, `--tag` or `--class`, visible matches first; or tests a CSS selector with `--css` as UTAM's `findElement` runs it, in the document or `--within` a node's light DOM or, with `--shadow`, its shadow root. `--all` lists hidden matches in full.
- `simply-utam snapshot path`: Shows the custom elements from the document down to a node (`--node` or `--text`), with each shadow crossing, the page object for each element, the route to it from the page object above, and warnings for a root selector that loads a hidden copy or an element declared in the wrong scope. Exits 1 when `--text` doesn't find exactly one visible node.
- `simply-utam snapshot tree`: Prints the tree under a node (`--node`, `--depth`), shadow root first, then light DOM.
- `simply-utam snapshot node`: Shows one node in full, or with `--ancestors`, its ancestors nearest first.
- Every `snapshot` command but `lookup` reads `.utam/snapshots/latest.json` (or `--file`) and prints a header naming it, with a failed step's error and, for UTAM's not-found error, the `find --css` that repeats its search. All take `--json`, `--limit` and `--project-dir`, and exit 2 on bad input.
- `simply-utam snapshot console snippet`: Prints the snippet to paste into a browser's DevTools console to capture a DOM snapshot of any page, with no test run, or copies it with `--copy`. `--mask` fixes the mask mode in the snippet. The snippet copies the masked snapshot to the clipboard, or downloads it where the console's `copy` isn't available.
- `simply-utam snapshot console import`: Saves the snapshot the snippet copied (or `--file <path>`, `--file -` for standard input) to `.utam/snapshots/manual/` and `latest.json`, with an optional `--label`, and prints its header. Exits 2 on bad input.
- `simply-utam snapshot lookup`: Shows the page objects for a custom element tag or a page object name, from `salesforce-pageobjects` and the project's own page objects: import path, methods and what they do, and public and private elements with their light or shadow scope. `--search <words>` finds page objects by name, tag or description. Needs no snapshot. Takes `--json`, `--limit` and `--project-dir`. See [design 0003](../../docs/design/0003-dom-snapshots.md).

## DOM snapshots in an existing project

`init` writes `wdio.conf.mjs` only when it doesn't exist yet, so an existing project's configuration
doesn't capture DOM snapshots until you add the hooks. Merge these into your `config`, keeping any
hooks you already have (`afterStep` most likely also takes a screenshot):

```js
import allureReporter from '@wdio/allure-reporter';
import {
  captureDomSnapshot,
  pruneDomSnapshots,
  serializeDomSnapshot,
  snapshotRunId,
  writeDomSnapshot,
} from '@simplysf/simply-utam';

export const config = {
  // …
  onPrepare: async function () {
    // One DOM snapshot folder per test run, shared by every worker; keep the last 10 runs.
    process.env.UTAM_SNAPSHOT_RUN_ID ??= snapshotRunId();
    await pruneDomSnapshots({ keepRuns: 10 });
  },
  before: async function () {
    // browser.domSnapshot('label') captures the page from the REPL during browser.debug().
    browser.addCommand('domSnapshot', async (label) => {
      const snapshot = await captureDomSnapshot({ trigger: 'manual', label });
      return snapshot ? writeDomSnapshot(snapshot) : undefined;
    });
  },
  afterStep: async function (step, scenario, { error }) {
    if (error) {
      // Capture the DOM snapshot first, before anything else changes the page.
      const snapshot = await captureDomSnapshot({
        trigger: 'failure',
        scenario: scenario.name,
        step: step.text,
        error,
      });
      if (snapshot) {
        try {
          allureReporter.addAttachment('dom-snapshot.json', serializeDomSnapshot(snapshot), 'application/json');
          console.log(`DOM snapshot written to ${await writeDomSnapshot(snapshot)}`);
        } catch (writeError) {
          // A snapshot that can't be saved mustn't cost the screenshot below.
          console.warn(`DOM snapshot not saved: ${writeError?.message ?? writeError}`);
        }
      }
      await browser.takeScreenshot();
    }
  },
};
```

Also set `cucumberOpts.timeout` above `waitforTimeout` (the scaffold adds 30 seconds), so a step that
waits for a missing element fails with UTAM's error, which names the locator, rather than only
Cucumber's timeout. `init` adds the guide and the capture step to an existing project's UTAM test
folder, since they're new files.

## Usage & Wireit Integration

In a Salesforce test project:

```json
{
  "scripts": {
    "build:utam-rules": "wireit",
    "build:utam-generate": "wireit",
    "build:utam-overrides": "wireit",
    "build:utam-rewrite-namespaces": "wireit",
    "build:utam": "wireit",
    "test:ui": "wireit"
  },
  "wireit": {
    "build:utam-rules": {
      "command": "simply-utam rules"
    },
    "build:utam-generate": {
      "command": "utam-generate -c generator.config.json",
      "dependencies": ["build:utam-rules"]
    },
    "build:utam-overrides": {
      "command": "simply-utam overrides",
      "dependencies": ["build:utam-generate"]
    },
    "build:utam-rewrite-namespaces": {
      "command": "simply-utam rewrite -c .utam/namespace-map.json",
      "dependencies": ["build:utam-overrides"]
    },
    "build:utam": {
      "command": "utam -c utam.config.json",
      "files": ["**/__utam__/**/*.utam.json", "**/__utam__/**/*.utam.js"],
      "output": ["pageObjects"],
      "dependencies": ["build:utam-rewrite-namespaces"]
    },
    "test:ui": {
      "command": "wdio run wdio.conf.mjs",
      "dependencies": ["build:utam"]
    }
  }
}
```

## Re-exports

`@simplysf/simply-utam` re-exports the entire `@simplysf/simply-utam-core` programmatic API (`TestEnvironment`, `LightningNavigator`, `goToExperiencePage`, `loginAsUser`, `logUtamHtml`, etc.) so consumers can optionally install only `@simplysf/simply-utam`.

## License

Licensed under the [Apache-2.0](https://raw.githubusercontent.com/SimplySF/simply-utam/main/LICENSE.txt) license.
