# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.4.0](https://github.com/SimplySF/simply-utam/compare/%40simplysf%2Fsimply-utam%400.3.4...%40simplysf%2Fsimply-utam%400.4.0) (2026-10-30)

### Bug Fixes

- give secondary template page objects unique names ([#26](https://github.com/SimplySF/simply-utam/issues/26)) ([9f3baad](https://github.com/SimplySF/simply-utam/commit/9f3baad5606c15849358c20eaf2a424ad1065bb4))

### BREAKING CHANGES

- simply-utam build now renames page objects generated
  from secondary LWC templates to <component><Template>, so tests that
  import one by its template name (pageObjects/fooTemplate) must import
  pageObjects/<component>FooTemplate instead, or run build --skip-names
  to keep the old names.

## [0.3.4](https://github.com/SimplySF/simply-utam/compare/%40simplysf%2Fsimply-utam%400.3.3...%40simplysf%2Fsimply-utam%400.3.4) (2026-10-26)

**Note:** Version bump only for package @simplysf/simply-utam

## [0.3.3](https://github.com/SimplySF/simply-utam/compare/%40simplysf%2Fsimply-utam%400.3.2...%40simplysf%2Fsimply-utam%400.3.3) (2026-10-26)

**Note:** Version bump only for package @simplysf/simply-utam

## [0.3.2](https://github.com/SimplySF/simply-utam/compare/%40simplysf%2Fsimply-utam%400.3.1...%40simplysf%2Fsimply-utam%400.3.2) (2026-10-26)

### Bug Fixes

- **deps:** bump @oclif/core from 5.1.8 to 5.1.9 ([#25](https://github.com/SimplySF/simply-utam/issues/25)) ([80c994a](https://github.com/SimplySF/simply-utam/commit/80c994a0c761c717cba7807b230e237a8a4f4e19))

## [0.3.1](https://github.com/SimplySF/simply-utam/compare/%40simplysf%2Fsimply-utam%400.3.0...%40simplysf%2Fsimply-utam%400.3.1) (2026-10-26)

**Note:** Version bump only for package @simplysf/simply-utam

# [0.3.0](https://github.com/SimplySF/simply-utam/compare/%40simplysf%2Fsimply-utam%400.2.0...%40simplysf%2Fsimply-utam%400.3.0) (2026-10-26)

### Features

- DOM snapshots for UTAM test authoring and failure diagnosis ([#20](https://github.com/SimplySF/simply-utam/issues/20)) ([560be28](https://github.com/SimplySF/simply-utam/commit/560be28390930af8a54d2ff6b4043cf7f24928ea)), closes [#id](https://github.com/SimplySF/simply-utam/issues/id)

# [0.2.0](https://github.com/SimplySF/simply-utam/compare/%40simplysf%2Fsimply-utam%400.1.7...%40simplysf%2Fsimply-utam%400.2.0) (2026-10-21)

### Bug Fixes

- let compiled page objects import each other ([#19](https://github.com/SimplySF/simply-utam/issues/19)) ([8e38a3c](https://github.com/SimplySF/simply-utam/commit/8e38a3ce0559296b90a1b55698ee7c8b686682e1))

### BREAKING CHANGES

- for a scoped package, init now writes the namespace with the scope
  ("@acme/my-app" instead of "my-app"). Existing projects keep their config until they re-run
  init --force. Pass --app-name my-app to keep the old namespace.

## [0.1.7](https://github.com/SimplySF/simply-utam/compare/%40simplysf%2Fsimply-utam%400.1.6...%40simplysf%2Fsimply-utam%400.1.7) (2026-10-19)

### Bug Fixes

- **deps:** bump @oclif/core from 5.1.2 to 5.1.8 ([#17](https://github.com/SimplySF/simply-utam/issues/17)) ([55121b5](https://github.com/SimplySF/simply-utam/commit/55121b5922b07ee441c1cc7ecd21ccdb8f7c9a5d))

## [0.1.6](https://github.com/SimplySF/simply-utam/compare/%40simplysf%2Fsimply-utam%400.1.5...%40simplysf%2Fsimply-utam%400.1.6) (2026-10-19)

**Note:** Version bump only for package @simplysf/simply-utam

## [0.1.5](https://github.com/SimplySF/simply-utam/compare/%40simplysf%2Fsimply-utam%400.1.4...%40simplysf%2Fsimply-utam%400.1.5) (2026-10-19)

**Note:** Version bump only for package @simplysf/simply-utam

## [0.1.4](https://github.com/SimplySF/simply-utam/compare/%40simplysf%2Fsimply-utam%400.1.3...%40simplysf%2Fsimply-utam%400.1.4) (2026-10-14)

**Note:** Version bump only for package @simplysf/simply-utam

## [0.1.3](https://github.com/SimplySF/simply-utam/compare/%40simplysf%2Fsimply-utam%400.1.2...%40simplysf%2Fsimply-utam%400.1.3) (2026-10-14)

**Note:** Version bump only for package @simplysf/simply-utam

## [0.1.2](https://github.com/SimplySF/simply-utam/compare/%40simplysf%2Fsimply-utam%400.1.1...%40simplysf%2Fsimply-utam%400.1.2) (2026-10-14)

### Bug Fixes

- add UTAM rules to .forceignore during init ([#7](https://github.com/SimplySF/simply-utam/issues/7)) ([c7737a7](https://github.com/SimplySF/simply-utam/commit/c7737a7fdee5ef06194b8526e838a1b911ca0985))

## [0.1.1](https://github.com/SimplySF/simply-utam/compare/%40simplysf%2Fsimply-utam%400.1.0...%40simplysf%2Fsimply-utam%400.1.1) (2026-10-01)

### Bug Fixes

- **simply-utam:** generate oclif manifest at pack time instead of committing it ([#3](https://github.com/SimplySF/simply-utam/issues/3)) ([efc9623](https://github.com/SimplySF/simply-utam/commit/efc9623f0f24e2d1def9d69b5e0ace1c8c35d8a9))

# 0.1.0 (2026-10-01)

### Features

- implement the SimplyUTAM framework ([#2](https://github.com/SimplySF/simply-utam/issues/2)) ([43ef999](https://github.com/SimplySF/simply-utam/commit/43ef999eb3ec62afb60301d574a010c6d9bc8a68))
