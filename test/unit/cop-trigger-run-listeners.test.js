/**
 * Tests for the daily and monthly COP cards: the condition and threshold in the card decide
 * whether a flow starts. Without a run listener Homey starts the flow on every change.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { App: class {} };
  return originalLoad.call(this, request, parent, isMain);
};

const App = require('../../.homeybuild/app');

function listeners() {
  const registered = {};
  const app = Object.create((App.default ?? App).prototype);
  app.error = () => {};
  app.selfHealing = { isFeatureEnabled: () => true, trackError: () => {} };
  app.homey = {
    flow: {
      getDeviceTriggerCard: (id) => ({
        registerRunListener: (listener) => {
          registered[id] = listener;
        },
      }),
    },
  };
  app.registerCopTriggerRunListeners();
  return registered;
}

for (const id of ['daily_cop_efficiency_changed', 'monthly_cop_efficiency_changed']) {
  test(`${id}: above needs a rise and a value at or above the threshold`, async () => {
    const run = listeners()[id];
    const args = { condition: 'above', threshold: 3 };
    assert.strictEqual(await run(args, { condition: 'above', cop_value: 3.2 }), true);
    assert.strictEqual(await run(args, { condition: 'above', cop_value: 3 }), true);
    assert.strictEqual(await run(args, { condition: 'above', cop_value: 2.9 }), false);
    assert.strictEqual(await run(args, { condition: 'below', cop_value: 3.4 }), false);
  });

  test(`${id}: below needs a fall and a value at or below the threshold`, async () => {
    const run = listeners()[id];
    const args = { condition: 'below', threshold: 3 };
    assert.strictEqual(await run(args, { condition: 'below', cop_value: 2.8 }), true);
    assert.strictEqual(await run(args, { condition: 'below', cop_value: 3.1 }), false);
    assert.strictEqual(await run(args, { condition: 'above', cop_value: 2.8 }), false);
  });

  test(`${id}: invalid state or args do not start the flow`, async () => {
    const run = listeners()[id];
    assert.strictEqual(await run({ condition: 'above', threshold: 3 }, {}), false);
    assert.strictEqual(await run({}, { condition: 'above', cop_value: 3 }), false);
  });
}
