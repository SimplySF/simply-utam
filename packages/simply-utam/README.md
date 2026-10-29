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

- `simply-utam init`: Scaffolds starter UTAM configs (`generator.config.json`, `utam.config.json`, `wdio.conf.mjs`, `.utam/namespace-map.json`) and the DOM snapshot capture step (`step_definitions/dom-snapshot.steps.mjs`) in the UTAM test folder, adds `.utam/snapshots/` to `.gitignore` (`--no-gitignore` to skip), non-destructively injects standard Wireit tasks into `package.json`, and adds any missing UTAM rules to `.forceignore` under a `# Ignore UTAM` comment so LWC bundles that contain UTAM files deploy successfully. Existing lines are never changed; new rules go inside the `# -- START CUSTOMIZATION` / `# -- END CUSTOMIZATION` region when one exists (`--forceignore-region-start` / `--forceignore-region-end` to change the markers, `--no-forceignore` to skip). The UTAM namespace is the `package.json` name, scope included, so page objects can import each other by the package's own name (`--app-name` to override). It also adds `"./pageObjects/*": "./pageObjects/*.js"` to `package.json` `exports`, which those imports resolve through; an existing entry is never changed.
- `simply-utam rules`: Scans LWC component definitions and generates or updates UTAM `.rules.json` files for root components. A component with no `<component>.html` template, such as a datatable with only custom type templates, is skipped, and a rules file left from an earlier run is kept and listed with `--verbose`. It warns when another template in the bundle (`orders.html` in `ordersTable`) could take the rules file, since the UTAM generator pairs rules files with templates by name prefix.
- `simply-utam overrides`: Deeply merges custom element assertions, wait conditions, and visibility rules from `*.utam-overrides.json` into generated `*.utam.json` files while preserving file indentation.
- `simply-utam names`: Renames the page objects generated from an LWC bundle's secondary templates (every template not named after the bundle, such as a datatable's custom type templates) to `<bundle><Template>`, so same-named templates in different bundles stop overwriting each other in the compiler's single output folder. Runs after `overrides`, so overrides files keep the template's own name. Fails, renaming nothing, when a new name would match another page object the compiler reads. See [Secondary template page objects](#secondary-template-page-objects).
- `simply-utam rewrite`: Rewrites namespace prefixes across compiled `*.utam.json` files according to `.utam/namespace-map.json`.
- `simply-utam steps`: Statically analyzes Gherkin `.feature` files, compiles existing step expressions, detects true undefined steps, and appends formatted Cucumber expressions into target step files.
- `simply-utam build`: Convenience runner executing all compilation and transformation stages sequentially (`rules -> utam-generate -> overrides -> names -> rewrite -> utam`). `--skip-names` leaves out the `names` stage.
- `simply-utam snapshot find`: Finds nodes in a DOM snapshot by `--text`, `--attr`, `--tag` or `--class`, visible matches first; or tests a CSS selector with `--css` as UTAM's `findElement` runs it, in the document or `--within` a node's light DOM or, with `--shadow`, its shadow root. `--all` lists hidden matches in full.
- `simply-utam snapshot path`: Shows the custom elements from the document down to a node (`--node` or `--text`), with each shadow crossing, the page object for each element, the route to it from the page object above, and warnings for a root selector that loads a hidden copy or an element declared in the wrong scope. Exits 1 when `--text` doesn't find exactly one visible node.
- `simply-utam snapshot tree`: Prints the tree under a node (`--node`, `--depth`), shadow root first, then light DOM.
- `simply-utam snapshot node`: Shows one node in full, or with `--ancestors`, its ancestors nearest first.
- Every `snapshot` command but `lookup` reads `.utam/snapshots/latest.json` (or `--file`) and prints a header naming it, with a failed step's error and, for UTAM's not-found error, the `find --css` that repeats its search. All take `--json`, `--limit` and `--project-dir`, and exit 2 on bad input.
- `simply-utam snapshot console snippet`: Prints the snippet to paste into a browser's DevTools console to capture a DOM snapshot of any page, with no test run, or copies it with `--copy`. `--mask` (`structure`, `labels`, `aria` or `full`) fixes the mask mode in the snippet. The snippet copies the masked snapshot to the clipboard, or downloads it where the console's `copy` isn't available.
- `simply-utam snapshot console import`: Saves the snapshot the snippet copied (or `--file <path>`, `--file -` for standard input) to `.utam/snapshots/manual/` and `latest.json`, with an optional `--label`, and prints its header. Exits 2 on bad input.
- `simply-utam snapshot lookup`: Shows the page objects for a custom element tag or a page object name, from the project's own page objects and the page-object packages its namespaces map to (`salesforce-pageobjects` through the scaffolded `lightning` namespace): import path, methods and what they do, and public and private elements with their light or shadow scope. `--search <words>` finds page objects by name, tag or description. Needs no snapshot. Takes `--json`, `--limit` and `--project-dir`. See [design 0003](../../docs/design/0003-dom-snapshots.md).

## DOM snapshots in an existing project

`init` writes `wdio.conf.mjs` only when it doesn't exist yet, so an existing project's configuration
doesn't capture DOM snapshots until you add the hooks. Merge these into your `config`, keeping any
hooks you already have (`afterStep` most likely also takes a screenshot):

```js
import allureReporter from '@wdio/allure-reporter';

// Imported here rather than with a static import, so a project whose @simplysf/simply-utam predates
// DOM snapshots still loads this config: the snapshot hooks then skip, and onPrepare says to upgrade.
const snapshots = await loadSnapshotApi();

async function loadSnapshotApi() {
  const api = await import('@simplysf/simply-utam');
  const names = [
    'captureDomSnapshot',
    'pruneDomSnapshots',
    'serializeDomSnapshot',
    'snapshotRunId',
    'writeDomSnapshot',
  ];
  return names.every((name) => typeof api[name] === 'function') ? api : undefined;
}

export const config = {
  // …
  onPrepare: async function () {
    if (!snapshots) {
      console.warn(
        'The installed @simplysf/simply-utam has no DOM snapshots, so none are captured. Upgrade it in package.json to capture them.',
      );
      return;
    }
    // One DOM snapshot folder per test run, shared by every worker.
    process.env.UTAM_SNAPSHOT_RUN_ID ??= snapshots.snapshotRunId();
  },
  onComplete: async function () {
    if (!snapshots) return;
    // Keep the last 10 runs, this one included. Housekeeping must never cost the run: on Windows a
    // locked old run folder can't be deleted.
    try {
      await snapshots.pruneDomSnapshots({ keepRuns: 10 });
    } catch (pruneError) {
      console.warn(`Old DOM snapshot runs not pruned: ${pruneError?.message ?? pruneError}`);
    }
  },
  before: async function () {
    if (!snapshots) return;
    // browser.domSnapshot('label') captures the page from the REPL during browser.debug().
    browser.addCommand('domSnapshot', async (label) => {
      const snapshot = await snapshots.captureDomSnapshot({ trigger: 'manual', label });
      return snapshot ? snapshots.writeDomSnapshot(snapshot) : undefined;
    });
  },
  afterStep: async function (step, scenario, { error }) {
    if (error) {
      // Capture the DOM snapshot first, before anything else changes the page.
      const snapshot = await snapshots?.captureDomSnapshot({
        trigger: 'failure',
        scenario: scenario.name,
        step: step.text,
        error,
      });
      if (snapshot) {
        // Saving and attaching each get their own try: neither failing may cost the other, or the
        // screenshot below.
        try {
          console.log(`DOM snapshot written to ${await snapshots.writeDomSnapshot(snapshot)}`);
        } catch (writeError) {
          console.warn(`DOM snapshot not saved: ${writeError?.message ?? writeError}`);
        }
        try {
          allureReporter.addAttachment(
            'dom-snapshot.json',
            snapshots.serializeDomSnapshot(snapshot),
            'application/json',
          );
        } catch (attachError) {
          console.warn(`DOM snapshot not attached to the Allure report: ${attachError?.message ?? attachError}`);
        }
      }
      await browser.takeScreenshot();
    }
  },
};
```

Also set `cucumberOpts.timeout` above `waitforTimeout` (the scaffold adds 30 seconds), so a step that
waits for a missing element fails with UTAM's error, which names the locator, rather than only
Cucumber's timeout. `init` adds the capture step to an existing project's UTAM test folder, since
it's a new file. For the guide, install the [`utam-dom-snapshots` skill](#agent-skills).

## Agent skills

The package ships agent skills for working with simply-utam in your project: guides that a coding
agent (or a person) follows to use its commands. Each is a folder under `skills/`, with a `SKILL.md`
whose frontmatter tells an agent when to load it. None is installed for you; add the ones you want.

| Skill                                                      | Use it when                                                                                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [`utam-dom-snapshots`](skills/utam-dom-snapshots/SKILL.md) | Writing or fixing a UTAM step definition, page object or selector: capturing DOM snapshots, querying them, and looking up page objects. |

Link a skill into your agent's skills folder, so it stays in step with the installed version of
simply-utam. For Claude Code, from the project folder:

```bash
mkdir -p .claude/skills
ln -s ../../node_modules/@simplysf/simply-utam/skills/utam-dom-snapshots .claude/skills/utam-dom-snapshots
```

Or copy the folder instead, to edit it; a copy doesn't change when you upgrade simply-utam, so
copy it again after an upgrade. Other agents read skills from their own folders; link or copy the
skill there the same way.

## Usage & Wireit Integration

In a Salesforce test project:

```json
{
  "scripts": {
    "build:utam-rules": "wireit",
    "build:utam-generate": "wireit",
    "build:utam-overrides": "wireit",
    "build:utam-names": "wireit",
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
    "build:utam-names": {
      "command": "simply-utam names",
      "dependencies": ["build:utam-overrides"]
    },
    "build:utam-rewrite-namespaces": {
      "command": "simply-utam rewrite -c .utam/namespace-map.json",
      "dependencies": ["build:utam-names"]
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

## Secondary template page objects

`utam-generate` makes a page object for every template and names it after the HTML file, and the UTAM
compiler writes every page object to one folder. So when two components have a template of the same
name, as datatables with custom types usually do (`picklistTemplate.html` in every table), one page
object silently overwrites the other. The `names` stage renames each secondary template's page objects
to `<component><Template>`:

| Template                            | Page object                   |
| ----------------------------------- | ----------------------------- |
| `component_1/component_1.html`      | `component_1` (unchanged)     |
| `component_1/fooTemplate.html`      | `component_1FooTemplate`      |
| `ordersTable/picklistTemplate.html` | `ordersTablePicklistTemplate` |
| `casesTable/picklistTemplate.html`  | `casesTablePicklistTemplate`  |

`simply-utam build` runs it. A project scaffolded before the stage existed runs it from Wireit by adding
the task and pointing the rewrite task at it, keeping its own rewrite command:

```json
{
  "scripts": { "build:utam-names": "wireit" },
  "wireit": {
    "build:utam-names": {
      "command": "simply-utam names",
      "dependencies": ["build:utam-overrides"]
    },
    "build:utam-rewrite-namespaces": {
      "command": "simply-utam rewrite -c .utam/namespace-map.json",
      "dependencies": ["build:utam-names"]
    }
  }
}
```

To keep the generated names, leave the task out or run `simply-utam build --skip-names`. Same-named
templates then overwrite each other again.

## Re-exports

`@simplysf/simply-utam` re-exports the entire `@simplysf/simply-utam-core` programmatic API (`TestEnvironment`, `LightningNavigator`, `goToExperiencePage`, `loginAsUser`, `logUtamHtml`, etc.) so consumers can optionally install only `@simplysf/simply-utam`.

## License

Licensed under the [Apache-2.0](https://raw.githubusercontent.com/SimplySF/simply-utam/main/LICENSE.txt) license.
