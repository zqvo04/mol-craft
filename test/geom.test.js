import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance, angleDeg, dihedralDeg, rotateAround, unit } from '../src/geom.js';

const close = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} ≈ ${b} (tol ${tol})`);

test('distance', () => {
  close(distance([0, 0, 0], [3, 4, 0]), 5);
});

test('angleDeg: 직각', () => {
  close(angleDeg([1, 0, 0], [0, 0, 0], [0, 1, 0]), 90);
});

test('angleDeg: 정사면체 각도', () => {
  // 정육면체 대각선 두 개 -> 109.4712°
  close(angleDeg([1, 1, 1], [0, 0, 0], [1, -1, -1]), 109.4712206, 1e-5);
});

test('dihedralDeg: anti = 180', () => {
  const a = [-1, 1, 0], b = [-1, 0, 0], c = [1, 0, 0], d = [1, -1, 0];
  close(Math.abs(dihedralDeg(a, b, c, d)), 180, 1e-6);
});

test('dihedralDeg: syn = 0', () => {
  const a = [-1, 1, 0], b = [-1, 0, 0], c = [1, 0, 0], d = [1, 1, 0];
  close(dihedralDeg(a, b, c, d), 0, 1e-6);
});

test('rotateAround: z축 90도 회전', () => {
  const p = rotateAround([1, 0, 0], [0, 0, 0], [0, 0, 1], 90);
  close(p[0], 0, 1e-9);
  close(p[1], 1, 1e-9);
});

test('rotateAround가 이면각을 +delta 만큼 증가시킨다', () => {
  // 축 b->c 기준 d를 오른손 법칙으로 +37도 회전하면 이면각도 +37도
  const a = [-1, 1, 0], b = [-1, 0, 0], c = [1, 0, 0], d = [1, 1, 0];
  const before = dihedralDeg(a, b, c, d);
  const d2 = rotateAround(d, b, unit([c[0] - b[0], c[1] - b[1], c[2] - b[2]]), 37);
  close(dihedralDeg(a, b, c, d2) - before, 37, 1e-6);
});
