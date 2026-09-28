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

/** The part of a UTAM page object or element this module reads: its wrapped WebdriverIO element. */
export type UtamElementLike = {
  element: {
    element: {
      selector: unknown;
      getHTML(options?: { serializableShadowRoots?: boolean }): Promise<string>;
    };
  };
};

/** What a UTAM object resolved to in the page. */
export type UtamHtml = {
  selector: string;
  html: string;
};

const colors = {
  reset: '\x1b[0m',
  brightCyanBackground: '\x1b[106m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
};

/**
 * Read the selector a UTAM object resolved through and its rendered HTML, shadow roots included.
 *
 * @param utamObject A UTAM page object or element.
 */
export async function getUtamHtml(utamObject: UtamElementLike): Promise<UtamHtml> {
  const element = utamObject.element.element;
  return {
    selector: describeSelector(element.selector),
    html: await element.getHTML({ serializableShadowRoots: true }),
  };
}

/**
 * Render a `getUtamHtml` result as a colored block for a terminal.
 *
 * @param utamHtml The selector and HTML to render.
 */
export function formatUtamHtml(utamHtml: UtamHtml): string {
  return (
    `${colors.brightCyanBackground}Logging UTAM Html${colors.reset} ${colors.cyan}selector${colors.reset} ` +
    `${utamHtml.selector}\n${colors.green}${utamHtml.html}${colors.reset}`
  );
}

/**
 * Log what a UTAM object resolved to, for working out why a locator does not match.
 *
 * @param utamObject A UTAM page object or element.
 * @param log Where the block is written. Defaults to `console.log`.
 */
export async function logUtamHtml(
  utamObject: UtamElementLike,
  // eslint-disable-next-line no-console -- logging is this function's purpose; `log` lets a caller redirect it
  log: (message: string) => void = (message) => console.log(message),
): Promise<void> {
  log(formatUtamHtml(await getUtamHtml(utamObject)));
}

function describeSelector(selector: unknown): string {
  if (typeof selector === 'string') return selector;
  if (typeof selector === 'function') return selector.name || 'anonymous function';
  return JSON.stringify(selector) ?? String(selector);
}
