import { UtamWdioService } from 'wdio-utam-service';

const { DEBUG } = process.env;
const EXPLICIT_TIMEOUT = 60 * 1000;
const DEBUG_TIMEOUT = EXPLICIT_TIMEOUT * 30;

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
    timeout: 1000 * 30,
  },
  reporters: [
    'spec',
    [
      'allure',
      {
        outputDir: 'allure-results',
        disableWebdriverScreenshotesReporting: false,
      },
    ],
  ],
  screenshotPath: './errorShots/',
  afterTest: async function (test, context, { passed }) {
    if (!passed) {
      await browser.takeScreenshot();
    }
  },
  afterStep: async function (step, scenario, { error }) {
    if (error) {
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
