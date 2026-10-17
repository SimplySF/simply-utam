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

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildPageObjectIndex, lookupPageObject, searchPageObjects } from '../src/index.js';
import { selectorLastParts, selectorTags } from '../src/snapshot/page-object-index.js';

type Files = Record<string, unknown>;

function writeProject(files: Files): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simply-utam-index-'));
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(dir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

const SPO = 'node_modules/salesforce-pageobjects';

/** A cut-down `salesforce-pageobjects`: its manifest and a few sources, laid out as 12.0.0 ships them. */
const shippedPageObjects: Files = {
  [`${SPO}/package.json`]: { name: 'salesforce-pageobjects', version: '12.0.0' },
  [`${SPO}/dist/utam.manifest.json`]: {
    pageObjects: {
      'utam-lightning/pageObjects/input': 'package/dist/lightning/input.utam.json',
      'utam-lightning/pageObjects/formattedText': 'package/dist/lightning/formattedText.utam.json',
      'utam-global/pageObjects/recordHomeFlexipage2': 'package/dist/global/recordHomeFlexipage2.utam.json',
      'utam-global/pageObjects/recordHomeTemplateDesktop': 'package/dist/global/recordHomeTemplateDesktop.utam.json',
      'utam-global/pageObjects/recordHomeWithSubheaderTemplateDesktop':
        'package/dist/global/recordHomeWithSubheaderTemplateDesktop.utam.json',
      'utam-records/pageObjects/recordLayoutItem': 'package/dist/records/recordLayoutItem.utam.json',
      'utam-access-summaries/pageObjects/accessFromTabSet': 'package/dist/access/summaries/accessFromTabSet.utam.json',
    },
  },
  [`${SPO}/dist/lightning/input.utam.json`]: {
    description: { text: ['Represents the lightning-input Lightning web component.', 'A text input.'] },
    shadow: { elements: [{ name: 'input', selector: { css: 'input' } }] },
  },
  [`${SPO}/dist/lightning/formattedText.utam.json`]: { methods: [] },
  [`${SPO}/dist/global/recordHomeFlexipage2.utam.json`]: {
    interface: true,
    root: true,
    methods: [{ name: 'getHighlights', returnType: 'utam-records/pageObjects/recordLayoutItem' }],
  },
  [`${SPO}/dist/global/recordHomeTemplateDesktop.utam.json`]: {
    root: true,
    implements: 'utam-global/pageObjects/recordHomeFlexipage2',
    selector: { css: 'one-record-home-flexipage2' },
    shadow: {
      elements: [
        {
          name: 'layoutItem',
          public: true,
          type: 'utam-records/pageObjects/recordLayoutItem',
          selector: {
            css: "records-record-layout-item[field-label='%s'], .x > records-record-layout-item",
            args: [{ name: 'label', type: 'string' }],
          },
        },
        { name: 'mobileOnly', public: true, selector: { accessid: 'record-home' } },
        { name: 'save', public: true, type: ['clickable'], selector: { css: 'lightning-button.save' } },
        { name: 'main', public: true, type: 'container', selector: { css: "[slot='main']" } },
      ],
    },
    elements: [{ name: 'header', selector: { css: 'records-highlights2' } }],
  },
  [`${SPO}/dist/global/recordHomeWithSubheaderTemplateDesktop.utam.json`]: {
    root: true,
    implements: 'utam-global/pageObjects/recordHomeFlexipage2',
    selector: { css: 'one-record-home-flexipage2' },
  },
  [`${SPO}/dist/records/recordLayoutItem.utam.json`]: {
    description: 'One field of a record layout.',
  },
  [`${SPO}/dist/access/summaries/accessFromTabSet.utam.json`]: {
    root: true,
    selector: { css: 'access-from-tab-set' },
  },
};

/** The scaffolded project files, with one hand-written page object. */
const projectFiles: Files = {
  'package.json': { name: 'my-app' },
  'utam.config.json': {
    pageObjectsRootDir: './',
    pageObjectsFileMask: ['**/__utam__/**/*.utam.json'],
    pageObjectsOutputDir: 'pageObjects',
  },
  'generator.config.json': {
    namespaces: { c: 'my-app/pageObjects/', lightning: 'salesforce-pageobjects/lightning/pageObjects/' },
  },
  'test/__utam__/recordPage.utam.json': {
    root: true,
    selector: { css: 'one-record-home-flexipage2' },
    description: { text: ['The record page, read by the phone field tests.'] },
    shadow: {
      elements: [
        {
          name: 'phone',
          public: true,
          selector: {
            css: "records-record-layout-item[field-label='%s']",
            args: [{ name: 'fieldLabel', type: 'string' }],
          },
        },
        { name: 'highlights', selector: { css: 'div > records-highlights2' } },
        { name: 'objectLabel', public: true, type: 'container', selector: { css: "[slot='entityLabel']" } },
        { name: 'field', selector: { css: "[data-field='%s']", args: [{ name: 'apiName', type: 'string' }] } },
      ],
    },
    methods: [
      { name: 'getObjectLabel', compose: [{ element: 'highlights', apply: 'getText' }] },
      { name: 'getFieldText', compose: [{ element: 'field', apply: 'getText' }] },
      {
        name: 'clickField',
        compose: [
          { element: 'field', apply: 'scrollToCenter' },
          { element: 'field', apply: 'click' },
        ],
      },
      {
        name: 'getPhoneText',
        compose: [
          { element: 'phone', returnType: 'utam-records/pageObjects/recordLayoutItem' },
          { chain: true, element: 'value', returnType: 'utam-lightning/pageObjects/formattedText' },
          { chain: true, apply: 'getText', returnType: 'string' },
        ],
      },
      {
        name: 'waitForPhone',
        compose: [
          { apply: 'waitFor', args: [{ type: 'function', predicate: [{ element: 'phone', apply: 'isVisible' }] }] },
          { apply: 'returnSelf' },
        ],
      },
    ],
  },
  'test/__utam__/nested/outer.utam.json': {
    elements: [
      {
        name: 'panel',
        selector: { css: '.panel' },
        shadow: { elements: [{ name: 'title', public: true, selector: { css: 'h2' } }] },
      },
    ],
  },
  'test/__utam__/broken.utam.json': '{ not json',
  'node_modules/other/__utam__/ignored.utam.json': { root: true, selector: { css: 'other-thing' } },
};

const dirs: string[] = [];
function project(files: Files): string {
  const dir = writeProject(files);
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('selector tags', () => {
  it('takes the tag from the last compound of each comma-separated alternative', () => {
    expect(selectorTags("a.b > lightning-input[data-name='%s'], .x lightning-button, .slds-button")).toEqual([
      'lightning-input',
      'lightning-button',
    ]);
    expect(selectorTags("[slot='secondaryFields']")).toEqual([]);
    expect(selectorTags('LIGHTNING-INPUT')).toEqual(['lightning-input']);
  });

  it('keeps commas and spaces inside attribute values and :not() together', () => {
    expect(selectorTags("lightning-input[title='a, b c']:not(.x, .y)")).toEqual(['lightning-input']);
    expect(selectorLastParts("div > [slot='secondaryFields'], .x lightning-button")).toEqual([
      "[slot='secondaryFields']",
      'lightning-button',
    ]);
  });
});

describe('buildPageObjectIndex', () => {
  const dir = project({ ...shippedPageObjects, ...projectFiles });
  const index = buildPageObjectIndex({ projectDir: dir });

  it('indexes salesforce-pageobjects by manifest name, with the import path test code uses', () => {
    const input = index.entries.get('utam-lightning/pageObjects/input');
    expect(input).toMatchObject({
      importPath: 'salesforce-pageobjects/lightning/pageObjects/input',
      source: 'salesforce-pageobjects',
      root: false,
    });
    const nested = index.entries.get('utam-access-summaries/pageObjects/accessFromTabSet');
    expect(nested?.importPath).toBe('salesforce-pageobjects/access/summaries/pageObjects/accessFromTabSet');
  });

  it("indexes the project's own page objects by import path, with their compiled file", () => {
    expect(index.entries.get('my-app/pageObjects/recordPage')).toMatchObject({
      name: 'my-app/pageObjects/recordPage',
      importPath: 'my-app/pageObjects/recordPage',
      outputFile: 'pageObjects/recordPage.js',
      source: 'project',
      root: true,
    });
    expect(index.namespaces.lightning).toBe('salesforce-pageobjects/lightning/pageObjects/');
  });

  it('skips page objects under node_modules and warns about invalid JSON', () => {
    expect([...index.entries.keys()].some((name) => name.endsWith('/ignored'))).toBe(false);
    expect(index.warnings).toEqual([`Skipped ${path.join('test', '__utam__', 'broken.utam.json')}: not valid JSON.`]);
  });

  it('records each element as light or shadow, nested elements by their full name', () => {
    const outer = index.entries.get('my-app/pageObjects/outer')!;
    expect(outer.privateElements).toMatchObject([{ name: 'panel', scope: 'light' }]);
    expect(outer.publicElements).toMatchObject([{ name: 'panel.title', scope: 'shadow' }]);
    expect(outer.privateElements[0].usedBy).toEqual(['getTitle']);
  });

  it('ignores mobile selectors and leaves non-page-object types out of the tags', () => {
    const desktop = index.entries.get('utam-global/pageObjects/recordHomeTemplateDesktop')!;
    expect(desktop.publicElements.map((element) => element.name)).toEqual(['layoutItem', 'save', 'main']);
    expect(desktop.publicElements[1].type).toBe('["clickable"]');
    expect(index.tags.has('lightning-button')).toBe(false);
  });

  it('links each interface to its implementations', () => {
    expect(index.entries.get('utam-global/pageObjects/recordHomeFlexipage2')?.implementations).toEqual([
      'utam-global/pageObjects/recordHomeTemplateDesktop',
      'utam-global/pageObjects/recordHomeWithSubheaderTemplateDesktop',
    ]);
  });

  it('records private elements, the methods that use them, and method parameters', () => {
    const page = index.entries.get('my-app/pageObjects/recordPage')!;
    expect(page.privateElements.find((element) => element.name === 'highlights')?.usedBy).toEqual(['getObjectLabel']);
    expect(page.privateElements.find((element) => element.name === 'field')?.usedBy).toEqual([
      'getFieldText',
      'clickField',
    ]);
    expect(page.publicElements[0].args).toEqual([{ name: 'fieldLabel', type: 'string' }]);
    expect(page.methods.find((method) => method.name === 'getFieldText')?.args).toEqual([
      { name: 'apiName', type: 'string' },
    ]);
  });

  it('summarizes what each method does, and what it returns', () => {
    const page = index.entries.get('my-app/pageObjects/recordPage')!;
    const compose = Object.fromEntries(page.methods.map((method) => [method.name, method.compose]));
    expect(compose).toEqual({
      getObjectLabel: `getText on highlights "div > records-highlights2"`,
      getFieldText: `getText on field "[data-field='%s']"`,
      clickField: `scrollToCenter, click on field "[data-field='%s']"`,
      getPhoneText: `phone "records-record-layout-item[field-label='%s']" → chain value → chain getText()`,
      waitForPhone: 'waitFor(phone); returns self',
    });
    expect(page.methods.find((method) => method.name === 'getPhoneText')?.returns).toBe('string');
  });

  it('warns and indexes only the project when salesforce-pageobjects is missing', () => {
    const bare = project(projectFiles);
    const result = buildPageObjectIndex({ projectDir: bare });
    expect(result.warnings[0]).toMatch(/salesforce-pageobjects is not installed/);
    expect(result.entries.has('my-app/pageObjects/recordPage')).toBe(true);
  });

  it('indexes nothing of the project without a utam.config.json', () => {
    const shippedOnly = project({ ...shippedPageObjects, 'package.json': { name: 'my-app' } });
    const result = buildPageObjectIndex({ projectDir: shippedOnly });
    expect([...result.entries.values()].every((entry) => entry.source === 'salesforce-pageobjects')).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

describe('buildPageObjectIndex: compose summaries', () => {
  const form = {
    root: true,
    selector: { css: 'c-form' },
    elements: [
      {
        name: 'nameInput',
        public: true,
        type: 'utam-lightning/pageObjects/input',
        selector: { css: "lightning-input[data-name='%s']", args: [{ name: 'fieldName', type: 'string' }] },
      },
      { name: 'save', selector: { css: 'button.save' } },
      {
        name: 'toast',
        type: 'utam-lightning/pageObjects/formattedText',
        selector: { css: 'lightning-formatted-text' },
      },
    ],
    methods: [
      {
        name: 'setName',
        compose: [{ element: 'nameInput', apply: 'setText', args: [{ name: 'value', type: 'string' }] }],
      },
      {
        name: 'fillTwice',
        args: [
          { name: 'value', type: 'string' },
          { name: 'mode', value: 'fast' },
        ],
        compose: [
          { element: 'nameInput', apply: 'setText', args: [{ name: 'value', type: 'string' }] },
          { element: 'nameInput', apply: 'setText', args: [{ name: 'value', type: 'string' }] },
        ],
      },
      {
        name: 'hasSavedLabel',
        compose: [
          { element: 'save', apply: 'getText', matcher: { type: 'stringContains', args: [{ value: '"Saved"' }] } },
        ],
      },
      { name: 'isSaveEnabled', compose: [{ element: 'save', apply: 'isEnabled', matcher: { type: 'isTrue' } }] },
      {
        name: 'useHelper',
        compose: [
          {
            applyExternal: {
              type: 'utam-helpers/utils/formHelper',
              invoke: 'fill',
              args: [
                { value: 3 },
                { value: true },
                { name: 'record', type: 'string' },
                { type: 'elementReference', value: 'save' },
                { type: 'pageObject', value: 'utam-lightning/pageObjects/input' },
                { value: { css: '.x' } },
                { value: null },
              ],
            },
          },
        ],
      },
      { name: 'checkToast', compose: [{ apply: 'check', args: [{ type: 'elementReference', value: 'toast' }] }] },
      {
        name: 'waitForToast',
        compose: [{ apply: 'waitFor', args: [{ type: 'function', predicate: [{ element: 'toast' }] }] }],
      },
      {
        name: 'openRecord',
        description: {
          text: ['Opens the record.'],
          return: 'the record page (utam-global/pageObjects/recordHomeFlexipage2)',
        },
        compose: [{ element: 'save', apply: 'click' }],
      },
    ],
  };
  const index = buildPageObjectIndex({
    projectDir: project({ ...projectFiles, 'test/__utam__/form.utam.json': form }),
  });
  const methods = Object.fromEntries(
    index.entries.get('my-app/pageObjects/form')!.methods.map((method) => [method.name, method]),
  );

  it('writes statement arguments as parameter names and literals', () => {
    expect(methods.setName.compose).toBe(`setText(value) on nameInput "lightning-input[data-name='%s']"`);
    expect(methods.useHelper.compose).toBe('formHelper.fill(3, true, record, save, input, ".x")');
  });

  it('writes a matcher after the statement it checks, with its arguments', () => {
    expect(methods.hasSavedLabel.compose).toBe('getText on save "button.save" is stringContains("Saved")');
    expect(methods.isSaveEnabled.compose).toBe('isEnabled on save "button.save" is isTrue');
  });

  it('lists each parameter once, leaving out literal values', () => {
    expect(methods.fillTwice.args).toEqual([
      { name: 'value', type: 'string' },
      { name: 'fieldName', type: 'string' },
    ]);
    expect(methods.fillTwice.compose).toBe(
      `setText(value), setText(value) on nameInput "lightning-input[data-name='%s']"`,
    );
  });

  it("collects an applyExternal call's named arguments as parameters", () => {
    expect(methods.useHelper.args).toEqual([{ name: 'record', type: 'string' }]);
  });

  it('counts an elementReference argument as the method using that element', () => {
    const { privateElements } = index.entries.get('my-app/pageObjects/form')!;
    const usedBy = (name: string): string[] | undefined =>
      privateElements.find((element) => element.name === name)?.usedBy;
    expect(usedBy('save')).toContain('useHelper');
    expect(usedBy('toast')).toEqual(['checkToast', 'waitForToast']);
  });

  it("reads a return type from a waitFor predicate's element, or from the description", () => {
    expect(methods.waitForToast).toMatchObject({
      compose: 'waitFor(toast)',
      returns: 'utam-lightning/pageObjects/formattedText',
    });
    expect(methods.openRecord.returns).toBe('utam-global/pageObjects/recordHomeFlexipage2');
  });

  it('says how many more elements declare a typed match than it names', () => {
    const typed = (name: string): Record<string, unknown> => ({
      name,
      type: 'my-app/pageObjects/card',
      selector: { css: 'c-card' },
    });
    const many = buildPageObjectIndex({
      projectDir: project({
        ...projectFiles,
        'test/__utam__/card.utam.json': { elements: [] },
        'test/__utam__/deck.utam.json': { elements: ['a', 'b', 'c', 'd'].map(typed) },
      }),
    });
    expect(lookupPageObject(many, 'c-card').lines).toContain(
      '  matched by: typed element in deck.a, deck.b, deck.c and 1 more',
    );
  });

  it("warns when salesforce-pageobjects has no readable manifest, and skips a manifest entry it can't read", () => {
    const noManifest = buildPageObjectIndex({
      projectDir: project({ ...projectFiles, [`${SPO}/package.json`]: { name: 'salesforce-pageobjects' } }),
    });
    expect(noManifest.warnings).toContain(
      "salesforce-pageobjects has no readable dist/utam.manifest.json; it isn't indexed.",
    );
    const missingSource = buildPageObjectIndex({
      projectDir: project({
        ...projectFiles,
        [`${SPO}/package.json`]: { name: 'salesforce-pageobjects' },
        [`${SPO}/dist/utam.manifest.json`]: {
          pageObjects: { 'utam-x/pageObjects/gone': 'package/dist/x/gone.utam.json' },
        },
      }),
    });
    expect(missingSource.entries.has('utam-x/pageObjects/gone')).toBe(false);
    expect(missingSource.warnings.filter((warning) => warning.includes('salesforce-pageobjects'))).toEqual([]);
  });
});

describe('lookupPageObject', () => {
  const dir = project({ ...shippedPageObjects, ...projectFiles });
  const index = buildPageObjectIndex({ projectDir: dir });

  it("reports the interface for an implementation's root selector, the project's own first", () => {
    const { json, lines } = lookupPageObject(index, 'one-record-home-flexipage2');
    expect(json.matches.map((match) => [match.entry.name, match.via])).toEqual([
      ['my-app/pageObjects/recordPage', 'root selector'],
      ['utam-global/pageObjects/recordHomeFlexipage2', 'root selector'],
    ]);
    expect(json.matches[1].matchedImplementation).toBe('utam-global/pageObjects/recordHomeTemplateDesktop');
    expect(lines).toContain(
      '  matched implementation: utam-global/pageObjects/recordHomeTemplateDesktop; test code loads the interface',
    );
    expect(lines).toContain(
      '  implementations: salesforce-pageobjects/global/pageObjects/recordHomeTemplateDesktop, salesforce-pageobjects/global/pageObjects/recordHomeWithSubheaderTemplateDesktop',
    );
  });

  it('maps a tag through an element typed as a page object, once however many alternatives of its selector name it', () => {
    const { json, lines } = lookupPageObject(index, 'records-record-layout-item');
    expect(json.matches).toHaveLength(1);
    expect(json.matches[0]).toMatchObject({
      via: 'typed element',
      declaredBy: ['recordHomeTemplateDesktop.layoutItem'],
      declaredByCount: 1,
    });
    expect(lines).toContain('  matched by: typed element in recordHomeTemplateDesktop.layoutItem');
  });

  it('falls back to the naming convention when it names a page object that exists', () => {
    expect(lookupPageObject(index, 'lightning-formatted-text').json.matches[0]).toMatchObject({
      via: 'convention',
      entry: { name: 'utam-lightning/pageObjects/formattedText' },
    });
    expect(lookupPageObject(index, 'lightning-combobox').json.matches).toEqual([]);
  });

  it('looks a page object up by manifest name, import path or short name', () => {
    for (const query of [
      'utam-lightning/pageObjects/input',
      'salesforce-pageobjects/lightning/pageObjects/input',
      'input',
    ]) {
      const { json } = lookupPageObject(index, query);
      expect(json.matches.map((match) => [match.entry.name, match.via])).toEqual([
        ['utam-lightning/pageObjects/input', 'name'],
      ]);
    }
  });

  it('prints both name forms, saying which one a .utam.json "type" uses', () => {
    const { lines } = lookupPageObject(index, 'input');
    expect(lines[0]).toBe('salesforce-pageobjects/lightning/pageObjects/input (not root, salesforce-pageobjects)');
    expect(lines).toContain(
      '  name: utam-lightning/pageObjects/input (manifest name; a .utam.json "type" uses salesforce-pageobjects/lightning/pageObjects/input)',
    );
    expect(lines).toContain('  description: A text input.');
    expect(lines.some((line) => line.includes('matched by'))).toBe(false);
  });

  it('prints methods with their parameters and compose, and elements with getters and scope', () => {
    const { lines } = lookupPageObject(index, 'recordPage');
    expect(lines.slice(0, 4)).toEqual([
      'my-app/pageObjects/recordPage (root, project)',
      '  compiled to: pageObjects/recordPage.js (import it by relative path from test code)',
      '  description: The record page, read by the phone field tests.',
      '  root selector: one-record-home-flexipage2',
    ]);
    expect(lines).toContain('    clickField(apiName: string)');
    expect(lines[lines.indexOf('    clickField(apiName: string)') + 1]).toBe(
      `      scrollToCenter, click on field "[data-field='%s']"`,
    );
    expect(lines).toContain(
      `    getPhone(fieldLabel: string)  phone: "records-record-layout-item[field-label='%s']" [shadow]`,
    );
    expect(lines).toContain(
      `    getObjectLabel(pageObjectType: constructor)  objectLabel: "[slot='entityLabel']" [shadow] → container`,
    );
    expect(lines).toContain('    highlights: "div > records-highlights2" [shadow]  (used by getObjectLabel())');
  });

  it('says a missing tag proves nothing, and how to search', () => {
    expect(lookupPageObject(index, 'records-entity-label').lines).toEqual([
      'No page object found for "records-entity-label". This doesn\'t prove none exists, only that the index found no match by tag or name. Try lookup --search <words>.',
    ]);
  });

  it('cuts the text at the output limit and says how to see the rest', () => {
    const { lines, json } = lookupPageObject(index, 'recordPage', { limit: 3 });
    expect(lines).toHaveLength(4);
    expect(lines[3]).toMatch(/^… \d+ more lines not shown \(output limit 3\)\. Look up one page object/);
    expect(json.matches).toHaveLength(1);
  });
});

describe('searchPageObjects', () => {
  const dir = project({ ...shippedPageObjects, ...projectFiles });
  const index = buildPageObjectIndex({ projectDir: dir });

  it('ranks name matches first, then tags, then descriptions, and needs every word', () => {
    const names = (query: string): string[] => searchPageObjects(index, query).json.results.map((r) => r.name);
    expect(names('record')).toEqual([
      'utam-global/pageObjects/recordHomeFlexipage2',
      'utam-global/pageObjects/recordHomeTemplateDesktop',
      'utam-global/pageObjects/recordHomeWithSubheaderTemplateDesktop',
      'utam-records/pageObjects/recordLayoutItem',
      'my-app/pageObjects/recordPage',
    ]);
    expect(names('access-from-tab-set')).toEqual(['utam-access-summaries/pageObjects/accessFromTabSet']);
    expect(names('phone tests')).toEqual(['my-app/pageObjects/recordPage']);
    expect(names('phone nothing')).toEqual([]);
  });

  it('prints each match with its flags, tags and description, and a next step', () => {
    const { lines } = searchPageObjects(index, 'layout field');
    expect(lines).toEqual([
      '1 page objects match "layout field" (name matches first, then tag, then description):',
      'salesforce-pageobjects/records/pageObjects/recordLayoutItem  tags: records-record-layout-item',
      '    One field of a record layout.',
      "Run lookup <name or tag> for one page object's methods and elements.",
    ]);
  });
});
