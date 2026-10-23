# DOM snapshots: an overview

## Why it exists

Salesforce Lightning pages are hard to automate. Components sit several shadow roots deep, and
Lightning keeps pages you've left (and inactive console tabs) in the DOM, hidden. A UTAM step that
fails rarely says why. It may have loaded a hidden copy and read the wrong value, or searched the
wrong shadow root. Finding out usually means reproducing the run by hand, digging in DevTools and
rerunning the scenario for each guess, at minutes per run.

**A DOM snapshot records the page's structure, shadow roots included, at one moment**: when a step
fails, where a scenario asks for one, or when a person runs a snippet in the browser console. A CLI
then answers questions about it offline: what a selector matches, which copy UTAM takes, and which
page objects likely reach an element. It also searches the page objects available to the project.

- **Explore before writing.** Capture any page from the browser console, with no test run, and see
  its components and their page objects.
- **Write steps against the real page.** `path` shows the route through page objects down to an
  element, and `find --css` tests each selector before the first run.
- **Diagnose without reproducing.** A failing step leaves a snapshot behind. You find the cause in
  it and check your fix against it, then confirm with one live run.
- **Agent-ready.** simply-utam ships an agent skill, `utam-dom-snapshots`, that you install for your
  coding agent. The commands give it answers from the snapshot, so it needs no browser.
- **Masked by default.** Record values are replaced with their length (`•14`), ids with `•id` and
  emails with `•email`, while field labels and button text are kept for searching. Controls'
  accessible names, which Lightning often builds from the record, are masked unless you opt in with
  `aria`. A stricter mode masks labels too.
  A failure's error message is kept as the test printed it.
- **Low footprint.** It ships in `@simplysf/simply-utam`, adds one small dependency (`css-select`),
  and plugs into an existing WebdriverIO + Cucumber setup through three config hooks.

## Workflows

| Workflow                   | Trigger                                                         | Outcome                                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Explore a page by hand** | A snippet pasted into DevTools on any page, with no test run    | A snapshot of the page as that person sees it, for planning steps before any exist. A different user or profile can see a different page, so confirm with a test run.             |
| **Write a new step**       | An `And I capture the DOM snapshot` step placed in the scenario | A snapshot of the page at that point in the scenario. You locate the target, see which page objects likely reach it, and test selectors before the first run.                     |
| **Fix a failing step**     | Any step throws, and the `afterStep` hook captures the page     | A snapshot of the page as it was when the step failed, with the error in its header. You find the cause, check the fix against the same snapshot, then confirm with one live run. |
| **Find page objects**      | You need a page object, or want to know what one can do         | Page objects from the project and the packages it maps, found by name, tag or description, with their methods and elements. No snapshot needed.                                   |

Every capture lands in `.utam/snapshots/<run>/` (also attached to the Allure report) and is copied
to `latest.json`, which the commands read by default. Old runs are pruned automatically.

## CLI surface

All the commands are under `npx simply-utam snapshot`. `find`, `path`, `node` and `tree` read the
latest snapshot, or another one given with `--file`. They start with a header naming the snapshot
and, for a failure, its scenario, step and error. Every query command, `lookup` included, takes
`--json` for scripts and agents.

| Command           | Question it answers                         | What it does                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `find`            | Where is the element, and how many copies?  | Lists matching elements by text or label, tag, attribute or class, visible ones first, and counts the hidden ones. With `--css`, it runs a selector as UTAM does and marks the match UTAM takes, warning when that match is hidden.                                                                                                                                                                                              |
| `path`            | How do I reach it from the page?            | Shows the components from the page down to an element, one per line, marking each shadow root crossed. It names each component's page object, from your project and the page-object packages it maps, and the likely route to it: the element of a page object above whose selector matches it. It warns when a root selector would load a hidden copy, or when one of your page objects declares an element in the wrong scope. |
| `node`            | What exactly is this element?               | Shows one element in full: its attributes, text, size and position (or which hidden subtree it's in), and its children. With `--ancestors`, it lists the parents up to the page instead, which helps you find where two copies differ.                                                                                                                                                                                           |
| `tree`            | What's under this element?                  | Prints the elements under a node, a few levels deep, listing shadow root content first and then slotted content.                                                                                                                                                                                                                                                                                                                 |
| `lookup`          | Which page object, and what can it do?      | Searches the page objects available to the project, not the snapshot: your own and those in the page-object packages it maps. Give it a tag or page object name, or `--search` words to match a name, tag or description. For each page object, it shows the import path, root selector, methods (with a summary of what each does) and elements, each marked as light DOM or shadow DOM.                                        |
| `console snippet` | How do I capture a page without a test run? | Prints, or copies, a script to paste into the browser's DevTools console. The script copies a masked snapshot of the page.                                                                                                                                                                                                                                                                                                       |
| `console import`  | (pairs with `console snippet`)              | Saves the snapshot the script copied to the project, so the other commands can read it.                                                                                                                                                                                                                                                                                                                                          |

## Further reading

- [The `utam-dom-snapshots` skill](../packages/simply-utam/skills/utam-dom-snapshots/SKILL.md): the
  full how-to, with every command's options and output explained, workflows step by step, and
  page-object recipes. Install it for your coding agent as the
  [CLI README](../packages/simply-utam/README.md#agent-skills) shows.
- [simply-utam README](../packages/simply-utam/README.md#dom-snapshots-in-an-existing-project): the
  command reference, and the hooks to merge into an existing project's `wdio.conf.mjs`.
- [Design 0003: DOM snapshots](design/0003-dom-snapshots.md): what is recorded and why, the
  snapshot format, masking, capture limits, and the page-object index.
