/*
 * Copyright (c) 2026, SimplySF.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { selectAll, selectOne } from 'css-select';
import { afterAll, describe, expect, it } from 'vitest';
import {
  componentPath,
  componentPathByText,
  findNodes,
  nodeAncestors,
  nodeDetails,
  querySnapshot,
  snapshotHeader,
  subtree,
  utamErrorHint,
  type PathResult,
} from '../src/index.js';
import { getNode, type Located } from '../src/snapshot/locate.js';
import { adapter, matchSelector, scopeMatches } from '../src/snapshot/selector.js';
import {
  activeRecordHome,
  el,
  handle,
  indexWith,
  recordHeader,
  recordPageSnapshot,
  removeIndexDirs,
  snapshotOf,
} from './snapshot-fixtures.js';

afterAll(removeIndexDirs);

const snapshot = recordPageSnapshot();
const copy = (which: 'old' | 'new'): string => handle(snapshot, (node) => node.attrs?.['data-copy'] === which);
const highlights = (which: 'old' | 'new'): string =>
  snapshot.root
    .children![0].children!.flatMap((host) => host.children ?? [])
    .filter((node) => node.attrs?.['data-copy'] === which)[0].shadow!.children[0].id;
const label = (which: 'old' | 'new'): string =>
  handle(
    snapshot,
    (node) => node.tag === 'records-entity-label' && node.shadow?.text === (which === 'new' ? 'Account' : '•7'),
  );
const hiddenHost = handle(snapshot, (node) => node.hidden === true);
const visibleHost = handle(snapshot, (node) => node.attrs?.class === 'oneContent active lafPageHost');

describe('find', () => {
  it('lists visible matches first, counts hidden ones, and names the first in document order', () => {
    const { lines, json } = findNodes(snapshot, { tag: 'one-record-home-flexipage2' });
    expect(lines[0]).toBe('1 visible, 1 hidden matches for tag one-record-home-flexipage2');
    expect(lines[1]).toMatch(new RegExp(`^${copy('new')} +one-record-home-flexipage2\\[data-copy="new"\\]$`));
    expect(lines).toContain('1 hidden matches not listed; add --all to list them.');
    expect(lines.at(-1)).toBe(
      `First in the document's own tree, which a root selector reaches first: ${copy('old')} (hidden). utam.load takes a root selector's first match; test a selector with find --css.`,
    );
    expect(json.hidden[0]).toMatchObject({ id: copy('old'), hidden: true, hiddenUnder: { id: hiddenHost } });
  });

  it('lists hidden matches in full with all, under the top of their hidden subtree', () => {
    const { lines } = findNodes(snapshot, { tag: 'one-record-home-flexipage2', all: true });
    expect(lines[2]).toMatch(
      /one-record-home-flexipage2\[data-copy="old"\] {2}\(hidden, under n\d+ div\.oneContent\.lafPageHost/,
    );
  });

  it('matches text in own text, shadow text and attribute values, but not in class', () => {
    expect(findNodes(snapshot, { text: 'account' }).json.visible.map((node) => node.id)).toEqual([label('new')]);
    expect(findNodes(snapshot, { text: 'widget' }).json.visible.map((node) => node.tag)).toEqual(['span']);
    expect(findNodes(snapshot, { text: 'lafPageHost' }).json.visible).toEqual([]);
  });

  it("names the first match in the document's own tree, skipping one in a shadow root before it", () => {
    const mixed = snapshotOf([
      el('c-host', {}, { shadow: [el('c-item', { 'data-k': 'shadow' }, { hidden: true })] }),
      el('c-item', { 'data-k': 'doc' }),
    ]);
    const doc = handle(mixed, (node) => node.attrs?.['data-k'] === 'doc');
    expect(findNodes(mixed, { tag: 'c-item' }).lines.at(-1)).toBe(
      `First in the document's own tree, which a root selector reaches first: ${doc}. utam.load takes a root selector's first match; test a selector with find --css.`,
    );
  });

  it("says when every match is inside a shadow root, out of a root selector's reach", () => {
    expect(findNodes(snapshot, { tag: 'records-highlights2' }).lines.at(-1)).toBe(
      "Every match is inside a shadow root, so a root selector can't reach them; test a selector with find --css.",
    );
  });

  it('matches --attr as a case-insensitive substring, and --class as a whole token', () => {
    expect(findNodes(snapshot, { attr: 'slot=ENTITY' }).json.visible.map((node) => node.tag)).toEqual([
      'records-entity-label',
    ]);
    expect(findNodes(snapshot, { attr: 'data-id' }).json.visible.map((node) => node.tag)).toEqual(['c-widget']);
    expect(findNodes(snapshot, { class: 'active' }).json.visible.map((node) => node.id)).toEqual([visibleHost]);
    expect(findNodes(snapshot, { class: 'activ' }).json.visible).toEqual([]);
  });

  it("tests --attr against the node's own attributes, not names an object inherits", () => {
    expect(findNodes(snapshot, { attr: 'constructor' }).json.visible).toEqual([]);
    expect(findNodes(snapshot, { attr: 'toString=x' }).json.visible).toEqual([]);
  });
});

describe('find --css', () => {
  it("marks UTAM's match and warns when it's the hidden copy", () => {
    const { lines } = findNodes(snapshot, { css: 'one-record-home-flexipage2' });
    expect(lines[0]).toBe('2 matches for css "one-record-home-flexipage2" in the document, in document order:');
    expect(lines[1]).toMatch(
      new RegExp(`^${copy('old')} .*\\(hidden, under ${hiddenHost} .*← findElement / utam.load takes this one$`),
    );
    expect(lines[3]).toBe(
      `Warning: the first match is hidden, so UTAM gets the hidden copy, not ${copy('new')}. Scope the selector to a container only the visible copy is in.`,
    );
  });

  it('finds only the visible copy with a scope the hidden one lacks', () => {
    const { json, lines } = findNodes(snapshot, { css: '.active.lafPageHost one-record-home-flexipage2' });
    expect(json.visible.map((node) => node.id)).toEqual([copy('new')]);
    expect(lines.some((line) => line.startsWith('Warning'))).toBe(false);
  });

  it("doesn't cross a shadow root, and searches one with --within and --shadow", () => {
    expect(findNodes(snapshot, { css: 'records-highlights2' }).json.visible).toEqual([]);
    expect(
      findNodes(snapshot, { css: 'records-highlights2', within: copy('new'), shadow: true }).json.visible.map(
        (n) => n.id,
      ),
    ).toEqual([highlights('new')]);
    expect(
      findNodes(snapshot, { css: 'records-entity-label', within: highlights('new') }).json.visible.map((n) => n.id),
    ).toEqual([label('new')]);
  });

  it('says a match behind a shadow root needs --within its host --shadow', () => {
    const { lines } = findNodes(snapshot, { css: 'records-highlights2' });
    expect(lines).toContain("It matches 2 nodes this search doesn't cover:");
    expect(lines.find((line) => line.includes(highlights('new')))).toMatch(
      new RegExp(`in ${copy('new')}'s shadow root → --within ${copy('new')} --shadow$`),
    );
    expect(lines).toContain("A selector doesn't cross a shadow root, synthetic ones included.");
  });

  it('says a match in the same tree but outside --within is outside it, not behind a shadow root', () => {
    const widget = handle(snapshot, (node) => node.tag === 'c-widget');
    const outside = findNodes(snapshot, { css: 'c-widget', within: visibleHost }).lines;
    expect(outside[0]).toBe(`0 matches for css "c-widget" in ${visibleHost}'s light DOM, in document order:`);
    expect(outside.find((line) => line.startsWith(`  ${widget}`))).toMatch(
      new RegExp(`outside ${visibleHost}, in the same tree → no --within \\(the document\\)$`),
    );
    expect(outside).not.toContain("A selector doesn't cross a shadow root, synthetic ones included.");
  });

  it("says a match in --within's light DOM, when searching its shadow root, needs no --shadow", () => {
    const { lines } = findNodes(snapshot, { css: 'records-entity-label', within: highlights('new'), shadow: true });
    expect(lines.find((line) => line.includes(label('new')))).toMatch(
      new RegExp(`in ${highlights('new')}'s light DOM → --within ${highlights('new')}$`),
    );
  });

  it('says when a selector matches nothing anywhere', () => {
    expect(findNodes(snapshot, { css: 'lightning-combobox' }).lines).toContain(
      'It matches nothing anywhere in this snapshot, in any shadow root.',
    );
  });

  it('says a selector naming something no node has may match a pruned wrapper on the live page', () => {
    const { lines } = findNodes(snapshot, { css: '.wrap lightning-combobox' });
    expect(lines).toContain(
      'It matches nothing in this snapshot, in any shadow root, but it names something no node here has, which the live page may have on a pruned wrapper (see below).',
    );
    expect(lines).not.toContain('It matches nothing anywhere in this snapshot, in any shadow root.');
    expect(lines).toContain(
      'No node in this snapshot has .wrap: it may be on an element the snapshot pruned (plain wrappers are dropped), so the live page may match differently.',
    );
  });

  it('notes names no node has, and combinators and positions a pruned wrapper can change, through querySnapshot too', () => {
    const POSITIONAL_NOTE =
      ">, +, ~ and child-position pseudo-classes can match differently on the live page: the snapshot drops plain wrappers, so a node's parent and siblings here may not be its live ones.";
    expect(querySnapshot(snapshot, '#main c-widget').notes).toEqual([
      'No node in this snapshot has #main: it may be on an element the snapshot pruned (plain wrappers are dropped), so the live page may match differently.',
    ]);
    for (const css of ['body > c-widget', 'x-closed + c-widget', 'x-closed ~ c-widget', 'c-widget:first-child'])
      expect(querySnapshot(snapshot, css).notes).toEqual([POSITIONAL_NOTE]);
    // Names and combinators inside attribute values and strings, and nth arguments, aren't read as syntax.
    expect(querySnapshot(snapshot, "c-widget[data-id='a > b.c #d']").notes).toEqual([]);
    expect(querySnapshot(snapshot, 'c-widget:not(.active)').notes).toEqual([]);
    expect(querySnapshot(snapshot, 'span:nth-child(odd)').notes).toEqual([POSITIONAL_NOTE]);
  });

  it('notes placeholders, live-state pseudo-classes and masked attributes', () => {
    const { lines } = findNodes(snapshot, { css: "c-widget[data-id='%s']:hover span[title='Acme']" });
    expect(lines).toContain('%s/%d placeholders match any value.');
    expect(lines).toContain("Ignored :hover: a snapshot doesn't record live state, so this may over-match.");
    expect(lines).toContain(
      "Can't check [title=…] values: they're masked in this snapshot, so a masked node may not be listed.",
    );
    expect(lines).toContain(
      'Mask labels hides every [title] value. To check them on controls, recapture with UTAM_SNAPSHOT_MASK=aria.',
    );
    const aria = snapshotOf([el('span', { title: '•4' })], { mask: 'aria' });
    expect(findNodes(aria, { css: "span[title='Acme']" }).lines.some((line) => line.includes('recapture'))).toBe(false);
  });

  it('drops :focus-within, :focus-visible and :checked whole, and an emptied :not() with them', () => {
    const page = snapshotOf([
      el('div', { class: 'box' }, { children: [el('a', { href: 'x' }), el('input', { type: 'checkbox' })] }),
    ]);
    const ids = (css: string): string[] => querySnapshot(page, css).matches.map((match) => match.tag);
    expect(ids('div:focus-within')).toEqual(['div']);
    expect(querySnapshot(page, 'div:focus-within').notes).toEqual([
      "Ignored :focus-within: a snapshot doesn't record live state, so this may over-match.",
    ]);
    expect(ids('a:focus-visible')).toEqual(['a']);
    expect(querySnapshot(page, 'a:focus-visible').notes[0]).toMatch(/^Ignored :focus-visible:/);
    expect(ids('input:not(:checked)')).toEqual(['input']);
    expect(ids('input:not(:checked, .other)')).toEqual(['input']);
    expect(ids('input:not(.other, :hover)')).toEqual(['input']);
    expect(ids('div:is(:hover, :focus) a, input:checked')).toEqual(['a', 'input']);
    expect(ids('a:focus')).toEqual(['a']);
  });

  it('matches a %d child-position placeholder as any position', () => {
    const page = snapshotOf([el('ul', {}, { children: [el('li', { class: 'a' }), el('li', { class: 'b' })] })]);
    const result = querySnapshot(page, 'li:nth-child(%d)');
    expect(result.matches.map((match) => match.attrs?.class)).toEqual(['a', 'b']);
    expect(result.notes).toContain('%s/%d placeholders match any value.');
    expect(querySnapshot(page, 'li:nth-of-type( %d )').matches).toHaveLength(2);
  });

  it('keeps the rest of a selector list when a live-state pseudo-class is a whole item or compound', () => {
    const page = snapshotOf([el('ul', {}, { children: [el('li', { class: 'a' }), el('button', {})] })]);
    const tags = (css: string): string[] => querySnapshot(page, css).matches.map((match) => match.tag);
    // Dropping the pseudo-class leaves any element in its place: over-matching, as the note says.
    expect(tags(':hover, li')).toEqual(['html', 'body', 'ul', 'li', 'button']);
    expect(tags('li, :focus')).toEqual(['html', 'body', 'ul', 'li', 'button']);
    expect(tags('ul > :focus')).toEqual(['li', 'button']);
    expect(tags(':focus')).toEqual(['html', 'body', 'ul', 'li', 'button']);
    expect(tags('ul :is(:hover)')).toEqual(['li', 'button']);
  });

  it('leaves live-state names inside attribute values and strings alone', () => {
    const page = snapshotOf([el('button', { title: ':checked items' }), el('button', { title: 'x' })]);
    const result = querySnapshot(page, 'button[title=":checked items"]');
    expect(result.matches.map((match) => match.attrs?.title)).toEqual([':checked items']);
    expect(result.notes).toEqual([]);
    expect(querySnapshot(page, "button[title=':hover']:hover").notes).toEqual([
      "Ignored :hover: a snapshot doesn't record live state, so this may over-match.",
    ]);
  });

  it('matches page-object selectors without notes, and skips one it cannot read or a scope it cannot find', () => {
    for (const css of ['one-record-home-flexipage2', '.active.lafPageHost one-record-home-flexipage2'])
      expect(scopeMatches(snapshot, css, { kind: 'document' })).toEqual(matchSelector(snapshot, css).matches);
    expect(scopeMatches(snapshot, 'records-highlights2', { kind: 'shadow', within: copy('new') })).toEqual(
      matchSelector(snapshot, 'records-highlights2', { kind: 'shadow', within: copy('new') }).matches,
    );
    expect(scopeMatches(snapshot, 'a[', { kind: 'document' })).toEqual([]);
    expect(scopeMatches(snapshot, 'span', { kind: 'shadow', within: 'n99999' })).toEqual([]);
  });

  it("tests attributes against the node's own, not names an object inherits", () => {
    expect(querySnapshot(snapshot, '[constructor]').matches).toEqual([]);
    expect(querySnapshot(snapshot, '[toString=x]').matches).toEqual([]);
    expect(querySnapshot(snapshot, '[hasOwnProperty]').matches).toEqual([]);
  });

  it('runs sibling combinators, :has and nested matches through the snapshot tree', () => {
    const page = snapshotOf([
      el('c-a', { class: 'first' }),
      el('c-b', {}, { children: [el('span', { class: 'inner' }, { children: [el('span', { class: 'deep' })] })] }),
      el('c-c'),
      el('c-host', {}, { shadow: [el('c-x'), el('c-y')], children: [el('c-z')] }),
    ]);
    const tags = (css: string, scope?: Parameters<typeof querySnapshot>[2]): string[] =>
      querySnapshot(page, css, scope).matches.map((match) => match.tag);
    expect(tags('c-a + c-b')).toEqual(['c-b']);
    expect(tags('c-a ~ c-c')).toEqual(['c-c']);
    expect(tags('c-a + c-c')).toEqual([]);
    expect(tags('c-b:has(.deep)')).toEqual(['c-b']);
    expect(tags('c-b:has(> .deep)')).toEqual([]);
    expect(tags(':has(> .inner)')).toEqual(['c-b']);
    expect(tags('c-b span')).toEqual(['span', 'span']);
    expect(tags('span span')).toEqual(['span']);
    expect(tags('c-b:has(span span)')).toEqual(['c-b']);
    const host = handle(page, (node) => node.tag === 'c-host');
    expect(tags('c-x + c-y', { kind: 'shadow', within: host })).toEqual(['c-y']);
    expect(tags('c-x ~ c-y', { kind: 'shadow', within: host })).toEqual(['c-y']);
    // A shadow root is a boundary: its first child has no previous sibling outside it.
    expect(tags('c-z ~ c-x', { kind: 'shadow', within: host })).toEqual([]);
    expect(tags('c-host:has(c-x)')).toEqual([]);
    expect(() => tags('c-x', { kind: 'shadow', within: handle(page, (node) => node.tag === 'c-a') })).toThrow(
      /has no shadow root in this snapshot/,
    );
  });

  it("gives css-select's whole-tree searches the light tree, without nested matches twice", () => {
    const page = snapshotOf([
      el('c-b', {}, { children: [el('span', { class: 'inner' }, { children: [el('span', { class: 'deep' })] })] }),
      el('c-host', {}, { shadow: [el('span', { class: 'in-shadow' })] }),
    ]);
    const body = getNode(
      page,
      handle(page, (node) => node.tag === 'body'),
    );
    const opts = { adapter, xmlMode: false };
    const classes = (nodes: Located[]): Array<string | undefined> => nodes.map((node) => node.node.attrs?.class);
    // Searching from both spans returns the deep one once; nothing in a shadow root is reached.
    const spans = selectAll<Located, Located>('span', body, opts);
    expect(classes(spans)).toEqual(['inner', 'deep']);
    expect(classes(selectAll<Located, Located>('span', spans, opts))).toEqual(['inner', 'deep']);
    expect(adapter.removeSubsets(spans)).toEqual([spans[0]]);
    expect(selectOne<Located, Located>('.deep', body, opts)?.node.attrs?.class).toBe('deep');
    expect(selectOne<Located, Located>('.in-shadow', body, opts)).toBeNull();
  });

  it('refuses an unreadable selector, --shadow without --within, and an address for a handle', () => {
    expect(() => findNodes(snapshot, { css: 'a[' })).toThrow(/Can't read selector "a\["/);
    expect(() => findNodes(snapshot, { css: 'a', shadow: true })).toThrow('--shadow needs --within <node>.');
    expect(() => findNodes(snapshot, { css: 'a', within: '0.1.1' })).toThrow(
      `0.1.1 is an address, not a node handle. Commands take the n number printed next to each node; in this snapshot that's ${visibleHost}.`,
    );
    expect(() => findNodes(snapshot, { css: 'a', within: 'n9999' })).toThrow('No node n9999 in this snapshot.');
  });

  it('gives the matches as data through querySnapshot, in document order', () => {
    const result = querySnapshot(snapshot, 'one-record-home-flexipage2');
    expect(result.matches.map((match) => [match.id, match.hidden])).toEqual([
      [copy('old'), true],
      [copy('new'), false],
    ]);
  });
});

describe('path', () => {
  const index = indexWith();
  const path = (target: string, i = index): PathResult & { lines: string[] } => {
    const result = componentPath(snapshot, target, { index: i });
    return { ...result.json, lines: result.lines };
  };

  it('annotates each custom element with its page object, and the route to it from the one above', () => {
    const { lines } = path(label('new'));
    expect(lines[0]).toMatch(
      /^one-record-home-flexipage2\[data-copy="new"\] +salesforce-pageobjects\/global\/pageObjects\/recordHomeFlexipage2 \(root, interface\)$/,
    );
    expect(lines).toContain('  #shadow(synthetic)');
    expect(lines.find((line) => line.includes('records-highlights2'))).toMatch(
      /salesforce-pageobjects\/records\/pageObjects\/highlights2$/,
    );
    expect(lines).toContain(
      '    ↳ reachable through salesforce-pageobjects/global/pageObjects/recordHomeFlexipage2 (in its implementation recordHomeTemplateDesktop), element "highlights" "records-highlights2" (public, shadow, getHighlights())',
    );
    // A container route, found by the element's whole selector: it names no tag.
    expect(lines.at(-1)).toBe(
      '      ↳ reachable through salesforce-pageobjects/records/pageObjects/highlights2, element "entityLabel" "[slot=\'entityLabel\']" (public container, light, getEntityLabel(pageObjectType: constructor))',
    );
    expect(lines.find((line) => line.includes('records-entity-label'))).toMatch(
      /← target \[n\d+\] +no page object found$/,
    );
  });

  it("warns when a root page object's selector would load the hidden copy", () => {
    expect(path(label('new')).lines[1]).toBe(
      `  ⚠ root selector "one-record-home-flexipage2" matches 2 in the document; utam.load takes the first, ${copy('old')} (hidden). See find --css "one-record-home-flexipage2".`,
    );
  });

  it("quotes a root selector with a double quote in it as one shell word in find --css's suggestion", () => {
    const flexipage = {
      root: true,
      selector: { css: 'one-record-home-flexipage2:not([data-copy="none"])' },
      elements: [],
    };
    const warning = path(label('new'), indexWith({ flexipage })).lines.find((line) => line.includes('⚠ root selector'));
    expect(warning).toMatch(/See find --css 'one-record-home-flexipage2:not\(\[data-copy="none"\]\)'\.$/);
  });

  it('shows a project root page object on a plain container, and drops the warning for the root it scopes', () => {
    const { lines, steps } = path(label('new'), indexWith({ activeRecordHome }));
    expect(steps[0]).toMatchObject({
      id: visibleHost,
      annotation: { importPath: 'my-app/pageObjects/activeRecordHome', via: 'project root selector', root: true },
    });
    expect(lines[0]).toMatch(
      /^div\.oneContent\.active\.lafPageHost +my-app\/pageObjects\/activeRecordHome \(root, project; compiled to pageObjects\/activeRecordHome\.js, its root selector matches here\)$/,
    );
    expect(lines).toContain(
      '    ↳ reachable through my-app/pageObjects/activeRecordHome, element "recordHome" "one-record-home-flexipage2" (public, light, getRecordHome())',
    );
    expect(lines.some((line) => line.includes('⚠ root selector'))).toBe(false);
  });

  it('names a page object once, not again in the [also: …] list', () => {
    const withProject = indexWith({ recordHeader: recordHeader('shadow') });
    const { steps } = path(copy('new'), withProject);
    expect(steps[0].annotation).toMatchObject({
      importPath: 'my-app/pageObjects/recordHeader',
      others: ['salesforce-pageobjects/global/pageObjects/recordHomeFlexipage2'],
    });
  });

  it('names an element of your page object declared in the wrong scope, and the route it breaks', () => {
    const single = recordPageSnapshot({}, false);
    const target = handle(single, (node) => node.tag === 'records-entity-label');
    const broken = componentPath(single, target, { index: indexWith({ recordHeader: recordHeader('light') }) });
    const host = handle(single, (node) => node.tag === 'one-record-home-flexipage2');
    const panel = handle(single, (node) => node.tag === 'records-highlights2');
    const warning = `    ⚠ my-app/pageObjects/recordHeader: element "highlights" "records-highlights2" is declared in elements, but ${panel} is in ${host}'s shadow root. Move it to shadow.elements.`;
    expect(broken.lines.filter((line) => line === warning)).toHaveLength(1);
    expect(broken.lines).toContain(
      '    ↳ not reachable as declared: my-app/pageObjects/recordHeader, element "highlights" "records-highlights2" (private, light, used by getObjectLabel()). It runs through "highlights", which is in the wrong scope (⚠ above).',
    );
    const fixed = componentPath(single, target, { index: indexWith({ recordHeader: recordHeader('shadow') }) });
    expect(fixed.lines.some((line) => line.includes('⚠'))).toBe(false);
    expect(fixed.lines).toContain(
      '    ↳ reachable through my-app/pageObjects/recordHeader, element "highlights" "records-highlights2" (private, shadow, used by getObjectLabel())',
    );
  });

  it('marks a hidden ancestor on the path, even a plain one', () => {
    const { lines, steps } = path(label('old'));
    expect(lines[0]).toBe('div.oneContent.lafPageHost.windowViewMode-minimized  (hidden)');
    expect(steps.map((step) => [step.tag, step.hidden])).toEqual([
      ['div', true],
      ['one-record-home-flexipage2', false],
      ['records-highlights2', false],
      ['records-entity-label', false],
    ]);
  });

  it("doesn't tell you to move an element to the other scope when neither scope finds it", () => {
    // Two shadow roots below the page object's root: neither elements nor shadow.elements reaches it.
    const page = snapshotOf([
      el(
        'one-record-home-flexipage2',
        {},
        { shadow: [el('c-wrap', {}, { shadow: [el('records-highlights2', {}, { text: 'Panel' })] })] },
      ),
    ]);
    const target = handle(page, (node) => node.tag === 'records-highlights2');
    const deep = indexWith({
      deep: {
        root: true,
        selector: { css: 'one-record-home-flexipage2' },
        elements: [{ name: 'highlights', public: true, selector: { css: 'records-highlights2' } }],
      },
    });
    const { lines, json } = componentPath(page, target, { index: deep });
    expect(json.steps.flatMap((step) => step.scopeMismatches ?? [])).toEqual([]);
    expect(lines.some((line) => line.includes('Move it to'))).toBe(false);
  });

  it('counts a public method that reaches a private element through elements nested in it', () => {
    const nested = indexWith({
      recordHeader: {
        ...recordHeader('shadow'),
        methods: [{ name: 'getObjectLabelText', compose: [{ element: 'objectLabel', apply: 'getText' }] }],
      },
    });
    const single = recordPageSnapshot({}, false);
    const panel = handle(single, (node) => node.tag === 'records-highlights2');
    const { lines } = componentPath(single, panel, { index: nested });
    expect(lines.find((line) => line.includes('recordHeader, element "highlights"'))).toMatch(
      /\(private, shadow, used by getObjectLabelText\(\), getObjectLabel\(\)\)$/,
    );
  });

  it('marks an unreadable shadow root', () => {
    const { lines } = path(handle(snapshot, (node) => node.tag === 'x-closed'));
    expect(lines).toContain("  ⚠ unreadable shadow root, most likely closed: UTAM selectors can't reach inside it.");
  });

  it('prints no annotations without an index, and cuts long output at the limit', () => {
    const plain = componentPath(snapshot, label('new'));
    expect(plain.lines.some((line) => line.includes('salesforce-pageobjects'))).toBe(false);
    const cut = componentPath(snapshot, label('new'), { index, limit: 2 });
    expect(cut.lines).toHaveLength(3);
    expect(cut.lines[2]).toMatch(/output limit 2\)\. Use tree on a node lower down\.$/);
  });
});

describe('path --text', () => {
  it('prints the path for exactly one visible match, noting hidden ones', () => {
    const result = componentPathByText(snapshot, 'Account');
    expect(result.exitCode).toBe(0);
    expect(result.lines.some((line) => line.includes(`← target [${label('new')}]`))).toBe(true);
    const withHidden = componentPathByText(snapshot, 'Highlights');
    expect(withHidden.lines.at(-1)).toBe(
      '1 hidden matches for "Highlights" also exist; see `find --text "Highlights" --all`.',
    );
  });

  it('keeps the hidden-matches line within the output limit', () => {
    const full = componentPathByText(snapshot, 'Highlights').lines;
    const limit = full.length - 1;
    const limited = componentPathByText(snapshot, 'Highlights', { limit }).lines;
    expect(limited).toHaveLength(limit + 1);
    expect(limited.at(-1)).toBe(`… 1 more lines not shown (output limit ${limit}). Use tree on a node lower down.`);
  });

  it('lists candidates and exits 1 for no match, several, or only hidden ones', () => {
    expect(componentPathByText(snapshot, 'nothing here')).toMatchObject({
      exitCode: 1,
      lines: ['No path printed: nothing matches "nothing here". Try find with a shorter label, --tag or --attr.'],
    });
    const several = componentPathByText(snapshot, 'entityLabel');
    expect(several.exitCode).toBe(1);
    expect(several.lines[0]).toBe(
      'No path printed: "entityLabel" has 2 visible matches, and path --text needs exactly one.',
    );
    const hiddenOnly = componentPathByText(snapshot, '•7');
    expect(hiddenOnly.exitCode).toBe(1);
    expect(hiddenOnly.lines[0]).toMatch(/matches only hidden nodes \(1\)/);
  });
});

describe('tree and node', () => {
  it('prints the shadow root first, then light children, to a depth', () => {
    const { lines } = subtree(snapshot, highlights('new'), { depth: 1 });
    expect(lines).toEqual([
      `records-highlights2  [${highlights('new')}]`,
      '  #shadow(synthetic)',
      expect.stringMatching(/^ {4}slot\[name="entityLabel"\] {2}\[n\d+\]$/),
      expect.stringMatching(/^ {4}h2\.slds-card__header-title "Highlights" {2}\[n\d+\]$/),
      '  light DOM:',
      expect.stringMatching(/^ {4}records-entity-label\[slot="entityLabel"\] #shadow "Account" {2}\[n\d+\]$/),
    ]);
    const shallow = subtree(snapshot, highlights('new'), { depth: 0 });
    expect(shallow.lines[1]).toBe('  … 3 children (raise --depth or tree --node a child)');
    expect(subtree(snapshot).lines[0]).toBe('html  [n1]');
  });

  it('shows one node in full, with its address, parent side and children', () => {
    const { lines, json } = nodeDetails(snapshot, label('new'));
    expect(lines[0]).toBe(`records-entity-label  [${label('new')}]  at 0.1.1.0.s.0.0`);
    expect(lines).toContain('  shadow root: synthetic, text "Account"');
    expect(lines).toContain('  visibility: visible, rect [x 0, y 0, 10×10]');
    expect(lines.find((line) => line.startsWith('  parent'))).toMatch(/\(light DOM child\)$/);
    expect(json.node).toMatchObject({ id: label('new'), address: '0.1.1.0.s.0.0', shadow: { mode: 'synthetic' } });
    expect(json.node).not.toHaveProperty('children');
  });

  it('cuts one node in full at the output limit, and treats a limit below 1 as 1', () => {
    const full = nodeDetails(snapshot, label('new')).lines;
    const { lines, json } = nodeDetails(snapshot, label('new'), { limit: 2 });
    expect(lines).toEqual([
      ...full.slice(0, 2),
      `… ${full.length - 2} more lines not shown (output limit 2). Raise --limit.`,
    ]);
    expect(json.node.id).toBe(label('new'));
    for (const limit of [0, -3])
      expect(nodeDetails(snapshot, label('new'), { limit }).lines).toEqual([
        full[0],
        `… ${full.length - 1} more lines not shown (output limit 1). Raise --limit.`,
      ]);
  });

  it('lists ancestors nearest first, with a line wherever the chain leaves a shadow root', () => {
    const { lines } = nodeAncestors(snapshot, label('new'));
    expect(lines.slice(0, 4)).toEqual([
      `Ancestors of ${label('new')} records-entity-label[slot="entityLabel"] #shadow "Account", nearest first:`,
      `  ${highlights('new')}  records-highlights2`,
      `  — #shadow(synthetic) root of ${copy('new')} —`,
      `  ${copy('new')}  one-record-home-flexipage2[data-copy="new"]`,
    ]);
    expect(lines.at(-1)).toBe(
      "A CSS selector can't reach past a #shadow line: above it, scope with a page object, not a selector.",
    );
  });
});

describe('tree and node on hidden, closed and framed nodes', () => {
  const page = snapshotOf([
    el(
      'div',
      { class: 'slds-hide' },
      {
        hidden: true,
        children: [
          el('c-card', { title: '•4' }, { text: 'Hidden card', children: [el('span', {}, { text: 'inner' })] }),
        ],
      },
    ),
    el(
      'c-host',
      { id: 'main' },
      {
        shadow: [el('h2', {}, { text: 'Title' })],
        children: [el('button', { name: 'save' }, { text: 'Save' }), el('div', { class: 'later' }, { hidden: true })],
      },
    ),
    el('x-closed', {}, { mode: 'unreadable' }),
    el('iframe', { name: 'f' }, { src: 'https://acme.my.site.com/s/form' }),
  ]);
  const hiddenTop = handle(page, (node) => node.attrs?.class === 'slds-hide');
  const card = handle(page, (node) => node.tag === 'c-card');
  const inner = handle(page, (node) => node.text === 'inner');
  const host = handle(page, (node) => node.tag === 'c-host');
  const later = handle(page, (node) => node.attrs?.class === 'later');

  it('says whether a node is the top of a hidden subtree or inside one', () => {
    expect(nodeDetails(page, hiddenTop).lines).toContain('  visibility: hidden (top of a hidden subtree)');
    const { lines, json } = nodeDetails(page, card);
    expect(lines).toContain(`  visibility: hidden, inside ${hiddenTop} div.slds-hide`);
    expect(json.hiddenUnder).toBe(hiddenTop);
  });

  it('lists every attribute, its text, and each light and shadow child, marking hidden ones', () => {
    const { lines, json } = nodeDetails(page, host);
    expect(lines[0]).toMatch(/^c-host {2}\[n\d+\] {2}at 0\.1\.1$/);
    expect(lines).toContain('  attributes:');
    expect(lines).toContain('    id="main"');
    expect(lines).toContain('  light DOM children (2):');
    expect(lines.find((line) => line.includes(later))).toMatch(/div\.later {2}\(hidden\)$/);
    expect(lines).toContain('  shadow root children (1):');
    expect(lines.find((line) => line.includes('h2'))).toMatch(/^ {4}n\d+ +h2 "Title"$/);
    expect(json.children.map((child) => [child.node, child.hidden])).toEqual([
      ['button[name="save"] "Save"', false],
      ['div.later', true],
    ]);
    expect(json.shadowChildren.map((child) => child.node)).toEqual(['h2 "Title"']);
    expect(nodeDetails(page, card).lines).toContain('  text: "Hidden card"');
  });

  it("says a closed shadow root can't be read, and an iframe's content wasn't captured", () => {
    const closed = nodeDetails(
      page,
      handle(page, (node) => node.tag === 'x-closed'),
    ).lines;
    expect(closed).toContain("  shadow root: unreadable, most likely closed; UTAM selectors can't reach inside it");
    expect(closed).toContain('  no children in the snapshot');
    const frame = handle(page, (node) => node.tag === 'iframe');
    expect(nodeDetails(page, frame).lines).toContain(
      '  src: https://acme.my.site.com/s/form (iframe content not captured)',
    );
    expect(subtree(page, frame).lines[0]).toBe(
      `iframe[name="f"] src="https://acme.my.site.com/s/form" (iframe content not captured)  [${frame}]`,
    );
  });

  it('prints a node id as #id in one-line descriptions', () => {
    expect(subtree(page, host, { depth: 0 }).lines[0]).toBe(`c-host#main  [${host}]`);
  });

  it('says when a tree or an ancestor list starts inside a hidden subtree', () => {
    expect(subtree(page, card).lines[0]).toBe(`(inside hidden subtree ${hiddenTop})`);
    const { lines, json } = nodeAncestors(page, inner);
    expect(lines[0]).toBe(`Ancestors of ${inner} span (hidden, under ${hiddenTop}), nearest first:`);
    expect(lines).toContain(`  ${hiddenTop}  div.slds-hide  (hidden)`);
    expect(json.ancestors).toContainEqual({ kind: 'element', id: hiddenTop, node: 'div.slds-hide', hidden: true });
    expect(nodeAncestors(page, hiddenTop).lines[0]).toBe(
      `Ancestors of ${hiddenTop} div.slds-hide (hidden), nearest first:`,
    );
  });

  it('repeats where a long tree starts at its end, for output that keeps only the tail', () => {
    const wide = snapshotOf(Array.from({ length: 45 }, (_, i) => el('c-row', { 'data-i': String(i) })));
    const { lines } = subtree(wide);
    expect(lines).toHaveLength(48);
    expect(lines.at(-1)).toBe('(end of tree under n1 html)');
    expect(subtree(page).lines.at(-1)).not.toMatch(/^\(end of tree/);
  });
});

describe('header and UTAM error', () => {
  it("keeps a failed assertion's expected and received lines, and names the file", () => {
    const failed = recordPageSnapshot({
      scenario: "The second account's header",
      step: 'Then the record header shows "Test Biz 2"',
      error:
        'expect(received).toBe(expected)\n\nExpected: "Test Biz 2"\nReceived: "Test Biz 1"\n    at Context.<anonymous>',
    });
    expect(snapshotHeader(failed, { file: 'latest.json' })).toEqual([
      'Snapshot latest.json: failure, 2026-10-16T12:00:00.000Z, https://acme.lightning.force.com/lightning/r/Account/•id/view, mask labels',
      "  scenario: The second account's header",
      '  step: Then the record header shows "Test Biz 2"',
      '  error: expect(received).toBe(expected)',
      '         Expected: "Test Biz 2"',
      '         Received: "Test Biz 1"',
    ]);
  });

  it("repeats UTAM's search from its not-found error, from the element the index resolves", () => {
    const single = recordPageSnapshot(
      { error: "Can't find elements with locator 'records-entity-label' inside its scope element.." },
      false,
    );
    const panel = handle(single, (node) => node.tag === 'records-highlights2');
    const index = indexWith({ recordHeader: recordHeader('shadow') });
    expect(utamErrorHint(single, index)?.lines).toEqual([
      '  UTAM searched its scope element\'s light DOM (elements) for "records-entity-label". To repeat its search here:',
      `    npx simply-utam snapshot find --css "records-entity-label" --within ${panel}   (my-app/pageObjects/recordHeader, element "highlights.objectLabel")`,
    ]);
    let built = 0;
    const header = snapshotHeader(single, { index: () => (built++, index) });
    expect(built).toBe(1);
    expect(header.at(-1)).toContain(`--within ${panel}`);
  });

  it('keeps a selector with quotes in it whole, and quotes it for the shell', () => {
    const hint = (selector: string): ReturnType<typeof utamErrorHint> =>
      utamErrorHint(
        snapshotOf([el('c-x')], {
          error: `Can't find element with locator '${selector}' inside its scope shadow root`,
        }),
      );
    expect(hint("button[title='Save']")?.json.selector).toBe("button[title='Save']");
    expect(hint("button[title='Save']")?.lines[1]).toBe(
      `    npx simply-utam snapshot find --css "button[title='Save']"`,
    );
    expect(hint('button[title="Save"]')?.lines[1]).toBe(
      `    npx simply-utam snapshot find --css 'button[title="Save"]'`,
    );
    expect(hint(`a[title="it's"]`)?.lines[1]).toBe(`    npx simply-utam snapshot find --css 'a[title="it'\\''s"]'`);
  });

  it('tells the reader to recapture with aria when the selector tests an accessible name the mask hides', () => {
    const hint = (selector: string, mask: string): string[] | undefined =>
      utamErrorHint(
        snapshotOf([el('c-x')], {
          mask,
          error: `Can't find element with locator '${selector}' inside its scope element`,
        }),
      )?.lines;
    expect(hint("button[title='Edit']", 'labels')?.at(-1)).toBe(
      `    ${'Mask labels hides every [title] value. To check them on controls, recapture with UTAM_SNAPSHOT_MASK=aria.'}`,
    );
    expect(hint('input[placeholder="Search"][aria-label="Search"]', 'structure')?.at(-1)).toBe(
      '    Mask structure hides every [placeholder], [aria-label] value. To check them on controls, recapture with UTAM_SNAPSHOT_MASK=aria.',
    );
    expect(hint("button[title='Edit']", 'aria')).toHaveLength(3);
    expect(hint("c-x[data-id='a']", 'labels')).toHaveLength(3);
  });

  it("asks for both scopes when it can't tell where UTAM searched, and adds nothing for other errors", () => {
    const shadowError = snapshotOf([el('c-x')], {
      error: "Can't find element with locator 'lightning-input' inside its scope shadow root",
    });
    expect(utamErrorHint(shadowError)?.lines[1]).toBe('    npx simply-utam snapshot find --css "lightning-input"');
    let built = 0;
    const other = snapshotOf([el('c-x')], { error: 'Timeout' });
    expect(utamErrorHint(other)).toBeUndefined();
    snapshotHeader(other, { index: () => (built++, indexWith()) });
    expect(built).toBe(0);
  });
});
