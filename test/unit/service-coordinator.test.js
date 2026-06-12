/**
 * Lifecycle tests for ServiceCoordinator destroy ordering (ADR-061).
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return {};
  return originalLoad.call(this, request, parent, isMain);
};

const { ServiceCoordinator } = require('../../.homeybuild/lib/services/service-coordinator');

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

async function waitUntil(predicate) {
  for (let i = 0; i < 10; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test('ADR-061: ServiceCoordinator.destroy awaits AdaptiveControlService.destroy', async () => {
  const gate = deferred();
  const calls = [];
  const coordinator = Object.create(ServiceCoordinator.prototype);
  coordinator.logger = () => {};
  coordinator.device = {
    homey: {
      clearTimeout: () => {},
    },
    removeListener: () => {},
  };
  coordinator.healthCheckInterval = null;
  coordinator._disconnectStatusTimer = null;
  coordinator._disconnectDailyResetTimer = null;
  coordinator._degradedSinceTimer = null;
  coordinator.serviceHealth = new Map();
  coordinator.isInitialized = true;
  coordinator.settingsManager = { destroy: () => calls.push('settings') };
  coordinator.capabilityHealth = { destroy: () => calls.push('capability') };
  coordinator.energyTracking = { destroy: () => calls.push('energy') };
  coordinator.flowCardManager = { destroy: () => calls.push('flowcard') };
  coordinator.buildingInsights = { destroy: async () => calls.push('insights') };
  coordinator.adaptiveControl = {
    saveEnergyOptimizerState: async () => calls.push('energy-state'),
    destroy: async () => {
      calls.push('adaptive-start');
      await gate.promise;
      calls.push('adaptive-done');
    },
  };
  coordinator.modbusConnection = { destroy: async () => calls.push('modbus') };

  let resolved = false;
  const destroyPromise = coordinator.destroy().then(() => { resolved = true; });
  await waitUntil(() => calls.includes('adaptive-start'));

  assert.strictEqual(resolved, false, 'destroy must not resolve before adaptive cleanup resolves');
  assert.strictEqual(calls.includes('modbus'), false, 'modbus cleanup must wait for adaptive cleanup');

  gate.resolve();
  await destroyPromise;

  assert.strictEqual(resolved, true);
  assert.ok(calls.indexOf('adaptive-done') < calls.indexOf('modbus'), 'modbus cleanup runs after adaptive cleanup');
});
