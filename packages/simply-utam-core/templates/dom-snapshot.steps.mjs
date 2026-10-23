import { Before, When } from '@wdio/cucumber-framework';

// Captures the page as it is, without waiting: put it after a step that waits for something on the
// page. The snapshot is written under .utam/snapshots/ and copied to latest.json. See the
// utam-dom-snapshots skill in @simplysf/simply-utam.
Before(function (scenario) {
  this.domSnapshotScenario = scenario.pickle.name;
});

// Imported when the step runs, not with this file, so a project whose @simplysf/simply-utam predates
// DOM snapshots fails only this step, saying what to do, rather than every scenario.
async function snapshotApi() {
  const api = await import('@simplysf/simply-utam');
  if (typeof api.captureDomSnapshot !== 'function' || typeof api.writeDomSnapshot !== 'function') {
    throw new Error(
      'The installed @simplysf/simply-utam has no DOM snapshots. Upgrade it in package.json to use this step.',
    );
  }
  return api;
}

async function capture(world, label) {
  const { captureDomSnapshot, writeDomSnapshot } = await snapshotApi();
  const snapshot = await captureDomSnapshot({ trigger: 'step', scenario: world.domSnapshotScenario, label });
  if (snapshot) console.log(`DOM snapshot written to ${await writeDomSnapshot(snapshot)}`);
}

When('I capture the DOM snapshot', async function () {
  await capture(this);
});

When('I capture the DOM snapshot {string}', async function (label) {
  await capture(this, label);
});
