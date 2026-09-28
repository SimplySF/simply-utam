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

import { describe, expect, it, vi } from 'vitest';
import { formatUtamHtml, getUtamHtml, logUtamHtml, type UtamElementLike } from '../src/utam-html.js';

const getHTML = vi.fn(() => Promise.resolve('<lightning-button></lightning-button>'));

function utamObject(selector: unknown): UtamElementLike {
  return { element: { element: { selector, getHTML } } };
}

const byRole = (): void => {};

// eslint-disable-next-line no-control-regex
const stripAnsi = (text: string): string => text.replace(/\x1b\[\d+m/g, '');

describe('getUtamHtml', () => {
  it('reads the selector and the HTML with shadow roots serialized', async () => {
    const object = utamObject('.slds-button');

    expect(await getUtamHtml(object)).toStrictEqual({
      selector: '.slds-button',
      html: '<lightning-button></lightning-button>',
    });
    expect(getHTML).toHaveBeenCalledWith({ serializableShadowRoots: true });
  });

  it('describes a non-string selector', async () => {
    expect((await getUtamHtml(utamObject({ css: 'button' }))).selector).toBe('{"css":"button"}');
    expect((await getUtamHtml(utamObject(byRole))).selector).toBe('byRole');
  });
});

describe('formatUtamHtml', () => {
  it('renders a labelled block', () => {
    expect(stripAnsi(formatUtamHtml({ selector: '.slds-button', html: '<button></button>' }))).toBe(
      'Logging UTAM Html selector .slds-button\n<button></button>',
    );
  });
});

describe('logUtamHtml', () => {
  it('writes the block to the given logger', async () => {
    const log = vi.fn();

    await logUtamHtml(utamObject('.slds-button'), log);

    expect(log).toHaveBeenCalledOnce();
    expect(stripAnsi(log.mock.calls[0][0] as string)).toContain('<lightning-button></lightning-button>');
  });
});
