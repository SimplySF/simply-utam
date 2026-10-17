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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { serializeDomSnapshot } from '../src/index.js';

// The scaffolded templates, run as a test project runs them, with WebdriverIO's modules stubbed.
const WDIO_CONFIG = '../templates/wdio.conf.mjs';
const SNAPSHOT_STEPS = '../templates/dom-snapshot.steps.mjs';

type Hook = (...args: unknown[]) => Promise<unknown>;

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@simplysf/simply-utam');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('scaffolded wdio.conf.mjs', () => {
  it("still takes the failure screenshot when the DOM snapshot can't be written", async () => {
    vi.doMock('wdio-utam-service', () => ({ UtamWdioService: class {} }));
    vi.doMock('@wdio/allure-reporter', () => ({ default: { addAttachment: vi.fn() } }));
    vi.doMock('@simplysf/simply-utam', () => ({
      captureDomSnapshot: vi.fn(async () => ({ meta: {}, root: { address: '0', tag: 'html' } })),
      pruneDomSnapshots: vi.fn(),
      serializeDomSnapshot,
      snapshotRunId: vi.fn(),
      writeDomSnapshot: vi.fn(async () => {
        throw new Error('EPERM: operation not permitted, rename latest.json');
      }),
    }));
    const takeScreenshot = vi.fn(async () => '');
    vi.stubGlobal('browser', { takeScreenshot });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { config } = (await import(WDIO_CONFIG)) as { config: { afterStep: Hook } };
    await config.afterStep({ text: 'I click Save' }, { name: 'S' }, { error: 'boom' });

    expect(takeScreenshot).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith('DOM snapshot not saved: EPERM: operation not permitted, rename latest.json');
  });
});

describe('scaffolded dom-snapshot.steps.mjs', () => {
  async function loadSteps(api: Record<string, unknown>): Promise<Map<string, Hook>> {
    const steps = new Map<string, Hook>();
    vi.doMock('@wdio/cucumber-framework', () => ({
      Before: vi.fn(),
      When: (pattern: string, fn: Hook) => steps.set(pattern, fn),
    }));
    vi.doMock('@simplysf/simply-utam', () => api);
    await import(SNAPSHOT_STEPS);
    return steps;
  }

  it('loads with a @simplysf/simply-utam that predates DOM snapshots, and only the step fails', async () => {
    // A real module namespace reads a missing export as undefined; vitest's mock throws unless it's listed.
    const steps = await loadSteps({
      goToApplication: vi.fn(),
      captureDomSnapshot: undefined,
      writeDomSnapshot: undefined,
    });
    const step = steps.get('I capture the DOM snapshot')!;
    await expect(step.call({ domSnapshotScenario: 'S' })).rejects.toThrow(
      'The installed @simplysf/simply-utam has no DOM snapshots. Upgrade it in package.json to use this step.',
    );
  });

  it('captures and writes a labelled snapshot', async () => {
    const captureDomSnapshot = vi.fn(async () => ({ meta: {} }));
    const writeDomSnapshot = vi.fn(async () => '.utam/snapshots/r/S--after.json');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const steps = await loadSteps({ captureDomSnapshot, writeDomSnapshot });
    await steps.get('I capture the DOM snapshot {string}')!.call({ domSnapshotScenario: 'S' }, 'after');
    expect(captureDomSnapshot).toHaveBeenCalledWith({ trigger: 'step', scenario: 'S', label: 'after' });
    expect(log).toHaveBeenCalledWith('DOM snapshot written to .utam/snapshots/r/S--after.json');
  });
});
