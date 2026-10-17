import { Before, When } from '@wdio/cucumber-framework';
import { captureDomSnapshot, writeDomSnapshot } from '@simplysf/simply-utam';

// Captures the page as it is, without waiting: put it after a step that waits for something on the
// page. The snapshot is written under .utam/snapshots/ and copied to latest.json. See SNAPSHOTS.md.
Before(function (scenario) {
  this.domSnapshotScenario = scenario.pickle.name;
});

async function capture(world, label) {
  const snapshot = await captureDomSnapshot({ trigger: 'step', scenario: world.domSnapshotScenario, label });
  if (snapshot) console.log(`DOM snapshot written to ${await writeDomSnapshot(snapshot)}`);
}

When('I capture the DOM snapshot', async function () {
  await capture(this);
});

When('I capture the DOM snapshot {string}', async function (label) {
  await capture(this, label);
});
