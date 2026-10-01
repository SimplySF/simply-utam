import { Given } from '@wdio/cucumber-framework';
import { goToApplication } from '@simplysf/simply-utam';

Given('I open the Salesforce application {string}', async (appName) => {
  // Authenticates via Salesforce CLI frontdoor URL and opens the application home page
  await goToApplication(appName);
});
