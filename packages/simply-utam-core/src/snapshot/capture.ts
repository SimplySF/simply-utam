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

import { readFileSync } from 'node:fs';
import type { EnvLike } from '../test-environment.js';
import { parseDomSnapshot, type DomSnapshot, type SnapshotMask, type SnapshotTrigger } from './format.js';

/** Runs the walker's source in a page and returns the JSON text it produces. */
export type SnapshotPage = {
  evaluate(source: string, timeoutMs: number): Promise<string>;
};

/** The part of a WebdriverIO browser capture uses. */
export type SnapshotBrowser = {
  execute(script: string, ...args: unknown[]): Promise<unknown>;
};

export type CaptureDomSnapshotOptions = WalkerOptions & {
  /** The browser to capture. Defaults to WebdriverIO's global `browser`. */
  browser?: SnapshotBrowser;
  /** Any other way to run the walker; used instead of `browser` when given. */
  page?: SnapshotPage;
  scenario?: string;
  step?: string;
  /** The failed step's error; its message is copied into `meta.error`, without terminal color codes. */
  error?: unknown;
  /** The backstop around the whole capture. Defaults to 10 s. */
  timeoutMs?: number;
};

export const SNAPSHOT_MASK_ENV = 'UTAM_SNAPSHOT_MASK';

let walkerSourceCache: string | undefined;

/** The walker's source text, exactly as it ships in `walker.js`. */
export function walkerSource(): string {
  walkerSourceCache ??= readFileSync(new URL('./walker.js', import.meta.url), 'utf8');
  return walkerSourceCache;
}

function browserPage(browser: SnapshotBrowser): SnapshotPage {
  return {
    async evaluate(source: string): Promise<string> {
      return String(await browser.execute(`return ${source};`));
    },
  };
}

/** The options every way of running the walker shares. */
export type WalkerOptions = {
  /** Defaults to `manual`. */
  trigger?: SnapshotTrigger;
  label?: string;
  /** Defaults to `UTAM_SNAPSHOT_MASK`, then `labels`. */
  mask?: SnapshotMask;
  maxNodes?: number;
  maxHiddenNodes?: number;
  timeBudgetMs?: number;
  /** `none`, `auto`, or a CSS selector. */
  focus?: string;
  /** Where `UTAM_SNAPSHOT_MASK` is read from. Defaults to `process.env`. */
  env?: EnvLike;
  /** Where warnings go. Defaults to `console.warn`. */
  log?: (message: string) => void;
};

function resolveMask(options: WalkerOptions): SnapshotMask {
  const value = options.mask ?? (options.env ?? process.env)[SNAPSHOT_MASK_ENV];
  return value === 'structure' || value === 'aria' || value === 'full' ? value : 'labels';
}

/** The default warning sink. */
export function warn(message: string): void {
  // eslint-disable-next-line no-console -- the default sink; `log` lets a caller redirect it
  console.warn(message);
}

/**
 * The expression that runs the walker with these options, `(<walker>)(<options>)`, as every way of
 * capturing sends it to a page. Warns through `log` when the mask is `full`.
 */
export function walkerExpression(options: WalkerOptions): string {
  const mask = resolveMask(options);
  if (mask === 'full') (options.log ?? warn)('DOM snapshot: mask "full" keeps record data in the snapshot.');
  const walkerOptions = {
    trigger: options.trigger ?? 'manual',
    label: options.label,
    mask,
    maxNodes: options.maxNodes,
    maxHiddenNodes: options.maxHiddenNodes,
    timeBudgetMs: options.timeBudgetMs,
    focus: options.focus,
  };
  return `(${walkerSource()})(${JSON.stringify(walkerOptions)})`;
}

// Assertion libraries color their messages; the snapshot is read as text, not in a terminal.
// eslint-disable-next-line no-control-regex -- matching the escape character is the point
const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '');
}

function errorMessage(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && 'message' in error) return String(error.message);
  return typeof error === 'string' ? error : JSON.stringify(error);
}

/**
 * Capture a DOM snapshot of the current page. Never throws: on any failure it logs a warning and
 * returns `undefined`.
 *
 * @param options What to capture and how.
 */
export async function captureDomSnapshot(options: CaptureDomSnapshotOptions = {}): Promise<DomSnapshot | undefined> {
  const log = options.log ?? warn;
  try {
    const source = walkerExpression({ ...options, log });
    const timeoutMs = options.timeoutMs ?? 10_000;
    let page = options.page;
    if (!page) {
      const browser = options.browser ?? (globalThis as unknown as { browser?: SnapshotBrowser }).browser;
      if (!browser || typeof browser.execute !== 'function') throw new Error('no browser to capture');
      page = browserPage(browser);
    }
    let timer: NodeJS.Timeout | undefined;
    const json = await Promise.race([
      page.evaluate(source, timeoutMs),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
    const snapshot = parseDomSnapshot(json);
    if (options.scenario) snapshot.meta.scenario = options.scenario;
    if (options.step) snapshot.meta.step = options.step;
    const message = errorMessage(options.error);
    if (message !== undefined) snapshot.meta.error = stripAnsi(message);
    return snapshot;
  } catch (error) {
    log(`DOM snapshot not captured: ${errorMessage(error) ?? 'unknown error'}`);
    return undefined;
  }
}
