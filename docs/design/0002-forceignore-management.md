# 0002 — `.forceignore` management in `init`

**Status:** Implemented (PR #7)
**Package:** `packages/simply-utam-core`, `packages/simply-utam`
**Date:** 2026-10-07

## Problem

`simply-utam init` scaffolds the UTAM pipeline but doesn't yet manage `.forceignore`. The pipeline
writes files into LWC bundle folders, and Salesforce deploys an LWC bundle as a whole folder and
doesn't accept `.json` files inside it. For LWC deployments to succeed, those files need to be listed
in `.forceignore`.

| Artifact                                          | Written by                                                     | Location          |
| ------------------------------------------------- | -------------------------------------------------------------- | ----------------- |
| `<name>.rules.json`                               | `simply-utam rules`                                            | component folder  |
| `<name>.utam-overrides.json`                      | the developer                                                  | component folder  |
| `__utam__/<name>.utam.json`, `__utam__/*.utam.js` | `utam-generate` (`outputDir: "__utam__"`, `relativeOutputDir`) | inside the bundle |

`init` also scaffolds `hello.feature` and `hello.steps.mjs` under `<sourceDir>/test/utam/`, which is
inside a package directory. Those files are not Salesforce metadata.

The page object output (`pageObjects/`, `utils/`) and `.utam/` sit at the project root, outside the
package directories, so the deploy never reads them.

Today each project adds these rules itself. The reference test project uses:

```
**/__utam__/**
**/*.rules.json
**/*.utam-overrides.json
```

`.forceignore` belongs to the project, not to us. It often contains entries from the Salesforce
project template, from other tools, and from the team, and some projects keep local entries inside a
marked customization region such as `# -- START CUSTOMIZATION` … `# -- END CUSTOMIZATION`. Any edit
we make must leave every other line untouched.

## Decision

`init` makes sure `.forceignore` holds the rules our pipeline needs. It edits the file only by adding
lines under a `# Ignore UTAM` comment, which is the comment teams already use for these rules. It
never removes, rewrites or reorders a line. The logic lives in a new `@simplysf/simply-utam-core`
module, `forceignore`, as a pure string function plus a thin file wrapper. `scaffoldProject` calls the
wrapper, and the CLI only adds flags and output.

## Behavior

### Required rules

The general rules, plus one rule for this project's test folder. A pattern with no `/` except a
trailing one matches at any depth, so `*.rules.json` means the same as `**/*.rules.json` and both
spellings are accepted:

| Required                   | Also accepted as covering it                             | Why                                                         |
| -------------------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| `**/__utam__/**`           | `**/__utam__/`, `**/__utam__`, `__utam__/`, `__utam__`   | Generated `.utam.json` and `.utam.js` files inside bundles. |
| `**/lwc/**/*.rules.json`   | `**/*.rules.json`, `*.rules.json`                        | Scoped to LWC so it can't hide an unrelated `*.rules.json`. |
| `**/*.utam-overrides.json` | `*.utam-overrides.json`                                  | The suffix is ours alone, so a broad rule is safe.          |
| `<testDir>/`               | `<testDir>`, `<testDir>/**`, `/<testDir>/`, `/<testDir>` | The scaffolded feature and step files.                      |

`<testDir>` is the UTAM test folder that `init` writes to or finds:

- `init` already checks four folders: `<sourceDir>/test/utam`, `<sourceDir>/tests/utam`,
  `test/utam` and `tests/utam`.
- A rule is added for each one that exists, or is about to be scaffolded, **and** sits inside a
  package directory. A test folder at the project root is outside the package directories and gets no
  rule.
- The path is relative to the project root and uses forward slashes on every platform, for example
  `force-app/test/utam/`. `init` makes `--source-dir` relative to the project root first, so an
  absolute `--source-dir` gives the same rule. A folder outside the project root, or on another Windows
  drive, gets no rule, since a `.forceignore` pattern can't reach it. A `/` partway through a pattern ties it to the `.forceignore` folder, so the
  rule can't match an unrelated `test/utam` elsewhere.
- The rule covers the whole folder, so features the developer adds later are covered too.
- Folder names are literal, but `.forceignore` reads some characters as wildcards. `[`, `]` and `*`
  are escaped with a backslash, as is a leading `#` (a comment) or `!` (a negation), so
  `force-app[1]` becomes `force-app\[1\]/test/utam/`. A `?` is left as is: the `ignore` 5.x library
  that Salesforce's deploy tooling uses can't escape it, and unescaped it still matches the folder.

### Deciding whether a rule is already there

- An **active line** is any line that, once trimmed, is not empty, not a `#` comment and not a `!`
  negation.
- A required rule is **covered** when an active line anywhere in the file equals the rule, or equals
  one of the patterns accepted for it. Matching is exact text after trimming.
- If every required rule is covered, the file is left alone and the result reports `unchanged`.
- Negations are not evaluated. If a team re-includes our files with a later `!` line, that is their
  decision and we don't fight it.

### Our block

- The header is a line that is exactly `# Ignore UTAM` once trimmed.
- The block is that header plus the pattern lines directly below it. It stops at the first blank line,
  comment or end of file.
- There is no end marker. Because of that we can't prove which lines below the header are ours, so we
  only ever add to the block.
- If the header appears more than once, the first one is used.

### Where missing rules go

Only the missing rules are written, in the order of the table above.

1. **`# Ignore UTAM` already exists** (inside a region or not): add the missing rules after the last
   pattern line of that block. The block is never moved.
2. **A customization region exists**: insert a new `# Ignore UTAM` block directly above the region's
   end marker, with a blank line before it unless the line above is already blank. Nothing else in the
   region is reordered or reformatted.
3. **Otherwise**: append a new `# Ignore UTAM` block at the end of the file, after one blank line.
   Being last also means an earlier broad `!` line can't override our rules, because later lines win.
4. **No `.forceignore` and `sfdx-project.json` exists**: create the file holding only our block. This
   is safe because the Salesforce deploy library always applies its built-in ignores (such as
   `**/.*` and `**/*.dup`) before the file's own lines.
5. **No `.forceignore` and no `sfdx-project.json`**: do nothing, since the project isn't a Salesforce
   source project.

### Customization region

- Region markers default to `# -- START CUSTOMIZATION` and `# -- END CUSTOMIZATION`, and can be
  changed with `--forceignore-region-start` and `--forceignore-region-end`.
- Markers are trimmed, and a marker matches a line only if it equals the trimmed line exactly.
- An empty marker would match every blank line, so it is rejected: the block goes at the end of the
  file and a warning is added.
- The region is valid only if there is exactly one start line, exactly one end line, and the start
  comes before the end.
- If the region is malformed (start without end, end without start, end before start, or more than
  one of either), fall back to step 3 and add a warning to the result.
- We never replace or rewrite the region's contents. The only edit inside it is our own block.

### Preserving the file

- Line endings: new lines use the ending of the line they follow. When that line has none (the last
  line of a file with no final newline), they use whichever ending most lines in the file use.
- A leading byte-order mark is kept.
- If the file doesn't end with a newline, one is added before our lines. That is the only change made
  to an existing line, and it doesn't change the line's content.
- Every byte outside the lines we add is otherwise unchanged.
- The new content is written to a temporary file next to `.forceignore` and renamed into place, so an
  interrupted write can't leave the file truncated. A symlinked `.forceignore` is written through to
  its target, and the file's permissions are kept.
- A read-only `.forceignore` is left alone and reported as `failed`. A rename only needs permission on
  the folder, so the file's own permission is checked first.
- If the temporary file can't be created or renamed (a folder that doesn't allow new files, or on
  Windows a file another process briefly holds), the file is written in place instead.

### Flags

| Flag                                 | Default                    | Effect                                     |
| ------------------------------------ | -------------------------- | ------------------------------------------ |
| `--forceignore` / `--no-forceignore` | on                         | Turns `.forceignore` management on or off. |
| `--forceignore-region-start`         | `# -- START CUSTOMIZATION` | The line that starts the region.           |
| `--forceignore-region-end`           | `# -- END CUSTOMIZATION`   | The line that ends the region.             |

- `--force` doesn't change this behavior. It overwrites files we own, and we don't own
  `.forceignore`.
- `--dry-run` computes the same result and writes nothing.

### Output

`ScaffoldResult` gains one field. It is absent when `--no-forceignore` is set:

```ts
forceignore?: {
  path: string; // '.forceignore', relative to the project root
  action: 'created' | 'appended' | 'inserted' | 'unchanged' | 'skipped' | 'failed';
  placement?: 'block' | 'region' | 'end'; // where lines went, when any were written
  addedPatterns: string[];
  warnings: string[];
};
```

- `appended` means rules were added to an existing `# Ignore UTAM` block.
- `inserted` means a new block was added inside the region or at the end of the file.
- `skipped` means there is no `.forceignore` and no `sfdx-project.json`.
- `failed` means `.forceignore` could not be read or written, for example because of its
  permissions. The reason is in `warnings`, and `init` still finishes the rest of its work, including
  `package.json`. A problem with a file the project owns never aborts `init`.
- `.forceignore` is also listed in `createdFiles` or `modifiedFiles`, as for any other file.

Human-readable output reports the action, the added rules and any warnings, for example
`Updated .forceignore: added **/__utam__/**, force-app/test/utam/ (inside the customization region)`.
A newly created file is reported without a placement. A dry run says `Would update` or
`Would create` instead, a file that needs nothing reports `.forceignore already covers UTAM
artifacts.`, and a skipped file says why it was skipped and suggests pointing `--project-dir` at the folder that
contains `sfdx-project.json`. Warnings, including
the reason for a `failed` result, are printed as CLI warnings.

### Upgrades

Because we only ever add lines, a later release can add a rule but can't tighten or remove one that
an earlier release wrote. This rarely matters in practice: `init` is normally run once when a project
adopts SimplyUTAM, not repeatedly over the project's life. If a release ever needs a stored rule to
change, its release notes will give the manual edit.

## Alternatives considered

- **A start/end managed block that we own and rewrite on every run.** This would allow clean
  upgrades. Rejected because the established style is a single `# Ignore UTAM` comment with no end
  marker, and existing projects already have that header. Adding a second convention would duplicate
  the rules in those projects.
- **Treating everything under `# Ignore UTAM`, up to the next comment, as ours to rewrite.** Rejected
  because teams add their own lines under nearby comments. Without an end marker we can't prove a line
  is ours, so add-only is the only safe choice.
- **Testing rule coverage against real paths with the `ignore` package or the Salesforce tooling's
  `.forceignore` handling.** This would be more accurate, but it breaks the core rule that
  `@salesforce/core` is the only runtime dependency. Exact matching plus a short table of accepted
  broader patterns covers the patterns used in practice.
- **Keeping the unscoped `**/*.rules.json` as the rule we write.** Rejected because the suffix is
  generic and could hide an unrelated file. We still accept it as covering the rule, so projects that
  already have it are not given a duplicate.
- **Ignoring all JSON in LWC folders (`**/lwc/**/*.json`).** Rejected because it claims files we don't
  write and could hide a team's real mistake.
- **A broad test-folder rule such as `**/test/utam/**` or `**/*.feature`.** Rejected in favor of the
  exact path `init` knows, which is the narrowest rule that works.
- **Case-insensitive or fuzzy region markers.** Rejected because we don't own the region. Exact
  matching won't mistake an unrelated comment for a marker.
- **Always appending at the end of the file, even when a region exists.** Rejected because projects
  that keep a region expect local entries inside it.
- **Moving `utam-generate` output out of the LWC bundles.** Out of scope. `relativeOutputDir` is how
  UTAM's generator places its output, and the overrides merger expects `<component>/__utam__/`.

## Implementation plan

1. `packages/simply-utam-core/src/forceignore/forceignore-manager.ts`:
   - `SIMPLY_UTAM_FORCEIGNORE_RULES`, the required rules with their accepted alternatives, plus
     `FORCEIGNORE_FILE` and `FORCEIGNORE_HEADER`;
   - `DEFAULT_FORCEIGNORE_REGION`;
   - the pure function `mergeForceignore(content, { rules, regionStart, regionEnd })`;
   - `resolveUtamTestIgnoreRules(testDirs, packageDirectories)`, which works out the test-folder rules;
   - the file wrapper `ensureForceignore({ projectDir, rules, dryRun, regionStart, regionEnd })`.
2. `src/forceignore/index.ts`, plus a `./forceignore` subpath export in `package.json`.
3. `src/scaffold/project-scaffolder.ts`: work out the test folder, call `ensureForceignore`, record the
   result and add it to `ScaffoldResult`. Add `forceignore`, `forceignoreRegionStart` and
   `forceignoreRegionEnd` to `ScaffoldOptions`. Make `sourceDir` project-relative once, up front,
   and keep a leading `../` when filling the config templates. An absolute source path, such as a
   folder on another Windows drive, is used as is, both in the configs and when writing the hello-world
   files. Read package directories from
   `sfdx-project.json` through a small internal reader, `src/discovery/sfdx-project.ts`, split out of
   `project-discovery.ts` and not re-exported, so `init` never has to scan every LWC.
4. `src/index.ts`, the core README `## API` section and `test/index.test.ts`, updated together.
5. `packages/simply-utam/src/commands/init.ts`: the new flags, passing them through, and output lines.
   Update the command's `description` to mention `.forceignore`.
6. The CLI README, and this document's status once the change lands.

## Testing

`mergeForceignore`, the pure function, which most cases target:

- Empty content: our block is written.
- An existing `# Ignore UTAM` block with some rules: only the missing rules are added, after its last
  pattern line.
- A `# Ignore UTAM` block followed directly by a team line under another comment: the team line stays
  where it is, and our rules go above that comment.
- A broader accepted pattern (`**/*.rules.json`) elsewhere in the file counts as covering the rule.
- Every rule covered, as in the reference test project: `unchanged`, and the output equals the input
  byte for byte.
- A commented-out or negated copy of a rule doesn't count as covering it.
- A valid region with team lines before and after: the block goes directly above the end marker, and
  every team line is unchanged.
- An existing `# Ignore UTAM` block inside a region: lines are added there, not at a new location.
- Custom region markers match. A marker with extra text or different case does not.
- Each malformed region case falls back to the end of the file with a warning.
- CRLF content gets CRLF lines. A BOM is kept. A file with no final newline gets one before our lines.
- Running twice gives the same result as running once.

`resolveUtamTestIgnoreRules`:

- A test folder inside a package directory gets a rule tied to the project root.
- A test folder at the project root gets no rule.
- Windows-style paths become forward slashes.
- A `sourceDir` of `.` gives `test/utam/`.

`ensureForceignore` and `scaffoldProject`, against a temporary folder:

- No `.forceignore` but `sfdx-project.json` present: the file is created and listed in `createdFiles`.
- Neither file present: `skipped`, and nothing is written.
- An existing file that changes is listed in `modifiedFiles`.
- `--dry-run` writes nothing but reports the same result.
- `forceignore: false` leaves the file alone and omits the field.

CLI `init`:

- The flags are passed through.
- `--json` includes the `forceignore` field.
- Warnings are printed.

## Open questions

- **The generator's `rulesFileMask`:** it is still the unscoped `**/*.rules.json`. Scoping it to match
  is a separate change and is not part of this one.
