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

import type { DomNode } from './format.js';

/**
 * Cut a value to `max` characters, ending with `…` when it was longer.
 *
 * @param value The text.
 * @param max The most characters to keep.
 */
export function clip(value: string, max = 60): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * A value as one POSIX shell word, for a command the output suggests: double-quoted, or
 * single-quoted when it has a double quote.
 *
 * @param value The text, such as a selector.
 */
export function shellQuote(value: string): string {
  return value.includes('"') ? `'${value.replaceAll("'", "'\\''")}'` : `"${value}"`;
}

// Aura and LWC bookkeeping: never useful in a selector, and on every node of a Lightning page.
const NOISE_ATTRS = new Set(['data-aura-rendered-by', 'data-data-rendering-service-uid', 'data-aura-class']);

/**
 * A node in one line: tag, id and classes as CSS, other attributes, own text and shadow text.
 *
 * @param node The node.
 */
export function describeNode(node: DomNode): string {
  const attrs = node.attrs ?? {};
  let out = node.tag;
  if (attrs.id) out += `#${attrs.id}`;
  if (attrs.class)
    out += attrs.class
      .trim()
      .split(/\s+/)
      .map((name) => `.${name}`)
      .join('');
  for (const [name, value] of Object.entries(attrs)) {
    if (name !== 'id' && name !== 'class' && !NOISE_ATTRS.has(name)) out += `[${name}="${clip(value)}"]`;
  }
  if (node.text) out += ` "${node.text}"`;
  if (node.shadow?.text) out += ` #shadow "${node.shadow.text}"`;
  if (node.shadow?.mode === 'unreadable') out += ' #shadow(unreadable: UTAM selectors cannot reach inside)';
  if (node.src) out += ` src="${node.src}"`;
  if (node.notCaptured) out += ' (iframe content not captured)';
  return out;
}

/**
 * A node in one line, without its own text: for naming a container.
 *
 * @param node The node.
 */
export function describePlain(node: DomNode): string {
  return describeNode({ ...node, text: undefined });
}
