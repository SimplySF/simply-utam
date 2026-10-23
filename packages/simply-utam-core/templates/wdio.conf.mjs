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
// How long element waits run before failing (waitforTimeout). DEBUG leaves it alone, so a wrong
// locator still fails within a minute instead of stalling the session you're debugging.
const EXPLICIT_TIMEOUT = 60 * 1000;
// How long a Cucumber step may run under DEBUG, so pausing in browser.debug() or at a breakpoint
// doesn't end the step while you're still inspecting the page.
const DEBUG_TIMEOUT = 30 * 60 * 1000;
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
  waitforTimeout: EXPLICIT_TIMEOUT,
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
    // Housekeeping must never cost the run: on Windows a locked old run folder can't be deleted.
    try {
      await pruneDomSnapshots({ keepRuns: 10 });
    } catch (pruneError) {
      console.warn(`Old DOM snapshot runs not pruned: ${pruneError?.message ?? pruneError}`);
    }
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
        // Saving and attaching each get their own try: neither failing may cost the other, or the
        // screenshot below.
        try {
          console.log(`DOM snapshot written to ${await writeDomSnapshot(snapshot)}`);
        } catch (writeError) {
          console.warn(`DOM snapshot not saved: ${writeError?.message ?? writeError}`);
        }
        try {
          allureReporter.addAttachment('dom-snapshot.json', serializeDomSnapshot(snapshot), 'application/json');
        } catch (attachError) {
          console.warn(`DOM snapshot not attached to the Allure report: ${attachError?.message ?? attachError}`);
        }
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
