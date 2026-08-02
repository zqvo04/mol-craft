import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMolecule, addAtom, addBond, removeAtom, neighbors,
  bondOrderSum, branchAtoms, measure, setDihedral,
} from '../src/model.js';

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
