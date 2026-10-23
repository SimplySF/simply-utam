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

import { describePlain } from './describe.js';
import { DomSnapshotError, type DomNode, type DomSnapshot } from './format.js';

/** A node with what the queries need around it. */
export type Located = {
  node: DomNode;
  parent?: Located;
  /** Reached by stepping into the parent's shadow root. */
  viaShadow: boolean;
  /** The nearest node, itself included, marked `hidden`. */
  hiddenTop?: Located;
  /** The node's place in the walk: shadow root first, then light children, as `tree` prints them. */
  order: number;
  light: Located[];
  shadow: Located[];
};

const indexes = new WeakMap<DomSnapshot, { byId: Map<string, Located>; byAddress: Map<string, Located> }>();

function build(snapshot: DomSnapshot): { byId: Map<string, Located>; byAddress: Map<string, Located> } {
  const cached = indexes.get(snapshot);
  if (cached) return cached;
  const byId = new Map<string, Located>();
  const byAddress = new Map<string, Located>();
  let order = 0;
  const visit = (node: DomNode, parent: Located | undefined, viaShadow: boolean): Located => {
    const entry: Located = { node, parent, viaShadow, order: order++, light: [], shadow: [] };
    entry.hiddenTop = node.hidden ? entry : parent?.hiddenTop;
    byId.set(node.id, entry);
    if (node.address) byAddress.set(node.address, entry);
    for (const child of node.shadow?.children ?? []) entry.shadow.push(visit(child, entry, true));
    for (const child of node.children ?? []) entry.light.push(visit(child, entry, false));
    return entry;
  };
  visit(snapshot.root, undefined, false);
  const built = { byId, byAddress };
  indexes.set(snapshot, built);
  return built;
}

/**
 * Every node by its handle, in walk order.
 *
 * @param snapshot The snapshot.
 */
export function locate(snapshot: DomSnapshot): Map<string, Located> {
  return build(snapshot).byId;
}

/**
 * One node by its handle. An address (`0.1.2…`) is refused with the handle it stands for, so
 * the caller learns which form commands take.
 *
 * @param snapshot The snapshot.
 * @param nodeId The node's handle, such as `n4821`.
 */
export function getNode(snapshot: DomSnapshot, nodeId: string): Located {
  const { byId, byAddress } = build(snapshot);
  const found = byId.get(nodeId);
  if (found) return found;
  if (/^0(\.|$)/.test(nodeId)) {
    const byAddr = byAddress.get(nodeId);
    throw new DomSnapshotError(
      `${nodeId} is an address, not a node handle. Commands take the n number printed next to each node${
        byAddr ? `; in this snapshot that's ${byAddr.node.id}` : ''
      }.`,
    );
  }
  throw new DomSnapshotError(`No node ${nodeId} in this snapshot.`);
}

/** A matched node, as queries report it. */
export type FoundNode = {
  id: string;
  tag: string;
  attrs?: Record<string, string>;
  text?: string;
  shadowText?: string;
  hidden: boolean;
  /** For a hidden match: the top of the hidden subtree it's in. */
  hiddenUnder?: { id: string; node: string };
};

/**
 * A located node as queries report it.
 *
 * @param entry The node.
 */
export function toFound(entry: Located): FoundNode {
  const { node } = entry;
  const found: FoundNode = { id: node.id, tag: node.tag, hidden: entry.hiddenTop !== undefined };
  if (node.attrs) found.attrs = node.attrs;
  if (node.text) found.text = node.text;
  if (node.shadow?.text) found.shadowText = node.shadow.text;
  if (entry.hiddenTop) found.hiddenUnder = { id: entry.hiddenTop.node.id, node: describePlain(entry.hiddenTop.node) };
  return found;
}

/**
 * The shadow host whose shadow tree a node is in, or undefined for the document's tree.
 *
 * @param entry The node.
 */
export function treeHost(entry: Located): Located | undefined {
  for (let up: Located = entry; up.parent; up = up.parent) if (up.viaShadow) return up.parent;
  return undefined;
}

/**
 * Whether `entry` is a descendant of `ancestor`, across shadow roots.
 *
 * @param entry The node.
 * @param ancestor The possible ancestor.
 */
export function isUnder(entry: Located, ancestor: Located): boolean {
  for (let up = entry.parent; up; up = up.parent) if (up === ancestor) return true;
  return false;
}
