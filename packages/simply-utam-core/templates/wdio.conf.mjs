import { UtamWdioService } from 'wdio-utam-service';
import allureReporter from '@wdio/allure-reporter';
import {
  captureDomSnapshot,
  pruneDomSnapshots,
  serializeDomSnapshot,
  snapshotRunId,
  writeDomSnapshot,
} from '@simplysf/simply-utam';

const { DEBUG } = process.env;
const EXPLICIT_TIMEOUT = 60 * 1000;
const DEBUG_TIMEOUT = EXPLICIT_TIMEOUT * 30;
// A step must outlast UTAM's waits, so a failure reports UTAM's error (which names the locator it
// couldn't find) rather than only Cucumber's timeout, and the DOM snapshot shows the page UTAM searched.
const STEP_TIMEOUT_MARGIN = 30 * 1000;

export const config = {
  runner: 'local',
  specs: ['{{sourceDir}}/**/test/*.feature', '{{sourceDir}}/**/test/**/*.feature'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'chrome',
      'wdio:enforceWebDriverClassic': true,
    },
  ],
  logLevel: 'debug',
  bail: 0,
  waitforTimeout: DEBUG ? DEBUG_TIMEOUT : EXPLICIT_TIMEOUT,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  automationProtocol: 'webdriver',
  services: [
    [
      UtamWdioService,
      {
        implicitTimeout: 0,
        injectionConfigs: ['salesforce-pageobjects/ui-global-components.config.json'],
      },
    ],
  ],
  framework: 'cucumber',
  cucumberOpts: {
    require: ['{{sourceDir}}/**/test/*.steps.mjs', '{{sourceDir}}/**/test/**/*.steps.mjs'],
    timeout: (DEBUG ? DEBUG_TIMEOUT : EXPLICIT_TIMEOUT) + STEP_TIMEOUT_MARGIN,
  },
  reporters: [
    'spec',
    [
      'allure',
      {
        outputDir: 'allure-results',
        disableWebdriverScreenshotsReporting: false,
      },
    ],
  ],
  screenshotPath: './errorShots/',
  onPrepare: async function () {
    // One DOM snapshot folder per test run, shared by every worker; keep the last 10 runs.
    process.env.UTAM_SNAPSHOT_RUN_ID ??= snapshotRunId();
    await pruneDomSnapshots({ keepRuns: 10 });
  },
  before: async function () {
    // browser.domSnapshot('label') captures the page from the REPL during browser.debug().
    browser.addCommand('domSnapshot', async (label) => {
      const snapshot = await captureDomSnapshot({ trigger: 'manual', label });
      return snapshot ? writeDomSnapshot(snapshot) : undefined;
    });
  },
  afterTest: async function (test, context, { passed }) {
    if (!passed) {
      await browser.takeScreenshot();
    }
  },
  afterStep: async function (step, scenario, { error }) {
    if (error) {
      // Capture the DOM snapshot first, before anything else changes the page.
      const snapshot = await captureDomSnapshot({
        trigger: 'failure',
        scenario: scenario.name,
        step: step.text,
        error,
      });
      if (snapshot) {
        allureReporter.addAttachment('dom-snapshot.json', serializeDomSnapshot(snapshot), 'application/json');
        console.log(`DOM snapshot written to ${await writeDomSnapshot(snapshot)}`);
      }
      await browser.takeScreenshot();
    }
  },
  afterScenario: async function (world, result) {
    if (result.error) {
      console.error('SCENARIO ERROR: ', result.error);
    }
  },
  afterHook: async function (test, context, result) {
    if (result.error) {
      console.error('HOOK ERROR: ', result.error);
    }
  },
};
