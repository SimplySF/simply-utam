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

- `simply-utam init`: Scaffolds starter UTAM configs (`generator.config.json`, `utam.config.json`, `wdio.conf.mjs`, `.utam/namespace-map.json`) and non-destructively injects standard Wireit tasks into `package.json`.
- `simply-utam rules`: Scans LWC component definitions and generates or updates UTAM `.rules.json` files for root components.
- `simply-utam overrides`: Deeply merges custom element assertions, wait conditions, and visibility rules from `*.utam-overrides.json` into generated `*.utam.json` files while preserving file indentation.
- `simply-utam rewrite`: Rewrites namespace prefixes across compiled `*.utam.json` files according to `.utam/namespace-map.json`.
- `simply-utam steps`: Statically analyzes Gherkin `.feature` files, compiles existing step expressions, detects true undefined steps, and appends formatted Cucumber expressions into target step files.
- `simply-utam build`: Convenience runner executing all compilation and transformation stages sequentially (`rules -> utam-generate -> overrides -> rewrite -> utam`).

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
