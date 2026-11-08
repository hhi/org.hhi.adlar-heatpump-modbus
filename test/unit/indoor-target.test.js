/**
 * Tests for R9 (v3.7.1): the desired indoor temperature from a flow card is limited to 15–25 °C
 * instead of failing the flow (e.g. a thermostat in frost protection sends 7 °C).
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

const { clampIndoorTarget } = require('../../.homeybuild/lib/shared/utils/indoor-target');

test('clampIndoorTarget keeps values within 15–25 °C', () => {
  assert.deepStrictEqual(clampIndoorTarget(20.5), { value: 20.5, clamped: false });
  assert.deepStrictEqual(clampIndoorTarget(15), { value: 15, clamped: false });
  assert.deepStrictEqual(clampIndoorTarget(25), { value: 25, clamped: false });
});

test('clampIndoorTarget limits frost protection and too high values', () => {
  assert.deepStrictEqual(clampIndoorTarget(7), { value: 15, clamped: true });
  assert.deepStrictEqual(clampIndoorTarget(28), { value: 25, clamped: true });
});

test('clampIndoorTarget rejects a non-numeric value', () => {
  assert.throws(() => clampIndoorTarget(Number.NaN), /Invalid desired indoor temperature/);
});
