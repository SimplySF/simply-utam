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

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { parseDomSnapshot, querySnapshot, type DomNode, type DomSnapshot, type SelectorScope } from '../src/index.js';
import { walkerSource } from '../src/snapshot/capture.js';
import { getNode } from '../src/snapshot/locate.js';

type WalkOptions = Record<string, unknown> & {
  /** Runs against the document before the walk, to attach shadow roots and define elements. */
  setup?: (window: JSDOM['window']) => void;
  /** Called with each element `getRect` is asked about; return a size, or nothing for 10 × 10. */
  rect?: (el: Element) => { width: number; height: number } | undefined;
  /** Leaves `checkVisibility` out, so the walker falls back to computed styles. */
  noCheckVisibility?: boolean;
  /** Runs `performance.now()` through this instead, given the number of calls so far. */
  clock?: (calls: number) => number;
};

const URL_WITH_RECORD = 'https://acme.lightning.force.com/lightning/r/Account/0015g00000XyZabAAB/view?ws=1#x';

/**
 * Run the walker in jsdom, from the same text core sends to a browser. jsdom has no
 * `checkVisibility` and no layout, so the test passes both in, as the walker allows.
 */
function walk(body: string, options: WalkOptions = {}, title = 'Acme | Account | Salesforce'): DomSnapshot {
  return walkDom(body, options, title).snapshot;
}

/** {@link walk}, keeping the jsdom window the snapshot was taken from. */
function walkDom(
  body: string,
  options: WalkOptions = {},
  title = 'Acme | Account | Salesforce',
): { snapshot: DomSnapshot; window: JSDOM['window'] } {
  const { setup, rect, noCheckVisibility, clock, ...walkerOptions } = options;
  const dom = new JSDOM(`<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`, {
    url: URL_WITH_RECORD,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  setup?.(window);
  if (clock) {
    let calls = 0;
    Object.defineProperty(window.performance, 'now', { value: () => clock(calls++) });
  }
  const hidden = (el: Element): boolean => {
    const style = window.getComputedStyle(el);
    return style.display === 'none' || style.visibility === 'hidden';
  };
  Object.assign(window, {
    walkerOptions: {
      ...(noCheckVisibility ? {} : { checkVisibility: (el: Element) => !hidden(el) }),
      ...walkerOptions,
      getRect: (el: Element) => ({ x: 1.4, y: 2.6, width: 10, height: 10, ...rect?.(el) }),
    },
  });
  return { snapshot: parseDomSnapshot(window.eval(`(${walkerSource()})(window.walkerOptions)`) as string), window };
}

function allNodes(node: DomNode, out: DomNode[] = []): DomNode[] {
  out.push(node);
  for (const child of [...(node.shadow?.children ?? []), ...(node.children ?? [])]) allNodes(child, out);
  return out;
}

function nodes(snapshot: DomSnapshot): DomNode[] {
  return allNodes(snapshot.root);
}

function byTag(snapshot: DomSnapshot, tag: string): DomNode[] {
  return nodes(snapshot).filter((node) => node.tag === tag);
}

function byAttr(snapshot: DomSnapshot, name: string, value: string): DomNode | undefined {
  return nodes(snapshot).find((node) => node.attrs?.[name] === value);
}

function shadow(host: Element, html: string): ShadowRoot {
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = html;
  return root;
}

describe('walker source', () => {
  it('is one self-contained function, the same text that ships in lib', () => {
    const source = walkerSource();
    expect(source).toMatch(/^[\s\S]*?\nfunction domSnapshotWalker\(input\) \{/);
    // It parses on its own as one function. The tests below run it in a separate jsdom global, where
    // nothing from this module exists, so a reference outside itself would fail there.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- building it from its text is the check
    const build = new Function(`return (${source})`) as () => unknown;
    expect(typeof build()).toBe('function');
    const built = new URL('../lib/snapshot/walker.js', import.meta.url);
    if (fs.existsSync(built)) expect(fs.readFileSync(built, 'utf8')).toBe(source);
  });
});

describe('walker: structure', () => {
  const snapshot = walk(
    `<div class="wrap"><div class="slds-col"><c-app id="app"></c-app></div></div>
     <x-slotted><span slot="title">Title</span></x-slotted>
     <span id="input-27" data-id="n">generated id</span>
     <svg data-icon="x"><path d="M0"></path></svg>
     <script>var x = 1;</script><template><b>t</b></template>`,
    {
      setup: (window) => {
        const app = window.document.querySelector('c-app')!;
        const inner = shadow(app, '<c-inner><p id="deep">Deep</p></c-inner>');
        shadow(inner.querySelector('c-inner')!, '<slot></slot><slot name="aside"></slot><em title="x">Inner</em>');
        shadow(window.document.querySelector('x-slotted')!, '<h2><slot name="title"></slot></h2>');
      },
    },
  );

  it('keeps the root and body, and gives addresses from 0, with s for a shadow root', () => {
    expect(snapshot.root).toMatchObject({ tag: 'html', address: '0' });
    expect(snapshot.root.children?.[0]).toMatchObject({ tag: 'body', address: '0.1' });
    const app = byTag(snapshot, 'c-app')[0];
    expect(app.address).toBe('0.1.0.0.0');
    expect(byTag(snapshot, 'c-inner')[0].address).toBe('0.1.0.0.0.s.0');
    expect(byTag(snapshot, 'em')[0].address).toBe('0.1.0.0.0.s.0.s.2');
  });

  it('removes plain wrappers, moving their children up without changing their addresses', () => {
    expect(nodes(snapshot).some((node) => node.attrs?.class === 'wrap' || node.attrs?.class === 'slds-col')).toBe(
      false,
    );
    expect(snapshot.root.children?.[0].children?.[0].tag).toBe('c-app');
  });

  it('records light children, shadow children and slotted content separately', () => {
    const inner = byTag(snapshot, 'c-inner')[0];
    expect(inner.children?.map((node) => node.tag)).toEqual(['p']);
    expect(inner.shadow).toMatchObject({ mode: 'native' });
    // A slot with no name has nothing to keep it; a named one keeps its name.
    expect(inner.shadow?.children.map((node) => node.tag)).toEqual(['slot', 'em']);
    expect(inner.shadow?.children[0].attrs).toEqual({ name: 'aside' });
    const slotted = byTag(snapshot, 'x-slotted')[0];
    expect(slotted.children?.[0]).toMatchObject({ tag: 'span', attrs: { slot: 'title' } });
  });

  it('drops generated ids, scripts, templates and the inside of svg', () => {
    expect(byAttr(snapshot, 'data-id', 'n')?.attrs).toEqual({ 'data-id': 'n' });
    expect(byTag(snapshot, 'script')).toEqual([]);
    expect(byTag(snapshot, 'template')).toEqual([]);
    expect(byTag(snapshot, 'svg')[0].children).toBeUndefined();
  });

  it('rounds rects for visible elements', () => {
    expect(byTag(snapshot, 'c-app')[0].rect).toEqual([1, 3, 10, 10]);
  });

  it('numbers handles shadow root first, then light children, the same on every read', () => {
    const inner = byTag(snapshot, 'c-inner')[0];
    const [slot, em] = inner.shadow!.children;
    const [p] = inner.children!;
    expect(Number(slot.id.slice(1))).toBeLessThan(Number(em.id.slice(1)));
    expect(Number(em.id.slice(1))).toBeLessThan(Number(p.id.slice(1)));
    expect(snapshot.root.id).toBe('n1');
  });
});

describe('walker: visibility', () => {
  it('marks the top of a hidden subtree once, keeping a plain hidden wrapper', () => {
    const snapshot = walk(
      `<div class="slds-hide" style="display: none"><div><one-record-home-flexipage2 data-copy="old"></one-record-home-flexipage2></div></div>
       <one-record-home-flexipage2 data-copy="new"></one-record-home-flexipage2>`,
    );
    const top = byAttr(snapshot, 'class', 'slds-hide');
    expect(top).toMatchObject({ hidden: true });
    expect(top?.rect).toBeUndefined();
    const copies = byTag(snapshot, 'one-record-home-flexipage2');
    expect(copies.map((node) => [node.attrs?.['data-copy'], node.hidden])).toEqual([
      ['old', undefined],
      ['new', undefined],
    ]);
  });

  it('inside a hidden subtree keeps only custom elements and elements with text, a name or data-*', () => {
    const snapshot = walk(
      `<div style="display: none"><span class="x">kept text</span><b role="button"></b><input name="q"><i data-k="1"></i><c-thing></c-thing></div>`,
    );
    const hiddenTop = snapshot.root.children![0].children![0];
    expect(hiddenTop.children?.map((node) => node.tag)).toEqual(['span', 'input', 'i', 'c-thing']);
  });

  it('never marks display: contents hosts or slots hidden, nor an option in a closed select', () => {
    const snapshot = walk(
      `<c-host style="display: contents"><span data-x="1">in host</span></c-host>
       <select name="s"><option>One</option></select>`,
      {
        setup: (window) => {
          shadow(window.document.querySelector('c-host')!, '<slot name="main" style="display: contents"></slot>');
        },
        // What a browser's checkVisibility says: false for display: contents, and for an option in a
        // closed select, which has no box.
        checkVisibility: (el: Element) =>
          !['contents', 'none'].includes(el.ownerDocument.defaultView!.getComputedStyle(el).display) &&
          el.localName !== 'option',
      },
    );
    expect(byTag(snapshot, 'c-host')[0].hidden).toBeUndefined();
    expect(byTag(snapshot, 'slot')[0].hidden).toBeUndefined();
    expect(byTag(snapshot, 'option')[0].hidden).toBeUndefined();
  });

  it('keeps zero-size elements visible, with the size in rect', () => {
    const snapshot = walk('<c-zero></c-zero>', { rect: () => ({ width: 0, height: 0 }) });
    expect(byTag(snapshot, 'c-zero')[0]).toMatchObject({ rect: [1, 3, 0, 0] });
    expect(byTag(snapshot, 'c-zero')[0].hidden).toBeUndefined();
  });

  it('falls back to computed display and visibility without checkVisibility', () => {
    const snapshot = walk('<c-a style="visibility: hidden"></c-a><c-b></c-b>', { noCheckVisibility: true });
    expect(byTag(snapshot, 'c-a')[0].hidden).toBe(true);
    expect(byTag(snapshot, 'c-b')[0].hidden).toBeUndefined();
  });

  it('judges the children of a visibility: hidden element on their own when one is set back to visible', () => {
    const body = `<c-panel style="visibility: hidden"><c-label>Hidden</c-label><c-action style="visibility: visible"></c-action></c-panel>
       <c-gone style="visibility: hidden"><c-inner></c-inner><c-under style="display: none"><c-x style="visibility: visible"></c-x></c-under></c-gone>`;
    for (const noCheckVisibility of [false, true]) {
      const snapshot = walk(body, { noCheckVisibility });
      expect(byTag(snapshot, 'c-panel')[0].hidden).toBeUndefined();
      expect(byTag(snapshot, 'c-label')[0].hidden).toBe(true);
      expect(byTag(snapshot, 'c-action')[0]).toMatchObject({ rect: [1, 3, 10, 10] });
      expect(byTag(snapshot, 'c-action')[0].hidden).toBeUndefined();
      // A visible descendant under display: none doesn't render, so the subtree stays hidden.
      expect(byTag(snapshot, 'c-gone')[0].hidden).toBe(true);
    }
  });
});

describe('walker: shadow roots', () => {
  it('records shadow text, masked by the host rules', () => {
    const snapshot = walk(
      '<lightning-formatted-text></lightning-formatted-text><records-entity-label></records-entity-label>',
      {
        setup: (window) => {
          window.document
            .querySelector('lightning-formatted-text')!
            .attachShadow({ mode: 'open' })
            .append('(555) 010-0001');
          window.document.querySelector('records-entity-label')!.attachShadow({ mode: 'open' }).append('Account');
        },
      },
    );
    expect(byTag(snapshot, 'lightning-formatted-text')[0].shadow).toMatchObject({ text: '•14', children: [] });
    expect(byTag(snapshot, 'records-entity-label')[0].shadow?.text).toBe('Account');
  });

  it('flags a defined custom element with no readable root, no children and a size as unreadable', () => {
    const snapshot = walk(
      `<x-closed></x-closed><x-undefined></x-undefined><x-light><span data-a="1">a</span></x-light><x-zero></x-zero><x-text>t</x-text>`,
      {
        setup: (window) => {
          for (const tag of ['x-closed', 'x-light', 'x-zero', 'x-text']) {
            window.customElements.define(tag, class extends window.HTMLElement {});
          }
          window.document.querySelector('x-closed')!.attachShadow({ mode: 'closed' }).innerHTML = '<p>secret</p>';
        },
        rect: (el) => (el.localName === 'x-zero' ? { width: 0, height: 5 } : undefined),
      },
    );
    expect(byTag(snapshot, 'x-closed')[0].shadow).toEqual({ mode: 'unreadable', children: [] });
    for (const tag of ['x-undefined', 'x-light', 'x-zero', 'x-text']) {
      expect(byTag(snapshot, tag)[0].shadow).toBeUndefined();
    }
  });
});

describe('walker: limits and focus', () => {
  const many = (prefix: string, count: number): string =>
    Array.from({ length: count }, (_, i) => `<c-${prefix} data-i="${i}"></c-${prefix}>`).join('');

  it('stops adding visible nodes at maxNodes, with the reason', () => {
    const snapshot = walk(many('v', 10), { maxNodes: 4 });
    expect(snapshot.meta.truncated).toEqual({ reasons: ['nodes'] });
    expect(byTag(snapshot, 'c-v')).toHaveLength(2);
  });

  it('walks the visible page first, so hidden content before it uses neither budget', () => {
    const snapshot = walk(`<div style="display: none">${many('h', 10)}</div>${many('v', 3)}`, {
      maxHiddenNodes: 3,
    });
    expect(byTag(snapshot, 'c-v')).toHaveLength(3);
    expect(byTag(snapshot, 'c-h')).toHaveLength(2);
    expect(snapshot.meta.truncated).toEqual({ reasons: ['hiddenNodes'] });
  });

  it('runs out of time in the hidden part, after the visible page', () => {
    let visibleDone = false;
    const snapshot = walk(`<div style="display: none">${many('h', 5)}</div>${many('v', 3)}`, {
      timeBudgetMs: 100,
      // The clock jumps once the last visible element has been measured.
      rect: (el) => {
        if (el.localName === 'c-v' && el.getAttribute('data-i') === '2') visibleDone = true;
        return undefined;
      },
      clock: () => (visibleDone ? 1000 : 0),
    });
    expect(byTag(snapshot, 'c-v')).toHaveLength(3);
    expect(byTag(snapshot, 'c-h')).toHaveLength(0);
    expect(snapshot.meta.truncated).toEqual({ reasons: ['time'] });
  });

  it('keeps the root and body when the time is up before the walk starts, cutting what is below them', () => {
    const snapshot = walk(many('v', 3), { timeBudgetMs: 0, clock: (calls) => calls });
    expect(snapshot.root).toMatchObject({ tag: 'html', address: '0' });
    expect(snapshot.root.children?.map((node) => node.tag)).toEqual(['body']);
    expect(byTag(snapshot, 'c-v')).toHaveLength(0);
    expect(snapshot.meta.truncated).toEqual({ reasons: ['time'] });
  });

  it('keeps the root and body past maxNodes', () => {
    const snapshot = walk(many('v', 3), { maxNodes: 0 });
    expect(snapshot.root.children?.map((node) => node.tag)).toEqual(['body']);
    expect(byTag(snapshot, 'c-v')).toHaveLength(0);
    expect(snapshot.meta.truncated).toEqual({ reasons: ['nodes'] });
  });

  it('counts the tops of hidden subtrees against maxHiddenNodes', () => {
    const tops = Array.from({ length: 5 }, (_, i) => `<c-h data-i="${i}" style="display: none"></c-h>`).join('');
    const snapshot = walk(`${tops}${many('v', 2)}`, { maxHiddenNodes: 2 });
    expect(byTag(snapshot, 'c-h').map((node) => node.attrs?.['data-i'])).toEqual(['0', '1']);
    expect(byTag(snapshot, 'c-v')).toHaveLength(2);
    expect(snapshot.meta.truncated).toEqual({ reasons: ['hiddenNodes'] });
  });

  it('lists every limit it reached', () => {
    const snapshot = walk(`<div style="display: none">${many('h', 5)}</div>${many('v', 6)}`, {
      maxNodes: 5,
      maxHiddenNodes: 2,
    });
    expect(snapshot.meta.truncated?.reasons.sort()).toEqual(['hiddenNodes', 'nodes']);
  });

  it('walks the focus element first, keeping its ancestors past maxNodes, and records its address', () => {
    const body = `${many('chrome', 6)}<section class="tabContent oneConsoleTab"><c-record></c-record></section>`;
    const unfocused = walk(body, { maxNodes: 5 });
    expect(byTag(unfocused, 'c-record')).toHaveLength(0);
    const focused = walk(body, { maxNodes: 5, focus: 'auto' });
    expect(byTag(focused, 'c-record')).toHaveLength(1);
    expect(byTag(focused, 'c-record')[0].address).toBe('0.1.6.0');
    expect(focused.meta.focus).toBe('0.1.6');
    // The rest of the page fills what's left: html, body and the record use 3 of the 5.
    expect(byTag(focused, 'c-chrome')).toHaveLength(2);
  });

  it('takes a CSS selector as focus, ignores one that matches nothing visible, and reaches into shadow hosts', () => {
    const body = `${many('chrome', 6)}<c-app></c-app><main style="display: none"><c-x></c-x></main>`;
    const setup = (window: JSDOM['window']): void => {
      shadow(window.document.querySelector('c-app')!, '<c-record id="r"></c-record>');
    };
    expect(walk(body, { maxNodes: 4, focus: 'c-app', setup }).meta.focus).toBe('0.1.6');
    expect(byTag(walk(body, { maxNodes: 4, focus: 'c-app', setup }), 'c-record')).toHaveLength(1);
    const none = walk(body, { focus: 'main' });
    expect(none.meta.focus).toBeUndefined();
    expect(walk(body, { focus: '<<not css' }).meta.focus).toBeUndefined();
  });

  it('focuses an element inside a shadow root by keeping its host chain', () => {
    const body = `${many('chrome', 6)}<c-app></c-app>`;
    const snapshot = walk(body, {
      maxNodes: 3,
      focus: 'c-app',
      setup: (window) => {
        shadow(window.document.querySelector('c-app')!, '<c-shell><c-record></c-record></c-shell>');
      },
    });
    expect(byTag(snapshot, 'c-record')).toHaveLength(1);
    expect(byTag(snapshot, 'c-shell')[0].address).toBe('0.1.6.s.0');
  });
});

describe('walker: masking', () => {
  const recordPage = `
    <label>Account Name</label><span class="test-id__field-label">Phone</span>
    <lightning-formatted-text data-output-element-id="output-field"></lightning-formatted-text>
    <h1>Acme Corp</h1><h2 class="slds-card__header-title">Contacts (3)</h2>
    <a href="/x">Acme Lookup</a><a role="tab" href="#">Details</a><a role="button" href="#">Name</a>
    <button aria-label="Edit Phone" title="Edit">Edit</button>
    <div role="option" title="Acme">Acme Result</div><div role="menuitem">Recent Acme</div>
    <select name="Stage"><option>Prospecting</option></select>
    <article aria-label="Contacts">card</article>
    <table><thead><tr><th scope="col">Contact Name</th></tr></thead>
      <tbody><tr><th>Jo Bloggs</th><td><input type="checkbox" aria-label="Select item Jo Bloggs"></td></tr></tbody></table>
    <div class="tabBar"><ul class="tabBarItems"><li><a role="tab" title="Acme Corp">Acme Corp</a></li></ul></div>
    <span data-value="secret" data-recordid="0015g00000XyZabAAB" data-name-value="x" data-mail="a@b.co">v</span>
    <input value="typed" placeholder="Search Accounts">`;

  const labels = walk(recordPage, {
    setup: (window) => {
      window.document.querySelector('lightning-formatted-text')!.attachShadow({ mode: 'open' }).append('Acme Corp');
    },
  });
  const text = (snapshot: DomSnapshot, tag: string, i = 0): string | undefined => byTag(snapshot, tag)[i]?.text;

  it('keeps label text and masks record values with their length, in labels mode', () => {
    expect(text(labels, 'label')).toBe('Account Name');
    expect(text(labels, 'span')).toBe('Phone');
    expect(text(labels, 'h2')).toBe('Contacts (3)');
    expect(text(labels, 'h1')).toBe('•9');
    expect(byTag(labels, 'lightning-formatted-text')[0].shadow?.text).toBe('•9');
    expect(text(labels, 'option')).toBe('Prospecting');
    expect(text(labels, 'th', 0)).toBe('Contact Name');
  });

  it('masks links, row headers, lookup options and menu items, but not tabs and column header links', () => {
    expect(byTag(labels, 'a').map((node) => node.text)).toEqual(['•11', 'Details', 'Name', '•9']);
    expect(byAttr(labels, 'role', 'option')).toMatchObject({ text: '•11', attrs: { title: '•4' } });
    expect(byAttr(labels, 'role', 'menuitem')?.text).toBe('•11');
  });

  it('keeps control labels, masks them elsewhere, and masks everything in tab bars and data rows', () => {
    expect(byTag(labels, 'button')[0].attrs).toMatchObject({ 'aria-label': 'Edit Phone', title: 'Edit' });
    expect(byTag(labels, 'article')[0].attrs?.['aria-label']).toBe('•8');
    expect(text(labels, 'th', 1)).toBe('•9');
    expect(byAttr(labels, 'type', 'checkbox')?.attrs?.['aria-label']).toBe('•21');
    const tab = nodes(labels).find((node) => node.tag === 'a' && node.attrs?.title !== undefined);
    expect(tab).toMatchObject({ text: '•9', attrs: { role: 'tab', title: '•9' } });
  });

  it('masks value attributes, and record ids and emails in the values it keeps', () => {
    expect(byAttr(labels, 'data-value', '•6')?.attrs).toEqual({
      'data-value': '•6',
      'data-recordid': '•id',
      'data-name-value': '•1',
      'data-mail': '•email',
    });
    expect(byTag(labels, 'input').find((node) => node.attrs?.placeholder)?.attrs).toEqual({
      value: '•5',
      placeholder: 'Search Accounts',
    });
  });

  it('masks every text and control label in structure mode, and nothing in full mode', () => {
    const structure = walk(recordPage, { mask: 'structure' });
    expect(text(structure, 'label')).toBe('•12');
    expect(byTag(structure, 'button')[0].attrs?.['aria-label']).toBe('•10');
    expect(structure.meta.mask).toBe('structure');
    const full = walk(recordPage, { mask: 'full' });
    expect(text(full, 'h1')).toBe('Acme Corp');
    expect(full.meta.url).toBe(URL_WITH_RECORD);
  });

  it('masks the metadata: record ids and the query in the url, every title part but the app', () => {
    expect(labels.meta).toMatchObject({
      url: 'https://acme.lightning.force.com/lightning/r/Account/•id/view',
      title: '•4 | •7 | Salesforce',
      mask: 'labels',
      trigger: 'manual',
      truncated: null,
    });
    expect(labels.meta.viewport).toHaveLength(2);
  });

  it('records an iframe as not captured, with its masked source', () => {
    const snapshot = walk('<iframe src="/apex/Page?id=0015g00000XyZabAAB"></iframe>');
    expect(byTag(snapshot, 'iframe')[0]).toMatchObject({ src: '/apex/Page', notCaptured: true });
    // The fragment goes too, as it does from meta.url, query string or not.
    const fragments = walk('<iframe src="/apex/Page#0015g00000XyZabAAB"></iframe><iframe src="/a?x=1#y"></iframe>');
    expect(byTag(fragments, 'iframe').map((node) => node.src)).toEqual(['/apex/Page', '/a']);
    expect(byTag(walk('<iframe src="/a?x=1#y"></iframe>', { mask: 'full' }), 'iframe')[0].src).toBe('/a?x=1#y');
  });
});

describe('walker: LWC synthetic shadow', () => {
  // Lightning renders most components under @lwc/synthetic-shadow, which emulates shadowRoot and
  // children. Loaded into jsdom, it scopes shadow roots as in the browser; the LWC engine's part,
  // marking each rendered element with its owner, is done by hand here.
  const require = createRequire(import.meta.url);
  const polyfill = fs.readFileSync(require.resolve('@lwc/synthetic-shadow/dist/index.cjs'), 'utf8');
  const OWNER = '$$HostElementKey$$';
  const KEY = '$$ShadowedNodeKey$$';

  const snapshot = walk('<c-outer></c-outer>', {
    setup: (window) => {
      window.eval(`var process = { env: { NODE_ENV: 'production' } }; var module = { exports: {} };\n${polyfill}`);
      const doc = window.document;
      const owned = (tag: string, owner: Element): Element =>
        Object.assign(doc.createElement(tag), { [OWNER]: (owner as unknown as Record<string, unknown>)[KEY] });
      const synthetic = (host: Element): ShadowRoot =>
        host.attachShadow({ mode: 'open', '$$lwc-synthetic-mode': true } as ShadowRootInit);
      // A host gets its key when its shadow root is attached, so attach before creating its content.
      const outer = doc.querySelector('c-outer')!;
      const outerRoot = synthetic(outer);
      const inner = owned('c-inner', outer);
      // The polyfill patches appendChild, not append.
      outerRoot.appendChild(inner);
      outerRoot.appendChild(owned('c-sibling', outer));
      const innerRoot = synthetic(inner);
      innerRoot.appendChild(owned('c-leaf', inner));
    },
  });

  it('recognizes synthetic roots, and walks each one as its own scope', () => {
    const [outer] = byTag(snapshot, 'c-outer');
    expect(outer.shadow?.mode).toBe('synthetic');
    expect(outer.shadow?.children.map((node) => node.tag)).toEqual(['c-inner', 'c-sibling']);
    const [inner] = byTag(snapshot, 'c-inner');
    expect(inner).toMatchObject({ address: '0.1.0.s.0', shadow: { mode: 'synthetic' } });
    expect(inner.shadow?.children.map((node) => node.tag)).toEqual(['c-leaf']);
    expect(byTag(snapshot, 'c-leaf')).toHaveLength(1);
  });

  it("doesn't see shadow content from the document's tree", () => {
    expect(outerLightTags(snapshot)).toEqual([]);
  });
});

describe('querySnapshot matches querySelectorAll', () => {
  // A page with no plain wrapper in the way of these selectors, and one that is: `div.wrap`, which the
  // walker prunes, moving `c-wrapped` up to `body`.
  const { snapshot, window } = walkDom(
    `<c-app id="app"><c-header class="hdr" title="Header"><span data-k="a">A</span><span data-k="b">B</span></c-header>` +
      `<c-list><c-item data-i="1"></c-item><c-item data-i="2" class="sel"></c-item><c-item data-i="3"></c-item></c-list></c-app>` +
      `<c-host><c-slotted slot="x"><c-leaf></c-leaf></c-slotted></c-host>` +
      `<div class="wrap"><c-wrapped data-w="1"></c-wrapped></div>`,
    {
      setup: (win) => {
        shadow(
          win.document.querySelector('c-host')!,
          '<c-panel class="p"><c-row data-r="1"></c-row><c-row data-r="2"></c-row></c-panel><c-foot></c-foot><slot name="x"></slot>',
        );
      },
    },
  );
  const doc = window.document;
  const host = doc.querySelector('c-host')!;
  const hostHandle = nodes(snapshot).find((node) => node.tag === 'c-host')!.id;

  /** An element's address as the walker records it: child positions, `s` for a step into a shadow root. */
  function addressOf(el: Element): string {
    const segments: string[] = [];
    for (let current = el; current !== doc.documentElement;) {
      const parent = current.parentElement;
      if (parent) {
        segments.unshift(String([...parent.children].indexOf(current)));
        current = parent;
      } else {
        const root = current.parentNode as ShadowRoot;
        segments.unshift(`s.${[...root.children].indexOf(current)}`);
        current = root.host;
      }
    }
    return ['0', ...segments].join('.');
  }

  const live = (from: ParentNode, css: string): string[] => [...from.querySelectorAll(css)].map(addressOf);
  const fromSnapshot = (css: string, scope?: SelectorScope): string[] =>
    querySnapshot(snapshot, css, scope).matches.map((match) => getNode(snapshot, match.id).node.address);

  it('in the document', () => {
    const selectors = [
      'c-item',
      'c-list > c-item',
      'c-item + c-item',
      'c-item ~ c-item',
      'c-item:first-child',
      'c-item:nth-child(2)',
      'c-item:last-child',
      '.sel',
      '#app c-item',
      'c-app > c-header span',
      'span[data-k="b"]',
      '[title]',
      'c-header span:last-child',
      'body > c-app',
      'c-host > c-slotted',
      'c-slotted c-leaf',
      'c-panel',
      'c-row',
    ];
    for (const css of selectors) expect(fromSnapshot(css), css).toEqual(live(doc, css));
    expect(fromSnapshot('c-item').length).toBe(3);
  });

  it("in a host's shadow root", () => {
    const scope: SelectorScope = { kind: 'shadow', within: hostHandle };
    for (const css of [
      'c-row',
      'c-panel > c-row',
      'c-row + c-row',
      'c-panel ~ c-foot',
      ':first-child',
      'slot',
      '.p c-row',
    ])
      expect(fromSnapshot(css, scope), css).toEqual(live(host.shadowRoot!, css));
    // As in the browser, the host itself and its light DOM are outside its shadow root.
    expect(fromSnapshot('c-host c-row', scope)).toEqual(live(host.shadowRoot!, 'c-host c-row'));
    expect(fromSnapshot('c-leaf', scope)).toEqual([]);
  });

  it("in a host's light DOM", () => {
    const scope: SelectorScope = { kind: 'light', within: hostHandle };
    for (const css of ['c-leaf', 'c-slotted > c-leaf', '[slot]', 'c-host c-leaf', 'c-row'])
      expect(fromSnapshot(css, scope), css).toEqual(live(host, css));
  });

  it('differs across a pruned wrapper, and says it may', () => {
    expect(live(doc, '.wrap c-wrapped')).toHaveLength(1);
    const named = querySnapshot(snapshot, '.wrap c-wrapped');
    expect(named.matches).toEqual([]);
    expect(named.notes).toContain(
      'No node in this snapshot has .wrap: it may be on an element the snapshot pruned (plain wrappers are dropped), so the live page may match differently.',
    );
    expect(live(doc, 'body > c-wrapped')).toEqual([]);
    const child = querySnapshot(snapshot, 'body > c-wrapped');
    expect(child.matches).toHaveLength(1);
    expect(child.notes).toContain(
      ">, +, ~ and child-position pseudo-classes can match differently on the live page: the snapshot drops plain wrappers, so a node's parent and siblings here may not be its live ones.",
    );
  });
});

function outerLightTags(snapshot: DomSnapshot): string[] {
  return (byTag(snapshot, 'c-outer')[0].children ?? []).map((node) => node.tag);
}
