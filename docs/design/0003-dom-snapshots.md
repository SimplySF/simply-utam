# 0003 — DOM snapshots for page object authoring and failure diagnosis

**Status:** Draft (experimental): implemented in this PR stack, after an agent evaluation
**Package:** `packages/simply-utam-core`, `packages/simply-utam`, scaffold templates
**Date:** 2026-10-17

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
- Capture it automatically when a step fails, and on demand at any point in a scenario.
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

## Decision

Add a DOM snapshot feature to `@simplysf/simply-utam-core`:

- A **walker**: one self-contained function that runs inside the page and returns a compact, masked
  JSON snapshot.
- **Capture inside a WebdriverIO test**, through `browser.execute`: on failure, at a chosen step, or
  from the REPL while paused.
- **Files**: one folder per test run, plus `latest.json`, with pruning of old runs.
- A **page-object index** built from the installed `salesforce-pageobjects` package and the
  project's own page objects.
- **Queries** over a snapshot and the index: `find` (including a CSS selector check with UTAM's
  `findElement` semantics), `path`, `tree`, `node` and `lookup`.
- A **usage guide** for the commands, the workflow, and the two page-object authoring recipes agents
  need to act on what the commands show.

The `simply-utam` CLI exposes the queries as `simply-utam snapshot …` commands for agents and people.
Core takes one new runtime dependency, `css-select`, for the selector check (see Public API).

This is experimental: the MVP is what we need to use it on real authoring and failure work, and its
commands, output and format can still change. An agent evaluation of the interface (Evidence,
Appendix C) shaped it. **Later phases** are listed but not designed here.

This document records what the feature is and why: its decisions, the evidence, the risks, the open
questions and the later phases. Exact output wording lives in the code, its tests and the usage
guide; the examples here show the shape of the output, not its final text.

## MVP

### 1. The walker

- A single function with no imports or closures, because capture sends its source text to the page.
  It lives in a plain JavaScript file (`src/snapshot/walker.js`), which the build copies to `lib/`
  unchanged, and core reads that file as text to send it. Nothing compiles or transforms it, so the
  text tests run is the text that ships. (A function written in TypeScript would be checked against
  vitest's transformed source, not the `tsc` output.)
- It returns the snapshot as a JSON string, not an object. A deep tree returned as an object can hit
  serialization depth limits and is slower to convert; a string crosses as one value, and the caller
  parses it.
- It collects page metadata itself (`url`, `title`, viewport size) and masks it in the page, so in
  the default modes unmasked values never leave the browser.
- Top-level document only. Each `iframe` is recorded as a node with its `src` (query string removed,
  record IDs masked) and marked `notCaptured`. Most Setup pages in Lightning are Visualforce pages
  inside iframes, so the MVP doesn't cover them.
- It works in any current browser. Where `checkVisibility` is missing, it falls back to computed
  `display` and `visibility`.

#### What it records

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
walker records it as `shadow.text`, built like `text` (the shadow root's own text nodes, trimmed and
capped at 80 characters) and masked by the host's rules. On a record page, that's where every field
value is: `lightning-formatted-text #shadow "•10"`.

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

#### Pruning

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

#### Limits

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

| `focus`          | Walked first                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none` (default) | Nothing; the walk is in document order.                                                                                                                                                                 |
| `auto`           | The first visible match of, in turn: the console's active workspace tab (`section.tabContent.oneConsoleTab`), the standard navigation's page host (`.oneContent.lafPageHost`), `[role="main"]`, `main`. |
| a CSS selector   | Its first visible match. Selectors are matched in the document's own tree, not inside shadow roots.                                                                                                     |

The focus element's subtree is walked first, and its ancestors (crossing shadow hosts) are always
kept, so its nodes have somewhere to go; the rest of the page fills what's left of `maxNodes`. The
ancestors are kept even past the limit, so the node count can run a little over `maxNodes`.
Addresses don't change, and `meta.focus` holds the focus element's address. A focus that matches
nothing visible is ignored. `captureDomSnapshot({ focus })` passes it through.

Capture also has an outside timeout (default 10 s) as a backstop. If it's ever reached, the script
may still be running in the browser, and the next WebdriverIO command (such as the screenshot) waits
behind it, because WebDriver Classic runs one command per session at a time. The walker's own budget
is what keeps capture fast; the backstop only stops a caller from hanging.

#### Visibility

- An element is hidden when `checkVisibility({ visibilityProperty: true, opacityProperty: true })`
  is false. Hidden is marked once, on the top node of the hidden subtree.
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

#### Masking

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

#### Snapshot format

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
    "org": { "apiVersion": "66.0", "instanceUrl": "https://…" }, // hand-driven capture only (Later phases); see Open questions
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
thing on disk and in memory (see Open questions).

`version` is a whole number that goes up when the format changes in a way an older reader can't
handle. `parseDomSnapshot` rejects JSON whose `format` isn't ours or whose `version` is newer than it
understands, and names both in the error. Adding an optional field, or a new `trigger` value, doesn't
change `version`.

### 2. Capture inside a WebdriverIO test

Capture is the walker plus a way to run JavaScript in the page. `captureDomSnapshot` takes a
WebdriverIO `browser` or any `SnapshotPage`:

```ts
type SnapshotPage = {
  /** Run the walker's source in the page and return the JSON text it produces. */
  evaluate(source: string, timeoutMs: number): Promise<string>;
};
```

- `captureDomSnapshot(options)` returns `Promise<DomSnapshot | undefined>`. It never throws: on any
  failure it returns `undefined` and writes a warning through the injectable `log`.
- `browser` is typed structurally (anything with `execute`), like `NavigableBrowser`, and defaults to
  the global `browser`, as `LightningNavigator` does. It's turned into a `SnapshotPage` that calls
  `browser.execute`. `SnapshotPage` is the seam tests use, and the one later capture routes plug into.

**On failure.** The scaffolded `wdio.conf.mjs` already takes a screenshot in `afterStep` when a step
fails. It captures the snapshot first, before anything else changes the page:

```js
import allureReporter from '@wdio/allure-reporter';
import { captureDomSnapshot, pruneDomSnapshots, writeDomSnapshot } from '@simplysf/simply-utam';

// …
onPrepare: async function () {
  // One snapshot folder per test run, shared by every worker.
  process.env.UTAM_SNAPSHOT_RUN_ID ??= new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  await pruneDomSnapshots({ keepRuns: 10 });
},
afterStep: async function (step, scenario, { error }) {
  if (error) {
    const snapshot = await captureDomSnapshot({ trigger: 'failure', scenario: scenario.name, step: step.text, error });
    if (snapshot) {
      allureReporter.addAttachment('dom-snapshot.json', JSON.stringify(snapshot), 'application/json');
      console.log(`DOM snapshot written to ${await writeDomSnapshot(snapshot)}`);
    }
    await browser.takeScreenshot();
  }
},
```

Core doesn't import Allure. The hook in the test project does; `@wdio/allure-reporter` is already a
dependency `init` checks for.

Cucumber doesn't call `afterStep` for an undefined step, so the hook never writes a useless failure
snapshot for a step that has no definition yet.

The scaffold sets `cucumberOpts.timeout` above `waitforTimeout` (90 s against 60 s). With the step
timeout below it, a UTAM wait on an element with `"wait": true` outlasts the step: Cucumber fails it
with only `function timed out`, and the failure capture runs while UTAM is still polling the page.
With the step timeout above it, UTAM gives up first, its error names the locator it couldn't find
(`… inside its scope element` or `… inside its scope shadow root`), and the capture shows the page
UTAM searched.

**At a chosen step.** `init` scaffolds a step definition, with an optional label, as
`dom-snapshot.steps.mjs` next to `hello.steps.mjs` in `<sourceDir>/test/utam/step_definitions/`, a
path the scaffolded `cucumberOpts.require` globs already match:

```gherkin
And I capture the DOM snapshot
And I capture the DOM snapshot "after opening Account"
```

A `Before` hook in the same file records the scenario's name for the file name. Run only that
scenario (`wdio run wdio.conf.mjs --spec features/account.feature:12`). The earlier steps take the
browser to the page and the snapshot is written. A step not written yet after it is undefined and
fails the scenario (the scaffold leaves `cucumberOpts.ignoreUndefinedDefinitions` off), but only once
the steps before it, and the snapshot, are done.

The step captures the page as it is, without waiting. Lightning keeps rendering after navigation
returns, so a capture taken too early shows the app's frame with the page half-built. Page-object
steps hide this because they wait for their elements, so the guide says to put the snapshot step
after a step that waits for something on the page (see Risks for navigation).

**While paused.** The scaffolded `before` hook registers `browser.domSnapshot(label?)` as a custom
command (trigger `manual`), so it can be called from the REPL during `browser.debug()`.

**Existing projects.** `init` only writes templates that are missing, so a project that already has
`wdio.conf.mjs` doesn't get the new hooks. When `init` skips an existing `wdio.conf.mjs`, it prints a
note pointing to the README section with the `onPrepare`, `before` and `afterStep` snippets to copy.
The snapshot step is a new file, so `init` adds it to existing projects too.

### 3. Files

`writeDomSnapshot(snapshot, options?)` writes the snapshot and returns the path:

- Snapshots go to `.utam/snapshots/<runId>/<name>.json`. `runId` comes from `UTAM_SNAPSHOT_RUN_ID`
  (through the injectable `env`), which the scaffolded `onPrepare` hook sets once per test run, so
  every worker in a run uses the same folder. In a project without the hook, the current time is
  used.
- `<name>` is `<scenario>--<step>` for failures, and `<scenario>--<label or number>` for the step and
  the custom command. Each part is cut down to letters, digits and `-`, and capped at 60 characters.
  A number is appended if the name is already taken; files are created with the exclusive `wx` flag,
  so two workers can't both take the same name.
- It also writes `.utam/snapshots/latest.json`, a copy of the most recent snapshot, which the query
  commands read by default. With more than one worker, `latest.json` is whichever finished last. The
  file inside the run folder is always correct, and every command prints a header saying which
  snapshot it read (see CLI).
- It adds `pageObjectPackages`, the installed `salesforce-pageobjects` version, when it resolves from
  the project.
- `pruneDomSnapshots({ keepRuns })` deletes all but the newest `keepRuns` run folders. The scaffolded
  `onPrepare` hook keeps 10.
- The file system is an injectable sink, so tests don't touch disk.

Snapshots must not be committed. `init` adds `.utam/` to `.gitignore`, add-only, reusing the
add-only merging design 0002 built for `.forceignore` (`mergeForceignore`): never removing or
rewriting a line, adding under a `# Ignore UTAM` comment. The two files share one implementation of
the merge rather than two.

### 4. Page-object index

`buildPageObjectIndex(options)` reads two kinds of source:

- **The project's own page objects**, found from the project's `utam.config.json`
  (`pageObjectsRootDir` and `pageObjectsFileMask`; the scaffolded default is
  `**/__utam__/**/*.utam.json`), not from a fixed folder name.
- **`salesforce-pageobjects`**, resolved from the test project. Version 12.0.0 ships
  `dist/utam.manifest.json` (page object name → source path) and 1,638 `.utam.json` sources, 445 of
  them root page objects.

Parsing all of them takes well under a second, so the MVP builds the index each time and doesn't
cache it.

#### Names and import paths

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

For `salesforce-pageobjects`, the import path is the source file's folder under `dist/`, then
`pageObjects/`, then its name without `.utam.json`:

| Manifest name                                        | Source                                             | Import path                                                            |
| ---------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| `utam-lightning/pageObjects/input`                   | `dist/lightning/input.utam.json`                   | `salesforce-pageobjects/lightning/pageObjects/input`                   |
| `utam-access-summaries/pageObjects/accessFromTabSet` | `dist/access/summaries/accessFromTabSet.utam.json` | `salesforce-pageobjects/access/summaries/pageObjects/accessFromTabSet` |

For project page objects, the import path follows `pageObjectsOutputDir` in `utam.config.json` and
the generator's `namespaces`, and the entry records the compiled file that test code imports by
relative path. Project page objects aren't in any manifest, so their `name` is their import path.

#### Tags

The index maps each tag to page objects from:

1. **Root selectors.** A root page object's `selector.css`.
2. **Typed elements.** Any element in any page object whose `type` is a page object. This covers
   non-root page objects, which only get a selector from the parent that uses them.
3. **The naming convention**, as a fallback (`lightning-input` → `utam-lightning/pageObjects/input`),
   marked `byConvention` and used only when it names a page object that exists.

For 1 and 2, a selector can list several alternatives (`lightning-primitive-input-simple,
lightning-primitive-input-checkbox-button, …`) and each one can be compound (`.x lightning-button`,
`lightning-input[data-id="name"]`). The tag is taken from the last part of each comma-separated
alternative, so one selector can map to several tags. An alternative whose last part has no tag
(`.slds-button`, `[slot='secondaryFields']`) adds no tag; `path` still finds routes through it by
matching the whole selector (see Queries).

Reading the `.utam.json` sources also has to handle:

- `%s` and `%d` argument placeholders in selectors (`lightning-input[data-name='%s']`). They don't
  affect the tag.
- `returnAll`, which doesn't change the tag either.
- Elements under both `elements` and `shadow.elements`, nested to any depth. Each element records
  which of the two it's declared in.
- `css` selectors only. `accessid`, `classchain` and `uiautomator` are mobile selectors with no tag.
- `type` values that aren't page objects: `container`, `frame`, and arrays of basic types such as
  `["clickable", "editable"]`. Only a string naming a page object counts as a typed element.

#### Interfaces

Some page objects are interfaces with one implementation per profile. 89 of the 12.0.0 sources are
interfaces, and 168 are implementations. For example, `one-record-home-flexipage2` is the root
selector of two implementations, `recordHomeTemplateDesktop` (the default) and
`recordHomeWithSubheaderTemplateDesktop` (the `entity: lead` profile). Both implement
`utam-global/pageObjects/recordHomeFlexipage2`, which is what test code imports, and UTAM picks the
implementation at runtime from the configured profiles. When a tag maps to an implementation, the
index reports the interface it implements as the page object to use, and lists its implementations.
The MVP doesn't record which profile selects each implementation (see Later phases and Open questions).

#### Each entry

| Field             | Meaning                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`            | Manifest name, or the import path where there's no manifest.                                                                                                              |
| `importPath`      | What test code imports, and what a `.utam.json` `type` names.                                                                                                             |
| `root`            | Whether `utam.load` can load it directly. Only root page objects can.                                                                                                     |
| `selector`        | A root page object's root selector.                                                                                                                                       |
| `source`          | `project` or `salesforce-pageobjects`.                                                                                                                                    |
| `outputFile`      | For a project page object: its compiled file.                                                                                                                             |
| `byConvention`    | Matched by naming convention only.                                                                                                                                        |
| `description`     | The source's description, in full.                                                                                                                                        |
| `interface`       | Whether it's an interface; `implements` names the interface an implementation implements, and `implementations` lists an interface's.                                     |
| `publicElements`  | Public elements: name, `type`, selector, the tags in it, `elements` or `shadow.elements`, whether it's a list or a container, and its getter with parameters.             |
| `privateElements` | Private elements: the same fields, plus the public methods that use them (from `compose` statements).                                                                     |
| `methods`         | Public methods: name, parameters, return type, and a one-line summary of the `compose`: each statement's action on an element, `→ chain` steps, and `waitFor(...)` calls. |

Many shipped page objects keep elements private and expose them through methods, so the index
records private elements too. Without them, "reachable through" annotations would miss most routes.
Method summaries and parameters are there so an agent can tell what a method does and what a
container getter takes without reading the page object's source.

### 5. Queries

Plain functions over a snapshot and the index. Each returns a text form and a JSON form, and the
text form has an output limit (default 200 lines) with a note when it cuts output short. Each line
that names a node starts with its handle and writes the node like CSS: `tag#id.class[attr="value"]`,
then its text in quotes and its shadow text after `#shadow`. Aura bookkeeping attributes
(`data-aura-rendered-by` and similar) are left out of these lines.

| Function                                    | Answers                                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `findNodes(snapshot, options)`              | Which nodes match text, an attribute, a tag or a class.                                       |
| `querySnapshot(snapshot, selector, scope?)` | Which nodes a CSS selector matches in a scope, in document order, as `findElement` sees them. |
| `componentPath(snapshot, target, index?)`   | The custom elements from the document down to a node, annotated from the index.               |
| `subtree(snapshot, handle, { depth })`      | The pruned tree under a node, to a depth.                                                     |
| `nodeDetails(snapshot, handle)`             | One node in full.                                                                             |
| `nodeAncestors(snapshot, handle)`           | A node's ancestors, nearest first, with each shadow crossing.                                 |
| `utamErrorHint(snapshot, index)`            | For UTAM's not-found error, the `find --css` that repeats UTAM's search.                      |
| `lookupPageObject(index, tagOrName)`        | The page objects for a tag, or one page object by name.                                       |
| `searchPageObjects(index, words)`           | Page objects whose name, import path, tags or description contain every word.                 |

#### `find`

`findNodes` filters by any combination of:

- `text`: a case-insensitive substring of a node's own text, its shadow text, or any attribute value
  except `class`.
- `attr`: `name` matches any node with that attribute; `name=value` is a **case-insensitive
  substring** of the value, so `class=navexWorkspace` also matches `navexWorkspaceManager`.
- `tag`: the exact tag.
- `class`: one whole class token, case-sensitive, as `.name` matches it.

Visible matches come first, in document order, because a search by label is usually for the one the
user sees. Hidden ones are counted, or listed with `all`, each with the top of the hidden subtree
it's in. When there are hidden matches, a last line names the first match in document order, which is
the one a selector finds first, and points to `find --css`.

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

- `%s` and `%d` placeholders in an attribute test match any value.
- Live-state pseudo-classes (`:hover`, `:focus`, `:checked`, …) are ignored, so the selector may
  over-match.
- A test on an attribute whose value is masked can't be checked, so a masked node may be missing.

A bare "0 matches" is easy to doubt, especially with synthetic shadow roots, which are boundaries
too. So when nothing matches in the scope, `find --css` says where the selector does match: each
match outside the scope, with the scope that would find it (no `--within`, `--within <handle>`, or
`--within <host> --shadow`), or that it matches nothing anywhere in the snapshot.

#### `path`

`componentPath` takes a handle, or `{ text }`, which runs `find` first. With exactly one visible
match it prints the path. With more than one, it lists the candidates with their handles and exits
with code 1, so the caller picks one. With only hidden matches, it says so and suggests `find --all`.
It never picks a match silently.

The path shows one custom element per line, indented, plus the target. `#shadow(<mode>)` before a
line means that element is in the previous one's shadow root; without it, the element is in the
light DOM (a child, or slotted content). `(hidden)` marks the top of a hidden subtree. Each custom
element is annotated with one of:

- **its page object**: import path, plus `root` when it can be loaded directly, `interface` when UTAM
  picks the implementation, or `project` with its compiled file;
- **no page object found**: nothing in the index for that tag. This doesn't prove none exists;
- **unreadable shadow root**: its content can't be reached by UTAM selectors.

Below that, three kinds of note:

- **`↳ reachable through <page object>, element "<name>" "<selector>"`**: a page object higher on the
  path has an element that likely selects this one. For a public element that's its getter; for a
  private one, the public methods that use it; `container` means the getter takes the page object
  type to load there. It's matched by tag against every page object above, nearest first, and against
  the nearest one also by the element's whole selector, evaluated over the snapshot as
  `querySnapshot` does. That finds routes whose selector names no tag, such as a container selected
  by `[slot='secondaryFields']`. The target gets one too, when it isn't a custom element. The line
  says whether the element is declared `light` (`elements`) or `shadow` (`shadow.elements`). A
  private element counts as used by the public methods that use it and by the getters of public
  elements nested in it (`getX`, and `waitForX` for `"wait": true`). For shipped page objects the
  declared scope isn't checked against the page, so this is a likely route, not a proven one.
- **`⚠ root selector "…" matches N in the document`**: under a root page object, when its root
  selector (or an implementation's) matches more than once or its first match is hidden.
  `utam.load` takes the first, so the line gives the `find --css` to check it with.
- **`⚠ … is declared in elements, but <node> is in <host>'s shadow root`** (or the reverse): the
  scope check, for the project's own page objects. `path` replays each element's declaration from
  the page object's root over the snapshot, taking the first match at each level as UTAM does, and
  where an element selects a node on the path in the other scope, it names the element and the list
  to move it to. A missing `"shadow"` is a common mistake in a hand-written page object, and UTAM
  reports it only as a locator error. A misdeclared element is reported once, where it is, not again
  for the elements nested in it. A route through it, or through an element nested in it, prints as
  **`↳ not reachable as declared`** rather than as a clean route. Shipped page objects aren't
  checked: they aren't the project's to fix.

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

#### `tree` and `node`

`subtree` prints the pruned tree under a node to a depth, one node per line in `find`'s form, with
`(hidden)` where it applies. Under a node with a shadow root, its `#shadow(<mode>)` children come
first, then its light children under `light DOM:`, so every child's side is explicit; a node without
a shadow root lists its light children directly. Where the depth stops it, it says how many children
are left. A long tree ends by repeating the node it started at, because some agent harnesses keep
only the tail of long output.

`nodeDetails` shows one node in full, so nobody needs to script over the JSON: its handle and
address, every recorded attribute unclipped, its text and shadow text and shadow mode, its size and
position or the hidden subtree it's in, its parent and which side of it the node is on, and each of
its light and shadow children on one line.

`nodeAncestors` (`node --ancestors`) lists the node's ancestors, nearest first, one per line: handle,
the node in `find`'s form, `(hidden)` where it applies. A shadow crossing is its own line
(`— #shadow(synthetic) root of n894 —`), since a selector's reach ends there. There are no
page-object annotations; this is for finding a container to scope a selector with, which `find --css`
then tests.

#### `lookup`

`lookupPageObject` takes a tag, or a page object's name, import path or short name
(`recordHomeFlexipage2`). For each match it shows, in full and without clipping:

- the import path, `root` or not, `interface`, the source, and the compiled file for a project page
  object;
- the manifest name where it differs, with a note that a `.utam.json` `type` uses the import path;
- how it matched the tag (root selector, typed element in which page objects, or naming convention),
  and for an implementation, the interface test code loads;
- the description, root selector, interface and implementations;
- each method with its parameters and return type, and below it the `compose` summary;
- each public element with its getter, selector and type (a container's getter takes a page object
  type and returns it, or a list of them, rooted at the element the container selects);
- each private element with its selector and the public methods that use it;
- for every element, `[light]` or `[shadow]`: whether it's declared in `elements` or
  `shadow.elements`, so nobody needs the raw `.utam.json` to see where UTAM searches for it.

`searchPageObjects` (`lookup --search`) is for when the name isn't known yet: page objects whose
name, import path, tags or description contain every word, name matches first, then tag, then
description. `lookup` needs no snapshot.

### 6. CLI

| Command                       | Does                                                                           | Options                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `simply-utam snapshot find`   | `findNodes`, or `querySnapshot` with `--css`.                                  | `--text`, `--attr`, `--tag`, `--class`, in any combination; or `--css` alone, with `--within <handle>` and `--shadow`. `--all` lists hidden matches in full. |
| `simply-utam snapshot path`   | `componentPath`.                                                               | Exactly one of `--node <handle>` and `--text <text>`.                                                                                                        |
| `simply-utam snapshot tree`   | `subtree`.                                                                     | `--node <handle>` (default: the snapshot's root), `--depth <n>` (default 3).                                                                                 |
| `simply-utam snapshot node`   | `nodeDetails`, or `nodeAncestors` with `--ancestors`.                          | The handle as an argument, or `--node <handle>`; `--ancestors`.                                                                                              |
| `simply-utam snapshot lookup` | `lookupPageObject`, or `searchPageObjects` with `--search`. Needs no snapshot. | A tag or page object name as an argument, or `--search <words>`.                                                                                             |

```bash
simply-utam snapshot find --text "Account Name"
simply-utam snapshot find --tag one-record-home-flexipage2 --all
simply-utam snapshot find --attr slot=secondaryFields
simply-utam snapshot find --class navexWorkspace
simply-utam snapshot find --css ".navexWorkspace.active one-record-home-flexipage2"
simply-utam snapshot find --css "records-highlights2" --within n894 --shadow
simply-utam snapshot path --node n1288
simply-utam snapshot path --text "Account Name"
simply-utam snapshot tree --node n894 --depth 3
simply-utam snapshot node n1288
simply-utam snapshot node n1288 --ancestors
simply-utam snapshot lookup lightning-input
simply-utam snapshot lookup recordHomeFlexipage2
simply-utam snapshot lookup --search "record layout"
```

- The snapshot commands (all but `lookup`) take `--file` to choose the snapshot. The default is
  `.utam/snapshots/latest.json`.
- Every command takes `--json`, `--limit <n>` (the text output limit, default 200) and
  `--project-dir` (default `.`).
- `--within` needs `--css`, and `--shadow` needs `--within`.
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

| Exit code | Meaning                                                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0         | Success, including a `find` with no matches (an empty result is an answer).                                                                                 |
| 1         | `path --text` didn't find exactly one visible match.                                                                                                        |
| 2         | Bad input: the file or JSON isn't a snapshot, its version is newer, an unknown handle, an address in place of a handle, or a selector that can't be parsed. |

### 7. Usage guide

One document, `test/utam/SNAPSHOTS.md`, scaffolded into the test project. It's written as an agent
skill, with `name` and `description` frontmatter, so an agent harness can load it when a task
involves a UTAM step, page object or selector. The core README links to it.

It explains the tool, and it also carries the two page-object authoring recipes an agent needs to
act on what the tool shows. In every authoring session of the agent evaluation, most of the time
went to learning these two patterns from UTAM's and the shipped page objects' sources, not to
reading the page, and T3's raw WebdriverIO hop and F2's missing `"wait": true` came from the same gap
(Appendix C). The tool says where to attach a page object and which copy to scope to; the recipes say
how. There is no separate cookbook.

As a writing principle, the guide keeps the two kinds of content apart: the sections on the tool
explain its output, and the recipes, in their own section, are UTAM knowledge that holds with or
without snapshots. That keeps each part short, and lets the recipes move into a skill of their own if
the guide outgrows one file.

The recipes:

- **Scope a shipped root page object to the visible copy.** Write a small project root page object
  whose selector is the outermost container that tells the copies apart, with one public element
  typed as the shipped page object's interface and `"wait": true`. Don't copy the shipped JSON:
  wrapping keeps its methods and its upgrades. Prefer `>`, since a class such as `.active` can repeat
  inside the hidden copy, where a descendant selector still finds it. Use the import path in `type`.
  Check the selector with `find --css` before a live run, on a snapshot of each kind of page the step
  runs on, and claim no case you didn't check.

- **Attach a custom page object below the last shipped one.** The last line of `path` that names a
  page object is the attach point. Add an element there, in a project page object or a wrapper, typed
  as a new non-root page object, which has no `selector` of its own; the element that holds it does.
  Use `shadow.elements` for each `#shadow` hop and plain `elements` for light children, and a
  container getter for slotted content. Keep every hop below the last shipped page object in a page
  object, not in step code. A root selector is looked up in the document, so a project root page
  object starts at an ancestor with no `#shadow` line above it.

Beyond the commands, how to read their output, and the recipes, the guide sets out:

- **Where snapshots come from.** Only a test run writes them, on failure or at a capture step, so
  check the header: `latest.json` may come from another run, scenario or step. Get the snapshot from
  a run you need anyway: a failing step, a best first attempt, or a capture step after one that waits.
- **Writing a step.** `find` the target by its label, `path` to it, load the outermost root page
  object on the path and follow it down (`lookup`), attach your own below the last one, and test each
  hop with `find --css --within` (and `--shadow`). With hidden matches, scope to the visible copy
  (`node --ancestors`, then `find --css`). Confirm with a live run.
- **Fixing a failing step.** Read the header. For UTAM's not-found error, run the suggested
  `find --css`: `inside its scope element` means `elements`, `inside its scope shadow root` means
  `shadow.elements`. Otherwise `find` the label with `--all` and compare the `path` with the page
  object: the right root, the right shadow crossings, the visible copy.
- **When something doesn't match**: no match for a label (search by label, not value), a hidden node
  with nothing under it (never rendered; open it first), several matches with some hidden, an
  `iframe` marked not captured, and an unreadable shadow root, whose content UTAM can't reach ("its
  scope does not have shadow root").

### Public API (MVP)

New exports from `src/index.ts`, with matching entries in the README's `## API` section and
`test/index.test.ts`.

These go on core's root export, not a new `./snapshot` subpath. The scaffolded `wdio.conf.mjs`
imports them, and a test project depends only on `@simplysf/simply-utam`, which re-exports core's
root (`export * from '@simplysf/simply-utam-core'`) but not its subpaths. A subpath would make test
projects depend on core directly as well. The existing subpaths (`./discovery`, `./steps`, …) hold
build-time tooling the CLI uses, not what a test run imports.

| Export                                                                                                                               | Description                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `captureDomSnapshot(options?)`                                                                                                       | Captures a snapshot through a `browser` or `SnapshotPage`; never throws.                                                                            |
| `writeDomSnapshot(snapshot, options?)`                                                                                               | Writes a snapshot and `latest.json`, and returns the path.                                                                                          |
| `pruneDomSnapshots(options?)`                                                                                                        | Deletes all but the newest run folders.                                                                                                             |
| `readDomSnapshot(path)`, `parseDomSnapshot(json)`, `serializeDomSnapshot(snapshot)`                                                  | Reads or parses a snapshot, checking `format` and `version` and numbering handles; writes the file form, without handles.                           |
| `findNodes`, `querySnapshot`, `componentPath`, `subtree`, `nodeDetails`, `nodeAncestors`, `utamErrorHint`                            | The snapshot queries.                                                                                                                               |
| `buildPageObjectIndex(options?)`, `lookupPageObject`, `searchPageObjects`                                                            | The page-object index and its queries.                                                                                                              |
| `ensureGitignore`, `mergeGitignore`                                                                                                  | The `.gitignore` rule, shaped like `ensureForceignore` and `mergeForceignore` and sharing their merge.                                              |
| `DomSnapshotError`                                                                                                                   | Thrown for input that isn't a readable snapshot, an unknown handle, or a selector that can't be parsed.                                             |
| `DOM_SNAPSHOT_FORMAT`, `DOM_SNAPSHOT_VERSION`, `LATEST_SNAPSHOT`, `DEFAULT_OUTPUT_LIMIT`, `SNAPSHOT_MASK_ENV`, `SNAPSHOT_RUN_ID_ENV` | `'simply-utam-dom-snapshot'`, `1`, `'.utam/snapshots/latest.json'`, `200` (lines of text output), `'UTAM_SNAPSHOT_MASK'`, `'UTAM_SNAPSHOT_RUN_ID'`. |
| `DomSnapshot`, `DomNode`, `SnapshotPage`, `SnapshotBrowser`, `SelectorScope`, `QueryResult`, option and result types                 | Types. `SnapshotBrowser` and `SnapshotPage` are structural.                                                                                         |

**Later**, with the hand-driven capture routes: `devToolsPage`, `launchExploreBrowser` and
`domSnapshotScript`.

**Runtime dependency.** This design adds `css-select` as a runtime dependency of core.
`querySnapshot` runs it through an adapter over the snapshot tree, which gives full CSS selector
syntax and, with the adapter deciding the scope, the same answer as UTAM's `findElement`: the first
match in document order within one tree scope. A hand-written matcher would cover only a subset and
be one more place to disagree with the browser. AGENTS.md asks for discussion before core takes a
new runtime dependency; this design is where that discussion happens (see Open questions). Tests add
`jsdom` and `@lwc/synthetic-shadow` as devDependencies (see Testing).

## Later phases

Listed so the MVP doesn't box them out. Each one needs its own design before it's built.

| Enhancement                   | What it adds, and why it's later                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hand-driven capture           | `simply-utam explore` (a logged-in Chrome to drive by hand) and `snapshot capture` over the DevTools protocol (`devToolsPage`); `snapshot script` to paste into any browser's console, and `snapshot save` to file what it produced. Later because no session needed to drive a page by hand: a deliberately failing first attempt, or a capture step, reached every state. Spike findings for them are in Appendix B. |
| Other page-object packages    | Index an in-house library's page-object package, found through the generator's `namespaces` or a `pageObjectPackages` option and `--page-objects` flag. Later because no project in the sessions used one.                                                                                                                                                                                                             |
| Profiles                      | Record the profile that selects each implementation, and read the project's configured profiles. Later because the scaffold configures none and no session needed one.                                                                                                                                                                                                                                                 |
| Checks across snapshots       | Run one `find --css` over several snapshots (each kind of page a step runs on), so a scope checked on one page is checked on the others. See Open questions.                                                                                                                                                                                                                                                           |
| `find --compare <handle>`     | Compares a visible copy's ancestors with a hidden copy's below the point where they join, and tests each differing ancestor as a scope with `querySnapshot`. Held in reserve: built only if agents still struggle to pick a scope with `node --ancestors` and `find --css`.                                                                                                                                            |
| Live page object check        | In a paused test or an `explore` Chrome, loads a candidate page object with UTAM itself and reports which of its elements resolve, element by element. Would turn "reachable through" annotations into proven routes.                                                                                                                                                                                                  |
| Live failure replay           | When a step fails, pauses the session and walks the failing page object's chain with UTAM to show how far it got. Builds on the live check.                                                                                                                                                                                                                                                                            |
| Comparison with a passing run | Diffs a failing snapshot against the last passing one for the same step, to show what changed after a release or layout change.                                                                                                                                                                                                                                                                                        |
| More triggers                 | `UTAM_SNAPSHOT_AFTER="<step text>"` and `UTAM_SNAPSHOT=all`, through an `afterStep` hook, without editing feature files.                                                                                                                                                                                                                                                                                               |
| iframes and windows           | Capture each frame (switching into it) and each window, and link them to the `iframe` node. Needed for Setup pages.                                                                                                                                                                                                                                                                                                    |
| MCP server                    | The same queries and capture as tools, so agents don't need to know the CLI.                                                                                                                                                                                                                                                                                                                                           |
| WebdriverIO service           | The hooks and custom command as a service package, instead of scaffolded config.                                                                                                                                                                                                                                                                                                                                       |
| Page object drafts            | Proposes a `.utam.json` for the part of a path with no page object.                                                                                                                                                                                                                                                                                                                                                    |

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
  the test user. The pasted-script capture route (Later phases) would let one of them run the walker.
- **No selector evaluation at all, leaving every check to a live run**: each live run is slow, and a
  root scoped to the wrong copy fails with a wrong value, not an error, so the agent learns little
  from it. Evaluating CSS over the snapshot answers "which element does this selector find first?"
  before the run. What it doesn't do is resolve a page object: it doesn't follow `type`s, run
  methods, or wait, so the live run stays the check that a page object works.
- **A full offline page object checker**: would walk a page object's elements over the snapshot,
  re-implementing how UTAM resolves a chain. Each part it re-implements is another place to disagree
  with UTAM, and a confident wrong answer costs more than no answer. `path`'s scope check is the one
  narrow exception: it replays only the project's own declarations, one scope at a time, and names a
  mismatch rather than claiming a route works. The live page object check (Later phases) uses UTAM
  itself instead.
- **A separate cookbook for the authoring recipes**: keeps the guide about the tool, but an agent
  that loads the guide doesn't load the cookbook, and the recipes are what it was missing.
- **Reading LWC source only**: misses everything that isn't our own component, and everything decided
  at runtime.
- **The UTAM browser extension**: right answers, but only interactive and only for a person.

## Risks

- **Synthetic shadow light trees.** UTAM's shadow lookups are `shadowRoot.querySelector*` run in the
  page, and the spike confirmed that walking `shadowRoot.children` gives the same scoped view on real
  Lightning pages. Light trees are the gap: on flexipage hosts (`flexipage-tab2`,
  `flexipage-component2`, `record_flexipage-desktop-record-page-decorator`), a host's `children` and
  `host.querySelectorAll` differ by a few elements under synthetic shadow, apparently filtered by
  owner. If UTAM searches a host's light DOM there, a path or a `find --css --within` through those
  elements could be wrong. A live run that disagrees with `find --css` is treated as a bug, with its
  snapshot as the fixture.
- **`labels` masking is a heuristic.** It will sometimes keep a record value or mask a label the
  agent needs. The rules are data, so they're cheap to adjust, and `structure` is the safe mode.
- **Navigation doesn't wait for Lightning.** `goToApplication` returns once the frontdoor redirect
  page has loaded, so anything that checks the page straight afterwards, such as a capture step, sees
  `/secur/contentDoor` or a half-built page. `LightningNavigator` could wait for the target URL and
  for rendering to settle before returning. That changes navigation for every test, so it's a
  separate change, not part of this MVP; the guide says to capture after a step that waits.
- **Closed shadow roots.** Neither the walker nor UTAM can see into one, so the risk is diagnosis,
  not coverage: without the `unreadable` flag it would look like an empty element. The flag is a
  heuristic; if a managed package with closed roots comes up, check it on one of its pages.

## Open questions

Each entry gives the question, its context, the options, and a recommendation where one is
defensible.

### Masking and logs

1. **Should `meta.url` and `meta.org.instanceUrl` mask the org's host name?** Both keep the My
   Domain host (`<my-domain>.lightning.force.com`), which names the customer for a production or
   sandbox org, though it isn't record data. Options: keep both; mask the My Domain part in `labels`
   and `structure`; mask it in `structure` only. Recommendation: mask it in `labels` and
   `structure`, keeping the domain suffix; no session needed the host.
2. **Which of the unchecked masking candidates leak record data?** Not yet checked on a real page:
   modal `h2` titles ("Edit <record>"), lookup pills' `aria-label` ("Remove <record>"), button menus
   ("Show more actions for <record>"), the activity timeline, toasts, global search, and the Home
   page's recent records. Options: check all before release; check them as they come up, each fix
   with a fixture test. Recommendation: check the modal, pill and button-menu cases before release,
   since they're on common record pages, and the rest as they come up.
3. **Should `structure` mode mask `meta.error`?** The error is copied as-is because the same text is
   in the test report, but an assertion's message can hold record values, and `structure` is the
   mode for when nothing may leave. Options: keep it in every mode; mask quoted values in
   `structure`. Recommendation: mask quoted values in `structure`, so UTAM's locator errors, which
   name selectors rather than records, survive.
4. **Should the scaffold's `logLevel` drop from `debug` to `info`?** At `debug`, the scaffold's
   default, WebdriverIO logs the frontdoor URL with its one-time token (a problem today), the
   walker's source on every `execute`, and every result, so each capture also lands in the log
   (about 550 KB for two captures; unmasked in `full` mode). Options: `info`, with a comment on
   raising it; keep `debug` and say so in the guide. Recommendation: `info`, in PR 5.

### Capture

5. **What should a failure capture show when the step timeout fires during UTAM's wait?** With the
   step timeout above `waitforTimeout`, UTAM gives up first and its error names the locator, as the
   evaluation confirmed. A project can lower it, or a step can wait longer on its own; then the step
   fails with only `function timed out` and the capture runs while UTAM still polls, which is
   untested. Options: a guide line; a header note for that error, saying UTAM may still have been
   waiting; delaying the capture. Recommendation: the guide line and the header note, and a testbed
   run at a 30 s step timeout to see what the capture shows.
6. **Should the MVP do more for iframes than mark them `notCaptured`?** Most Setup pages and some
   managed packages render in one. No session met one, and the Setup scenario wasn't run. Options:
   leave it to the iframes phase; run that scenario before release. Recommendation: leave it to the
   later phase; the guide says what an `iframe` node means.

### Queries

7. **Do agents start from UTAM's locator error, and from the header's suggestion?** F1's agent
   started from the label and never used the error; the header's suggested `find --css`, built from
   it, hasn't met an agent. Options: keep it; move it to the top of the header; drop it.
   Recommendation: keep it. It stays silent for other errors, as F2 showed, and a rerun of F1 would
   show whether agents read it.
8. **How should `path` and `lookup` steer agents to the interface, and to a profile?** The index
   reports the interface for an implementation, which assumes test code loads the interface; how the
   scaffolded `injectionConfigs` choose an implementation is unconfirmed. A "reachable through" line
   found in an implementation names it, and one agent typed the implementation. Implementations are
   listed without the profile that selects them, and the scaffold configures none. Options: word the
   line so the interface comes first; warn in `path` when the matching implementation needs a
   profile the config doesn't set; record profiles (Later phases). Recommendation: confirm
   `injectionConfigs` and change the wording in PR 4; profiles later.
9. **Does a scope checked against one snapshot hold on other pages?** `find --css` answers for one
   snapshot. F2's agent added a console alternative to its selector that it never checked and that
   wouldn't have worked; T2's console scope holds only while each workspace shows one record page.
   Options: a guide rule to check each kind of page the step runs on; a check over several snapshots
   (Later phases). Recommendation: the guide rule now (it's in the scoping recipe), the check later.
10. **How should the selector check catch disagreements with UTAM over pruned wrappers?** A plain
    wrapper with only a class is pruned, so a selector that names one, or uses `>`, `+`, `~` or
    `:nth-child` across one, can match differently from the live page. Options: jsdom fixture tests
    comparing `querySnapshot` with `querySelectorAll`; a live comparison for every root selector in
    `salesforce-pageobjects`; a `find --css` warning when a compound names a tag and class that
    appear nowhere in the snapshot. Recommendation: the tests and the warning in PR 4, the live
    comparison with the release check (question 13).
11. **Should a snapshot warn when `salesforce-pageobjects` doesn't match the org's release?** Both
    versions are recorded, so the check is cheap. Options: a header line now; later.
    Recommendation: later; no session hit a mismatch.

### Format and implementation

12. **Is `css-select` acceptable as core's new runtime dependency?** It's accepted here (see Public
    API) and open for review comment, since AGENTS.md asks for discussion first. The alternative is a
    hand-written matcher for the subset page objects use (tags, classes, ids, attribute tests,
    descendant and child combinators, `:not`), with a clear error for anything else.
    Recommendation: keep `css-select`, pinned to an exact version.
13. **Should the spike's probe become a release check?** It compares the walker's view with
    `querySelectorAll` on a live page and lists the shadow-mode signals, so on each Salesforce
    release it would catch drift to native shadow or in the light-tree differences (Risks). Options:
    a maintainer script run against a scratch org; drop it. Recommendation: add it after this stack,
    with question 10's live comparison; both need an org, and neither blocks the MVP.

### Evaluation

14. **Is a baseline comparison against today's tools wanted before release?** The evaluation asked
    whether the tool works, not whether it beats source, the failure screenshot, `logUtamHtml` and
    the WebdriverIO error, so it can't say whether the snapshot, rather than the agent's skill, was
    why sessions succeeded. Options: none; a small comparison on T3 and F2, where most of the time
    went outside the tool. Recommendation: none before release. The verdict was "It works", the
    shortfalls were page-object authoring, which the recipes now cover, and the acceptance check
    reruns T3 and F2.

## Known issues to fix in the stack

F2 found three small issues, all fixed in PR 4:

- **After a fix, `path` can't confirm it.** It still warns under the shipped root page object when a
  project root page object now scopes it, and shows no line for a project root page object whose
  selector matches a plain element. (It also repeats the page object in its `[also: …]` list.)
- **The header keeps only the error's first line**, so a failed assertion's `Expected` and
  `Received` lines are lost, and the stored error keeps raw ANSI escapes.
- **`find --css --within`'s empty-result hint** says the matches are behind a shadow root when
  they're outside the `--within` scope, in the same tree.

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
verdict in full.

The spike code, the evaluation plan, observation sheets, transcripts and reference solutions are kept
outside the repository.

## Implementation order

The evaluation build is promoted to production rather than rewritten. It lands as a stack of five
pull requests, pushed together. Each one gets the same hardening:

- **A code review against AGENTS.md**: `process.env` read only through an injectable `env`, an
  injectable sink for anything that writes output, WebdriverIO and UTAM types written structurally,
  and `src/index.ts`, the README's `## API` section and `test/index.test.ts` in step. Helpers the
  evaluation build exported only for the CLI's convenience are made internal or listed in the API.
- **Tests** filled out to the Testing section for what the PR adds.
- **No evaluation-build leftovers**: no prerelease version suffixes, no `spikes/` folder, no demo data.

| PR  | Contains                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | This design, and its row in the design index.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2   | The page-object index (`buildPageObjectIndex`, both name forms, interfaces, private elements and method summaries), `lookupPageObject`, `searchPageObjects`, and `simply-utam snapshot lookup` with `--search`. Needs no browser, org or snapshot.                                                                                                                                                                                                                             |
| 3   | The walker (`walker.js` and the build step that copies it to `lib/`), with its limits, visible-first order, `focus`, masking and the `unreadable` flag; the format (`parseDomSnapshot`, `readDomSnapshot`, handles, the stored `address`); `captureDomSnapshot`; and the files (`writeDomSnapshot`, `latest.json`, `pruneDomSnapshots`).                                                                                                                                       |
| 4   | The queries (`findNodes`, `querySnapshot`, `componentPath`, `subtree`, `nodeDetails`, `nodeAncestors`, `utamErrorHint`) and the commands `find` (including `--css`), `path`, `tree` and `node`, with the header, text and `--json` output, output limits and exit codes. Adds `css-select`. Fixes the known issues above.                                                                                                                                                      |
| 5   | The scaffold: the `onPrepare`, `before` and `afterStep` hooks, the `browser.domSnapshot` custom command, the snapshot step, the step timeout above `waitforTimeout`, the `.gitignore` rule on 0002's merge, the `init` note for existing projects, and the fix for the misspelled Allure option `disableWebdriverScreenshotesReporting` (to `disableWebdriverScreenshotsReporting`), which today has no effect. The usage guide with its recipes, linked from the core README. |

**Acceptance check.** Before the stack is pushed, rerun T3 and F2 in the testbed against the stack's
build, as in Appendix C: a fresh session on the same model and effort, with only the task and the
guide. Both should be correct by the evaluation's checks. They also show whether the recipes close
the gap the sessions found: T3 should write a page object for the last hop rather than step code,
and F2 should wrap the shipped root with its interface type and `"wait": true`.

## Testing

The evaluation build's tests are the starting point; each PR fills them out to this list.

- **Walker** with `jsdom` fixtures: nested shadow roots, slotted content, hidden subtrees and the
  hidden-node limit, hidden plain wrappers kept by pruning, the visible-first order (a hidden subtree
  before the visible page in document order, with the time budget and node limit reached in the
  hidden part), several truncation reasons at once, `display: contents` hosts and `slot` elements,
  `option` in a closed `select`, generated ids, addresses starting at `0`, the root and `body` kept,
  pruning, every limit, `focus` (`none`, `auto`, a selector, no match, a focus inside a shadow root,
  ancestors kept past `maxNodes`, and `meta.focus`), shadow text and its masking, the `unreadable`
  flag (and not on an undefined element, one with light children, or one with no size), each masking
  rule (including lookup results in `[role="option"]`, related-list titles, `a[role="tab"]` and
  `a[role="button"]` as labels, and control `aria-label`s inside `.tabBarItems`, `tbody` and data
  rows), and the metadata masking. jsdom doesn't implement `checkVisibility` and returns zero for
  every `getBoundingClientRect`, so the walker takes both as optional parameters that tests replace;
  in the browser they default to the real ones. Tests load the walker from the same text core sends
  (`walker.js`, read as text) and run it in a separate jsdom global, where nothing from core exists,
  which proves it has no closures and that what's tested is what ships. A build check confirms
  `lib/` holds an identical copy.
- **Synthetic shadow** with `@lwc/synthetic-shadow` loaded into jsdom, with each rendered element
  marked with its owner by hand, as the LWC engine does. It scopes synthetic shadow roots as in the
  browser and gives the `synthetic` mode signal, so traversal is tested against the emulation
  Lightning uses and not only native shadow roots. It doesn't reproduce a host's slotted light
  children, which the walker sees on real pages; that part of the light tree is checked against
  captured pages (see Risks, synthetic shadow light trees).
- **Capture** with a fake `browser` and a fake `SnapshotPage`: `evaluate` throwing, the backstop
  timeout, and the `undefined` result.
- **Format**: `format` and `version` checks, `address` read from the file, handle numbering (shadow
  children before light, stable across reads), and an address refused with its handle.
- **Files**: names for each trigger, cleaning and capping, name collisions (including two writers
  racing for one name), `runId`, `latest.json`, `pageObjectPackages`, pruning runs, and an injected
  file system.
- **Index** with fixture packages and projects: root selectors, typed elements, comma lists and
  compound selectors, `%s` placeholders, `elements` and `shadow.elements` recorded, mobile selectors
  and non-page-object types ignored, private elements and the methods that use them (including
  getters of public elements nested in them), method parameters, return types and `compose`
  summaries, container getters, the naming convention, both name forms, import paths from
  `utam.config.json` and `namespaces`, interfaces and implementations, project page objects named by
  import path with their compiled file, lookup by name and short name, and `--search` ranking.
- **Selector matching**: each scope (document, light, shadow), combinators not crossing a shadow
  root, ancestors above the scope counting, document order with hidden matches, placeholders,
  live-state pseudo-classes, masked attribute values, and an unparseable selector. The same selectors
  run through `querySelectorAll` on the jsdom fixture the snapshot came from must give the same
  matches, except where the output says it can't judge.
- **Queries** with fixture snapshots: `find`'s filters (`--attr` substring, `--class` token), visible
  and hidden ordering and the first-in-document-order line; `find --css` marking, the hidden-first
  warning, and the empty-result explanation (outside the scope in the same tree, behind a shadow
  root, nowhere); "reachable through" by tag and by whole selector (a container with no tag), public,
  private and container routes, with their `light` or `shadow` scope; the root selector warning, and
  no warning when a project root page object scopes it; the scope check (a misdeclared element
  reported once, elements nested in it not reported again, only project page objects checked) and
  routes marked not reachable as declared; a project root page object on a plain element;
  `path --text` with zero, one, several and only hidden matches; `tree`'s shadow and light sides and
  depth; `node` and `node --ancestors` with shadow crossings; `lookup` output unclipped, with
  `[light]` and `[shadow]` marks; an unreadable root in each; and the output limit.
- **Header**: UTAM's two not-found errors with the element identified and not identified, another
  error with no suggestion, an assertion's `Expected` and `Received` lines kept, and ANSI escapes
  removed.
- **CLI**: each command over fixtures, the header, text and `--json` output, and every exit code.
- **`.gitignore`**: the same cases as 0002's `.forceignore` tests that apply.

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

## Appendix B: notes for the hand-driven routes

What the spike found for hand-driven capture, for when it's designed:

- **Launching Chrome.** Chrome 136 and later ignore `--remote-debugging-port` on the default
  profile, so `explore` needs a throwaway `--user-data-dir`, which also keeps the user's own sessions
  away from the debugging port. Port `0` lets Chrome pick a free port and write it to
  `DevToolsActivePort` in the profile folder; a fixed port could already be held by another Chrome.
  The port listens on `127.0.0.1`, but any local process can control that Chrome while it runs.
- **Logging in.** Navigate to `TestEnvironment.buildFrontdoorUrl(path)` with `Page.navigate`, so the
  session ID never goes on Chrome's command line, and the browser is logged in as the test user, whose
  permissions and layouts are what the tests see.
- **Choosing the tab.** Keep only `page` targets with an `http` or `https` URL: an undocked DevTools
  window and a blank new tab are `page` targets too, and the spike once snapshotted DevTools itself.
  `/json/list` lists the most recently activated tab first across all windows, and
  `document.visibilityState` is `visible` for each window's front tab, so with two windows only a
  `--target` match is reliable.
- **Pasted script.** Chrome asks you to type `allow pasting` the first time. An agent's browser tool
  that runs the script would get the whole snapshot back into its context, so the script needs a mode
  that saves a file and returns a summary.
- **Attaching chromedriver** to that Chrome with `debuggerAddress` works, and `execute` works, but
  each attach opens a blank tab and starts the session there: the live page object check would have
  to find the user's page among the window handles by URL, switch to it, and close the blank tab. The
  Chrome window survives both a plain exit and `deleteSession`.

## Appendix C: agent evaluation

### Method

The question was narrow: can an agent find and use the commands from the guide alone, does their
output lead it to a correct solution, ideally on the first live run, and where does it get stuck? It
wasn't a comparison with today's tools.

- **The tool**: a thin build of this design's interface (walker, capture, failure hook and capture
  step, files, page-object index, query commands and guide), leaving out what no agent touches.
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
- **The tool was improved between sessions**, so later sessions ran on a better tool. With one
  session per scenario, the result is judgment, not a score.

A dry run confirmed on a live page that `utam.load` takes the first match in document order, not the
first visible one. A first T1 session read leftover run output, including the reference solution's
selectors, and was discarded; T1 was rerun from a cleaned base.

### Scenarios

| Scenario                       | Task                                                                                                                                                                                      | Tests                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| T1: a field on a record page   | `Then the "Phone" field shows "(555) 010-0001"` on an Account record page.                                                                                                                | Whether `path` and `lookup` find an interface and a deep chain.                        |
| T2: the active console tab     | `Then the record header shows "Test Biz 2"` after opening Test Biz 1 and Test Biz 2 in the console app; the inactive tab keeps a hidden copy first.                                       | Whether `find`'s hidden matches lead the agent to scope the root.                      |
| T3: below the last page object | `Then the record header's object label is "Account"`: `records-entity-label`, which no page object covers, with its text in its shadow root.                                              | Whether `path` makes clear where page objects stop and where `"shadow"` is needed.     |
| T4 (optional): a Setup page    | A column in Setup's Users list, inside a Visualforce iframe.                                                                                                                              | What an agent does with an `iframe` node. Not run.                                     |
| F1: a missing `"shadow"`       | T3's reference page object with one element moved from `shadow.elements` to `elements`; UTAM fails with its locator error.                                                                | Whether the agent finds a scope mistake, and whether a scope check in `path` names it. |
| F2: a hidden copy              | A step that loads `recordHomeFlexipage2` directly after an in-app link from one Account to another; the minimized previous page comes first, so it reads the wrong record, with no error. | Whether the agent finds a wrong value's cause with no locator error to start from.     |
| F3 (reserve): the wrong root   | The standard app's navigation step run in the console app.                                                                                                                                | Held in case F1 or F2 didn't reproduce. Not needed.                                    |

### Sessions

Live runs count scenario runs, with all run invocations in brackets. T1, T2, the T2 rerun and T3
each began with a deliberate probe, a throwing stub to get a failure snapshot, as the guide suggests.
Every session lost one invocation to its sandbox blocking the browser connection.

| Session  | Outcome                                                                                                                                                       | Live runs | Time                      | Peak context | What it established                                                                                                                                                                                                                | What changed after it                                                                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1       | Correct, by a simpler route than the reference (the highlights panel).                                                                                        | 2 (3)     | 11.5 min                  | 107k         | Agents find the commands from the guide alone, and `find`, `path`, `tree` and `lookup` lead to a correct route. It scripted over the JSON to see one node, and missed a container route whose selector names no tag.               | `node`; routes matched by an element's whole selector; `tree` marking each child's side; method summaries in `lookup`.                                                                                                                                         |
| T2       | Correct, with a caveat (the step went into a shared file). Its first scope, with `.active`, also matched the hidden workspace's nested subtab and cost a run. | 3 (4)     | 11 min                    | 128k         | The guide's document-order rule was understood, but nothing showed which match UTAM takes or tested a selector. It copied the shipped JSON for lack of a pattern.                                                                  | `find --css`; the first-in-document-order line; `path`'s root-selector warning; handles; `--class` as a whole token and `--attr` documented as a substring; `lookup` unclipped and saying which name goes in `type`.                                           |
| T2 rerun | Correct, same caveat; the right scope before any live run.                                                                                                    | 3 (5)     | 9 min                     | 119k         | `find --css` showed the hidden copy first, with the warning, and the agent dropped that candidate. It climbed to the container with 13 `node` calls, and read UTAM's sources to learn how to wrap a shipped root.                  | `node --ancestors`; `lookup` no longer clipping element selectors or descriptions.                                                                                                                                                                             |
| T3       | The checks pass, but the intent was missed: no page object for the last hop, which it read in raw WebdriverIO through UTAM's internal element handle.         | 3 (4)     | 13.5 min                  | 149k         | `path` showed the attach point and the four shadow hops in one call, read correctly. A bare `0 matches` from `find --css` made it doubt the tool, and it spent 6 minutes in sources working out how to attach below a page object. | `path`'s scope check for project page objects; `light`/`shadow` on routes; `lookup`'s `[light]`/`[shadow]` marks; `find --css`'s empty-result explanation; guide lines on root selectors and UTAM's two not-found messages.                                    |
| F1       | Correct: the reference's fix, restoring the `"shadow"`.                                                                                                       | 1 (2)     | 2.5 min                   | 49k          | `path`'s scope check named the bug on the agent's second query. It ignored UTAM's locator error. One route through the misdeclared element still printed as reachable, though the warning above kept it from misleading.           | Routes through a misdeclared element marked as not reachable; private elements counted as used by nested public getters; the header's `find --css` suggestion from UTAM's error; no handles or selectors from session snapshots in the guide or help examples. |
| F2       | Correct in standard navigation, with an unchecked console alternative in its selector list that wouldn't work.                                                | 1 (2)     | 15 min active (26 in all) | 132k         | `find --css`'s warning was the whole diagnosis, and two `node --ancestors` calls gave the reference's scope. It spent 8.6 minutes in UTAM's sources learning to wrap a shipped root, and left out `"wait": true`.                  | The three known issues, fixed in PR 4; both recipes moved into the guide.                                                                                                                                                                                      |

After the probe, the first live run was correct in five of six sessions. No session asked a
question, needed to drive a page by hand, hit an `iframe`, was hindered by masking, or had a snapshot
truncated.

### Decisive features

- **`path`**: T1's route, including the container route through `[slot='secondaryFields']`; T3's
  attach point and shadow hops, read correctly in one call; F1's scope check, which named the
  missing `"shadow"`.
- **`find`'s hidden matches and `find --css`**: T2 found the hidden copy; in the T2 rerun,
  `find --css` exposed the nested-`.active` trap before any run; in F2, its warning was the whole
  diagnosis.
- **`node`, then `node --ancestors`**: T2 and the rerun compared containers (13 single calls in the
  rerun); F2 picked its container with two `--ancestors` calls.
- **`path`'s root-selector warning**: sent the T2 rerun straight to `find --css`, and confirmed F2's
  finding.
- **`lookup`**: every session used it to orient and to read methods.

"Reachable through" never misled an agent. Every route it printed was real, except one in F1's
broken page object, through the misdeclared element, which the scope warning above it kept from
misleading; such a route is now marked not reachable as declared.

### Unused, or never triggered

- `tree` was used to confirm, never as the deciding step.
- `focus` was never needed: no output was large enough, and nothing was truncated.
- Masking never hid anything an agent needed; `find` by label and shadow text lengths (`•10`) were
  enough.
- No `iframe` node was met.
- Four features were built after the session that showed the need and haven't met an agent since:
  `find --css`'s empty-result explanation, `lookup`'s `[light]`/`[shadow]` marks, the header's
  suggestion from UTAM's error, and the not-reachable-as-declared marking.

### Where the time went

Diagnosis was fast whenever the tool had the answer: 1.2 minutes in both F1 and F2.
Every authoring session spent its longest stretch in UTAM's and the shipped page objects' sources,
learning page-object authoring rather than reading the page:

- T2 and its rerun: how to scope a shipped root (1.4 minutes in the rerun, after the tool had given
  the scope);
- T3: how to attach below the last page object (6.1 minutes);
- F2: scoping again (8.6 minutes).

T3's raw WebdriverIO hop and F2's missing `"wait": true` and unchecked selector list came from the
same gap. Those are the two recipes now in the guide.

### Verdict

The plan set out three outcomes before the sessions ran:

| If the sessions show…                                                                                                                         | Then…                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **It fails outright**: agents can't find or use the commands from the docs, or the output steers them wrong in most scenarios.                | Fix or rethink the interface before building it in core, and rerun the failing scenarios. |
| **It works**: agents use the commands without help, and the output leads to a correct solution in most scenarios, most on the first live run. | Proceed with the MVP, shaped by what the sessions showed.                                 |
| **Mixed**: it works in some scenarios and not others, or agents got there but it's unclear the snapshot was why.                              | Consider a small comparison against a baseline, on the scenarios that were unclear.       |

The read is **It works**:

- Agents used the commands from the guide without help in all six sessions, and asked no questions.
- Every session ended with a scenario that passes and checks the value, and in each one the step
  that found the answer came from the tool's output: `path` in T1, T3 and F1, `find`'s hidden
  matches and `find --css` in T2, the rerun and F2.
- After the probe, five of six sessions were correct on the first live run.

It isn't **Mixed**. Where a session fell short (T2's first scope, T3's missing page object, F2's
selector list), the cause was page-object authoring, not the snapshot: the output was right and was
read right. That called for the recipes, not a baseline comparison. Whether reviewers want a
baseline anyway is open question 14.
