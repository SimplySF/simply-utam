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

## Windows

CI runs on Windows too, and most of our red builds have been Windows-only. Before pushing, check the
diff for:

- **Paths in output, sorting or comparison:** normalize to `/` first (`toPosixRelative` in
  `path-utils.ts`). A raw sort orders `\` differently from `/`.
- **Paths in test expectations:** build them the way the code does (`path.join`, exported constants
  such as `DEFAULT_NAMESPACE_MAP`), never as hardcoded `a/b` strings.
- **Line endings:** `.gitattributes` keeps checkouts LF, so leave it alone. Write generated files
  with `\n`.
- **Spawning binaries in tests:** don't link `node_modules` or rely on `.bin` lookup. Pass a
  `spawnCommand` that runs the package's bin script with `process.execPath`. Production code
  appends `.cmd` on win32.
- **Removing or renaming files:** Windows locks open files (EBUSY/EPERM). Catch the error and warn
  when the step is best-effort, rather than failing the run.
