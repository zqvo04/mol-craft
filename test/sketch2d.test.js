import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMolecule, addAtom, addBond } from '../src/model.js';
import { layout, findRings } from '../src/sketch2d.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const angleDeg = (a, b, c) => {
  const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
  const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2));
  return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
};

function ring(n) {
  const m = createMolecule();
  for (let i = 0; i < n; i++) addAtom(m, 'C', [0, 0, 0]);
  for (let i = 0; i < n; i++) addBond(m, i, (i + 1) % n);
  return m;
}

test('findRings: 벤젠은 6원 고리 1개', () => {
  assert.deepEqual(findRings(ring(6)).map((r) => r.length), [6]);
});

test('findRings: 사슬(고리 없음)은 빈 배열', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'C', [0, 0, 0]);
  addBond(m, 0, 1);
  assert.deepEqual(findRings(m), []);
});

test('layout: 벤젠 — 모든 결합 길이 1, 정육각형', () => {
  const pos = layout(ring(6));
  for (let i = 0; i < 6; i++) {
    assert.ok(Math.abs(dist(pos.get(i), pos.get((i + 1) % 6)) - 1) < 1e-6);
  }
  // 정육각형 내각은 120도
  for (let i = 0; i < 6; i++) {
    const a = angleDeg(pos.get((i + 5) % 6), pos.get(i), pos.get((i + 1) % 6));
    assert.ok(Math.abs(a - 120) < 1e-6);
  }
});

test('layout: 사슬 — 120도 지그재그, 결합 길이 1', () => {
  const m = createMolecule();
  for (let i = 0; i < 6; i++) addAtom(m, 'C', [0, 0, 0]);
  for (let i = 0; i < 5; i++) addBond(m, i, i + 1);
  const pos = layout(m);
  for (let i = 0; i < 5; i++) assert.ok(Math.abs(dist(pos.get(i), pos.get(i + 1)) - 1) < 1e-9);
  for (let i = 1; i < 5; i++) {
    assert.ok(Math.abs(angleDeg(pos.get(i - 1), pos.get(i), pos.get(i + 1)) - 120) < 1e-9);
  }
});

test('layout: 융합 이환계(나프탈렌류) — 공유 변 포함 모든 결합이 길이 1', () => {
  const m = createMolecule();
  for (let i = 0; i < 10; i++) addAtom(m, 'C', [0, 0, 0]);
  const bonds = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [5, 6], [6, 7], [7, 8], [8, 9], [9, 4]];
  for (const [a, b] of bonds) addBond(m, a, b);
  assert.equal(findRings(m).length, 2);
  const pos = layout(m);
  for (const [a, b] of bonds) assert.ok(Math.abs(dist(pos.get(a), pos.get(b)) - 1) < 1e-6);
});

test('layout: 고리 치환기(톨루엔류) — 가지 결합도 길이 1이고 고리 원자와 안 겹친다', () => {
  const m = ring(6);
  addAtom(m, 'C', [0, 0, 0]); // idx6: 메틸
  addBond(m, 0, 6);
  const pos = layout(m);
  assert.ok(Math.abs(dist(pos.get(0), pos.get(6)) - 1) < 1e-9);
  for (let i = 0; i < 6; i++) assert.ok(dist(pos.get(6), pos.get(i)) > 0.1);
});

test('layout: 수소는 배치하지 않는다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'H', [0, 0, 0]);
  addBond(m, 0, 1);
  const pos = layout(m);
  assert.ok(pos.has(0));
  assert.ok(!pos.has(1));
});

test('layout: 원자 하나짜리 분자도 처리한다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [5, 5, 5]);
  const pos = layout(m);
  assert.deepEqual(pos.get(0), [0, 0]);
});
