---
name: utam-dom-snapshots
description: Captures and queries DOM snapshots of Salesforce Lightning pages, and looks up UTAM page objects, to work out which page object and selector reach an element and why a UTAM step failed. Use when writing or fixing a UTAM step definition, page object or selector in this project.
---

# DOM snapshots

A DOM snapshot is a JSON capture of the page a test was on: every custom element and shadow root,
which parts are hidden, and the attributes and labels a selector needs. Record data is masked. Don't
read or script over the JSON: the `npx simply-utam snapshot` commands answer questions about it, and
`node <handle>` shows everything recorded about one element.

## Snapshot lifecycle

- **Where they come from.** A test run writes snapshots in three ways, and a person can capture one
  from their own browser:
  - **On failure.** When a step throws, the `afterStep` hook in `wdio.conf.mjs` captures the page
    before anything else happens.
  - **On demand.** The step `And I capture the DOM snapshot` (or `... snapshot "<label>"`) captures
    the page wherever you put it in a scenario.
  - **While paused.** `await browser.domSnapshot("<label>")` in the REPL of `browser.debug()` (see
    "Capture by hand"). It needs a person at the terminal.
  - **From the browser console.** A person pastes a snippet into the DevTools console of any page,
    and `snapshot console import` saves it (see "Capture by hand"). No test run needed.
- **Where they go.** Each run gets a folder, `.utam/snapshots/<run>/`, with one file per capture,
  named `<scenario>--<step or label>.json`; a capture that doesn't know its scenario is
  `manual--<label>.json`. Captures from the console go to `.utam/snapshots/manual/`, which pruning
  never deletes. Every capture is also copied to
  `.utam/snapshots/latest.json`, which the commands read by default; `--file <path>` reads another.
- **`latest.json` is only the most recent capture.** It may come from an earlier run, another
  scenario, or another step. Every command prints a header naming the snapshot's file, trigger,
  time, URL and mask mode, then its scenario, step and, for a failure, the error, with an
  assertion's `Expected` and `Received` lines. Check it before you trust the answer.
- **A capture is one moment.** The on-demand step doesn't wait for anything. Lightning keeps
  rendering after navigation returns, so a capture taken too early shows the app's frame with the
  page half-built: the target missing, components with nothing inside. A failure capture shows the
  page as it was when the step gave up.
- **An undefined step writes no snapshot.** Cucumber doesn't call `afterStep` for a step with no
  definition. The steps before it still run, so an on-demand capture placed before it still works.

## Getting the snapshot you need

Each live run is slow, so get a snapshot from a run you need anyway, and run only the scenario you
need:

```bash
npm run test:ui -- --spec <path/to/file>.feature:<line>
```

`<line>` is the line of the scenario's `Scenario:`. `test:ui` compiles your page objects first, then
runs `wdio run wdio.conf.mjs` with the arguments after `--`.

| You have                                    | Do this                                                                                                                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A failing step                              | Run it. The failure snapshot shows the page at the moment it failed.                                                                                                                           |
| A step with no definition yet               | Write your best first attempt and run it. If it fails, its failure snapshot is the page you need. Or add `And I capture the DOM snapshot` before it, if you'd rather look first.               |
| A snapshot where the target isn't there yet | The capture was too early. Capture after a step that waits for something on the page: `utam.load` waits for its root, and `waitFor…` methods (elements marked `"wait": true`) wait for theirs. |
| A page state no step reaches yet            | Add the steps that reach it, then capture after them. Or, to look before writing any steps, ask a person to capture it from the console (see "Capture by hand").                               |

Remove any capture step you added to a feature file before you finish.

### Capture by hand

A page a person drives by hand isn't necessarily the page the test sees: a different user, profile,
window size or feature flag can render a different DOM. A capture from a test run is the faithful
one; capture by hand to explore a page, and confirm with a live run.

**From the browser console.** Works on any page, in any browser, with no test run. An agent runs
the two commands; a person runs the snippet:

1. `npx simply-utam snapshot console snippet --copy` puts the snippet on the clipboard (without
   `--copy` it prints it). `--mask` sets the mask mode, which is fixed in the snippet.
2. The person opens DevTools on the page, checks the console's context selector says `top`, pastes
   and presses Enter. Chrome asks to type `allow pasting` the first time. The snippet copies the
   snapshot to the clipboard and prints a one-line summary. Where the console's `copy` isn't
   available, it downloads `dom-snapshot-<time>.json` instead.
3. `npx simply-utam snapshot console import --label "<label>"` saves it and prints its header. For a
   download, add `--file <path>`; `--file -` reads standard input.

The snippet can be saved as a DevTools Snippet (Sources → Snippets) and run again on each page.

**While paused.** For a person at the terminal, not an agent: the REPL needs someone to type into
it. Add `await browser.debug();` to a step definition where you want to stop, and run the scenario
with `DEBUG` set (`DEBUG=1 npm run test:ui -- --spec …`), so the step can stay paused for up to 30
minutes instead of timing out. In the REPL, click around the page as you need, then capture it:

```js
await browser.domSnapshot('after opening Account');
```

It returns the file it wrote, and copies it to `latest.json` like any other capture. Remove the
`browser.debug()` call before you finish.

## Workflow

**Writing a step:**

1. Get a snapshot of the page (see above) and check its header.
2. `find` the target by its label (values are masked), or by tag or attribute.
3. `path --node <handle>` to see the components from the page down to it, with their page objects
   and the routes between them. `node <handle>` shows any one of them in full.
4. Load the outermost **root** page object on the path, and follow its public methods and elements
   down (`lookup` shows them). Where the page objects stop, write your own page object for the rest
   (see "Attach your own page object below the last shipped one"); keep every step below the last
   page object in a page object, not in step code. Check each element's selector with
   `find --css "<selector>" --within <handle>` (and `--shadow`) before a live run.
5. If `find` shows hidden matches, make sure what you load can only match the visible one: UTAM
   takes the first element that matches a selector, in document order, whether or not it's visible.
   See "Scope a shipped root page object to the visible copy", and test your root selector with
   `find --css "<selector>"` before a live run.
6. Confirm with a live run.

**Fixing a failing step:**

1. Run it, then read the failure snapshot's header: it names the step and the error. UTAM's error
   names the selector it couldn't find, relative to the element it searched in:
   `inside its scope element` means that element's light DOM (the selector is declared in
   `elements`), and `inside its scope shadow root` means its shadow root (`shadow.elements`). For
   that error, the header also gives the `find --css` that repeats UTAM's search, with `--within`
   the element it searched from when one of your page objects identifies it. Run it.
2. `find` that selector's tag (`--tag`), or the target's label, with `--all`.
3. `path` to the match and compare it with the page object: the right root, the right shadow
   crossings, the visible copy. A wrongly scoped root fails with a wrong value, not an error: it
   loaded a hidden copy. After your fix, run `path` again on the same snapshot: a scope warning that
   is gone, or your page object on the path above the target, confirms it before a live run.
4. Fix, and confirm with a live run.

## Commands

Run from the project folder, or point `--project-dir <dir>` at it. Every command takes `--json`;
text output stops at 200 lines, and `--limit <n>` changes that. Every command but `lookup` reads
`latest.json` unless you give `--file <path>` (relative to the current folder).

### `find`: which nodes match

```bash
npx simply-utam snapshot find --text "<label>"
npx simply-utam snapshot find --tag <custom-element-tag> --all
npx simply-utam snapshot find --attr <attribute>=<value>
npx simply-utam snapshot find --class <class>
npx simply-utam snapshot find --css "<selector>"
```

`--text` is a case-insensitive substring of a node's own text, its shadow text, or any attribute
value except `class`. `--attr name` matches any node with that attribute; `--attr name=value` is a
case-insensitive substring of the value (`class=slds-button` also matches `slds-button_brand`).
`--class` matches one whole class token, as `.name` does. Each match is one line: its node handle,
then the node written like CSS (`tag#id.class[attr="value"]`), its text in quotes and its shadow text
after `#shadow`. Visible matches come first, in document order; hidden ones are counted, or listed
with `--all`, each with the hidden subtree it's in. When there are hidden matches, a last line says
which match comes first in the page.

`--css` tests a selector the way UTAM's `findElement` runs it: every match in document order, hidden
ones included, with the first (the one UTAM takes) marked, and a warning when that one is hidden. A
selector doesn't reach into a shadow root, as in the browser. It searches the document, which is
where a root page object's selector is looked up. For an element of a page object, add `--within
<handle>` for the page object's root element: alone it searches that element's light DOM
(`elements`), and with `--shadow` its shadow root (`shadow.elements`). `%s` in an attribute matches
any value; a test on a masked value can't be checked, and the output says so. With no match, it lists
where the selector does match, in a scope the search didn't cover: inside another node's shadow
root, in `--within`'s light DOM when you searched its shadow root, or outside `--within` in the same
tree. Each comes with the `--within` (and `--shadow`) that finds it. Lightning's synthetic shadow roots are boundaries too, as they are for
UTAM.

### `path`: from the page down to a node

```bash
npx simply-utam snapshot path --node <handle>
npx simply-utam snapshot path --text "<label>"
```

One custom element per line, indented, plus any plain element that one of your own root page
objects' selectors matches first: that's how a page object of yours that scopes a shipped one to a
container shows up. `#shadow(...)` means the next element is inside the previous
one's shadow root; without it, the element is in the light DOM (a child, or slotted content).
`(hidden)` marks the top of a hidden subtree. Each custom element is annotated with one of:

- **an import path**: its page object. `root`: `utam.load` can load it. `interface`: import the
  interface; UTAM picks the implementation. `project`: one of yours, compiled to `pageObjects/`.
- **`↳ reachable through <page object>, element "<name>" "<selector>"`**: a page object above it has
  an element that likely selects this one, with the getter (public) or the methods that use it
  (private). `container` means the getter takes the page object to load there. `light` or `shadow`
  is where the element is declared (`elements` or `shadow.elements`). Matched by tag for any page
  object above, and for the nearest one also by its whole selector (such as `[slot='…']`), so treat
  it as a likely route; the target itself gets one too, when it isn't a custom element.
- **`⚠ <your page object>: element "…" is declared in elements, but n5021 is in n5020's shadow
root`**: an element of one of your own page objects selects this node, but UTAM would search the
  wrong scope for it, so it won't find it (nor anything nested in it). The line says which list to
  move it to. Only your project's page objects are checked. A route below it that runs through
  that element is printed as `↳ not reachable as declared`.
- **`⚠ root selector "…" matches N in the document`**: under a root page object, when its root
  selector matches more than once or its first match is hidden. `utam.load` takes the first, so check
  it with the `find --css` the line gives. It isn't shown when a page object of yours above it
  reaches it through an element, because then the root isn't loaded with `utam.load`.
- **`⚠ unreadable shadow root`**: the component has a shadow root nothing can read, most likely a
  closed one. UTAM selectors can't reach inside it either.
- **`no page object found`**: nothing in the index for that tag, which doesn't prove none exists.

`path --text` needs exactly one visible match; otherwise it lists the candidates and exits with 1.

### `node`: one element in full

```bash
npx simply-utam snapshot node <handle>
npx simply-utam snapshot node <handle> --ancestors
```

Its handle and its address (see Reference); every recorded attribute, unclipped; its text and
shadow text; its size and position, or which hidden subtree it's in; its parent in the snapshot; and
each of its light DOM and shadow root children on one line. Add `--json` for the same as data.

With `--ancestors`, the node's ancestors instead, nearest first, one line each: its handle, then the
node written like CSS. `— #shadow(mode) root of <handle> —` marks where the chain leaves a shadow
root. A selector can't reach past that line; to scope above it, use a page object.

### `tree`: what's under a node

```bash
npx simply-utam snapshot tree --node <handle> --depth 3
```

Without `--node` it starts at the page's root; `--depth` defaults to 3. Lines as in `find`, with node handles. A long tree ends by repeating which node it started at. Under a node with a shadow root, its `#shadow(...)` children come
first, then its light DOM children (slotted content) under `light DOM:`; a node without a shadow root
lists its light DOM children directly below it. Plain wrapper elements with only a class are left out of
snapshots, so a child in the tree isn't always a direct child in the DOM.

### `lookup`: page objects

```bash
npx simply-utam snapshot lookup <custom-element-tag>
npx simply-utam snapshot lookup <pageObjectName>
npx simply-utam snapshot lookup --search "<words>"
```

With a tag or name, shows each matching page object's import path, whether it's a root, its root
selector, an interface's implementations, its methods with their parameters and what they return,
its public elements with their getters, and its private elements with the methods that use them
(directly, or through an element nested in them, including a nested public element's getter).
Each element is marked `[light]` (declared in `elements`, searched in its parent's light DOM) or
`[shadow]` (in `shadow.elements`, searched in its parent's shadow root); its parent is the page
object's root element, or the element it's nested in (`parent.child`).
The line under each method summarizes what it does: each `compose` statement's action on an element
(with the element's selector), `→ chain` for a step on what the previous one returned, and
`waitFor(...)` with the elements it waits on.

A **container** element's getter takes a page object type, such as `getSecondaryFields(MyItem)`, and
returns that page object (or a list of them, for `[]`) rooted at the element the container selects.
A `name:` line is the page object's manifest name; a `.utam.json` `"type"` uses the import path on
the line above it.
That's how you attach your own page object below a shipped one: write it without `root` or
`selector`, import its compiled file, and pass it in.

With `--search`, lists page objects
whose name, import path, tags or description contain every word, when you don't know the name yet.
Reads `salesforce-pageobjects` and your project's page objects; needs no snapshot.

### Exit codes

0 success (including no matches); 1 `path --text` without exactly one visible match; 2 bad input (no
such file, not a snapshot, an unknown node handle, a selector that can't be read).

## When something doesn't match

- **No match for a label.** Check the header: is this the snapshot you think it is, taken after the
  page loaded? Record values are masked (`"•14"` is 14 characters of data), so search by a field's
  label, not its value.
- **A hidden node with nothing under it** was never rendered. Lightning renders some content, such
  as inactive tabs and collapsed sections, only when it's opened. Open it in your step, then
  capture.
- **Several matches, some hidden.** A previously visited page, an inactive console tab or a closed
  section is still in the DOM. Scope the root selector so it matches only the visible copy, and test
  it with `find --css`: a class such as `.active` can also appear inside the hidden copy. To find a
  container that only the visible copy is in, compare `node <handle> --ancestors` for each copy.
- **A header marked `TRUNCATED`.** The capture stopped at a limit (`nodes`, `hiddenNodes` or
  `time`), so part of the page isn't in the snapshot, and a node it doesn't have may still be on the
  page. Close console tabs and pages the test doesn't need, and capture again.
- **An `iframe` node marked `not captured`.** Its content isn't in the snapshot.
- **An unreadable shadow root.** Content behind a closed shadow root can't be automated through
  UTAM. UTAM's error `its scope does not have shadow root` is the sign of it.

## Page-object recipes

These are about writing UTAM page objects, and hold with or without snapshots. The commands above
tell you where to attach a page object and which copy to scope to; these say how.

### Attach your own page object below the last shipped one

The last line of `path` that names a page object is the attach point.

- **Through a container.** If that page object has a container element whose selector matches your
  target or an element above it (`lookup` marks it `container`), write your page object without
  `root` or `selector`, import its compiled file, and pass it to the container's getter, such as
  `getSecondaryFields(MyItem)`.
- **Otherwise, from a root of your own.** Write a root page object whose selector matches an element
  with no `#shadow` line above it on the path: a root selector is looked up in the document. From
  there, nest one element per hop down to the target: `shadow.elements` for each `#shadow` line
  `path` shows between two elements, and plain `elements` for a light DOM child or slotted content.
  Give each nested element a selector; a non-root page object has none of its own, the element that
  holds it does. For example, to reach an object label in a record page's highlights panel:

  ```json
  {
    "root": true,
    "selector": { "css": "one-record-home-flexipage2" },
    "shadow": {
      "elements": [
        {
          "name": "highlights",
          "selector": { "css": "records-highlights2" },
          "elements": [{ "name": "objectLabel", "public": true, "selector": { "css": "records-entity-label" } }]
        }
      ]
    }
  }
  ```

  Check each hop with `find --css "<selector>" --within <handle>` (add `--shadow` for a
  `shadow.elements` hop), then `path` to the target: a misdeclared hop shows as `⚠ … Move it to …`.

- Keep every hop below the last shipped page object in a page object, not in step code. Don't reach
  into UTAM's internals (`getRootElement().element` and the like) from a step.

### Scope a shipped root page object to the visible copy

When `find --css` shows a root page object's first match is a hidden copy, write a small root page
object of your own whose selector is the outermost container that tells the copies apart, with one
public element typed as the shipped page object. Don't copy the shipped JSON: wrapping keeps its
methods and its upgrades.

```json
{
  "root": true,
  "selector": { "css": ".oneContent.active.lafPageHost" },
  "elements": [
    {
      "name": "recordHome",
      "public": true,
      "wait": true,
      "type": "salesforce-pageobjects/global/pageObjects/recordHomeFlexipage2",
      "selector": { "css": "one-record-home-flexipage2" }
    }
  ]
}
```

- Type the element as the **interface** test code imports (`recordHomeFlexipage2`), not an
  implementation, and use its **import path** (`salesforce-pageobjects/…`), not the manifest name
  (`utam-global/…`). `lookup` shows both.
- Add `"wait": true`, so `waitForRecordHome()` waits for the page to render.
- Scope at the outermost container that differs between the copies, and prefer a child combinator
  (`>`): a class such as `.active` can repeat inside the hidden copy, where a descendant selector
  still finds it. Compare `node <handle> --ancestors` for each copy to find it.
- Check the selector with `find --css` on a snapshot of each kind of page the step runs on, such as
  standard navigation and a console app, and don't claim a case you didn't check.

## Reference

- **Node handles** (`n5012`) are what commands take and what `find`, `path` and `tree` print. They're
  numbered in the order `tree` prints nodes, so within one tree (outside any shadow root, or inside
  the same one) a smaller handle comes earlier in the page. They hold for one snapshot only, so take
  them from the snapshot you're reading.
- **Addresses** (`0.1.4.s.2`), shown by `node` and in `--json` output, say where a node sits: `0` is
  `html`, each number is the nth child element, and `s` steps into a shadow root. An address stays
  the same in another snapshot of the same page, as long as the page's structure is the same.
  Commands don't take them; one passed to `--node` is refused with its handle.
- **Masking** is set by `UTAM_SNAPSHOT_MASK` when the test runs, and the header shows the mode:
  - `labels` (the default) keeps field labels, button text, tab names, column headers and object
    names, and replaces other text with its length (`"•14"`), record ids with `•id` and email
    addresses with `•email`.
  - `structure` masks all text, and the labels of controls too: the safe mode, when record data
    mustn't leave the org. `find --text` then has nothing to match; search by tag, attribute or class.
  - `full` keeps everything, record values included, so `find --text` can match a value. Use it only
    on a dev org with no real data; capture warns when it's on.

  In every mode, a failure's error message is recorded as the test printed it, unmasked.

- **Your own page objects** go in a `__utam__` folder as `<name>.utam.json`.
  `npx utam -c utam.config.json` compiles them to `pageObjects/<name>.js`, which step definitions
  import by relative path.
