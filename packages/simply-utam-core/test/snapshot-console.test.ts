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
import * as vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  DOM_SNAPSHOT_FORMAT,
  DomSnapshotError,
  captureDomSnapshot,
  domSnapshotSnippet,
  importDomSnapshot,
  type DomSnapshot,
} from '../src/index.js';

const BODY = `<h1 title="Account">Acme Corporation</h1><p>Some record text</p><button>Save</button>`;

/** A Lightning-like page in jsdom; `copy` is stubbed in when given, as the DevTools console has it. */
function page(copy?: (text: string) => void): { dom: JSDOM; downloads: Array<{ name: string; href: string }> } {
  const dom = new JSDOM(
    `<!doctype html><html><head><title>Acme | Account | Salesforce</title></head><body>${BODY}</body></html>`,
    {
      url: 'https://acme.lightning.force.com/lightning/r/Account/0015g00000XyZabAAB/view',
      runScripts: 'outside-only',
    },
  );
  const downloads: Array<{ name: string; href: string }> = [];
  const { window } = dom;
  if (copy) Object.assign(window, { copy });
  // jsdom has neither object URLs nor navigation; record the download link the snippet clicks.
  let blobs = 0;
  Object.assign(window.URL, { createObjectURL: () => `blob:snapshot-${++blobs}`, revokeObjectURL: () => undefined });
  window.document.addEventListener('click', (event) => {
    const link = event.target as HTMLAnchorElement;
    downloads.push({ name: link.download, href: link.href });
    event.preventDefault();
  });
  return { dom, downloads };
}

function runIn(dom: JSDOM, source: string): unknown {
  return new vm.Script(source).runInContext(dom.getInternalVMContext());
}

/** Everything but the capture time, which differs between two captures. */
function comparable(snapshot: DomSnapshot): unknown {
  return { ...snapshot, meta: { ...snapshot.meta, capturedAt: undefined } };
}

describe('domSnapshotSnippet', () => {
  it('copies the same snapshot a capture takes, and returns only a summary', async () => {
    const copied: string[] = [];
    const { dom, downloads } = page((text) => copied.push(text));
    const summary = runIn(dom, domSnapshotSnippet({ env: {} }));

    expect(copied).toHaveLength(1);
    expect(downloads).toEqual([]);
    expect(summary).toMatch(
      /^DOM snapshot of https:\/\/acme\.lightning\.force\.com\/lightning\/r\/Account\/•id\/view \(\d+ KB, mask labels\) copied to the clipboard\. Save it with: npx simply-utam snapshot console import$/,
    );
    const imported = importDomSnapshot(copied[0]);
    const captured = await captureDomSnapshot({
      page: { evaluate: async (source) => String(runIn(dom, source)) },
      focus: 'auto',
      env: {},
    });
    expect(comparable(imported)).toEqual(comparable(captured!));
    expect(imported.meta.trigger).toBe('manual');
  });

  it('copies ASCII only, so masked text survives any clipboard encoding', () => {
    const copied: string[] = [];
    const { dom } = page((text) => copied.push(text));
    runIn(dom, domSnapshotSnippet({ env: {} }));
    expect(copied[0]).toMatch(/^[\x20-\x7e]*$/);
    expect(copied[0]).toContain('\\u2022');
    expect(JSON.stringify(importDomSnapshot(copied[0]))).toContain('•');
  });

  it('downloads the JSON where the console has no copy, and says how to import it', () => {
    const { dom, downloads } = page();
    const summary = runIn(dom, domSnapshotSnippet({ env: {} })) as string;
    expect(downloads).toEqual([
      { name: expect.stringMatching(/^dom-snapshot-\d{8}T\d{6}\.json$/), href: 'blob:snapshot-1' },
    ]);
    expect(summary).toContain(
      `downloaded as ${downloads[0].name}. Save it with: npx simply-utam snapshot console import --file <path to ${downloads[0].name}>`,
    );
  });

  it('is ASCII only, fixes the mask and walker options, and warns on full', () => {
    const logged: string[] = [];
    const snippet = domSnapshotSnippet({ mask: 'full', maxNodes: 50, focus: 'none', log: (m) => logged.push(m) });
    expect(snippet).toMatch(/^[\t\n\r\x20-\x7e]*$/);
    expect(snippet).toContain('"trigger":"manual","mask":"full","maxNodes":50,"focus":"none"');
    expect(logged).toEqual(['DOM snapshot: mask "full" keeps record data in the snapshot.']);
    expect(domSnapshotSnippet({ env: { UTAM_SNAPSHOT_MASK: 'structure' } })).toContain('"mask":"structure"');
  });

  it('reports truncation in its summary', () => {
    const { dom } = page(() => undefined);
    expect(runIn(dom, domSnapshotSnippet({ env: {}, maxNodes: 1 }))).toContain('TRUNCATED (nodes)');
  });
});

describe('importDomSnapshot', () => {
  const json = JSON.stringify({
    format: DOM_SNAPSHOT_FORMAT,
    version: 1,
    meta: {
      capturedAt: '2026-10-19T12:00:00.000Z',
      trigger: 'failure',
      scenario: 'S',
      step: 'x',
      error: 'e',
      url: 'u',
      title: 't',
      viewport: [1, 1],
      mask: 'labels',
      truncated: null,
      label: 'old',
    },
    root: { address: '0', tag: 'html' },
  });

  it('sets the label when given and keeps the rest of meta', () => {
    expect(importDomSnapshot(json, { label: 'new' }).meta).toMatchObject({
      label: 'new',
      trigger: 'failure',
      scenario: 'S',
      error: 'e',
    });
    expect(importDomSnapshot(json).meta.label).toBe('old');
    expect(importDomSnapshot(`\uFEFF${json}\n`).root.id).toBe('n1');
  });

  it('rejects text that is not a snapshot, or from a newer version', () => {
    expect(() => importDomSnapshot('DOM snapshot of … copied')).toThrow(DomSnapshotError);
    expect(() => importDomSnapshot(json.replace('"version":1', '"version":99'))).toThrow(/newer than this reader/);
  });
});
