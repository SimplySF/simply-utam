# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.3.1](https://github.com/SimplySF/simply-utam/compare/%40simplysf%2Fsimply-utam-core%400.3.0...%40simplysf%2Fsimply-utam-core%400.3.1) (2026-10-26)

### Bug Fixes

- **deps:** bump @salesforce/core from 9.3.6 to 9.4.1 ([#21](https://github.com/SimplySF/simply-utam/issues/21)) ([2427d80](https://github.com/SimplySF/simply-utam/commit/2427d80e9dddab06a23c5ce59658abca8ed24dec))

# [0.3.0](https://github.com/SimplySF/simply-utam/compare/%40simplysf%2Fsimply-utam-core%400.2.0...%40simplysf%2Fsimply-utam-core%400.3.0) (2026-10-26)

### Features

- DOM snapshots for UTAM test authoring and failure diagnosis ([#20](https://github.com/SimplySF/simply-utam/issues/20)) ([560be28](https://github.com/SimplySF/simply-utam/commit/560be28390930af8a54d2ff6b4043cf7f24928ea)), closes [#id](https://github.com/SimplySF/simply-utam/issues/id)

# [0.2.0](https://github.com/SimplySF/simply-utam/compare/%40simplysf%2Fsimply-utam-core%400.1.3...%40simplysf%2Fsimply-utam-core%400.2.0) (2026-10-21)

### Bug Fixes

- let compiled page objects import each other ([#19](https://github.com/SimplySF/simply-utam/issues/19)) ([8e38a3c](https://github.com/SimplySF/simply-utam/commit/8e38a3ce0559296b90a1b55698ee7c8b686682e1))

### BREAKING CHANGES

- for a scoped package, init now writes the namespace with the scope
  ("@acme/my-app" instead of "my-app"). Existing projects keep their config until they re-run
  init --force. Pass --app-name my-app to keep the old namespace.

## [0.1.3](https://github.com/SimplySF/simply-utam/compare/%40simplysf%2Fsimply-utam-core%400.1.2...%40simplysf%2Fsimply-utam-core%400.1.3) (2026-10-19)

### Bug Fixes

- **deps:** bump prettier from 3.9.9 to 3.9.10 ([#14](https://github.com/SimplySF/simply-utam/issues/14)) ([ca2cbaf](https://github.com/SimplySF/simply-utam/commit/ca2cbaf3d1438d5dd44dfa1ae4da9eb0a9b96ee3))

## [0.1.2](https://github.com/SimplySF/simply-utam/compare/%40simplysf%2Fsimply-utam-core%400.1.1...%40simplysf%2Fsimply-utam-core%400.1.2) (2026-10-14)

### Bug Fixes

- **deps:** bump @salesforce/core from 9.2.0 to 9.3.6 ([#10](https://github.com/SimplySF/simply-utam/issues/10)) ([410df50](https://github.com/SimplySF/simply-utam/commit/410df50bbc85f43ec8563362c70d91dce97f8001))

## [0.1.1](https://github.com/SimplySF/simply-utam/compare/%40simplysf%2Fsimply-utam-core%400.1.0...%40simplysf%2Fsimply-utam-core%400.1.1) (2026-10-14)

### Bug Fixes

- add UTAM rules to .forceignore during init ([#7](https://github.com/SimplySF/simply-utam/issues/7)) ([c7737a7](https://github.com/SimplySF/simply-utam/commit/c7737a7fdee5ef06194b8526e838a1b911ca0985))

# 0.1.0 (2026-10-01)

### Features

- implement the SimplyUTAM framework ([#2](https://github.com/SimplySF/simply-utam/issues/2)) ([43ef999](https://github.com/SimplySF/simply-utam/commit/43ef999eb3ec62afb60301d574a010c6d9bc8a68))
- **simply-utam-core:** scaffold the monorepo and core library ([ea76fc9](https://github.com/SimplySF/simply-utam/commit/ea76fc9a87bff9540054fe7c8e956ac78aa656f1))
