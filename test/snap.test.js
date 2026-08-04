import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMolecule, addAtom, addBond, neighbors } from '../src/model.js';
import {
  canBond, snapTarget, vseprCheck, newSnapEvents, SNAP_RADIUS_FACTOR, idealDirection, stability,
  implicitH, formula, syncHydrogens,
} from '../src/snap.js';
import { distance, angleDeg } from '../src/geom.js';
import { loadPreset } from '../src/presets.js';
import { minimize } from '../src/uff.js';

test('canBond: 원자가가 남으면 허용', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'H', [1.1, 0, 0]);
  const r = canBond(m, 0, 1);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.targetLength - 1.109) < 0.02);
});

test('canBond: 원자가가 가득 차도 이제 막지 않고 overloaded로 표시한다', () => {
  const m = loadPreset('methane');
  addAtom(m, 'H', [3, 0, 0]);
  const r = canBond(m, 0, 5);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'ok-overloaded');
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

test('idealDirection: 메탄을 원자별로 순차 조립하면 정사면체로 수렴한다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  for (let k = 0; k < 4; k++) {
    const idx = addAtom(m, 'H', idealDirection(m, 0));
    addBond(m, 0, idx);
  }
  assert.equal(vseprCheck(m, 0).satisfied, true);
});

test('idealDirection: 두 결합이 있는 중심에 붙일 때 둘 다에 이상각으로 맞는다', () => {
  // N은 전자 도메인 4개(결합3 + 비공유쌍1)이므로 목표는 109.47°다(암모니아 삼각뿔형 방향).
  const m = createMolecule();
  addAtom(m, 'N', [0, 0, 0]);
  addAtom(m, 'H', idealDirection(m, 0));
  addBond(m, 0, 1);
  addAtom(m, 'H', idealDirection(m, 0));
  addBond(m, 0, 2);
  const dir = idealDirection(m, 0);
  const a1 = angleDeg(m.atoms[1].pos, [0, 0, 0], dir);
  const a2 = angleDeg(m.atoms[2].pos, [0, 0, 0], dir);
  assert.ok(Math.abs(a1 - 109.47) < 0.1 && Math.abs(a2 - 109.47) < 0.1);
});

test('idealDirection: 물은 첫 두 H가 109.47°(사면체 방향)로 붙는다 — 180°에 갇히지 않는다', () => {
  const m = createMolecule();
  addAtom(m, 'O', [0, 0, 0]);
  const h1 = idealDirection(m, 0);
  addAtom(m, 'H', h1); addBond(m, 0, 1);
  const h2 = idealDirection(m, 0);
  assert.ok(Math.abs(angleDeg(h1, [0, 0, 0], h2) - 109.47) < 0.1);
});

test('stability: 최적화된 메탄은 100점, 초원자가 SF6는 감점된다', () => {
  const good = loadPreset('methane');
  minimize(good);
  assert.equal(stability(good).score, 100);

  const sf6 = loadPreset('sf6');
  const s = stability(sf6);
  assert.ok(s.score < 100);
  assert.ok(s.issues.some((x) => x.msg.includes('초원자가')));
});

test('formula: 있는 원자만 Hill 표기로 센다(메탄 -> CH4)', () => {
  const m = loadPreset('methane');
  assert.equal(formula(m), 'CH4');
});

test('implicitH: 결합 수만큼 자동 계산 — 골격식 규칙 2.2 표', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  addAtom(m, 'C', [1.5, 0, 0]);
  addBond(m, 0, 1); // C0는 결합 1개 -> CH3
  assert.equal(implicitH(m, 0), 3);
  assert.equal(implicitH(m, 1), 3);
});

test('syncHydrogens: 골격만 그린 에탄올(C-C-O)에서 C2H6O를 만든다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  addAtom(m, 'C', [1.5, 0, 0]);
  addAtom(m, 'O', [3.0, 0, 0]);
  addBond(m, 0, 1); addBond(m, 1, 2);
  syncHydrogens(m);
  assert.equal(formula(m), 'C2H6O');
  // 골격식 규칙 3: 채운 뒤 모든 무거운 원자의 원자가가 정확히 찬다.
  for (let i = 0; i < 3; i++) assert.equal(implicitH(m, i), 0);
});

test('syncHydrogens: 원자가를 넘겨 붙은 H는 뗀다(CH5 -> CH4)', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  for (let k = 0; k < 5; k++) {
    const idx = addAtom(m, 'H', [k + 1, 0, 0]);
    addBond(m, 0, idx);
  }
  assert.equal(formula(m), 'CH5');
  syncHydrogens(m);
  assert.equal(formula(m), 'CH4');
  assert.equal(neighbors(m, 0).length, 4);
});

test('syncHydrogens: 두 번 불러도 결과가 같다(멱등)', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  addAtom(m, 'O', [1.4, 0, 0]);
  addBond(m, 0, 1);
  syncHydrogens(m);
  const f1 = formula(m);
  const n1 = m.atoms.length;
  syncHydrogens(m);
  assert.equal(formula(m), f1);
  assert.equal(m.atoms.length, n1);
});
