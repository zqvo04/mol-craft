import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRUST, sameTopology, trustFor, assertComparable } from '../src/trust.js';
import { loadPreset } from '../src/presets.js';

test('기하량은 항상 geometry 등급이다', () => {
  for (const kind of ['angle', 'dihedral', 'distance', 'formula', 'topologyEqual']) {
    assert.equal(trustFor(kind, false).key, 'geometry');
    assert.equal(trustFor(kind, true).key, 'geometry');
  }
});

test('배좌 장벽은 위상이 달라도 relative로 허용된다', () => {
  assert.equal(trustFor('barrier', false).key, 'relative');
  assert.equal(trustFor('barrier', true).key, 'relative');
});

test('총에너지는 같은 위상에서만 relative, 다르면 blocked', () => {
  assert.equal(trustFor('energy', false).key, 'relative');
  assert.equal(trustFor('energy', true).key, 'blocked');
});

test('sameTopology는 좌표가 달라도 위상이 같으면 참', () => {
  const a = loadPreset('butane');
  const b = loadPreset('butane');
  b.atoms[0].pos = [9, 9, 9];
  assert.equal(sameTopology(a, b), true);
  assert.equal(sameTopology(loadPreset('ethane'), loadPreset('ethylene')), false);
});

test('assertComparable은 위상이 다르면 throw한다', () => {
  assert.throws(
    () => assertComparable(loadPreset('ethane'), loadPreset('ethylene'), 'ch99-test'),
    /ch99-test/,
  );
  assert.doesNotThrow(() => assertComparable(loadPreset('ethane'), loadPreset('ethane'), 'ok'));
});

test('relative 등급 문구에 UFF 과대평가 경고가 들어 있다', () => {
  assert.match(TRUST.relative.note, /과대평가/);
});

test('알 수 없는 valueKind는 throw한다', () => {
  assert.throws(() => trustFor('pKa', false), /pKa/);
});
