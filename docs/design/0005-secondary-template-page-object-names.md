# 0005 — Unique names for secondary template page objects

**Status:** Draft
**Package:** `packages/simply-utam-core`, `packages/simply-utam`
**Date:** 2026-10-29

## Problem

An LWC bundle can hold more than one template. Besides `component_1.html`, a component that switches
templates in `render()` has others, such as `fooTemplate.html`. Two components often give their extra
templates the same name:

```
lwc/component_1/component_1.html
lwc/component_1/fooTemplate.html
lwc/component_2/component_2.html
lwc/component_2/fooTemplate.html
```

`utam-generate` makes a page object for every HTML file it finds and names it after the HTML file, so
the build writes:

```
lwc/component_1/__utam__/fooTemplate.utam.json
lwc/component_2/__utam__/fooTemplate.utam.json
```

The most common case has no primary template at all. A component extending `LightningDatatable` (or
`LightningTreeGrid`) with custom data types has a JavaScript class and one template per type, and
template names such as `picklistTemplate` repeat across every table in the project:

```
lwc/ordersTable/ordersTable.js          extends LightningDatatable, customTypes → the templates below
lwc/ordersTable/picklistTemplate.html
lwc/ordersTable/lookupTemplate.html
lwc/casesTable/casesTable.js
lwc/casesTable/picklistTemplate.html
lwc/casesTable/lookupTemplate.html
```

The UTAM compiler's output is flat: each page object becomes `pageObjects/<json name>.js`, whatever
folder it came from. In both examples the same-named templates compile to one file
(`pageObjects/fooTemplate.js`, `pageObjects/picklistTemplate.js`), and one silently overwrites the
other. `simply-cicd build publish-utam-page-objects` (in `simply-plugins-core`) now refuses to
publish in that state and asks for a rename, which blocks the build.

The obvious fix, renaming `fooTemplate.html`, means changing component code that UTAM is only being
added to. The names that matter to UTAM are the generated `.utam.json` names, which no LWC code reads,
so the fix belongs in the pipeline that writes them, where every project gets it.

### Findings

Read from `utam@3.3.0` and `@utam/generator`, and reproduced with the real `utam-generate` and `utam`
binaries on two projects: one laid out as the first example, plus a third component
`lwc/emailTemplate/emailTemplate.html`; and one laid out as the datatable example, run through
`simply-utam rules`, `utam-generate` and `utam`. The datatable example was then deployed to a
Developer Edition scratch org (API 67.0) on a Lightning App Page, with an `ordersTableHost` component
rendering `c-orders-table`, and probed from a WebdriverIO run with `wdio-utam-service` 3.3. The DOM
findings were then re-checked from a DOM snapshot of the same page (0003), queried with
`simply-utam snapshot find`, `node` and `lookup`, which agreed with the probe.

| Question                                 | Observed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which files are generated                | `inputFileMask` defaults to `**/*.html`, so every template gets a page object, secondary ones included.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| What a page object is named              | `getPageObjectName()` takes the HTML basename up to the first `.`. The name decides the output file (`writeOutputJSON`), the root description (`Page Object: fooTemplate`), and the prefix of any frame page objects.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Where it is written                      | `<folder of the HTML>/__utam__/<name>.utam.json` (`relativeOutputDir: true`). A template in a subfolder of the bundle writes to that subfolder's `__utam__`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Can a rules file change the name         | No. A rules file is matched to an HTML file by folder and filename prefix (`fooTemplate.rules.json` for `fooTemplate.html`). It can set `outputDir`, but nothing in it changes the name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Frame page objects                       | With `traverseFrameContent`, the generator writes extra page objects named `<name>_<frame>`, with a counter appended on repeats.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Inbound references                       | The generator writes `type` references only for custom elements (`<c-component-2>` → `<namespace>component2`). A template is not a custom element, so no generated page object refers to a secondary template.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| What the compiler names its output after | The `.utam.json` filename (`run_utam.js`, `path.basename(absPath, fileExt)`). Renaming `fooTemplate.utam.json` to `component_1FooTemplate.utam.json` compiled to `pageObjects/component_1FooTemplate.js`, no other change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Is a renamed file regenerated            | Yes. `overrideExisting: true` (the scaffolded default) makes every run write `fooTemplate.utam.json` again, next to the renamed copy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A bundle with no primary template        | The datatable project generated `picklistTemplate.utam.json` and `lookupTemplate.utam.json` in both bundles and nothing named after either table. Renamed by hand to `ordersTablePicklistTemplate` and so on, all four compiled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Rules for such a bundle                  | `simply-utam rules` still writes `ordersTable.rules.json` (root, `c-orders-table`), because the table is exposed on a page. No HTML file is named `ordersTable`, so the generator pairs it with nothing, except as in the next row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Rules matched by prefix                  | The generator pairs a rules file with an HTML file in the same folder when the rules name _starts with_ the HTML name, and each rules file is used once, by the first HTML file that claims it. Adding `orders.html` to `ordersTable` made it a root page object `orders` with selector `c-orders-table`: a cell template claiming to be the table. With `ordersTable.html` present as well, `orders.html` still took the rules, in three of three runs on macOS, and `ordersTable` came out as a non-root page object. The generator takes files in the order the filesystem lists them: sorted on macOS, where `orders.html` comes first, but not guaranteed elsewhere, so a Linux CI runner may pair them differently from a laptop. |
| Where custom type markup renders (live)  | In the shadow root of `lightning-primitive-custom-cell`: `span.picklist-value` and `button.picklist-edit` were its two shadow children, and the cell had no light children. So the generated shape, elements under `shadow`, is right for a root element that is the custom cell.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Loading one (live)                       | Loaded into a container whose element is `lightning-primitive-custom-cell`, the generated picklist page object returned `Open` and the lookup one returned its badge. Salesforce's `lightning/datatable` has no public container on that element. Its `customCellContentByIndex` (`:scope *` inside the cell's shadow) hands the page object the _first element_ of the template instead, so the generated page object failed (`Can't find element with locator 'span' inside its scope shadow root`), and so did a variant with no `shadow` wrapper.                                                                                                                                                                                   |
| JavaScript sources                       | The generator parses a `.js` source as JSX (`scriptParser: 'jsx'`, the only one supported) and generates only from JSX elements it finds. LWC JavaScript holds no JSX, so a bundle's `.js` files produce no page objects.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Decision

Add a **naming stage** to the pipeline. After `utam-generate` has written the page objects, and after
`overrides` has merged into them, it renames each page object generated from a secondary template to
`<component><Template>`, with the template's first letter upper-cased:

| Template                                    | Generated as                 | Renamed to                              |
| ------------------------------------------- | ---------------------------- | --------------------------------------- |
| `component_1/component_1.html`              | `component_1.utam.json`      | unchanged                               |
| `component_1/fooTemplate.html`              | `fooTemplate.utam.json`      | `component_1FooTemplate.utam.json`      |
| `component_2/fooTemplate.html`              | `fooTemplate.utam.json`      | `component_2FooTemplate.utam.json`      |
| `component_1/fooTemplate.html`, frame `bar` | `fooTemplate_bar.utam.json`  | `component_1FooTemplate_bar.utam.json`  |
| `ordersTable/picklistTemplate.html`         | `picklistTemplate.utam.json` | `ordersTablePicklistTemplate.utam.json` |
| `casesTable/picklistTemplate.html`          | `picklistTemplate.utam.json` | `casesTablePicklistTemplate.utam.json`  |

This is the convention `salesforce-pageobjects` follows by hand (`baseCombobox` and
`baseComboboxItem`). It needs no configuration, like the `rules` stage, which works out root components
from `js-meta.xml`. It is **on by default**.

Every secondary template is renamed, not only the ones that clash today. Otherwise a page object's
published name would change the day another component first adds a template with the same name, and
every test importing it would break.

Alongside it, **`rules` stops writing a rules file for a component with no primary template**, and
**warns about a template that can take the component's rules**. A rules file configures the page object
generated from `<component>.html`. Without that file it configures nothing, and through prefix matching
it can mark a secondary template as the component's root page object, even taking the rules from a
primary template that exists (see Findings). `rules` therefore skips a component with no primary
template, with the reason `No <component>.html template`, and warns when another template's name is a
prefix of the component's name.

## Behavior

### Which files are renamed

For each LWC bundle (each directory directly under a folder `findLwcDirectories` returns):

1. List the bundle's `.html` files, in the bundle folder and its subfolders. Their basenames up to the
   first `.` are the template names, the same rule the generator uses.
2. The **primary** template is the one named after the bundle. It is never renamed. A bundle need not
   have one: a datatable with custom types has only secondary templates, and all of them are renamed.
3. Every other template's page objects are renamed: `<t>.utam.json` and `<t>_<anything>.utam.json` (its
   frames), in the `__utam__` folder beside that template. When template names overlap as prefixes
   (`foo` and `foo_bar`), the longest match wins.
4. A `.utam.json` that matches no template is left alone and listed in the `--verbose` output. Only
   `.html` files count as templates: the generator produces nothing from LWC JavaScript (see Findings),
   and a `.js` file named after the bundle would be the primary anyway.

The list comes from the HTML files, not from the JSON files, because a bundle name can itself contain
`_` (`component_1`), so a JSON name alone cannot be split into a template and a frame.

### The generator layout it relies on

The stage looks for page objects where the scaffolded `generator.config.json` puts them:
`outputDir: "__utam__"`, `relativeOutputDir: true` and `outputFileExtension: ".utam.json"`, the layout the
`overrides` stage already assumes. It reads those three keys from the generator config (the
`--generator-config` path `build` already takes) and fails, before renaming anything, when they differ.
With `relativeOutputDir: false` every page object goes to one folder, so the generator itself overwrites
same-named templates before any stage runs, and renaming afterwards cannot recover them.

### Changes to `rules`

`generateLwcRules` checks for `<component>.html` in the bundle folder before it reads `js-meta.xml`.
When the file is missing, the component is reported as `skipped` with the reason
`No <component>.html template`, like a component without `js-meta.xml` today, and no rules file is
created or updated.

A rules file already there, from an earlier run, is left alone: `rules` cannot tell one it wrote from
one a person edited. `--verbose` lists it, so a project can delete it. Until it is deleted, a secondary
template whose name is a prefix of the component's name still picks it up.

This does not leave the component without something it needs: a rules file is not a stub for a root
page object, and with no template of its own there is nothing to generate one from.

When a bundle has `<component>.html` and also a template whose name is a prefix of the component's name
(`orders.html` in `ordersTable`), `rules` still writes the rules file and adds a warning to its result
naming both templates: the generator may pair the rules with the wrong one, depending on the order the
filesystem lists them. `rules` cannot prevent that by naming the file differently, since any name that
starts with `ordersTable` also starts with `orders`. The warning is a warning, not a failure, because the
only fixes are a rename or a move of the template into a subfolder, both changes to component code.

### Using custom data type page objects in tests

The renamed page objects work, but only when loaded into a container whose element is
`lightning-primitive-custom-cell`, which `salesforce-pageobjects` does not expose. A test reaches one
through a page object of its own, with an element like the one below beside any `lightning/datatable`
element it already has for the same table. The probe did this:

```json
{
  "name": "ordersTableCells",
  "selector": { "css": "c-orders-table" },
  "shadow": {
    "elements": [
      {
        "name": "cellFactory",
        "selector": {
          "css": "[data-row-number='%d'] > :nth-child(%d) lightning-primitive-cell-factory",
          "args": [
            { "name": "row", "type": "number" },
            { "name": "col", "type": "number" }
          ]
        },
        "shadow": {
          "elements": [
            {
              "name": "customCell",
              "public": true,
              "type": "container",
              "selector": { "css": "lightning-primitive-custom-cell" }
            }
          ]
        }
      }
    ]
  }
}
```

```js
const cell = await page.getCustomCell(1, 2, OrdersTablePicklistTemplate);
```

`row` and `col` are DOM positions, as in `lightning/datatable`'s own `cellByIndex`: `col` counts the
checkbox column and the row header when the table shows them.

The root README documents this recipe. Generating the container for components that extend
`LightningDatatable` is out of scope here.

### The rename

- The new file replaces any file already at the target, which is the copy the previous run renamed.
  The generated file is then removed, so after the stage a secondary template has one page object, not
  two.
- The root `description.text` entry `Page Object: <t>` is rewritten to the new name. Other text is left
  alone, including a description set through generator config.
- The file's formatting is kept, as the `overrides` and `rewrite` stages keep it (`detectIndentation`).
- `--dry-run` reports the renames and writes nothing.

### Collisions

The stage computes every final name before it moves anything, and fails, naming every source, if two
match ignoring case. It compares against every `.utam.json` the compiler will read, under the
`pageObjectsFileMask` in `utam.config.json`, not only the renamed ones: a primary page object or a
hand-written one (such as a test's own page object under `force-app/test/…/__utam__/`) can hold the name
a rename would produce. Most clashes are already gone at that
point, but the rule can produce one: component `a` with template `bC.html` and component `aB` with
template `c.html` both become `aBC`. Case is ignored because the compiler's output folder is usually on a
case-insensitive filesystem (macOS, Windows), the same reason the publish check ignores it.

### Pipeline order

```
rules -> utam-generate -> overrides -> names -> rewrite -> utam
```

After `overrides`, so an overrides file keeps the template's own name (`fooTemplate.utam-overrides.json`
in the bundle folder), which is the name an author sees in the source tree. Before `rewrite`, because
`rewrite` only changes `type` strings and does not care about filenames; placing it there keeps every
stage that edits JSON before the compile.

### Surfaces

- `simply-utam-core`: `nameSecondaryPageObjects(options)` alongside `applyUtamOverrides`, with
  the same option shape (`rootDir`, `sourceDirs`, `dryRun`, `verbose`) and a result listing each rename
  and any collision.
- `simply-utam names`: a command over it, shaped like `simply-utam overrides`.
- `executeBuildPipeline` and `simply-utam build`: the new stage between overrides and rewrite, reported
  as `names` and counted in the result as `pageObjectsRenamed`. `executeBuildPipeline` takes
  `skipNames`, and `build` takes `--skip-names`, to leave the stage out.
- The scaffolded Wireit chain (`templates/wireit.json`): a `build:utam-names` task running
  `simply-utam names`, depending on `build:utam-overrides`, with `build:utam-rewrite-namespaces`
  depending on it instead.

### Opting out

The stage is on by default. A project that already imports secondary-template page objects by their
old names, and is not ready to change its tests, can leave it out:

- `simply-utam build --skip-names`.
- A Wireit chain without `build:utam-names`, which is what a project scaffolded before this change
  already has (see below). A newly scaffolded project removes the task and points
  `build:utam-rewrite-namespaces` back at `build:utam-overrides`.

Opting out brings back the clash this document is about, so it suits only a project whose secondary
template names happen to be unique.

### Existing projects

- A project running `simply-utam build` gets the stage on upgrade.
- A project using the scaffolded Wireit tasks does not, and is not meant to: `init` is a one-time setup
  step, which adds a missing task but never changes the `dependencies` of one that exists. To get the
  stage, such a project adds the task and moves one dependency in its package.json:

  ```json
  "build:utam-names": {
    "command": "simply-utam names",
    "dependencies": ["build:utam-overrides"]
  },
  "build:utam-rewrite-namespaces": {
    "command": "simply-utam rewrite -c .utam/namespace-map.json",
    "dependencies": ["build:utam-names"]
  }
  ```

  plus `"build:utam-names": "wireit"` under `scripts`. A project that changed the rewrite task's
  command keeps it: only `dependencies` changes. The root README and the release notes carry the same
  snippet.

- Any page object already published or imported as `<namespace>/pageObjects/fooTemplate` changes name.
  That is a breaking change for its consumers, released with a `BREAKING CHANGE:` footer, per the
  versioning finding in [0004](0004-self-referencing-page-objects.md#resolved-questions). The footer
  goes on the commit that adds the stage to `executeBuildPipeline` in `simply-utam`, since that is what
  changes names in an existing project. The core commits add a function and a template task, which
  change nothing until they are called.
- A template that is deleted leaves its renamed page object behind, as a deleted primary template
  already does, because the generator never deletes output. The stage does not clean up either.

## Workaround until this lands

A project can stop the generator from producing page objects for the clashing templates, through the
`ignore` list in its `generator.config.json`. The project's `ignore` replaces the generator's default,
so `**/node_modules/**` has to stay in it:

```json
"ignore": [
  "**/node_modules/**",
  "**/lwc/component_1/fooTemplate.html",
  "**/lwc/component_2/fooTemplate.html"
]
```

- List the files by path. A wildcard such as `**/lwc/*/*Template.html` also drops a primary template
  whose component name ends the same way: in the reproduction it removed `emailTemplate.utam.json`
  along with the two `fooTemplate` page objects. Glob patterns cannot express "a name that differs from
  its folder's name", which is the rule that actually separates the two.
- Those templates then get no page object at all. The component's primary page object covers only the
  primary template's markup, and a datatable component, which has no primary template, is left with no
  page objects.
- The generator never deletes output, so remove the `fooTemplate.utam.json` files already in `__utam__`
  folders. Otherwise the compiler and the publish check still see them.

## Alternatives considered

| Alternative                                                      | Why not                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rename the HTML templates                                        | Changes component code to suit generated test files. The names that matter are the generated JSON names, which no component code reads.                                                                                                   |
| A setting in the rules file                                      | The generator has none for the name, and a key of ours in a UTAM-owned format would be ignored by UTAM's own tools.                                                                                                                       |
| Call `generateFromHTML` ourselves with the computed name         | Would set the name before anything is written, but means replacing `utam-generate` (scanning, rules matching, writing) with our own runner, and the Wireit chain calls `utam-generate` directly.                                          |
| Rename only the templates that clash                             | A page object's name would depend on what other components contain, and change when a clash first appears.                                                                                                                                |
| Rename while publishing, in `simply-cicd`                        | The published names would differ from the files in the repo and from what the local compile produces, so tests written locally would import names that do not exist in the package. `simply-cicd` also only compiles, it never generates. |
| Nest output by component (`pageObjects/component_1/fooTemplate`) | The compiler writes one flat folder per run, so this needs one compile per component and merged profiles configs, and changes every import path. `salesforce-pageobjects` nests only by namespace and feature area.                       |
| A rename map in project config                                   | Every project would write the same entries the convention computes. Kept as a possible later addition for names a project wants to choose itself.                                                                                         |
| Exclude secondary templates from generation by default           | Loses the page objects instead of naming them.                                                                                                                                                                                            |

## Implementation plan

1. `nameSecondaryPageObjects` in a new `src/names/` folder of `simply-utam-core`, reusing
   `discoverProject`, `findLwcDirectories` and `detectIndentation`.
2. Public surface: export it from `src/index.ts`, list it in the README's `## API` section, cover it in
   `test/index.test.ts`.
3. `simply-utam names`, the `names` stage in `executeBuildPipeline`, and the `build` summary string.
4. `templates/wireit.json`: the new task and the changed dependency.
5. `generateLwcRules`: the `No <component>.html template` skip, the prefix warning, and the
   `--verbose` listing of a rules file left behind.
6. The root README: the stage, `--skip-names`, the Wireit snippet for existing projects, and the
   custom cell container recipe. The `simply-utam` README: `names` in `## Commands`, the stage in
   `build`'s pipeline string, the skip and warning in `rules`, and `skipNames` and
   `pageObjectsRenamed` on `executeBuildPipeline`, which `simply-utam` exports.
7. Update this document and the design index to match what shipped.

Commit the rules change separately from the naming stage: it changes what `rules` writes on its own.

Separately, in `simply-plugins-core`: the publish command's clash message should say to rename the
`.utam.json` file and mention this stage, not ask for components to be renamed. That needs its own
change there.

## Testing

- `nameSecondaryPageObjects`: a primary template only (no change); a secondary template; two
  components with the same secondary template; a datatable-style bundle with a `.js` class and only
  secondary templates; a `.utam.json` matching no template; a bundle name containing `_`; frame page objects of a
  primary and of a secondary template; templates in a bundle subfolder; a stale renamed file from a
  previous run; a collision produced by the rule, including one that differs only in case; a custom
  description left alone; `--dry-run`; idempotence on a second run; a rename that would land on an
  unchanged primary or hand-written page object; a generator config with `relativeOutputDir: false`.
- `executeBuildPipeline`: the stage runs between overrides and rewrite, stops the pipeline on a
  collision, is counted in the result, and is left out with `skipNames`.
- `generateLwcRules`: a component with no `<component>.html` is skipped with the reason, an existing
  rules file for one is left alone and listed, a template whose name is a prefix of the component's
  name produces the warning, and a component with only its primary template is unaffected.
- `init`: a new project gets the Wireit task and dependency.
- Integration checks outside the unit suite, through `simply-utam rules`, `utam-generate`, the stage
  and `utam`:
  - the first reproduction gives `component_1FooTemplate.js` and `component_2FooTemplate.js`, and an
    overrides file named after the template is still applied;
  - the datatable reproduction gives `ordersTablePicklistTemplate.js`, `ordersTableLookupTemplate.js`,
    `casesTablePicklistTemplate.js` and `casesTableLookupTemplate.js`, and writes no
    `ordersTable.rules.json`;
  - in an org, the renamed custom type page objects load through the container recipe above.

## Resolved questions

- **Reaching existing Wireit projects.** Not automated. `init` is a one-time setup step, so a project
  scaffolded before this change adds the task by hand if it wants the behavior (see
  [Existing projects](#existing-projects)).
- **An opt-out.** Yes: `--skip-names` on `build`, and leaving the task out of a Wireit chain (see
  [Opting out](#opting-out)).
- **JavaScript sources.** Only `.html` files count as templates. The generator reads `.js` only as JSX,
  which LWC JavaScript does not contain, so a bundle's `.js` files produce no page objects to name.
- **Are custom data type page objects usable as generated?** Yes, checked in an org: the markup renders
  in the shadow root of `lightning-primitive-custom-cell`, which is the shape the generator writes. They
  load only through a container on that element, which a test supplies (see
  [Using custom data type page objects in tests](#using-custom-data-type-page-objects-in-tests)).
- **Rules matched by prefix.** Confirmed: `orders.html` in `ordersTable` became a root page object for
  `c-orders-table`, with or without `ordersTable.html` beside it. Without a primary template, `rules`
  no longer writes the file that causes it. With one, `rules` warns (see
  [Changes to `rules`](#changes-to-rules)).
- **Repairing a prefix-paired rules file.** A warning is enough. The naming stage could detect the
  result afterwards (a secondary page object with `root: true` and the component's selector), but it
  cannot regenerate the primary with its rules, and the only fixes, renaming the template or moving it
  into a subfolder, are changes to component code that the project has to choose.

## Open questions

None.
