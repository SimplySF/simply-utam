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

// Lightning Experience paths, relative to the org's instance URL. Each is what a frontdoor URL's
// return path points at; `LightningNavigator` pairs them with a login.

/**
 * The app segment of a Lightning URL. A bare developer name is a custom app in the default
 * namespace (`MyApp` becomes `c__MyApp`); a name that already carries a namespace
 * (`standard__Sales`, `acme__Billing`) is used as given.
 *
 * @param applicationName The app's developer name, with or without a namespace prefix.
 */
export function lightningAppName(applicationName: string): string {
  return applicationName.includes('__') ? applicationName : `c__${applicationName}`;
}

/**
 * The home page of a Lightning app.
 *
 * @param applicationName The app's developer name.
 */
export function applicationPath(applicationName: string): string {
  return `${appBase(applicationName)}/page/home`;
}

/**
 * The new-record form for an object, opened inside a Lightning app.
 *
 * @param applicationName The app's developer name.
 * @param objectApiName The object's API name, e.g. `Account` or `Invoice__c`.
 */
export function newRecordPath(applicationName: string, objectApiName: string): string {
  return `${appBase(applicationName)}/o/${encodeURIComponent(objectApiName)}/new`;
}

/**
 * A record's detail page, opened inside a Lightning app.
 *
 * @param applicationName The app's developer name.
 * @param recordId The record's 15- or 18-character id.
 */
export function recordPath(applicationName: string, recordId: string): string {
  return `${appBase(applicationName)}/r/${encodeURIComponent(recordId)}/view`;
}

/**
 * One of a record's related lists, opened inside a Lightning app.
 *
 * @param applicationName The app's developer name.
 * @param recordId The parent record's id.
 * @param relatedListName The relationship name, e.g. `Contacts` or `Invoice_Lines__r`.
 */
export function relatedListPath(applicationName: string, recordId: string, relatedListName: string): string {
  return `${appBase(applicationName)}/r/${encodeURIComponent(recordId)}/related/${encodeURIComponent(relatedListName)}/view`;
}

function appBase(applicationName: string): string {
  return `/lightning/app/${encodeURIComponent(lightningAppName(applicationName))}`;
}
