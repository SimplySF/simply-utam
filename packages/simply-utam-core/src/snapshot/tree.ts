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

import { clip, describeNode, describePlain } from './describe.js';
import type { DomNode, DomSnapshot } from './format.js';
import { getNode, locate, type Located } from './locate.js';
import { DEFAULT_OUTPUT_LIMIT, limitLines, type QueryOutputOptions, type QueryResult } from './query-result.js';

export type SubtreeOptions = QueryOutputOptions & {
  /** How many levels below the node to print. Defaults to 3. */
  depth?: number;
};

/**
 * The pruned tree under a node, to a depth. Under a node with a shadow root, its shadow root's
 * children come first, then its light children under `light DOM:`, so every child's side is explicit.
 *
 * @param snapshot The snapshot.
 * @param handle The node to start at; the snapshot's root when omitted.
 * @param options How deep to go, and the output limit.
 */
export function subtree(snapshot: DomSnapshot, handle?: string, options: SubtreeOptions = {}): QueryResult<DomNode> {
  const start = handle ? getNode(snapshot, handle) : locate(snapshot).values().next().value!;
  const maxDepth = options.depth ?? 3;
  const lines: string[] = [];
  const trim = (node: DomNode, depth: number): DomNode => {
    const copy: DomNode = { ...node };
    delete copy.children;
    if (copy.shadow) copy.shadow = { ...copy.shadow, children: [] };
    if (depth < maxDepth) {
      if (node.children) copy.children = node.children.map((child) => trim(child, depth + 1));
      if (node.shadow && copy.shadow)
        copy.shadow.children = node.shadow.children.map((child) => trim(child, depth + 1));
    }
    return copy;
  };
  const print = (node: DomNode, depth: number, indent: number): void => {
    const pad = '  '.repeat(indent);
    lines.push(`${pad}${describeNode(node)}${node.hidden ? '  (hidden)' : ''}  [${node.id}]`);
    const childCount = (node.children?.length ?? 0) + (node.shadow?.children.length ?? 0);
    if (depth >= maxDepth) {
      if (childCount > 0) lines.push(`${pad}  … ${childCount} children (raise --depth or tree --node a child)`);
      return;
    }
    const light = node.children ?? [];
    if (!node.shadow || node.shadow.mode === 'unreadable') {
      for (const child of light) print(child, depth + 1, indent + 1);
      return;
    }
    // The shadow root first, as the component renders it; light children under their own marker.
    lines.push(`${pad}  #shadow(${node.shadow.mode})${node.shadow.text ? ` "${node.shadow.text}"` : ''}`);
    for (const child of node.shadow.children) print(child, depth + 1, indent + 2);
    if (light.length > 0) {
      lines.push(`${pad}  light DOM:`);
      for (const child of light) print(child, depth + 1, indent + 2);
    }
  };
  if (start.hiddenTop && start.hiddenTop !== start) lines.push(`(inside hidden subtree ${start.hiddenTop.node.id})`);
  print(start.node, 0, 0);
  const limited = limitLines(lines, options.limit ?? DEFAULT_OUTPUT_LIMIT, 'Lower --depth, or tree --node a child.');
  // Some agent harnesses keep only the tail of long output; repeat where this tree starts.
  if (limited.length > 40) limited.push(`(end of tree under ${start.node.id} ${clip(describeNode(start.node), 80)})`);
  return { lines: limited, json: trim(start.node, 0) };
}

type ChildLine = { id: string; node: string; hidden: boolean };

export type NodeDetails = {
  node: Omit<DomNode, 'children' | 'shadow'> & { shadow?: { mode: string; text?: string } };
  /** `light` when it's a child of its parent, `shadow` when it's in its parent's shadow root. */
  parent?: { id: string; node: string; via: 'light' | 'shadow' };
  /** The top of the hidden subtree it's in, itself included. */
  hiddenUnder?: string;
  children: ChildLine[];
  shadowChildren: ChildLine[];
};

function ownFields(node: DomNode): NodeDetails['node'] {
  const own: NodeDetails['node'] = { ...node };
  delete (own as Partial<DomNode>).children;
  const { shadow } = node;
  if (shadow) own.shadow = { mode: shadow.mode, ...(shadow.text ? { text: shadow.text } : {}) };
  return own;
}

function visibilityLine(entry: Located): string {
  const { node } = entry;
  if (node.hidden) return '  visibility: hidden (top of a hidden subtree)';
  if (entry.hiddenTop)
    return `  visibility: hidden, inside ${entry.hiddenTop.node.id} ${describePlain(entry.hiddenTop.node)}`;
  const rect = node.rect ? `, rect [x ${node.rect[0]}, y ${node.rect[1]}, ${node.rect[2]}×${node.rect[3]}]` : '';
  return `  visibility: visible${rect}`;
}

/**
 * One node in full: its handle and address, every recorded attribute unclipped, its text and shadow
 * text, size, visibility, parent, and each of its light and shadow children on one line.
 *
 * @param snapshot The snapshot.
 * @param handle The node's handle.
 */
export function nodeDetails(snapshot: DomSnapshot, handle: string): QueryResult<NodeDetails> {
  const entry = getNode(snapshot, handle);
  const { node } = entry;
  const summary = (child: DomNode): ChildLine => ({
    id: child.id,
    node: describeNode(child),
    hidden: child.hidden === true,
  });
  const json: NodeDetails = {
    node: ownFields(node),
    ...(entry.parent
      ? {
          parent: {
            id: entry.parent.node.id,
            node: describeNode(entry.parent.node),
            via: entry.viaShadow ? 'shadow' : 'light',
          },
        }
      : {}),
    ...(entry.hiddenTop ? { hiddenUnder: entry.hiddenTop.node.id } : {}),
    children: (node.children ?? []).map(summary),
    shadowChildren: (node.shadow?.children ?? []).map(summary),
  };

  const lines = [`${node.tag}  [${node.id}]  at ${node.address}`];
  const attrs = Object.entries(node.attrs ?? {});
  if (attrs.length > 0) lines.push('  attributes:', ...attrs.map(([name, value]) => `    ${name}="${value}"`));
  if (node.text) lines.push(`  text: "${node.text}"`);
  if (node.shadow?.mode === 'unreadable')
    lines.push("  shadow root: unreadable, most likely closed; UTAM selectors can't reach inside it");
  else if (node.shadow)
    lines.push(`  shadow root: ${node.shadow.mode}${node.shadow.text ? `, text "${node.shadow.text}"` : ''}`);
  if (node.src) lines.push(`  src: ${node.src}${node.notCaptured ? ' (iframe content not captured)' : ''}`);
  lines.push(visibilityLine(entry));
  if (json.parent) {
    const side = json.parent.via === 'shadow' ? 'in its shadow root' : 'light DOM child';
    lines.push(`  parent in the snapshot: ${json.parent.id} ${clip(json.parent.node, 100)} (${side})`);
  }
  const list = (label: string, items: ChildLine[]): void => {
    if (items.length === 0) return;
    lines.push(`  ${label} (${items.length}):`);
    for (const item of items)
      lines.push(`    ${item.id.padEnd(24)} ${clip(item.node, 110)}${item.hidden ? '  (hidden)' : ''}`);
  };
  list('light DOM children', json.children);
  list('shadow root children', json.shadowChildren);
  if (json.children.length === 0 && json.shadowChildren.length === 0) lines.push('  no children in the snapshot');
  return { lines, json };
}

export type AncestorLine =
  | { kind: 'element'; id: string; node: string; hidden: boolean }
  /** The next element up is this host; the elements below are in its shadow root. */
  | { kind: 'shadowRoot'; host: string; mode: string };

export type AncestorsResult = { target: { id: string; node: string }; ancestors: AncestorLine[] };

/**
 * A node's ancestors, nearest first, one line each, with a line where the chain leaves a shadow
 * root: for picking a container to scope a selector with, which `find --css` then tests.
 *
 * @param snapshot The snapshot.
 * @param handle The node's handle.
 * @param options The output limit.
 */
export function nodeAncestors(
  snapshot: DomSnapshot,
  handle: string,
  options: QueryOutputOptions = {},
): QueryResult<AncestorsResult> {
  const start = getNode(snapshot, handle);
  const ancestors: AncestorLine[] = [];
  for (let entry: Located = start; entry.parent; entry = entry.parent) {
    const parent = entry.parent;
    if (entry.viaShadow)
      ancestors.push({ kind: 'shadowRoot', host: parent.node.id, mode: parent.node.shadow?.mode ?? 'unknown' });
    ancestors.push({
      kind: 'element',
      id: parent.node.id,
      node: describePlain(parent.node),
      hidden: parent.node.hidden === true,
    });
  }
  let where = '';
  if (start.hiddenTop) where = start.hiddenTop === start ? ' (hidden)' : ` (hidden, under ${start.hiddenTop.node.id})`;
  const lines = [`Ancestors of ${start.node.id} ${describePlain(start.node)}${where}, nearest first:`];
  const width = Math.max(...ancestors.map((line) => (line.kind === 'element' ? line.id.length : 0)), 2);
  for (const line of ancestors) {
    if (line.kind === 'shadowRoot') lines.push(`  — #shadow(${line.mode}) root of ${line.host} —`);
    else lines.push(`  ${line.id.padEnd(width)}  ${line.node}${line.hidden ? '  (hidden)' : ''}`);
  }
  if (ancestors.some((line) => line.kind === 'shadowRoot'))
    lines.push("A CSS selector can't reach past a #shadow line: above it, scope with a page object, not a selector.");
  return {
    lines: limitLines(lines, options.limit ?? DEFAULT_OUTPUT_LIMIT, 'Raise --limit.'),
    json: { target: { id: start.node.id, node: describePlain(start.node) }, ancestors },
  };
}
