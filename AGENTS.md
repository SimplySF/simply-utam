# AGENTS.md

## Documentation map

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, and the pull-request checklist, then the
package's own `CONTRIBUTING.md` for what is specific to it.

The package README (e.g. [packages/simply-utam-core/README.md](packages/simply-utam-core/README.md))
is that package's API reference. Its `## API` section lists every export from `src/index.ts`; keep the
two in step.

## Working conventions

- **Implement shared behavior in `@simplysf/simply-utam-core`.** Any later package (a CLI, a
  WebdriverIO service, generators) is a thin surface over it, so one rule never has two
  implementations that drift.
- Core has no runtime dependency on WebdriverIO or UTAM. Type the members you need structurally
  instead of importing them; consumers bring their own versions. `@salesforce/core` is the one
  runtime dependency, and adding another needs discussion first.
- Read `process.env` only through an injectable `env` option, and give anything that writes output an
  injectable sink, so tests never need an org, a browser, or stubbed globals.
- Changing the public surface means updating `src/index.ts`, the README's `## API` section, and
  `test/index.test.ts` together.
- Commits follow Conventional Commits; commitlint enforces it and Lerna versions from it.
