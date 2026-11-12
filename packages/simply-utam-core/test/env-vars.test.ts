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
import { LEGACY_ENV, deprecatedEnvWarning, envValue } from '../src/env-vars.js';

describe('envValue', () => {
  it('maps every prefixed name to the UTAM_ name it replaced', () => {
    for (const [current, legacy] of Object.entries(LEGACY_ENV)) {
      expect(current).toBe(`SIMPLY_${legacy}`);
    }
  });

  it('reads the prefixed name without a warning', () => {
    const log = vi.fn();
    expect(envValue({ SIMPLY_UTAM_USERNAME: 'qa' }, 'SIMPLY_UTAM_USERNAME', log)).toBe('qa');
    expect(log).not.toHaveBeenCalled();
  });

  it('prefers the prefixed name, ignoring a legacy name it shadows without a warning', () => {
    const log = vi.fn();
    const env = { SIMPLY_UTAM_USERNAME: 'new', UTAM_USERNAME: 'old' };
    expect(envValue(env, 'SIMPLY_UTAM_USERNAME', log)).toBe('new');
    expect(log).not.toHaveBeenCalled();
  });

  it('falls back to the legacy name, warning once per name for an env', () => {
    const log = vi.fn();
    const env = { UTAM_USERNAME: 'old', UTAM_SNAPSHOT_MASK: 'aria' };
    expect(envValue(env, 'SIMPLY_UTAM_USERNAME', log)).toBe('old');
    expect(envValue(env, 'SIMPLY_UTAM_USERNAME', log)).toBe('old');
    expect(envValue(env, 'SIMPLY_UTAM_SNAPSHOT_MASK', log)).toBe('aria');
    expect(log.mock.calls).toEqual([
      [deprecatedEnvWarning('SIMPLY_UTAM_USERNAME')],
      [deprecatedEnvWarning('SIMPLY_UTAM_SNAPSHOT_MASK')],
    ]);

    envValue({ UTAM_USERNAME: 'old' }, 'SIMPLY_UTAM_USERNAME', log);
    expect(log).toHaveBeenCalledTimes(3);
  });

  it('treats an empty value as unset', () => {
    const log = vi.fn();
    expect(envValue({ SIMPLY_UTAM_USERNAME: '', UTAM_USERNAME: 'old' }, 'SIMPLY_UTAM_USERNAME', log)).toBe('old');
    expect(envValue({ UTAM_USERNAME: '' }, 'SIMPLY_UTAM_USERNAME', log)).toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
  });

  it('names the rename, never the value', () => {
    const message = deprecatedEnvWarning('SIMPLY_UTAM_USERNAME');
    expect(message).toBe(
      'Deprecated environment variable UTAM_USERNAME in use: rename it to SIMPLY_UTAM_USERNAME. ' +
        'The unprefixed name will stop working in a future major release.',
    );
  });
});
