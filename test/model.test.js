import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMolecule, addAtom, addBond, removeAtom, neighbors,
  bondOrderSum, branchAtoms, measure, setDihedral, duplicateAtoms, isTorsionChain, pruneAtom,
} from '../src/model.js';
import { loadPreset } from '../src/presets.js';

// n-부탄 골격만(수소 없음): C0-C1-C2-C3, anti 배좌
function butaneSkeleton() {
  const m = createMolecule();
  addAtom(m, 'C', [-1.9, 0.55, 0]);
  addAtom(m, 'C', [-0.75, -0.25, 0]);
  addAtom(m, 'C', [0.75, 0.25, 0]);
  addAtom(m, 'C', [1.9, -0.55, 0]);
  addBond(m, 0, 1); addBond(m, 1, 2); addBond(m, 2, 3);
  return m;
}

test('addAtom/addBond가 인덱스와 결합을 만든다', () => {
  const m = createMolecule();
  const a = addAtom(m, 'C', [0, 0, 0]);
  const b = addAtom(m, 'H', [1, 0, 0]);
  addBond(m, b, a); // 역순 입력도 i<j로 정규화
  assert.equal(a, 0);
  assert.deepEqual(m.bonds, [{ i: 0, j: 1, order: 1 }]);
  assert.deepEqual(neighbors(m, 0), [1]);
});

test('중복 결합은 order만 갱신한다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'O', [1.2, 0, 0]);
  addBond(m, 0, 1, 1);
  addBond(m, 0, 1, 2);
  assert.equal(m.bonds.length, 1);
  assert.equal(bondOrderSum(m, 0), 2);
});

test('removeAtom이 인덱스를 재정렬한다', () => {
  const m = butaneSkeleton();
  removeAtom(m, 0);
  assert.equal(m.atoms.length, 3);
  assert.deepEqual(m.bonds, [{ i: 0, j: 1, order: 1 }, { i: 1, j: 2, order: 1 }]);
});

test('branchAtoms가 사슬의 한쪽만 반환한다', () => {
  const m = butaneSkeleton();
  assert.deepEqual(branchAtoms(m, 1, 2).sort(), [2, 3]);
});

test('branchAtoms가 고리에서 null을 반환한다', () => {
  const m = createMolecule();
  for (let i = 0; i < 3; i++) addAtom(m, 'C', [i, 0, 0]);
  addBond(m, 0, 1); addBond(m, 1, 2); addBond(m, 0, 2);
  assert.equal(branchAtoms(m, 0, 1), null);
});

test('measure가 길이에 따라 거리/각도/이면각을 준다', () => {
  const m = butaneSkeleton();
  assert.ok(Math.abs(measure(m, [0, 1]) - 1.4) < 0.2);
  assert.ok(measure(m, [0, 1, 2]) > 100);
  assert.ok(Math.abs(Math.abs(measure(m, [0, 1, 2, 3])) - 180) < 1e-6);
});

test('setDihedral이 목표 각도로 정확히 회전시킨다', () => {
  const m = butaneSkeleton();
  assert.equal(setDihedral(m, [0, 1, 2, 3], 60), true);
  assert.ok(Math.abs(measure(m, [0, 1, 2, 3]) - 60) < 1e-6);
  // 회전축(1,2)의 반대편 원자는 움직이지 않는다
  assert.deepEqual(m.atoms[0].pos, [-1.9, 0.55, 0]);
});

test('setDihedral이 고리에서 false를 반환하고 좌표를 바꾸지 않는다', () => {
  const m = createMolecule();
  for (let i = 0; i < 4; i++) addAtom(m, 'C', [i, i % 2, 0]);
  addBond(m, 0, 1); addBond(m, 1, 2); addBond(m, 2, 3); addBond(m, 0, 3);
  const before = JSON.stringify(m.atoms);
  assert.equal(setDihedral(m, [0, 1, 2, 3], 30), false);
  assert.equal(JSON.stringify(m.atoms), before);
});

test('duplicateAtoms가 선택 원자와 내부 결합만 복사한다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'H', [1, 0, 0]); addAtom(m, 'H', [-1, 0, 0]);
  addBond(m, 0, 1); addBond(m, 0, 2);
  const dup = duplicateAtoms(m, [0, 1]); // H(2)는 선택 밖 — 그 결합은 복사되지 않아야 함

  assert.equal(m.atoms.length, 5);
  assert.equal(dup.length, 2);
  assert.equal(m.atoms[dup[0]].el, 'C');
  assert.equal(m.atoms[dup[1]].el, 'H');
  assert.equal(bondOrderSum(m, dup[0]), 1); // 복제된 C는 복제된 H 하나에만 결합
  assert.equal(m.atoms[dup[0]].pos[0], 2); // 원본 [0,0,0]에서 x+2만큼 옮겨짐
});

test('isTorsionChain: 실제 결합 사슬만 통과시킨다', () => {
  const b = loadPreset('butane');
  assert.equal(isTorsionChain(b, [0, 1, 2, 3]), true);   // C-C-C-C
  assert.equal(isTorsionChain(b, [4, 0, 1, 2]), true);   // H-C-C-C

  const m = loadPreset('methane');
  // 진단에서 슬라이더가 잘못 활성화되던 조합: H-C-H-H는 이면각이 아니다.
  assert.equal(isTorsionChain(m, [1, 0, 2, 3]), false);
  assert.equal(isTorsionChain(m, [1, 0, 2, 1]), false);  // 중복 원자
});

test('pruneAtom: 사슬 중간을 자르면 떨어져 나간 작은 쪽이 함께 사라진다', () => {
  // C0-C1-C2-C3 사슬(수소 없음). C1을 자르면 C0 쪽(1개)이 작고 C2-C3 쪽(2개)이 크다.
  const m = createMolecule();
  for (let k = 0; k < 4; k++) addAtom(m, 'C', [k * 1.5, 0, 0]);
  addBond(m, 0, 1); addBond(m, 1, 2); addBond(m, 2, 3);
  pruneAtom(m, 1);
  assert.equal(m.atoms.length, 2, 'C2, C3만 남아야 한다');
  assert.equal(m.bonds.length, 1);
});

test('pruneAtom: 말단을 자르면 그 하나만 사라진다', () => {
  const m = loadPreset('methane');
  pruneAtom(m, 1); // H 하나
  assert.equal(m.atoms.length, 4);
});

test('pruneAtom: 고리는 끊어져도 하나로 이어져 있어 전부 남는다', () => {
  const m = loadPreset('cyclohexane_chair');
  const before = m.atoms.length;
  pruneAtom(m, 0); // 고리 탄소 하나 — 나머지는 여전히 한 덩어리다
  assert.equal(m.atoms.length, before - 3, '탄소 1개 + 거기 붙은 H 2개만 사라진다');
});

test('pruneAtom: 원자가 하나뿐이면 아무것도 지우지 않는다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  assert.deepEqual(pruneAtom(m, 0), []);
  assert.equal(m.atoms.length, 1);
});
