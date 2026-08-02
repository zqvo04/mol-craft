import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMolecule, addAtom, addBond } from '../src/model.js';
import { canBond, snapTarget, vseprCheck, newSnapEvents, SNAP_RADIUS_FACTOR } from '../src/snap.js';
import { distance } from '../src/geom.js';
import { loadPreset } from '../src/presets.js';
import { minimize } from '../src/uff.js';

test('canBond: 원자가가 남으면 허용', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'H', [1.1, 0, 0]);
  const r = canBond(m, 0, 1);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.targetLength - 1.109) < 0.02);
});

test('canBond: 원자가가 가득 차면 거부', () => {
  const m = loadPreset('methane');
  addAtom(m, 'H', [3, 0, 0]);
  const r = canBond(m, 0, 5);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'valence-full-i');
});

test('canBond: 이미 결합된 쌍은 거부', () => {
  const m = loadPreset('methane');
  assert.equal(canBond(m, 0, 1).reason, 'already-bonded');
});

test('canBond: 초원자가는 허용하되 표시한다', () => {
  const m = createMolecule();
  addAtom(m, 'S', [0, 0, 0]);
  for (let k = 0; k < 3; k++) { addAtom(m, 'F', [k + 1, 0, 0]); addBond(m, 0, k + 1); }
  addAtom(m, 'F', [0, 2, 0]);
  const r = canBond(m, 0, 4);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'ok-expanded');
});

test('snapTarget이 평형 결합 길이로 당긴다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  addAtom(m, 'H', [1.4, 0, 0]); // 조금 먼 위치
  const p = snapTarget(m, 1, 0);
  assert.ok(Math.abs(distance(p, [0, 0, 0]) - 1.109) < 0.02);
  assert.ok(p[1] === 0 && p[2] === 0, '방향은 유지되어야 함');
});

test('snapTarget이 스냅 반경 밖이면 null', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  addAtom(m, 'H', [1.109 * SNAP_RADIUS_FACTOR + 0.5, 0, 0]);
  assert.equal(snapTarget(m, 1, 0), null);
});

test('vseprCheck: 최적화된 메탄은 만족, 찌그러진 메탄은 불만족', () => {
  const good = loadPreset('methane');
  minimize(good);
  assert.equal(vseprCheck(good, 0).satisfied, true);
  assert.equal(vseprCheck(good, 0).ideal, 109.47);

  const bad = loadPreset('methane');
  bad.atoms[1].pos = [1.1, 0, 0];
  bad.atoms[2].pos = [-1.1, 0, 0];
  assert.equal(vseprCheck(bad, 0).satisfied, false);
});

test('newSnapEvents가 새로 만족된 중심만 보고한다', () => {
  const prev = { 0: false, 1: true };
  const next = { 0: true, 1: true };
  assert.deepEqual(newSnapEvents(prev, next), ['0']);
});
