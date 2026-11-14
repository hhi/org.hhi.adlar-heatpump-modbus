/**
 * Test for R20 (v3.7.1): a pre-heat start time that has already passed gives 'Now'
 * instead of a time in the past.
 */

'use strict';

const { test, mock } = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return {};
  return originalLoad.call(this, request, parent, isMain);
};

const { FlowCardManagerService } = require('../../.homeybuild/lib/modbus/services/flow-card-manager-service');

async function getPreHeatListener() {
  const listeners = {};
  const card = (id) => ({
    registerRunListener: (fn) => { listeners[id] = fn; return card(id); },
    registerArgumentAutocompleteListener: () => card(id),
    trigger: async () => {},
  });
  const homey = {
    clock: { getTimezone: () => 'Europe/Amsterdam' },
    setTimeout: () => ({}),
    clearTimeout: () => {},
    setInterval: () => ({}),
    clearInterval: () => {},
    flow: {
      getActionCard: card,
      getConditionCard: card,
      getTriggerCard: card,
      getDeviceTriggerCard: card,
    },
  };
  const device = {
    homey,
    hasCapability: () => false,
    getSetting: () => null,
    getCapabilityValue: () => null,
    serviceCoordinator: {
      getAdaptiveControl: () => ({
        // tau = C / UA = 15 h → 4 h per 1 °C
        getBuildingModelService: () => ({
          getLearner: () => ({ getModel: () => ({ C: 15, UA: 1, confidence: 80 }) }),
        }),
        getExternalTemperatureService: () => ({ getIndoorTemperature: () => 19, getIndoorStaleness: () => 'fresh' }),
      }),
    },
  };
  const service = new FlowCardManagerService({ device, buildingInsightsService: {} });
  await service.registerBuildingInsightsCards();
  return listeners.calculate_preheat_time;
}

test('a pre-heat start time that has passed gives Now', async () => {
  const listener = await getPreHeatListener();
  // 14:00 CEST, target 16:00 local, 1 °C to go → 4 h → start 12:00 has passed
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-07-15T12:00:00Z') });
  try {
    const result = await listener({ target_clock_time: '16:00', target_indoor_temp: 20 });
    assert.strictEqual(result.start_time, 'Now');
    assert.strictEqual(result.duration_hours, 4);
  } finally {
    mock.timers.reset();
  }
});

test('a pre-heat start time in the future is given as HH:MM', async () => {
  const listener = await getPreHeatListener();
  // 14:00 CEST, target 23:00 local, 1 °C to go → 4 h → start 19:00
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-07-15T12:00:00Z') });
  try {
    const result = await listener({ target_clock_time: '23:00', target_indoor_temp: 20 });
    assert.strictEqual(result.start_time, '19:00');
  } finally {
    mock.timers.reset();
  }
});
