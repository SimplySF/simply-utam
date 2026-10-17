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
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DOM_SNAPSHOT_FORMAT,
  buildPageObjectIndex,
  parseDomSnapshot,
  type DomNode,
  type DomSnapshot,
  type PageObjectIndex,
  type ShadowMode,
} from '../src/index.js';

/** A node to build a snapshot from; addresses are worked out from where it sits. */
export type Spec = {
  tag: string;
  attrs?: Record<string, string>;
  text?: string;
  hidden?: true;
  children?: Spec[];
  shadow?: Spec[];
  shadowText?: string;
  mode?: ShadowMode;
  /** An iframe's source, recorded without its content. */
  src?: string;
};

export function el(tag: string, attrs: Record<string, string> = {}, rest: Omit<Spec, 'tag' | 'attrs'> = {}): Spec {
  return { tag, ...(Object.keys(attrs).length > 0 ? { attrs } : {}), ...rest };
}

function toNode(spec: Spec, address: string): Omit<DomNode, 'id'> {
  const node: Omit<DomNode, 'id'> = { address, tag: spec.tag };
  if (spec.attrs) node.attrs = spec.attrs;
  if (spec.text) node.text = spec.text;
  if (spec.src) Object.assign(node, { src: spec.src, notCaptured: true });
  if (spec.hidden) node.hidden = true;
  else node.rect = [0, 0, 10, 10];
  if (spec.children) node.children = spec.children.map((child, i) => toNode(child, `${address}.${i}`)) as DomNode[];
  if (spec.shadow || spec.mode) {
    node.shadow = {
      mode: spec.mode ?? 'synthetic',
      children: (spec.shadow ?? []).map((child, i) => toNode(child, `${address}.s.${i}`)) as DomNode[],
      ...(spec.shadowText ? { text: spec.shadowText } : {}),
    };
  }
  return node;
}

/**
 * A snapshot whose body holds `body`, read the way a file is, so handles are numbered.
 *
 * @param body The body's children.
 * @param meta Metadata to set.
 */
export function snapshotOf(body: Spec[], meta: Record<string, unknown> = {}): DomSnapshot {
  return parseDomSnapshot(
    JSON.stringify({
      format: DOM_SNAPSHOT_FORMAT,
      version: 1,
      meta: {
        capturedAt: '2026-10-16T12:00:00.000Z',
        trigger: 'failure',
        url: 'https://acme.lightning.force.com/lightning/r/Account/•id/view',
        title: '•4 | •7 | Salesforce',
        viewport: [1280, 900],
        mask: 'labels',
        truncated: null,
        ...meta,
      },
      // `head` is pruned but counted, so `body` is child 1, as the walker records it.
      root: {
        address: '0',
        tag: 'html',
        rect: [0, 0, 10, 10],
        children: [toNode(el('body', {}, { children: body }), '0.1')],
      },
    }),
  );
}

export function all(snapshot: DomSnapshot): DomNode[] {
  const out: DomNode[] = [];
  const visit = (node: DomNode): void => {
    out.push(node);
    for (const child of [...(node.shadow?.children ?? []), ...(node.children ?? [])]) visit(child);
  };
  visit(snapshot.root);
  return out;
}

/** The handle of the only node matching `test`. */
export function handle(snapshot: DomSnapshot, test: (node: DomNode) => boolean): string {
  const found = all(snapshot).filter(test);
  if (found.length !== 1) throw new Error(`expected one node, found ${found.length}`);
  return found[0].id;
}

/** One copy of a record page: the host, its highlights panel, and the object label slotted into it. */
function recordPage(copy: string, label: string): Spec {
  return el(
    'one-record-home-flexipage2',
    { 'data-copy': copy },
    {
      shadow: [
        el(
          'records-highlights2',
          {},
          {
            shadow: [
              el('slot', { name: 'entityLabel' }),
              el('h2', { class: 'slds-card__header-title' }, { text: 'Highlights' }),
            ],
            children: [el('records-entity-label', { slot: 'entityLabel' }, { shadowText: label, shadow: [] })],
          },
        ),
      ],
    },
  );
}

/**
 * A record page in standard navigation: the previous page kept hidden before the visible one, an
 * unreadable component, and a custom element no page object covers.
 */
export function recordPageSnapshot(meta: Record<string, unknown> = {}, withHiddenCopy = true): DomSnapshot {
  const hiddenCopy = el(
    'div',
    { class: 'oneContent lafPageHost windowViewMode-minimized' },
    { hidden: true, children: [recordPage('old', '•7')] },
  );
  return snapshotOf(
    [
      ...(withHiddenCopy ? [hiddenCopy] : []),
      el('div', { class: 'oneContent active lafPageHost' }, { children: [recordPage('new', 'Account')] }),
      el('x-closed', {}, { mode: 'unreadable' }),
      el('c-widget', { 'data-id': 'w' }, { children: [el('span', { title: '•4' }, { text: 'Widget' })] }),
    ],
    meta,
  );
}

const SPO = 'node_modules/salesforce-pageobjects';

/** `salesforce-pageobjects` with the record home interface, its implementation and the highlights panel. */
export const shippedPageObjects: Record<string, unknown> = {
  [`${SPO}/package.json`]: { name: 'salesforce-pageobjects', version: '12.0.0' },
  [`${SPO}/dist/utam.manifest.json`]: {
    pageObjects: {
      'utam-global/pageObjects/recordHomeFlexipage2': 'package/dist/global/recordHomeFlexipage2.utam.json',
      'utam-global/pageObjects/recordHomeTemplateDesktop': 'package/dist/global/recordHomeTemplateDesktop.utam.json',
      'utam-records/pageObjects/highlights2': 'package/dist/records/highlights2.utam.json',
    },
  },
  [`${SPO}/dist/global/recordHomeFlexipage2.utam.json`]: { interface: true, root: true },
  [`${SPO}/dist/global/recordHomeTemplateDesktop.utam.json`]: {
    root: true,
    implements: 'utam-global/pageObjects/recordHomeFlexipage2',
    selector: { css: 'one-record-home-flexipage2' },
    shadow: {
      elements: [
        {
          name: 'highlights',
          public: true,
          type: 'utam-records/pageObjects/highlights2',
          selector: { css: 'records-highlights2' },
        },
      ],
    },
  },
  [`${SPO}/dist/records/highlights2.utam.json`]: {
    elements: [{ name: 'entityLabel', public: true, type: 'container', selector: { css: "[slot='entityLabel']" } }],
  },
};

const project: Record<string, unknown> = {
  'package.json': { name: 'my-app' },
  'utam.config.json': { pageObjectsRootDir: './', pageObjectsFileMask: ['**/__utam__/**/*.utam.json'] },
  'generator.config.json': { namespaces: { c: 'my-app/pageObjects/' } },
};

const dirs: string[] = [];

/**
 * A page-object index over the shipped page objects above and the given project page objects.
 *
 * @param pageObjects Project page objects by name.
 */
export function indexWith(pageObjects: Record<string, unknown> = {}): PageObjectIndex {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simply-utam-queries-'));
  dirs.push(dir);
  const files = { ...shippedPageObjects, ...project };
  for (const [name, json] of Object.entries(pageObjects)) files[`test/__utam__/${name}.utam.json`] = json;
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(dir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, JSON.stringify(content));
  }
  return buildPageObjectIndex({ projectDir: dir });
}

export function removeIndexDirs(): void {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/** The page object from F1's reference: the record header, down to the object label. */
export function recordHeader(highlightsScope: 'shadow' | 'light'): Record<string, unknown> {
  const highlights = {
    name: 'highlights',
    selector: { css: 'records-highlights2' },
    elements: [{ name: 'objectLabel', public: true, selector: { css: 'records-entity-label' } }],
  };
  return {
    root: true,
    selector: { css: 'one-record-home-flexipage2' },
    ...(highlightsScope === 'shadow' ? { shadow: { elements: [highlights] } } : { elements: [highlights] }),
  };
}

/** F2's fix: a project root page object at the visible page host, wrapping the shipped record home. */
export const activeRecordHome = {
  root: true,
  selector: { css: '.oneContent.active.lafPageHost' },
  elements: [
    {
      name: 'recordHome',
      public: true,
      wait: true,
      type: 'salesforce-pageobjects/global/pageObjects/recordHomeFlexipage2',
      selector: { css: 'one-record-home-flexipage2' },
    },
  ],
};
