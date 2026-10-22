# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

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
