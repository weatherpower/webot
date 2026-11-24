import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchActiveWarnings, nwsFeatureToWarning } from '../src/nws.js';
import { classifyAlert } from '../src/themes.js';

const expires = new Date(Date.now() + 3600000).toISOString();
const fixture = {
  id: 'fixture-freeze-not-a-live-alert',
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[-98,35],[-97,35],[-97,36],[-98,36],[-98,35]]] },
  properties: {
    event: 'Freeze Warning', status: 'Actual', messageType: 'Alert', expires,
    sent: new Date().toISOString(), areaDesc: 'Canadian; Oklahoma',
    geocode: { UGC: ['OKZ025'] }, affectedZones: [], senderName: 'NWS Norman OK',
    headline: 'TEST FIXTURE ONLY', instruction: 'Protect sensitive plants.'
  }
};

test('freeze warnings have a dedicated theme and remain in the warning group', () => {
  const result = classifyAlert({ event: 'Freeze Warning' });
  assert.equal(result.isWarning, true);
  assert.equal(result.family, 'winter');
  assert.equal(result.theme.type, 'freeze');
});

test('real alert conversion never invents the sample polygon', () => {
  const converted = nwsFeatureToWarning({ ...fixture, geometry: null });
  assert.equal(converted.geometry, null);
  assert.deepEqual(converted.polygon, []);
  assert.equal(converted.center, null);
});

test('mocked NWS feed accepts freeze warning and rejects malformed response', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ features: [fixture] }) });
    const result = await fetchActiveWarnings({ warningOnly: true });
    assert.equal(result.count, 1);
    assert.equal(result.warnings[0].event, 'Freeze Warning');
    assert.equal(result.warnings[0].classification.isWarning, true);
    assert.deepEqual(result.warnings[0].geometry, fixture.geometry);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
    await assert.rejects(fetchActiveWarnings(), /valid features array/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
