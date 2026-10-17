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

import { Args, Command, Flags } from '@oclif/core';
import {
  buildPageObjectIndex,
  lookupPageObject,
  searchPageObjects,
  type LookupResult,
  type SearchResult,
} from '@simplysf/simply-utam-core';
import { BAD_INPUT, limitFlag, projectDirFlag } from '../../snapshot-flags.js';

/**
 * Look up the page objects for a tag, or search them by keyword. Doesn't need a snapshot.
 */
export default class SnapshotLookup extends Command {
  public static override summary =
    'Show the page objects for a tag, with their import paths, methods and elements; or search them.';

  public static override description =
    "Reads salesforce-pageobjects and the project's own page objects (from utam.config.json). A tag maps to a page object through a root selector, an element typed as that page object, or the naming convention. Where a tag maps to an implementation of an interface, the interface is reported, since test code loads the interface. Also accepts a page object name (such as recordHomeFlexipage2) instead of a tag. With --search, lists the page objects whose name, import path, tags or description contain every word given.";

  public static override examples = [
    '<%= config.bin %> <%= command.id %> lightning-input',
    '<%= config.bin %> <%= command.id %> one-record-home-flexipage2',
    '<%= config.bin %> <%= command.id %> recordLayoutItem',
    '<%= config.bin %> <%= command.id %> --search "related list"',
  ];

  public static override enableJsonFlag = true;

  public static override args = {
    tag: Args.string({ description: 'A custom element tag, or a page object name.' }),
  };

  public static override flags = {
    search: Flags.string({ summary: 'Words to search for in page object names, import paths, tags and descriptions.' }),
    ...projectDirFlag,
    ...limitFlag,
  };

  public async run(): Promise<LookupResult | SearchResult> {
    const { args, flags } = await this.parse(SnapshotLookup);
    if ((args.tag === undefined) === (flags.search === undefined)) {
      this.error('Give a tag or page object name, or --search <words>, but not both.', { exit: BAD_INPUT });
    }
    const index = buildPageObjectIndex({ projectDir: flags['project-dir'] });
    for (const warning of index.warnings) this.warn(warning);
    const options = { limit: flags.limit };
    const result =
      flags.search === undefined
        ? lookupPageObject(index, args.tag!, options)
        : searchPageObjects(index, flags.search, options);
    for (const line of result.lines) this.log(line);
    return result.json;
  }
}
