# 0003 — DOM snapshots for page object authoring and failure diagnosis

**Status:** Implemented (experimental)
**Package:** `packages/simply-utam-core`, `packages/simply-utam`, scaffold templates
**Date:** 2026-10-17 (updated 2026-10-19 to the shipped design)

## Problem

Writing and fixing UTAM tests depends on two answers that are hard to get:

1. **Which page object, and which selector?** A Lightning page is a deep tree of components, each
   behind its own shadow root. To reach an element you load the outermost root page object that
   covers it, follow its public elements down, and write a custom selector only where no page object
   exists. Mistakes here are common and slow to find: the wrong page object, a missing `"shadow"`, or
   a selector that crosses a component boundary.
2. **Why did this step fail?** The error says an element wasn't found. The screenshot shows what the
   user would see, not the structure UTAM searched through.

An LLM could help with both, but it has nothing accurate to read:

- **LWC source on disk** only covers our own components. It doesn't show which components actually
  rendered, how they nest, or what the record type, layout and profile produced. Standard and managed
  components aren't on disk at all.
- **`browser.getPageSource()`** returns light DOM only, with no shadow content.
- **`element.getHTML()`** (what `logUtamHtml` uses) includes shadow roots but returns one HTML string
  for one element. It is too large for a whole page, doesn't mark shadow boundaries in a form that's
  easy to query, and doesn't say what's visible.
- **The UTAM browser extension** answers these questions well, but only for a person clicking around
  in Chrome, not for an agent.

Lightning also keeps previously visited pages, console workspace tabs and inactive tabs in the DOM,
hidden. UTAM takes the first element that matches a selector in document order, visible or not, so a
root page object can silently load a hidden copy and read the wrong record. Nothing in today's output
shows it.

## Goals

- Capture the rendered component tree, with shadow boundaries, visibility and enough metadata to
  explain where the snapshot came from.
- Capture it automatically when a step fails, on demand at any point in a scenario, and from a
  browser a person drives.
- Let an agent ask focused questions of a snapshot without reading the whole thing: "what's the
  component path to this element?", "which page object covers this tag, and how do I import it?",
  "which element would this selector find first?".
- Keep record data out of snapshots by default.

## Non-goals

- Generating page objects or fixing tests automatically. The tools give an agent accurate
  information; the agent (or person) still writes the change.
- Proving that a page object works. That stays UTAM's job, in a live browser. The snapshot answers
  one narrower question offline: which elements a CSS selector matches, in which order, in a given
  scope (see Queries). It doesn't resolve a page object's chain, run its methods, or wait.
- Replacing a live run. A snapshot is one moment in time, so the live run stays the final check.
- Mobile apps and Experience Cloud specifics beyond what works the same as Lightning Experience.

## Overview

`@simplysf/simply-utam-core` has a DOM snapshot feature made of:

- A **walker**: one self-contained function that runs inside the page and returns a compact, masked
  JSON snapshot.
- **Capture**: inside a WebdriverIO test through `browser.execute` (on failure, at a chosen step, or
  from the REPL while paused), or by hand, by pasting a snippet into a browser's DevTools console.
- **Files**: one folder per test run, a `manual/` folder for hand captures, `latest.json`, and
  pruning of old runs.
- A **page-object index** built from the project's own page objects and every page-object package the
  project's namespace configuration maps to, `salesforce-pageobjects` included.
- **Queries** over a snapshot and the index: `find` (including a CSS selector check with UTAM's
  `findElement` semantics), `path`, `tree`, `node` and `lookup`.
- A **usage guide**, shipped as an agent skill, for the commands, the workflow, and the two
  page-object authoring recipes agents need to act on what the commands show.

The `simply-utam` CLI exposes the queries and the console capture as `simply-utam snapshot …`
commands. Core takes one new runtime dependency, `css-select`, for the selector check (see Public
surface).

The feature is experimental: its commands, output and format can still change. An agent evaluation
of the interface (Evidence, Appendix C) shaped it.

This document records what the feature is and why. It doesn't repeat what other files own: the
exports are listed in the [core README's DOM Snapshots
section](../../packages/simply-utam-core/README.md#dom-snapshots), the hooks to copy into an existing
project in the [CLI README](../../packages/simply-utam/README.md#dom-snapshots-in-an-existing-project),
and the commands, their output and the recipes in the usage guide
([`skills/utam-dom-snapshots/SKILL.md`](../../packages/simply-utam/skills/utam-dom-snapshots/SKILL.md)). Exact output
wording lives in the code and its tests; examples here show the shape of the output, not its text.

## 1. The walker

- A single function with no imports or closures, because capture sends its source text to the page.
  It lives in a plain JavaScript file (`src/snapshot/walker.js`), which the build copies to `lib/`
  unchanged, and core reads that file as text to send it. Nothing compiles or transforms it, so the
  text tests run is the text that ships. (A function written in TypeScript would be checked against
  vitest's transformed source, not the `tsc` output.)
- It returns the snapshot as a JSON string, not an object. A deep tree returned as an object can hit
  serialization depth limits and is slower to convert; a string crosses as one value, and the caller
  parses it.
- It collects page metadata itself (`url`, `title`, viewport size) and masks it in the page, so in
  the default modes unmasked values never leave the browser. The one exception is `meta.error`,
  which capture adds outside the browser: the failed step's error message is recorded as-is, and can
  include record values.
- Top-level document only. Each `iframe` is recorded as a node with its `src` (query string and
  fragment removed, record IDs masked) and marked `notCaptured`. Most Setup pages in Lightning are
  Visualforce pages inside iframes, so they aren't covered yet (see Later phases).
- It works in any current browser. Where `checkVisibility` is missing, it falls back to computed
  `display`, `visibility` and `opacity`.

### What it records

The walker starts at `document.documentElement`. For each element it visits the light-DOM
`children` and, when the element has a `shadowRoot`, that root's `children` separately. Under LWC's
synthetic shadow, `shadowRoot` and `children` are emulated so they show the same scoped view that
UTAM's selectors search. That is the view we want, so the walker never uses `document.querySelector*`
to move down the tree. UTAM's shadow lookups are `element.shadowRoot.querySelector*` run in the page,
which is exactly what the spike compared the walker against (see Evidence).

| Recorded   | Detail                                                                                                                                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `address`  | The node's position at capture time (see below).                                                                                                                                                                              |
| `tag`      | Lowercase tag name.                                                                                                                                                                                                           |
| `attrs`    | Only these: `id` (dropped when it looks generated, e.g. ends in `-123`), `class`, `name`, `type`, `role`, `slot`, `aria-hidden`, `title`, `aria-label`, `placeholder`, `alt`, `data-*`. Values are masked as described below. |
| `text`     | The element's own text (its text-node children, not its descendants'), trimmed and capped at 80 characters, then masked.                                                                                                      |
| `children` | Light-DOM children, including content slotted into a custom element.                                                                                                                                                          |
| `shadow`   | `{ mode, children, text? }` when the element has a shadow root, or appears to have one the walker can't read. `mode` and `text` are described below.                                                                          |
| `hidden`   | `true` on the top node of a hidden subtree (see Visibility). Omitted when visible.                                                                                                                                            |
| `rect`     | `[x, y, width, height]`, rounded, for visible elements. A zero size shows up here; it doesn't make the element hidden.                                                                                                        |

**Shadow mode.** A synthetic shadow root has `synthetic === true`, and
`Object.prototype.toString` gives `[object DocumentFragment]`. A native one has no `synthetic`
property and gives `[object ShadowRoot]`. The walker records `synthetic` for the first, `native` for
the second, and `unknown` for anything else, in case a later release changes either signal.

**Unreadable roots.** A closed shadow root isn't visible through `element.shadowRoot`, and neither
the walker nor UTAM can see into it: UTAM's runtime reads `element.shadowRoot` in the page too, and
fails with "its scope does not have shadow root" when it's missing. Standard Lightning components
can't use closed roots, or `salesforce-pageobjects` would break, but a third-party web component or a
managed package can. Without a flag, such a component looks like an empty element. The walker
records `shadow: { mode: "unreadable", children: [] }` on a custom element that is defined
(`customElements.get(tag)`), has no readable shadow root and no light-DOM children, and takes up
space on the page. The queries then say that its content can't be reached by UTAM selectors.

**Shadow text.** Some components (`lightning-formatted-text`, `records-entity-label`) render their
text straight into the shadow root, with no element around it, so no node's `text` holds it. The
walker records it as `shadow.text`, built like `text` and masked by the host's rules. On a record
page, that's where every field value is: `lightning-formatted-text #shadow "•10"`.

**Addresses** are dot-separated steps from the walk's root, `document.documentElement`, which is
`0`, so `body` is `0.1`:

- A number `n` is the `n`th child element (0-based) in the current tree.
- `s` steps from a host element into its shadow root, so the next number counts the shadow root's
  children.

So `0.1.4.s.2.s.0` is: `html`, its child 1 (`body`), `body`'s child 4, into that element's shadow
root, child 2 there, into its shadow root, child 0 there. Addresses count every element, including
the ones pruning removes, so as long as the page hasn't changed, an address leads to the same element
in the live page, and it stays the same in another snapshot of a page with the same structure.

**Node handles.** Addresses are long and easy to mistype, so commands don't take them. When a
snapshot is read, each node gets a short handle (`n812`), numbered in the order `tree` prints nodes:
the shadow root's children first, then the light children. Within one tree scope, a smaller handle
comes earlier in document order. Numbering is deterministic, so every command over the same file
agrees, but a handle holds for one snapshot only. Every command takes and prints handles; `node` and
`--json` output also show the address. An address passed to a command is refused, with its handle.

### Pruning

- The walk's root and `body` are always kept, so the snapshot has one root node.
- Every custom element (a tag with a `-`) and every element with a shadow root is kept.
- An element is also kept when it has any of `id` (not generated), `name`, `type`, `role`, `slot`,
  `title`, `aria-label`, `placeholder`, `alt` or a `data-*` attribute; has its own text; or is one of
  `a`, `button`, `input`, `select`, `textarea`, `label`, `option`, `iframe`.
- `class` alone doesn't keep an element, because nearly every SLDS wrapper has one. It's recorded
  only on elements kept for another reason.
- An element that is hidden while its parent is visible is always kept, whatever its attributes, so
  `hidden` always has a node to sit on. In Lightning this is often a plain `div.slds-hide`, which the
  other rules would remove.
- Any other element is removed, and its children move up to its parent. Their addresses don't
  change.
- `script`, `style`, `link`, `meta`, `template` and the inside of `svg` are dropped.
- **Inside a hidden subtree**, only custom elements and elements with their own text, a `name`, or a
  `data-*` attribute are kept: enough for `find` to show hidden duplicates, without the full detail.

### Limits

The walker checks its own limits as it goes and stops early rather than being cut off from outside:

| Limit            | Default | When reached                                                            |
| ---------------- | ------- | ----------------------------------------------------------------------- |
| `maxNodes`       | 20,000  | Stops adding visible nodes; adds `'nodes'` to `meta.truncated.reasons`. |
| `maxHiddenNodes` | 5,000   | Stops adding nodes inside hidden subtrees; adds `'hiddenNodes'`.        |
| `timeBudgetMs`   | 3,000   | Checked with `performance.now()`; stops the walk and adds `'time'`.     |

More than one limit can be reached in one walk, so `truncated` lists every reason. The defaults are
far above any page measured (Appendix A).

**Visible first.** Hidden content can come before the visible page in document order, or after it
(see Visibility). The walker therefore walks the visible tree first: when it reaches the top of a
hidden subtree, it adds that node in its place (so the tree's order and addresses don't change) and
queues it. Only after the visible tree is done does it walk the queued hidden subtrees. Hidden
content can then never use up the node limit or the time budget before the visible page is captured.
Hidden nodes count against `maxHiddenNodes`, not `maxNodes`.

**Focus.** `maxNodes` cuts the visible tree in document order, and Lightning's global header,
navigation and tab bars come first, so a tight limit can keep all of that chrome and lose the record
under test. The `focus` option chooses what gets the node budget first:

| `focus`        | Walked first                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`         | Nothing; the walk is in document order.                                                                                                                                                                 |
| `auto`         | The first visible match of, in turn: the console's active workspace tab (`section.tabContent.oneConsoleTab`), the standard navigation's page host (`.oneContent.lafPageHost`), `[role="main"]`, `main`. |
| a CSS selector | Its first visible match. Selectors are matched in the document's own tree, not inside shadow roots.                                                                                                     |

`captureDomSnapshot` defaults to `none`; the console snippet defaults to `auto` (see Capture). The
focus element's subtree is walked first, and its ancestors (crossing shadow hosts) are always kept,
so its nodes have somewhere to go; the rest of the page fills what's left of `maxNodes`. The
ancestors are kept even past the limit, so the node count can run a little over `maxNodes`.
Addresses don't change, and `meta.focus` holds the focus element's address. A focus that matches
nothing visible is ignored.

Capture also has an outside timeout (default 10 s) as a backstop. If it's ever reached, the script
may still be running in the browser, and the next WebdriverIO command (such as the screenshot) waits
behind it, because WebDriver Classic runs one command per session at a time. The walker's own budget
is what keeps capture fast; the backstop only stops a caller from hanging.

### Visibility

- An element is hidden when `checkVisibility({ visibilityProperty: true, opacityProperty: true })`
  is false. Hidden is marked once, on the top node of the hidden subtree, and judged only where the
  parent is visible.
- `visibility` is inherited but can be overridden: a descendant set back to `visible` still renders.
  So an element hidden only by `visibility` (not `display: none` or `opacity: 0`) that has such a
  descendant, in its light or shadow tree, isn't the top of a hidden subtree; its children are judged
  on their own.
- `checkVisibility` also returns false for `display: contents`, which LWC host elements can use and
  whose children still render. An element with computed `display: contents` is never marked hidden
  itself; its children are checked on their own. This covers `slot` elements too, which are
  `display: contents` by default.
- A zero size is not hidden. An LWC host can have zero size while its children are visible. The
  zero size shows in `rect` and nothing else.
- `option` and `optgroup` elements in a closed `select` have a zero rect; they're as visible as their
  `select`, so they're never marked hidden themselves.

**Where Lightning hides content.** All of it is `display: none`, which `checkVisibility` catches:

- **Standard navigation.** The previously visited page stays in the DOM as
  `div.oneContent.lafPageHost.windowViewMode-minimized`, before the visible page in document order.
- **Console apps.** Each inactive workspace tab and subtab is a `section.tabContent.oneConsoleTab`.
  They're in tab order, not in order of use, so hidden tabs can come before or after the visible one.
  A hidden workspace can contain its own `.active` subtab, so `.active` alone doesn't pick out the
  visible copy.
- **Record page tabs.** An inactive tab (`flexipage-tab2.slds-hide`) isn't rendered until it's first
  opened, so it's a hidden node with nothing under it.

### Masking

Snapshots are read by an LLM, which means their text goes to the model provider, and failure
snapshots can end up in Allure reports. They must not copy record data by default.
`UTAM_SNAPSHOT_MASK` (through the injectable `env`) sets the mode, and the mode is recorded in the
metadata.

| Mode               | Text                                       | Attribute values                                                                                                                                                                         |
| ------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `labels` (default) | Kept only for label-like elements (below). | `class`, `name`, `type`, `role`, `slot`, `aria-hidden`, `id`, `data-*` kept, except value attributes (below). `title`, `aria-label`, `placeholder`, `alt` kept only on controls (below). |
| `structure`        | All masked.                                | As `labels`, but `title`, `aria-label`, `placeholder` and `alt` are always masked.                                                                                                       |
| `full`             | All kept.                                  | All kept. Opt-in only, for example on a dev org with no real data. Capture logs a warning when it's used.                                                                                |

**Label-like elements** in `labels` mode: an element whose text is kept when it, or an ancestor in
the same tree within two levels, matches one of:

- `label`, `legend`, `button`, `option`, `th[scope="col"]`, `h2`–`h6`
- `[role="button"]`, `[role="columnheader"]`, `[role="tab"]`
- `.slds-form-element__label`, `.test-id__field-label`, `.slds-card__header-title`
- `.slds-text-title` (field labels in the record highlights panel)
- `records-entity-label` (the object name, such as "Account", above the record name; its text is
  shadow text)

Field labels on a record detail page sit in `span.test-id__field-label`, not in a `label`, which is
why that class is on the list. The list is data in the walker, so adding a pattern doesn't change
code.

These are deliberately left out, and are never label-like even under a label-like ancestor, because
Lightning shows record values in them: `a` (lookup fields and related-list rows are links whose text
is a record name), `th` without `scope="col"` (`lightning-datatable` puts the record name in the row
header), `h1` (page and record titles), `lightning-formatted-*` (field values), and
`[role="option"]` and `[role="menuitem"]` (lookup search results and the recent-items menus list
records in these roles; a native `option` is a picklist value and is kept). Two kinds of link are
exempt from the `a` rule, because their text is a label: Lightning tabs (`a[role="tab"]`) and
datatable column headers (`a[role="button"]`).

**Always masked.** Everything inside these is masked, text and control attributes alike, whatever
the rules above say:

- `.tabBarItems`: the console's workspace and subtab bars, whose tabs are named after records
  (`div.tabBar[role="tablist"] > ul.tabBarItems > li.oneConsoleTabItem > a.tabHeader[role="tab"]`,
  with the record in its `title`); subtab bars add `slds-sub-tabs`. The one class covers both.
- `tbody` and `[role="row"]` outside a `thead`: data rows label their controls after the row's
  record. The console's split-view list, for example, labels each row's checkbox
  `aria-label="Select item <record name>"`.

**Controls**, where `title`, `aria-label`, `placeholder` and `alt` are kept in `labels` mode outside
the always-masked areas: `button`, `input`, `select`, `textarea`, and elements with a role of
`button`, `tab`, `checkbox` or `combobox`. `a`, `option` and `menuitem` roles are not controls here,
for the same reasons as above. One known over-mask: a related list card's `article[aria-label]` holds
the list's name, but an `article` isn't a control, so it's masked.

**Value attributes** hold record data even when it doesn't look like an ID, so they're masked in
`labels` and `structure`: `value`, `data-value`, `data-text`, `data-label-value`, and `data-*` names
ending in `-value`. The list is data, like the label list.

**In every mode except `full`**:

- Masked text and values are replaced with their length, such as `"•12"`, so the agent can still see
  that the element has content.
- Kept values have anything that looks like a record ID (15 or 18 letters and digits, including at
  least one digit) replaced with `•id`, and anything that looks like an email address replaced with
  `•email`. This covers `data-*` values, which often carry record IDs.
- `meta.url` has its query string and fragment removed and record IDs replaced:
  `/lightning/r/Account/•id/view`. It keeps the org's host name (see Open questions).
- `meta.title` keeps only its last `|`-separated part, the app name, and replaces every other part
  with its length: `•4 | •7 | Salesforce`. Where the record name sits in a title isn't consistent
  (`Acme | Account | Salesforce` on a record page, `Contacts | Acme | Salesforce` on a related list),
  so no part except the last is safe to keep. `meta.url` already shows the object and page type.

`meta.error` is copied as-is, even when a failed assertion's message includes record values, because
the same text is already in the test report (see Open questions for `structure` mode).

`labels` is a heuristic, and it will sometimes keep a record value or mask a label the agent needs.
`structure` is the safe mode. Each rule above has a fixture test, so a known leak gets a test when
it's fixed. Because text is masked, `find --text` matches labels, not record values: search by field
label, or use `full` on a dev org.

## 2. Snapshot format

```jsonc
{
  "format": "simply-utam-dom-snapshot",
  "version": 1,
  "meta": {
    "capturedAt": "2026-10-16T14:03:11.402Z",
    "trigger": "failure", // failure | step | manual
    "url": "https://…/lightning/r/Account/•id/view",
    "title": "•4 | •7 | Salesforce",
    "viewport": [1280, 900],
    "label": "after opening Account", // step and manual triggers, when given
    "scenario": "Create Account",
    "step": "When user clicks \"New\"", // failure trigger only
    "error": "Element not found …", // failure trigger only
    "mask": "labels",
    "truncated": null, // or { "reasons": ["nodes" | "hiddenNodes" | "time", …] }
    "focus": "0.1.3.s.0.2", // the focus element's address, when a focus was found
    "pageObjectPackages": { "salesforce-pageobjects": "12.0.0" }, // added when written inside a project
  },
  "root": {/* node */},
}
```

A node, here a field value on a record page in `labels` mode:

```jsonc
{
  "address": "0.1.6.s.3.s.1",
  "tag": "lightning-formatted-text",
  "attrs": { "data-output-element-id": "output-field" },
  "rect": [312, 480, 96, 18],
  "shadow": { "mode": "synthetic", "children": [], "text": "•10" },
}
```

`mode` is one of `native`, `synthetic`, `unknown` or `unreadable`. Handles aren't stored:
`parseDomSnapshot` adds each node's `id` (`n812`) as it reads the file, so `DomNode` in memory and in
`--json` output has both `id` and `address`. The file keeps only `address`, so a key means the same
thing on disk and in memory, and a handle can't outlive the numbering that produced it.

`version` is a whole number that goes up when the format changes in a way an older reader can't
handle. `parseDomSnapshot` rejects JSON whose `format` isn't ours or whose `version` is newer than it
understands, and names both in the error. Adding an optional field, or a new `trigger` value, doesn't
change `version`.

## 3. Capture

Capture is the walker plus a way to run JavaScript in the page. There are two sources: a
WebdriverIO test run, and a browser a person drives, through its DevTools console. Both run the same
walker source with options built by the same code, and both save through `writeDomSnapshot`, so the
read commands never depend on where a snapshot came from.

### In a test run

`captureDomSnapshot(options)` takes a WebdriverIO `browser` or any `SnapshotPage`:

```ts
type SnapshotPage = {
  /** Run the walker's source in the page and return the JSON text it produces. */
  evaluate(source: string, timeoutMs: number): Promise<string>;
};
```

- It returns `Promise<DomSnapshot | undefined>` and never throws: on any failure it returns
  `undefined` and writes a warning through the injectable `log`.
- `browser` is typed structurally (anything with `execute`), like `NavigableBrowser`, and defaults to
  the global `browser`, as `LightningNavigator` does. It's turned into a `SnapshotPage` that calls
  `browser.execute`. `SnapshotPage` is the seam tests use, and the one later capture routes plug into.

**On failure.** The scaffolded `wdio.conf.mjs` already took a screenshot in `afterStep` when a step
fails. Its hook now captures the snapshot first, before anything else changes the page, then saves
it with `writeDomSnapshot` and attaches it to the Allure report, each in its own `try`, so neither
failing can cost the other or the screenshot (`writeDomSnapshot` can throw on a full disk, or a
`latest.json` another program holds open on Windows). The `onPrepare` hook sets one
`UTAM_SNAPSHOT_RUN_ID` for every worker and prunes old runs. Core doesn't import Allure; the hook in
the test project does, and `@wdio/allure-reporter` is already a dependency `init` checks for.
Cucumber doesn't call `afterStep` for an undefined step, so there is no useless failure snapshot for
a step with no definition yet.

**Timeouts.** The step timeout must outlast UTAM's waits. If it doesn't, a UTAM wait on an element
with `"wait": true` outlasts the step: Cucumber fails it with only `function timed out`, and the
failure capture runs while UTAM is still polling the page. When the step outlasts the wait, UTAM
gives up first, its error names the locator it couldn't find (`… inside its scope element` or
`… inside its scope shadow root`), and the capture shows the page UTAM searched. The scaffold sets
`waitforTimeout` to 60 s and `cucumberOpts.timeout` to that plus a 30 s margin. Under `DEBUG`, only
the step timeout grows, to 30 minutes plus the margin, so a session paused in `browser.debug()`
survives while a wrong locator still fails within a minute.

**At a chosen step.** `init` scaffolds a step definition, with an optional label, as
`dom-snapshot.steps.mjs` next to `hello.steps.mjs` in `<sourceDir>/test/utam/step_definitions/`, a
path the scaffolded `cucumberOpts.require` globs already match:

```gherkin
And I capture the DOM snapshot
And I capture the DOM snapshot "after opening Account"
```

`init` puts the step in the project's first UTAM test folder, which in an existing project can be
`<sourceDir>/tests/utam` or `test/utam` at the project root, beyond those globs. When `init` also
generates `wdio.conf.mjs`, it adds such a folder to `specs` and `cucumberOpts.require`, so the step
is defined wherever it lands.

A `Before` hook in the same file records the scenario's name for the file name. The step imports
`@simplysf/simply-utam` when it runs, not when the file loads: `init` adds the file to existing
projects, and one whose installed `@simplysf/simply-utam` predates DOM snapshots would otherwise fail
to load its step definitions, and so every scenario. Instead only the capture step fails, saying to
upgrade. Running only that scenario (`--spec features/account.feature:12`) takes the browser to the
page and writes the snapshot; a step not written yet after it is undefined and fails the scenario,
but only once the steps before it, and the snapshot, are done.

The step captures the page as it is, without waiting. Lightning keeps rendering after navigation
returns, so a capture taken too early shows the app's frame with the page half-built. Page-object
steps hide this because they wait for their elements, so the guide says to put the snapshot step
after a step that waits for something on the page (see Risks for navigation).

**While paused.** The scaffolded `before` hook registers `browser.domSnapshot(label?)` as a custom
command (trigger `manual`), so it can be called from the REPL during `browser.debug()`.

**Existing projects.** `init` only writes templates that are missing, so a project that already has
`wdio.conf.mjs` doesn't get the new hooks. When `init` keeps an existing `wdio.conf.mjs` that doesn't
capture snapshots, it prints a note pointing to the CLI README section with the snapshot API loader
and the `onPrepare`, `before` and `afterStep` snippets to copy. The snapshot step is a new file, so
`init` adds it to existing projects too. Like the step, the config loads `@simplysf/simply-utam` with
`import()` and checks the snapshot functions are there, so a project that pins a version predating
DOM snapshots and runs a newer `init` still gets a config that loads: the snapshot hooks skip, and
`onPrepare` warns once to upgrade.

### From the browser console

A test run covers a failing step and any state a scenario reaches. It doesn't cover a page no
scenario reaches yet, which otherwise means writing steps to get there or pausing a test with
`browser.debug()`. And `browser.domSnapshot` runs in the REPL, which needs a person to type into it.
The console route lets a person drive a page in any browser and capture it with the same walker,
without a test run, and it's what an agent's browser tool can run.

**In use.**

1. `simply-utam snapshot console snippet --copy` puts the snippet on the clipboard. Without `--copy`
   it prints it.
2. The person opens DevTools, checks the console's context selector says `top`, pastes and presses
   Enter. Chrome asks them to type `allow pasting` the first time. The snippet copies the snapshot to
   the clipboard and prints a one-line summary.
3. `simply-utam snapshot console import --label "account list"` reads the clipboard, checks the
   snapshot, saves it, and prints the path and the header that every read command prints.

An agent runs steps 1 and 3; only step 2 needs a person.

**The snippet** is `(walker)(options)`, wrapped:

- **Same walker, same world.** It runs the walker's source text, exactly as `captureDomSnapshot`
  sends it, in the page's main world, where WebDriver's `execute` runs it too, so it sees the same
  DOM a test capture does. The options are built by the same code, with `trigger: 'manual'`.
  `--focus` defaults to `auto` here; `--mask`, `--max-nodes` and `--max-hidden-nodes` are the other
  options.
- **Masked in the page.** The mask mode is fixed when the snippet is generated (default
  `UTAM_SNAPSHOT_MASK`, then `labels`), because masking runs in the walker. Record data in `labels`
  and `structure` modes never reaches the clipboard. It warns on `full`, as capture does.
- **The JSON goes to the clipboard**, through the console's `copy()`. Where `copy` isn't defined,
  as in an agent's browser tool or a bookmarklet, it downloads `dom-snapshot-<time>.json` through a
  Blob link instead, for `import --file`.
- **It returns a summary, not the snapshot**: its size, the mask, any truncation, and the import
  command to run next. An agent's browser tool that runs it gets that line, not the whole snapshot,
  in its context.
- **ASCII only.** Non-ASCII characters in the walker's source (such as the mask's `•`) are written as
  `\u` escapes, so no clipboard or terminal encoding can change the snippet.
- **No network calls.** The snippet writes only to the clipboard or a download.

**`import`** reads the clipboard by default (`pbpaste`, `wl-paste` or `xclip`, or PowerShell's
`Get-Clipboard`, with their counterparts for `snippet --copy`), or `--file <path>`, or `--file -` for
standard input. It checks the JSON with `parseDomSnapshot` and warns when the mask is `full`.
`--label` sets the label at import time, so one snippet serves every capture; the rest of `meta` is
kept as captured, so a failure snapshot downloaded from CI keeps its scenario, step and error. It
saves with `runId: MANUAL_RUN_ID` (see Files).

Core builds the snippet (`domSnapshotSnippet`) and parses and labels an import
(`importDomSnapshot`); the CLI owns the clipboard, which nothing but a person's terminal needs, behind
an injectable command runner.

A page driven by hand isn't necessarily the page the test sees: a different user, profile, window
size or feature flag can render a different DOM. The test run stays the faithful capture; the guide
says so, and the header's URL and viewport show where a capture came from.

### Command structure

Commands that read snapshots are `snapshot <verb>`. Commands that produce them are
`snapshot <source> <verb>`, one oclif topic per capture source, since each source has its own
lifecycle:

```text
simply-utam snapshot
├─ find · node · path · tree · lookup     read snapshots and the page-object index
└─ console                                capture by pasting into the DevTools console
   ├─ snippet    print the capture snippet, or copy it
   └─ import     save what the snippet produced
```

- **Test runs** have no commands: the scaffolded hooks and the capture step write their snapshots.
- **Not one `snapshot capture --from …`.** Sources share no verbs: the console takes two steps with a
  person in between, and the Chrome route (Later phases) needs a start and a stop. One command would
  carry flags that apply to only one source each.
- **`console import` reads any snapshot file**, such as one downloaded from CI, since checking and
  saving a file is the same work. If importing from elsewhere becomes common, it can move up to
  `snapshot import`.

## 4. Files

`writeDomSnapshot(snapshot, options?)` writes the snapshot and returns the path:

- Snapshots go to `.utam/snapshots/<runId>/<name>.json`. `runId` comes from `UTAM_SNAPSHOT_RUN_ID`
  (through the injectable `env`), which the scaffolded `onPrepare` hook sets once per test run to
  `snapshotRunId()`, the current time as `20261016T120000`, so every worker in a run uses the same
  folder. In a project without the hook, each process uses the time of its first capture. Run ids
  must sort in time order, since pruning keeps the ones that sort last; numbers in a custom id
  compare as numbers (`build-9` before `build-10`). A `runId` option overrides both: console imports
  pass `MANUAL_RUN_ID` (`manual`), so they collect in `.utam/snapshots/manual/`.
- `<name>` is `<scenario>--<step>` for failures, and `<scenario>--<label or number>` for the step and
  the custom command. A capture with no scenario, such as one from `browser.domSnapshot` or the
  console, uses `manual` in its place. Each part is cut down to letters, digits and `-`, and capped
  at 60 characters. A number is appended if the name is already taken; files are created with the
  exclusive `wx` flag, so two workers can't both take the same name.
- It also writes `.utam/snapshots/latest.json`, a copy of the most recent snapshot, which the query
  commands read by default. It's written to a temporary file in the same folder and renamed over
  `latest.json`, so a reader never sees it half-written; where the rename can't replace it (on
  Windows, while another process has it open), it's written in place. With more than one worker,
  `latest.json` is whichever finished last, which is why every command prints a header saying which
  snapshot it read (see CLI).
- It adds `meta.pageObjectPackages`: the version of each page-object package the index would read
  (see Page-object index).
- `pruneDomSnapshots({ keepRuns })` deletes all but the newest `keepRuns` run folders; the scaffold
  keeps 10. It never deletes `manual/` and doesn't count it as a run, so hand captures neither push
  out test runs nor get pruned by them.
- The file system is an injectable sink, so tests don't touch disk.

Snapshots must not be committed. `init` adds `.utam/snapshots/` to `.gitignore` (creating the file
when it's missing; `--no-gitignore` skips it), add-only, on the same merge design 0002 built for
`.forceignore`: never removing or rewriting a line, adding under a `# Ignore UTAM` comment. The two
files share one implementation of the merge. The rule is `.utam/snapshots/`, not `.utam/`, because
`init` also scaffolds `.utam/namespace-map.json`, which belongs in git. An existing `.utam/` rule
counts as covering it.

## 5. Page-object index

`buildPageObjectIndex(options)` reads:

- **The project's own page objects**, found from the project's `utam.config.json`
  (`pageObjectsRootDir` and `pageObjectsFileMask`; the scaffolded default is
  `**/__utam__/**/*.utam.json`), not from a fixed folder name.
- **Every page-object package the project's namespace configuration maps to** (below).
  `salesforce-pageobjects` 12.0.0, the usual one, ships `dist/utam.manifest.json` (page object name →
  source path) and 1,638 `.utam.json` sources, 445 of them root page objects.

Parsing all of them takes well under a second, so the index is built each time and not cached.

### Where packages come from

Both namespace files name import prefixes, for different reasons, and the index reads both:

| File                                 | What it maps                                                    | Prefixes that name a package                                                        |
| ------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `generator.config.json` `namespaces` | A component namespace to the import prefix the generator writes | The values, except `c`, the project's own namespace, and any under its package name |
| `.utam/namespace-map.json`           | A project prefix to an external one, rewritten after generation | The values; the keys are the project's own prefixes                                 |

The generator's `namespaces` cover packages with their own namespace (`lightning` →
`salesforce-pageobjects/lightning/pageObjects/`). The namespace map covers packages whose components
share `c` with the project, which the generator can't tell apart, so the build's `rewrite` task
moves them (`<appName>/pageObjects/shared` → `shared-components-pageobjects/pageObjects/shared`).

From each prefix, the package name is its first path segment, or its first two for a scoped package
(`@acme/page-objects/…`). The index resolves each name once from the project, with `createRequire`;
several prefixes into one package index it once. A package that doesn't resolve gets a warning
naming it and the file and entry that mapped it. The namespace map is read through the loader
`rewrite` uses, so the index and the build agree on what the file says and on longest-prefix-first
order. The index reads the default path only (see Open questions).

The project's own prefix is the generator's `c` namespace, which `init` writes and the generator
compiles the project's components under. It's usually the package name, scope included
([design 0004](0004-self-referencing-page-objects.md)), but a project may keep the scope-free name
older versions wrote, or set another with `--app-name`. Only without a `c` does the index fall back
to the namespace under the package name, then to `<package name>/pageObjects/`.

The index doesn't name `salesforce-pageobjects`. It's indexed when a namespace maps to it, like any
other package:

- **Salesforce projects get it with no extra step.** The scaffolded `generator.config.json` maps
  `lightning` to it, and one mapping is enough: the manifest covers every namespace it ships.
- **Other projects aren't told about it.** No mapping, no package, no warning.
- **Salesforce defaults stay in the scaffolder**, which adds the dependency and the `lightning`
  mapping. The index stays neutral.
- **Removing the `lightning` mapping drops it from the index.** That's intended: the generator no
  longer types anything as one of its page objects either.

### Reading a package

A package is read in one of two layouts:

- **With a manifest** (`dist/utam.manifest.json`): by manifest name, with the import path from the
  source's folder under `dist/` (see Names and import paths).
- **Without one**: every `*.utam.json` under the package's folder, skipping `node_modules`. The
  prefix describes the compiled JavaScript test code imports, not where the sources sit, which may
  be anywhere in the package (`src/**/__utam__/`), so the search isn't limited to the folder the
  prefix names. Each entry's `name` is its import path, as for project page objects, or
  `<package>/<file>` when it has none.

**Import paths are checked, not assumed.** Without a manifest, the candidate import paths for a file
are each prefix that names the package plus the file's name without `.utam.json`, and the namespace
map applied to the project's import path for that name. (A namespace map entry is a string prefix,
not a folder, so the second form is the one a map-found package usually needs.) With a manifest, the
candidate is the path the manifest rule gives. The index keeps the first candidate `require.resolve`
finds from the project, which respects the package's `exports` map and confirms the compiled file
ships. A package that exports its page objects to `import` only resolves nothing, so its entries get
no import paths. `salesforce-pageobjects` 12.0.0 exports `./*` to `dist/*.cjs` for `require`, and
checking all of its entries takes about 60 ms.

A file whose candidate doesn't resolve is still indexed, without an `importPath`: its tags and typed
elements still help `lookup` and `path`, and the output says it has no known import path. A source
that only exists for the package's own tests then shows up as noise instead of a wrong answer. Two
identical copies of one source (a package shipping both `src/` and `dist/`) are indexed once; of two
different sources with one name, the first in path order takes the import path. A candidate that
doesn't resolve is still registered as another name for its entry, so a `type` that names it links.

A package with neither a manifest nor a readable `.utam.json` gets a warning. Entries are ranked the
project's own page objects first, then packages in the order they're found: the generator's
`namespaces` in file order, then the namespace map, longest prefix first.

### Names and import paths

Page objects are referred to in two forms, and the index treats them as the same page object:

| Form          | Example                                              | Used by                                                                         |
| ------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| Manifest name | `utam-lightning/pageObjects/input`                   | `type` and `implements` in the shipped `.utam.json` files.                      |
| Import path   | `salesforce-pageobjects/lightning/pageObjects/input` | Test code, and `type` in the project's own (generated or hand-written) sources. |

The project's sources use import paths because the scaffolded `generator.config.json` maps the
`lightning` namespace to `salesforce-pageobjects/lightning/pageObjects/` (and `c` to
`<appName>/pageObjects/`). The index reads those `namespaces` to translate. Output always leads with
the import path, and where it shows a manifest name too, it says that a `.utam.json` `type` uses the
import path.

For a manifest package, the import path is the package name, the source file's folder under `dist/`,
then `pageObjects/`, then its name without `.utam.json`:

| Manifest name                                        | Source                                             | Import path                                                            |
| ---------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| `utam-lightning/pageObjects/input`                   | `dist/lightning/input.utam.json`                   | `salesforce-pageobjects/lightning/pageObjects/input`                   |
| `utam-access-summaries/pageObjects/accessFromTabSet` | `dist/access/summaries/accessFromTabSet.utam.json` | `salesforce-pageobjects/access/summaries/pageObjects/accessFromTabSet` |

For project page objects, the import path follows `pageObjectsOutputDir` in `utam.config.json` and
the generator's `namespaces`, and the entry records the compiled file. Test code imports it by
relative path, or by its import path when `package.json` `exports` maps that path to the compiled
file ([design 0004](0004-self-referencing-page-objects.md)); the entry's `exported` flag says so.
Project page objects aren't in any manifest, so their `name` is their import path.

**The namespace map in matching.** The rewrite also changes what the project's own page objects
say, so the index applies it in two more places, through extra names registered once the packages
and the project are read:

- **The naming convention** (see Tags). For `c-modal`, the generator's `c` mapping gives
  `my-app/pageObjects/modal`, but with a namespace map entry the page object is
  `shared-pageobjects/pageObjects/modal`. The convention's candidates go through the namespace map,
  longest prefix first, as the rewriter does.
- **Typed elements before a rewrite.** If `lookup` or `path` runs before the build's `rewrite` task,
  the project's generated `type` values still use the project prefix. The index registers the
  pre-rewrite form as another name for the rewritten entry, so the link holds either way.

### Tags

The index maps each tag to page objects from:

1. **Root selectors.** A root page object's `selector.css`.
2. **Typed elements.** Any element in any page object whose `type` is a page object. This covers
   non-root page objects, which only get a selector from the parent that uses them.
3. **The naming convention**, as a fallback (`lightning-input` → `utam-lightning/pageObjects/input`,
   for any package that ships a manifest), marked `byConvention` and used only when it names a page
   object that exists.

For 1 and 2, a selector can list several alternatives (`lightning-primitive-input-simple,
lightning-primitive-input-checkbox-button, …`) and each one can be compound (`.x lightning-button`,
`lightning-input[data-id="name"]`). The tag is taken from the last part of each comma-separated
alternative, so one selector can map to several tags. An alternative whose last part has no tag
(`.slds-button`, `[slot='secondaryFields']`) adds no tag; `path` still finds routes through it by
matching the whole selector (see Queries).

Reading the `.utam.json` sources also handles `%s` and `%d` argument placeholders and `returnAll`
(neither affects the tag); elements under both `elements` and `shadow.elements`, nested to any depth,
each recording which of the two it's declared in; `css` selectors only (`accessid`, `classchain` and
`uiautomator` are mobile selectors with no tag); and `type` values that aren't page objects
(`container`, `frame`, and arrays of basic types such as `["clickable", "editable"]`).

### Interfaces

Some page objects are interfaces with one implementation per profile. 89 of the 12.0.0 sources are
interfaces, and 168 are implementations. For example, `one-record-home-flexipage2` is the root
selector of two implementations, `recordHomeTemplateDesktop` (the default) and
`recordHomeWithSubheaderTemplateDesktop` (the `entity: lead` profile). Both implement
`utam-global/pageObjects/recordHomeFlexipage2`, which is what test code imports, and UTAM picks the
implementation at runtime from the configured profiles. When a tag maps to an implementation, the
index reports the interface it implements as the page object to use, and lists its implementations.
It doesn't record which profile selects each implementation (see Later phases and Open questions).

### What an entry records

Each entry has its names (manifest name and import path), whether it's a root page object and its
root selector, its `source` (`project` or the package's name), its compiled file for a project page
object, whether it matched by convention, its description, and its interface or implementations. It
also records:

- **Public and private elements**, each with its `type`, selector, the tags in it, whether it's in
  `elements` or `shadow.elements`, and whether it's a list or a container. Many shipped page objects
  keep elements private and expose them through methods; without private elements, "reachable
  through" annotations would miss most routes. A private element records the public methods that use
  it (from `compose` statements, including `applyExternal` parameters and `elementReference` uses).
- **Public methods**, with parameters, return type and a one-line summary of the `compose`, so an
  agent can tell what a method does and what a container getter takes without reading the page
  object's source.

## 6. Queries

Plain functions over a snapshot and the index. Each returns a text form and a JSON form, and the
text form has an output limit (default 200 lines) with a note when it cuts output short. Each line
that names a node starts with its handle and writes the node like CSS: `tag#id.class[attr="value"]`,
then its text in quotes and its shadow text after `#shadow`. Aura bookkeeping attributes
(`data-aura-rendered-by` and similar) are left out of these lines.

| Function                                       | Answers                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `findNodes(snapshot, options)`                 | Which nodes match text, an attribute, a tag or a class.                                         |
| `querySnapshot(snapshot, selector, scope?)`    | Which nodes a CSS selector matches in a scope, in document order, as `findElement` sees them.   |
| `componentPath(snapshot, handle, options)`     | The custom elements from the document down to a node, annotated from the index.                 |
| `componentPathByText(snapshot, text, options)` | The same, for the only visible node matching `text`; otherwise the candidates, and exit code 1. |
| `subtree(snapshot, handle, { depth })`         | The pruned tree under a node, to a depth.                                                       |
| `nodeDetails(snapshot, handle, options)`       | One node in full.                                                                               |
| `nodeAncestors(snapshot, handle)`              | A node's ancestors, nearest first, with each shadow crossing.                                   |
| `utamErrorHint(snapshot, index)`               | For UTAM's not-found error, the `find --css` that repeats UTAM's search.                        |
| `snapshotHeader(snapshot, options)`            | The lines every snapshot command prints first (see CLI).                                        |
| `lookupPageObject(index, tagOrName)`           | The page objects for a tag, or one page object by name.                                         |
| `searchPageObjects(index, words)`              | Page objects whose name, import path, tags or description contain every word.                   |

### `find`

`findNodes` filters by any combination of `text` (a case-insensitive substring of a node's own text,
its shadow text, or any attribute value except `class`), `attr` (`name`, or `name=value` as a
case-insensitive substring, so `class=navexWorkspace` also matches `navexWorkspaceManager`), `tag`
(exact) and `class` (one whole class token, case-sensitive, as `.name` matches it).

Visible matches come first, in document order, because a search by label is usually for the one the
user sees. Hidden ones are counted, or listed with `all`, each with the top of the hidden subtree
it's in. When there are hidden matches, a last line names the first match in the document's own tree
(not inside a shadow root), which is the one a root selector finds first, or says every match is
inside a shadow root, and points to `find --css`.

`querySnapshot` (`find --css`) tests a selector the way UTAM's `findElement` runs it, because a
wrongly scoped root page object loads a hidden copy silently, with no error. It lists every match in
document order, hidden ones included, marks the first (the one `findElement` and `utam.load` take),
and warns when that one is hidden, naming the first visible match instead. The scope follows UTAM's:

| Scope                        | Searches                                          | For                                       |
| ---------------------------- | ------------------------------------------------- | ----------------------------------------- |
| the document (default)       | The document's own tree, not inside shadow roots. | A root page object's selector.            |
| `--within <handle>`          | That element's light descendants.                 | An element declared in `elements`.        |
| `--within <handle> --shadow` | That element's shadow root.                       | An element declared in `shadow.elements`. |

As in the browser, combinators don't cross a shadow root, and ancestors above the scope still count
for combinators inside it. Where the snapshot can't judge a selector, the output says so:

- `%s` and `%d` placeholders in an attribute test, and `%d` in a child-position argument
  (`li:nth-child(%d)`), match any value.
- Live-state pseudo-classes (`:hover`, `:focus`, `:checked`, …) are ignored, so the selector may
  over-match. One that is a whole compound (`:hover, a` or `ul > :focus`) stands for any element;
  the same names inside an attribute value or a string are left alone.
- A test on an attribute whose value is masked can't be checked, so a masked node may be missing.
- A tag, class or id that no node in the snapshot has may be on a plain wrapper the walker pruned,
  so the live page may match differently.
- `>`, `+`, `~` and child-position pseudo-classes (`:nth-child`, `:first-child`, …) can match
  differently across a pruned wrapper.

A bare "0 matches" is easy to doubt, especially with synthetic shadow roots, which are boundaries
too. So when nothing matches in the scope, `find --css` says where the selector does match: each
match outside the scope, with the scope that would find it, or that it matches nothing anywhere in
the snapshot.

### `path`

`componentPath` takes a handle; `componentPathByText` takes text and runs `find` first. With exactly
one visible match it prints the path. With more than one, it lists the candidates with their handles
and exits with code 1, so the caller picks one. With only hidden matches, it says so and suggests
`find --all`. It never picks a match silently.

The path shows one custom element per line, indented, plus the target, and any plain element that
is the first match of one of the project's own root page objects' selectors: that's how a project
page object that scopes a shipped one to a container, as the scoping recipe does, appears.
`#shadow(<mode>)` before a line means that element is in the previous one's shadow root; without it,
the element is in the light DOM (a child, or slotted content). `(hidden)` marks the top of a hidden
subtree. Each custom element is annotated with its page object (import path, plus `root`,
`interface`, or `project` with its compiled file), with **no page object found** (which doesn't prove
none exists), or with **unreadable shadow root**.

Below that, three kinds of note:

- **`↳ reachable through <page object>, element "<name>" "<selector>"`**: a page object higher on the
  path has an element that likely selects this one. For a public element that's its getter; for a
  private one, the public methods that use it; `container` means the getter takes the page object
  type to load there. It's matched by tag against every page object above, nearest first, and against
  the nearest one also by the element's whole selector, evaluated over the snapshot as
  `querySnapshot` does. That finds routes whose selector names no tag, such as a container selected
  by `[slot='secondaryFields']`. A route found in an implementation names the interface, then the
  implementation it's in. The line says whether the element is declared `light` or `shadow`. A
  private element counts as used by the public methods that use it and by the getters of public
  elements nested in it. For shipped page objects the declared scope isn't checked against the page,
  so this is a likely route, not a proven one.
- **`⚠ root selector "…" matches N in the document`**: under a root page object, when its root
  selector (or an implementation's) matches more than once or its first match is hidden.
  `utam.load` takes the first, so the line gives the `find --css` to check it with. It isn't shown
  when one of the project's page objects above reaches the root page object through an element:
  then the root isn't loaded with `utam.load`, and the warning would hide the fix it describes.
- **`⚠ … is declared in elements, but <node> is in <host>'s shadow root`** (or the reverse): the
  scope check, for the project's own page objects. `path` replays each element's declaration from
  the page object's root over the snapshot, taking the first match at each level as UTAM does, and
  where an element selects a node on the path in the other scope, it names the element and the list
  to move it to. A missing `"shadow"` is a common mistake in a hand-written page object, and UTAM
  reports it only as a locator error. A misdeclared element is reported once, not again for the
  elements nested in it, and a route through it prints as **`↳ not reachable as declared`**. Shipped
  page objects aren't checked: they aren't the project's to fix.

Example, abridged, on a console app with an inactive workspace tab before the active one:

```
one-record-home-flexipage2               salesforce-pageobjects/global/pageObjects/recordHomeFlexipage2 (root, interface)
  ⚠ root selector "one-record-home-flexipage2" matches 2 in the document; utam.load takes the first, n463 (hidden). See find --css "one-record-home-flexipage2".
  #shadow(synthetic)
  …
      records-highlights2                salesforce-pageobjects/records/pageObjects/highlights2
        #shadow(synthetic)
        …
        records-highlights-details-item  salesforce-pageobjects/records/pageObjects/highlightsDetailsItem
          ↳ reachable through salesforce-pageobjects/records/pageObjects/highlights2, element "secondaryFields" "[slot='secondaryFields']" (public container, getSecondaryFields(pageObjectType: constructor))
          records-output-phone           salesforce-pageobjects/records/pageObjects/outputPhone
            #shadow(synthetic)
            lightning-formatted-phone #shadow "•14"  ← target [n1288]
```

### `tree` and `node`

`subtree` prints the pruned tree under a node to a depth. Under a node with a shadow root, its
`#shadow(<mode>)` children come first, then its light children under `light DOM:`, so every child's
side is explicit. Where the depth stops it, it says how many children are left. A long tree ends by
repeating the node it started at, because some agent harnesses keep only the tail of long output.

`nodeDetails` shows one node in full (handle, address, every recorded attribute unclipped, text,
shadow, size or hidden subtree, parent and side, and each child), so nobody needs to script over the
JSON. `nodeAncestors` (`node --ancestors`) lists the node's ancestors, nearest first, with each
shadow crossing on its own line, since a selector's reach ends there. It has no page-object
annotations; it's for finding a container to scope a selector with, which `find --css` then tests.

### `lookup`

`lookupPageObject` takes a tag, or a page object's name, import path or short name
(`recordHomeFlexipage2`), and shows each match in full and without clipping: its names, how it
matched the tag, its interface or implementations, and each method and element from the entry
(see What an entry records), with every element marked `[light]` or `[shadow]` so nobody needs the
raw `.utam.json` to see where UTAM searches for it. `searchPageObjects` (`lookup --search`) is for
when the name isn't known yet: name matches first, then tag, then description. `lookup` needs no
snapshot.

## 7. CLI

The commands are `snapshot find` (`--css` for `querySnapshot`), `path`, `tree`, `node`
(`--ancestors`), `lookup` (`--search`), and `console snippet` and `console import` (see Capture).
Their options are in the CLI's help and the usage guide. The rules that hold across them:

- The read commands (all but `lookup`) take `--file`, default `.utam/snapshots/latest.json`.
- Every command takes `--json`; every one but `console snippet` takes `--project-dir` (default
  `.`); the five read commands take `--limit` (the text output limit, default 200).
- Every snapshot command first prints a header naming the file, trigger, label, capture time, URL and
  mask (and `TRUNCATED` with its reasons), then the scenario, the step and the error, keeping a failed
  assertion's `Expected` and `Received` lines. `latest.json` is only the most recent capture, so the
  header is how the reader checks it's the snapshot they think it is.
- When the error is UTAM's not-found error (`… inside its scope element` or
  `… inside its scope shadow root`), the header adds the `find --css` that repeats UTAM's search, in
  the scope the message names. When a root page object declares that selector in that scope and its
  chain resolves in the snapshot, the suggestion has `--within` (and `--shadow`) the element UTAM
  searched from; otherwise it says the element can't be identified and to check both scopes. The
  error names the locator but not the page object, so this is the shortest way from the error to
  the page.

| Exit code | Meaning                                                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0         | Success, including a `find` with no matches (an empty result is an answer), and a saved import.                                                                                                   |
| 1         | `path --text` didn't find exactly one visible match.                                                                                                                                              |
| 2         | Bad input: the file or JSON isn't a snapshot, its version is newer, an unknown handle, an address in place of a handle, a selector that can't be parsed, an empty clipboard or no clipboard tool. |

## 8. Usage guide

One document, the `utam-dom-snapshots` agent skill, at `skills/utam-dom-snapshots/SKILL.md` in the
`@simplysf/simply-utam` package. Its `name` and `description` frontmatter let an agent harness load it
when a task involves a UTAM step, page object or selector. `init` doesn't install it: the user links
or copies the skill into their agent's skills folder, as the
[CLI README](../../packages/simply-utam/README.md#agent-skills) shows.

- **A skill, not a scaffolded file.** Agents discover skills only in their own skills folders, so a
  guide in the UTAM test folder is read only when someone points an agent at it.
- **In the CLI package.** The skill documents the CLI, and the CLI is the package a test project
  installs, so `node_modules/@simplysf/simply-utam/skills/` is a stable path to link to. Core, a
  dependency of the CLI, isn't always at the top of `node_modules`.
- **Linked, so it matches the installed version.** A symlink follows each upgrade, where a scaffolded
  copy kept the version `init` wrote, since `init` doesn't overwrite existing files. A copy remains an
  option for a user who wants to edit it.
- **Room for more.** Each skill is one folder under `skills/`, so a later skill for another part of
  simply-utam needs no scaffolding change.

It explains the tool, and it also carries the two page-object authoring recipes an agent needs to
act on what the tool shows: **attach your own page object below the last shipped one**, and **scope a
shipped root page object to the visible copy**. In every authoring session of the agent evaluation,
most of the time went to learning these two patterns from UTAM's and the shipped page objects'
sources, not to reading the page (Appendix C). The tool says where to attach a page object and which
copy to scope to; the recipes say how. There is no separate cookbook (see Alternatives).

The guide keeps the two kinds of content apart: the sections on the tool explain its output, and the
recipes, in their own section, are UTAM knowledge that holds with or without snapshots. That keeps
each part short, and lets the recipes move into a skill of their own if the guide outgrows one file.
Besides the commands, it covers where snapshots come from (and checking the header), capturing by
hand, the workflows for writing a step and fixing a failing one, and what to do when something
doesn't match.

## Public surface

The exports are listed in the [core README](../../packages/simply-utam-core/README.md#dom-snapshots)
and `test/index.test.ts`. Two decisions shape them:

- **They go on core's root export, not a new `./snapshot` subpath.** The scaffolded `wdio.conf.mjs`
  imports them, and a test project depends only on `@simplysf/simply-utam`, which re-exports core's
  root but not its subpaths. A subpath would make test projects depend on core directly as well. The
  existing subpaths hold build-time tooling the CLI uses, not what a test run imports.
- **Core takes `css-select` as a runtime dependency**, with a caret range like its other
  dependencies. `querySnapshot` runs it through an adapter over the snapshot tree, which gives full
  CSS selector syntax and, with the adapter deciding the scope, the same answer as UTAM's
  `findElement`: the first match in document order within one tree scope. A hand-written matcher for
  the subset page objects use would be one more place to disagree with the browser. The lockfile pins
  it for this repository, and the `querySnapshot`/`querySelectorAll` parity tests catch a release
  that changes matching. AGENTS.md asks for discussion before core takes a new runtime dependency;
  this design is that discussion.

Tests add `jsdom` and `@lwc/synthetic-shadow` as devDependencies.

## Testing

The test files hold the cases; this is the approach:

- **The walker runs as shipped.** Tests load it from the same text core sends (`walker.js`, read as
  text) and run it in a separate jsdom global, where nothing from core exists, which proves it has no
  closures. A build check confirms `lib/` holds an identical copy. jsdom doesn't implement
  `checkVisibility` and returns zero for every `getBoundingClientRect`, so the walker takes both as
  optional parameters that tests replace; in the browser they default to the real ones. Each masking
  rule has a fixture, so a leak that's fixed gets a test.
- **Synthetic shadow** is tested with `@lwc/synthetic-shadow` loaded into jsdom, each rendered
  element marked with its owner by hand as the LWC engine does, so traversal is checked against the
  emulation Lightning uses and not only native shadow roots. It doesn't reproduce a host's slotted
  light children; that part is checked against captured pages (see Risks).
- **Selector parity.** The same selectors run through `querySnapshot` and through
  `querySelectorAll` on the jsdom fixture the snapshot came from must give the same matches, except
  where the output says it can't judge.
- **No org, browser or disk.** Capture runs against a fake `browser` and `SnapshotPage`, files
  against an injected file system, the console commands against a fake clipboard runner, and the
  index against fixture projects and packages.
- **The console snippet** runs in jsdom: with a stubbed `copy`, the copied text matches what
  `captureDomSnapshot` produces for the same page and options, apart from `capturedAt`.

## Alternatives considered

- **`getPageSource()`**: no shadow content, so it can't answer either question.
- **`getHTML()` for the whole page**: includes shadow roots, but it's HTML text with no visibility,
  no pruning, no masking, and no handles to refer to.
- **WebdriverIO's devtools tooling (tracing, session replay)**: built for performance traces and
  replay viewers, not for queries an agent can run. It's heavier, and we can capture what we need with
  `execute` alone.
- **Generic browser tools for agents** (Chrome DevTools MCP, Playwright MCP, Claude in Chrome): they
  give an agent a live page, mostly through the accessibility tree. That tree flattens shadow DOM,
  so it loses shadow boundaries and component tags, which are exactly what a UTAM selector needs. They
  know nothing about page objects, aren't tied to test runs or failures, and log in separately from
  the test user. The console snippet lets one of them run the walker.
- **No selector evaluation at all, leaving every check to a live run**: each live run is slow, and a
  root scoped to the wrong copy fails with a wrong value, not an error, so the agent learns little
  from it. Evaluating CSS over the snapshot answers "which element does this selector find first?"
  before the run.
- **A full offline page object checker**: would walk a page object's elements over the snapshot,
  re-implementing how UTAM resolves a chain. Each part it re-implements is another place to disagree
  with UTAM, and a confident wrong answer costs more than no answer. `path`'s scope check is the one
  narrow exception: it replays only the project's own declarations, one scope at a time, and names a
  mismatch rather than claiming a route works. The live page object check (Later phases) uses UTAM
  itself instead.
- **Scaffolding the guide into the project's UTAM test folder** (the first version): agents don't
  discover it there, and `init` never updates it after an upgrade. See Usage guide.
- **A `skills sync` command that installs and updates the skills**: keeps copies current, but each
  project commits generated copies that still drift until someone runs it. A symlink needs no command.
- **Skills at the repository root**: the first place to look on GitHub, but the root isn't published,
  so a skill there can't be linked from `node_modules` and follows `main`, not the installed version.
- **A Claude Code plugin**: updates through the plugin system, but only for one agent, and versioned
  apart from the CLI it documents.
- **A separate cookbook for the authoring recipes**: keeps the guide about the tool, but an agent
  that loads the guide doesn't load the cookbook, and the recipes are what it was missing.
- **One `snapshot capture --from console|chrome` command**: see Command structure.
- **Reading LWC source only**: misses everything that isn't our own component, and everything decided
  at runtime.
- **The UTAM browser extension**: right answers, but only interactive and only for a person.

### For finding page-object packages

- **Explicit configuration**: a `pageObjectPackages` option, a `--package` flag, or a file listing
  packages with a layout and an import prefix. Predictable, and it handles a package no namespace
  maps to. Not now: every package seen so far is mapped, since the generator and `rewrite` need the
  mapping anyway. A package only hand-written step code uses can get a placeholder entry in the
  generator's `namespaces` whose key matches no component. If that becomes common, explicit
  configuration is the next step, as a second source over the same package reader.
- **Scanning `package.json` dependencies** for packages that ship a manifest or `*.utam.json`:
  finds the most, but is slower, picks up packages by mistake, and still can't tell what to import
  without a manifest or a mapping.
- **Keeping `salesforce-pageobjects` as an implicit default**: saves a project that removes the
  `lightning` mapping from losing it, but brings back the Salesforce assumption and a warning for
  projects that don't use it.
- **Limiting the search to the folder the prefix names**: simpler, but finds nothing when a package
  keeps its sources away from its compiled output, which UTAM's own layout (`__utam__` beside the
  component, compiled to `pageObjects/`) makes likely.

## Risks

- **Synthetic shadow light trees.** The spike confirmed that walking `shadowRoot.children` gives the
  same scoped view as `shadowRoot.querySelector*` on real Lightning pages. Light trees are the gap:
  on flexipage hosts (`flexipage-tab2`, `flexipage-component2`,
  `record_flexipage-desktop-record-page-decorator`), a host's `children` and `host.querySelectorAll`
  differ by a few elements under synthetic shadow, apparently filtered by owner. If UTAM searches a
  host's light DOM there, a path or a `find --css --within` through those elements could be wrong. A
  live run that disagrees with `find --css` is treated as a bug, with its snapshot as the fixture.
- **`labels` masking is a heuristic.** It will sometimes keep a record value or mask a label the
  agent needs. The rules are data, so they're cheap to adjust, and `structure` is the safe mode.
- **Navigation doesn't wait for Lightning.** `goToApplication` returns once the frontdoor redirect
  page has loaded, so anything that checks the page straight afterwards, such as a capture step, sees
  `/secur/contentDoor` or a half-built page. `LightningNavigator` could wait for the target URL and
  for rendering to settle before returning. That changes navigation for every test, so it's a
  separate change; the guide says to capture after a step that waits.
- **Closed shadow roots.** Neither the walker nor UTAM can see into one, so the risk is diagnosis,
  not coverage: without the `unreadable` flag it would look like an empty element. The flag is a
  heuristic; if a managed package with closed roots comes up, check it on one of its pages.
- **A hand capture isn't the test's page** (see From the browser console).

## Later phases

Listed so the current design doesn't box them out. Each one needs its own design before it's built.

| Enhancement                   | What it adds, and why it's later                                                                                                                                                                                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome capture route          | `snapshot chrome start`, `capture` and `stop`: launch Chrome logged in as the test user and capture a tab over the DevTools protocol, through a `SnapshotPage` over Node's `WebSocket`, removing the console's copy and paste. It would fill `meta.org` (`apiVersion`, `instanceUrl`). Appendix B has the spike's findings. |
| Profiles                      | Record the profile that selects each implementation, and read the project's configured profiles. Later because the scaffold configures none and no session needed one.                                                                                                                                                      |
| Checks across snapshots       | Run one `find --css` over several snapshots (each kind of page a step runs on), so a scope checked on one page is checked on the others. Until then, the scoping recipe says to check each kind of page and claim no case not checked.                                                                                      |
| `find --compare <handle>`     | Compares a visible copy's ancestors with a hidden copy's below the point where they join, and tests each differing ancestor as a scope. Built only if agents still struggle to pick a scope with `node --ancestors` and `find --css`.                                                                                       |
| Live page object check        | In a paused test or a Chrome-route browser, loads a candidate page object with UTAM itself and reports which of its elements resolve, element by element. Would turn "reachable through" annotations into proven routes.                                                                                                    |
| Live failure replay           | When a step fails, pauses the session and walks the failing page object's chain with UTAM to show how far it got. Builds on the live check.                                                                                                                                                                                 |
| Comparison with a passing run | Diffs a failing snapshot against the last passing one for the same step, to show what changed after a release or layout change.                                                                                                                                                                                             |
| More triggers                 | `UTAM_SNAPSHOT_AFTER="<step text>"` and `UTAM_SNAPSHOT=all`, through an `afterStep` hook, without editing feature files.                                                                                                                                                                                                    |
| iframes and windows           | Capture each frame (switching into it) and each window, and link them to the `iframe` node. Needed for Setup pages and some managed packages; no evaluation session met one.                                                                                                                                                |
| MCP server                    | The same queries and capture as tools, so agents don't need to know the CLI.                                                                                                                                                                                                                                                |
| WebdriverIO service           | The hooks and custom command as a service package, instead of scaffolded config.                                                                                                                                                                                                                                            |
| Page object drafts            | Proposes a `.utam.json` for the part of a path with no page object.                                                                                                                                                                                                                                                         |

## Open questions

Each entry gives the question, its context, the options, and a recommendation where one is
defensible.

### Masking and logs

1. **Should `meta.url` mask the org's host name?** It keeps the My Domain host
   (`<my-domain>.lightning.force.com`), which names the customer for a production or sandbox org,
   though it isn't record data. The Chrome route's `meta.org.instanceUrl` would too. Options: keep
   it; mask the My Domain part in `labels` and `structure`; mask it in `structure` only.
   Recommendation: mask it in `labels` and `structure`, keeping the domain suffix; no session needed
   the host.
2. **Which of the unchecked masking candidates leak record data?** Not yet checked on a real page:
   modal `h2` titles ("Edit <record>"), lookup pills' `aria-label` ("Remove <record>"), button menus
   ("Show more actions for <record>"), the activity timeline, toasts, global search, and the Home
   page's recent records. Recommendation: check the modal, pill and button-menu cases before release,
   since they're on common record pages, and the rest as they come up, each fix with a fixture test.
3. **Should `structure` mode mask `meta.error`?** The error is copied as-is because the same text is
   in the test report, but an assertion's message can hold record values, and `structure` is the
   mode for when nothing may leave. Recommendation: mask quoted values in `structure`, so UTAM's
   locator errors, which name selectors rather than records, survive.
4. **Should the scaffold's `logLevel` drop from `debug` to `info`?** At `debug`, WebdriverIO logs the
   frontdoor URL with its one-time token (a problem today), the walker's source on every `execute`,
   and every result, so each capture also lands in the log (about 550 KB for two captures; unmasked
   in `full` mode). The earlier recommendation was `info`, in the scaffold PR; the scaffolded
   `wdio.conf.mjs` still sets `logLevel: 'debug'`. Options: `info`, with a comment on raising it;
   keep `debug` and say so in the guide.

### Capture

5. **What should a failure capture show when the step timeout fires during UTAM's wait?** With the
   scaffold's timeouts, UTAM gives up first and its error names the locator, as the evaluation
   confirmed. A project can lower the step timeout, or a step can wait longer on its own; then the
   step fails with only `function timed out` and the capture runs while UTAM still polls, which is
   untested. The earlier recommendation was a guide line, a header note for that error saying UTAM
   may still have been waiting, and a testbed run at a 30 s step timeout; the header has no such note
   yet. Options: those; delaying the capture; nothing until a project hits it.

### Page objects and queries

6. **How should `path` and `lookup` steer agents to the interface, and to a profile?** The index
   reports the interface for an implementation, which assumes test code loads the interface. The
   scaffold sets `injectionConfigs: ['salesforce-pageobjects/ui-global-components.config.json']`;
   whether that config, with no profiles set, always picks the default implementation is
   unconfirmed. A "reachable through" route found in an implementation now names the interface first
   (`<interface> (in its implementation <name>)`); in the evaluation, one agent typed the
   implementation. Implementations are listed without the profile that selects them. Options: confirm
   `injectionConfigs` and leave the wording; warn in `path` when the matching implementation needs a
   profile the config doesn't set; record profiles (Later phases).
7. **Should a snapshot warn when `salesforce-pageobjects` doesn't match the org's release?** Both
   versions could be recorded, so the check is cheap. Recommendation: later; no session hit a
   mismatch.
8. **Where do packages other than `salesforce-pageobjects` keep their sources?** The layout without
   a manifest assumes a package ships its `.utam.json` files, and that a candidate import path for
   each one resolves to its compiled page object. No such package has been checked: none is
   installed in this repository or the testbed. A wrong assumption costs only import paths, not
   entries. Recommendation: check one real package (such as the one the scaffolded namespace map
   names) before the next release, and adjust the layout to it.
9. **Should the index follow a namespace map at another path?** `build --namespace-map` and
   `rewrite --config` take any path, but the index reads `.utam/namespace-map.json`.
   Recommendation: the default only, until a project moves the file; a `namespaceMapPath` option is a
   small addition when one does.

### Release checks

10. **Should the spike's probe become a release check?** It compares the walker's view with
    `querySelectorAll` on a live page and lists the shadow-mode signals, so on each Salesforce
    release it would catch drift to native shadow or in the light-tree differences (Risks). A
    companion would compare `querySnapshot` with the live page for every root selector in
    `salesforce-pageobjects`, catching disagreements over pruned wrappers. Recommendation: a
    maintainer script run against a scratch org; both need an org, and neither blocks this release.

## Evidence

**The spike** ran a throwaway walker on a scratch org's record page, a related list, and a console
app with several workspace tabs, and through WebdriverIO in a scaffolded project. It established:
synthetic-shadow traversal (for 239 sampled hosts, each shadow root's `children` matched
`shadowRoot.querySelectorAll`) and the shadow-mode signal; where Lightning hides content;
`display: contents` hosts; the masking rules, from what leaked on real pages; size and limits; JSON
string transfer; that `afterStep` isn't called for undefined steps; that `--spec file:line` runs one
scenario; and the DevTools findings in Appendix B. Measurements are in Appendix A.

**The agent evaluation** asked whether an agent can use the tool at all: six fresh agent sessions,
each given only a task and the usage guide, on a build of this design's interface that was improved
between sessions. Agents used the commands without help in every session, every session ended with a
scenario that passes and checks the value, and in each one the step that found the answer came from
the tool's output. The verdict was "It works". Appendix C has the method, the sessions and the
verdict.

The spike code, the evaluation plan, observation sheets, transcripts and reference solutions are kept
outside the repository.

## Appendix A: spike measurements

Measured on a scratch org; kept here because the limits and transfer choices rest on them.

- **Size and time.** The heaviest page, a console app with four workspace tabs and a subtab, gave a
  629 KB snapshot: 4,305 elements visited, 2,955 visible and 2,050 hidden nodes kept, walked in 12 ms
  (visible) and 10 ms (hidden), with a 48 ms round trip. An Account record page was 239 KB
  (8 + 2 ms), and a Contacts related list 273 KB (6 + 6 ms). No page went over 957 visible nodes or
  12 ms for the visible walk.
- **Hidden content.** The minimized previous page in standard navigation has about 1,150
  descendants; each console tab adds 700–740 hidden elements, so a console with about seven tabs
  open reaches `maxHiddenNodes`, later tabs are dropped first, and the visible page is unaffected.
  Forcing `maxHiddenNodes: 1000` or `timeBudgetMs: 10` on the console kept every visible node and
  dropped only hidden ones.
- **Focus.** With `maxNodes: 500` and no focus, a console app kept all its header chrome and lost the
  active subtab. With `focus: 'auto'`, the active workspace tab (462 nodes) came out whole, only
  header chrome was dropped, and the count was 504.
- **Transfer.** Through `browser.execute`, a 112 KB snapshot took 13 ms as a string and 18 ms as an
  object; through `Runtime.evaluate`, 240–630 KB took 20–50 ms. Neither form failed at those sizes.
- **Shadow modes.** 388 roots were synthetic, 12 native, and none unknown. On a record page,
  `checkVisibility` called all 81 `display: contents` hosts invisible; none was marked hidden.
- **Masking.** With the rules above, `find --text "Account Name"` found the field label on a record
  page with its value masked, and `find --text "Contact Name"` found the related list's column header
  (and the `data-label` on each cell). No other record values leaked on the record page, the Contacts
  related list or the console app.

## Appendix B: notes for the Chrome route

What the spike found for capture from a browser a person drives. The console route was designed from
the last two points; the Chrome route (Later phases) will be designed from the rest:

- **Launching Chrome.** Chrome 136 and later ignore `--remote-debugging-port` on the default
  profile, so `snapshot chrome start` needs a throwaway `--user-data-dir`, which also keeps the
  user's own sessions away from the debugging port. Port `0` lets Chrome pick a free port and write
  it to `DevToolsActivePort` in the profile folder; a fixed port could already be held by another
  Chrome. The port listens on `127.0.0.1`, but any local process can control that Chrome while it
  runs.
- **Logging in.** Navigate to `TestEnvironment.buildFrontdoorUrl(path)` with `Page.navigate`, so the
  session ID never goes on Chrome's command line, and the browser is logged in as the test user, whose
  permissions and layouts are what the tests see.
- **Choosing the tab.** Keep only `page` targets with an `http` or `https` URL: an undocked DevTools
  window and a blank new tab are `page` targets too, and the spike once snapshotted DevTools itself.
  `/json/list` lists the most recently activated tab first across all windows, and
  `document.visibilityState` is `visible` for each window's front tab, so with two windows only a
  `--tab` URL match is reliable.
- **Attaching chromedriver** to that Chrome with `debuggerAddress` works, and `execute` works, but
  each attach opens a blank tab and starts the session there: the live page object check would have
  to find the user's page among the window handles by URL, switch to it, and close the blank tab. The
  Chrome window survives both a plain exit and `deleteSession`.
- **Pasted script.** Chrome asks you to type `allow pasting` the first time.
- **An agent's browser tool** that runs a capture script gets its return value back into its
  context, so the script must save the snapshot elsewhere and return a summary, as the console
  snippet does.

## Appendix C: agent evaluation

### Method

The question was narrow: can an agent find and use the commands from the guide alone, does their
output lead it to a correct solution, ideally on the first live run, and where does it get stuck? It
wasn't a comparison with today's tools.

- **The tool**: a thin build of this design's interface (walker, capture, failure hook and capture
  step, files, page-object index, query commands and guide).
- **The agents**: one fresh Gemini 3.8 Flash session at medium effort per scenario, a demanding test
  of the docs and output, given only the task and the guide: "Make this scenario pass" (or "This
  scenario fails. Fix it."), the run command, a limit of 5 run invocations, and where the guide is.
- **The testbed**: a scaffolded project on a scratch org with seeded data (Accounts "Test Biz 1",
  Phone `(555) 010-0001`, and "Test Biz 2", each with two Contacts), a Lightning console app, and
  one test user. Every session started from the same clean commit. For a failure scenario, the broken
  code was run once first, so the agent started from a real failure snapshot.
- **Correct** meant: the scenario passes; it fails when the expected value changes; for the
  hidden-copy scenarios, it fails when the expected value is the hidden record's; and it changed no
  feature file, shared step, test data or `wdio.conf.mjs`. Each scenario had a reference solution,
  checked beforehand, which no agent saw.
- **The tool was improved between sessions**, from what each one showed, so later sessions ran on a
  better tool. With one session per scenario, the result is judgment, not a score.

### Scenarios

| Scenario                       | Task                                                                                                                                                                                      | Tests                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| T1: a field on a record page   | `Then the "Phone" field shows "(555) 010-0001"` on an Account record page.                                                                                                                | Whether `path` and `lookup` find an interface and a deep chain.                        |
| T2: the active console tab     | `Then the record header shows "Test Biz 2"` after opening Test Biz 1 and Test Biz 2 in the console app; the inactive tab keeps a hidden copy first.                                       | Whether `find`'s hidden matches lead the agent to scope the root.                      |
| T3: below the last page object | `Then the record header's object label is "Account"`: `records-entity-label`, which no page object covers, with its text in its shadow root.                                              | Whether `path` makes clear where page objects stop and where `"shadow"` is needed.     |
| F1: a missing `"shadow"`       | T3's reference page object with one element moved from `shadow.elements` to `elements`; UTAM fails with its locator error.                                                                | Whether the agent finds a scope mistake, and whether a scope check in `path` names it. |
| F2: a hidden copy              | A step that loads `recordHomeFlexipage2` directly after an in-app link from one Account to another; the minimized previous page comes first, so it reads the wrong record, with no error. | Whether the agent finds a wrong value's cause with no locator error to start from.     |

A Setup-page scenario (T4, inside a Visualforce iframe) and a reserve failure scenario (F3) weren't
run.

### Sessions

Live runs count scenario runs, with all run invocations in brackets. T1, T2, the T2 rerun and T3
each began with a deliberate probe, a throwing stub to get a failure snapshot, as the guide suggests.
Every session lost one invocation to its sandbox blocking the browser connection.

| Session  | Outcome                                                                                                                                                       | Live runs | Time                      | What it established                                                                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1       | Correct, by a simpler route than the reference (the highlights panel).                                                                                        | 2 (3)     | 11.5 min                  | Agents find the commands from the guide alone, and `find`, `path`, `tree` and `lookup` lead to a correct route. It scripted over the JSON to see one node, and missed a container route whose selector names no tag.               |
| T2       | Correct, with a caveat (the step went into a shared file). Its first scope, with `.active`, also matched the hidden workspace's nested subtab and cost a run. | 3 (4)     | 11 min                    | The guide's document-order rule was understood, but nothing showed which match UTAM takes or tested a selector. It copied the shipped JSON for lack of a pattern.                                                                  |
| T2 rerun | Correct, same caveat; the right scope before any live run.                                                                                                    | 3 (5)     | 9 min                     | `find --css` showed the hidden copy first, with the warning, and the agent dropped that candidate. It climbed to the container with 13 `node` calls, and read UTAM's sources to learn how to wrap a shipped root.                  |
| T3       | The checks pass, but the intent was missed: no page object for the last hop, which it read in raw WebdriverIO through UTAM's internal element handle.         | 3 (4)     | 13.5 min                  | `path` showed the attach point and the four shadow hops in one call, read correctly. A bare `0 matches` from `find --css` made it doubt the tool, and it spent 6 minutes in sources working out how to attach below a page object. |
| F1       | Correct: the reference's fix, restoring the `"shadow"`.                                                                                                       | 1 (2)     | 2.5 min                   | `path`'s scope check named the bug on the agent's second query. It ignored UTAM's locator error.                                                                                                                                   |
| F2       | Correct in standard navigation, with an unchecked console alternative in its selector list that wouldn't work.                                                | 1 (2)     | 15 min active (26 in all) | `find --css`'s warning was the whole diagnosis, and two `node --ancestors` calls gave the reference's scope. It spent 8.6 minutes in UTAM's sources learning to wrap a shipped root, and left out `"wait": true`.                  |

After the probe, the first live run was correct in five of six sessions. No session asked a
question, needed to drive a page by hand, hit an `iframe`, was hindered by masking, or had a snapshot
truncated.

### What decided, and what didn't

- **`path`** decided T1 (including the container route through `[slot='secondaryFields']`), T3 (the
  attach point and shadow hops in one call) and F1 (the scope check).
- **`find`'s hidden matches and `find --css`** decided T2, the rerun (exposing the nested-`.active`
  trap before any run) and F2 (its warning was the whole diagnosis), with `path`'s root-selector
  warning pointing the rerun straight to it.
- **`node`, then `node --ancestors`**, picked the containers to scope to; **`lookup`** was used in
  every session to orient and read methods.
- "Reachable through" never misled an agent. The one route it printed through F1's misdeclared
  element is now marked not reachable as declared.
- `tree` only confirmed; `focus` was never needed; masking never hid anything an agent needed.
- Four features were added after the session that showed the need and haven't met an agent since:
  `find --css`'s empty-result explanation, `lookup`'s `[light]`/`[shadow]` marks, the header's
  suggestion from UTAM's error (F1's agent started from the label, not the error), and the
  not-reachable-as-declared marking.

### Where the time went

Diagnosis was fast whenever the tool had the answer: 1.2 minutes in both F1 and F2. Every authoring
session spent its longest stretch in UTAM's and the shipped page objects' sources, learning
page-object authoring rather than reading the page: how to scope a shipped root (T2 and its rerun;
8.6 minutes in F2) and how to attach below the last page object (6.1 minutes in T3). T3's raw
WebdriverIO hop and F2's missing `"wait": true` and unchecked selector list came from the same gap.
Those are the two recipes now in the guide.

### Verdict

The plan set three outcomes before the sessions ran: **It fails outright** (rethink the interface),
**It works** (agents use the commands without help, and the output leads to a correct solution in
most scenarios, most on the first live run: proceed), or **Mixed** (consider a baseline comparison
on the unclear scenarios).

The read is **It works**: agents used the commands from the guide without help in all six sessions;
every session ended with a scenario that passes and checks the value, and in each one the step that
found the answer came from the tool's output; and after the probe, five of six were correct on the
first live run. It isn't Mixed: where a session fell short (T2's first scope, T3's missing page
object, F2's selector list), the cause was page-object authoring, not the snapshot. The output was
right and was read right. That called for the recipes, not a baseline comparison.

**Acceptance check.** Before the stack is pushed, T3 and F2 are rerun in the testbed against its
build, as above: a fresh session on the same model and effort, with only the task and the guide.
Both should be correct by the evaluation's checks, and they show whether the recipes close the gap:
T3 should write a page object for the last hop rather than step code, and F2 should wrap the shipped
root with its interface type and `"wait": true`.
