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

import { describe, expect, it } from 'vitest';
import {
  applicationPath,
  lightningAppName,
  newRecordPath,
  recordPath,
  relatedListPath,
} from '../src/lightning-paths.js';

describe('lightningAppName', () => {
  it('puts a bare developer name in the default namespace', () => {
    expect(lightningAppName('MyApp')).toBe('c__MyApp');
  });

  it('leaves a namespaced name alone', () => {
    expect(lightningAppName('standard__Sales')).toBe('standard__Sales');
    expect(lightningAppName('acme__Billing')).toBe('acme__Billing');
  });
});

describe('Lightning paths', () => {
  it('builds an app home page path', () => {
    expect(applicationPath('MyApp')).toBe('/lightning/app/c__MyApp/page/home');
  });

  it('builds a new-record path', () => {
    expect(newRecordPath('MyApp', 'Invoice__c')).toBe('/lightning/app/c__MyApp/o/Invoice__c/new');
  });

  it('builds a record path', () => {
    expect(recordPath('MyApp', '001000000000001AAA')).toBe('/lightning/app/c__MyApp/r/001000000000001AAA/view');
  });

  it('builds a related-list path', () => {
    expect(relatedListPath('standard__Sales', '001000000000001AAA', 'Contacts')).toBe(
      '/lightning/app/standard__Sales/r/001000000000001AAA/related/Contacts/view',
    );
  });

  it('encodes segments so a stray character cannot change the route', () => {
    expect(recordPath('MyApp', '001/../x')).toBe('/lightning/app/c__MyApp/r/001%2F..%2Fx/view');
  });
});
