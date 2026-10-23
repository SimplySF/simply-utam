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

import { walkerExpression, type WalkerOptions } from './capture.js';
import { parseDomSnapshot, type DomSnapshot } from './format.js';

export type DomSnapshotSnippetOptions = Omit<WalkerOptions, 'trigger' | 'label'>;

export type ImportDomSnapshotOptions = {
  /** Replaces the snapshot's label when given. */
  label?: string;
};

/** The command that saves what the snippet copied, as the summary names it. */
const IMPORT_COMMAND = 'npx simply-utam snapshot console import';

// Runs in the browser's console. `copy` is the console's own utility; anywhere else, such as an
// agent's browser tool, the JSON is downloaded instead. The JSON is made ASCII only, as the snippet
// is, so no clipboard encoding changes it. It returns a summary, never the snapshot, so a tool that
// runs it doesn't get the whole snapshot back.
const WRAPPER = String.raw`(() => {
  const json = __WALKER__.replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const meta = JSON.parse(json).meta;
  const truncated = meta.truncated ? ', TRUNCATED (' + meta.truncated.reasons.join(', ') + ')' : '';
  const summary = 'DOM snapshot of ' + meta.url + ' (' + Math.ceil(json.length / 1024) + ' KB, mask ' + meta.mask + truncated + ')';
  if (typeof copy === 'function') {
    copy(json);
    return summary + ' copied to the clipboard. Save it with: __IMPORT__';
  }
  const name = 'dom-snapshot-' + meta.capturedAt.replace(/[-:]/g, '').slice(0, 15) + '.json';
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 60000);
  return summary + ' downloaded as ' + name + '. Save it with: __IMPORT__ --file <path to ' + name + '>';
})()`;

/** Every character outside ASCII as a `\u` escape, which means the same in JS source, strings and comments alike. */
function asciiOnly(source: string): string {
  return source.replace(/[\u0080-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * The console snippet: the walker with its options, wrapped to copy the snapshot JSON to the
 * clipboard (or download it, where the console's `copy` isn't defined) and return a one-line summary.
 * The mask is fixed here, because masking runs in the page. The snippet is ASCII only, so no clipboard
 * or terminal encoding can change it.
 *
 * @param options The walker's options; the trigger is always `manual`, and a label is set on import.
 */
export function domSnapshotSnippet(options: DomSnapshotSnippetOptions = {}): string {
  const expression = walkerExpression({ ...options, trigger: 'manual' });
  return asciiOnly(WRAPPER.replace('__WALKER__', () => expression).replace(/__IMPORT__/g, () => IMPORT_COMMAND));
}

/**
 * Read snapshot JSON from outside a test run, such as what the console snippet copied, for
 * `writeDomSnapshot`. The rest of `meta` is kept as captured.
 *
 * @param json The snapshot's JSON text.
 * @param options The label to set.
 * @throws {DomSnapshotError} When the text isn't a snapshot this version can read.
 */
export function importDomSnapshot(json: string, options: ImportDomSnapshotOptions = {}): DomSnapshot {
  // A clipboard on Windows can hand back a byte order mark before the text.
  const snapshot = parseDomSnapshot(json.replace(/^\uFEFF/, ''));
  if (options.label) snapshot.meta.label = options.label;
  return snapshot;
}
