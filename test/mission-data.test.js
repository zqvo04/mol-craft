import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MISSIONS, missionById } from '../src/mission-data.js';
import { validateMission, loadStart, evaluate, runProbe } from '../src/mission.js';
import { measure } from '../src/model.js';
import { sub, unit, cross, dot } from '../src/geom.js';
import { formula } from '../src/snap.js';

test('모든 미션이 스키마 검증을 통과한다', () => {
  for (const m of MISSIONS) validateMission(m);
});

test('미션 id는 중복되지 않는다', () => {
  assert.equal(new Set(MISSIONS.map((m) => m.id)).size, MISSIONS.length);
});

// 고리 평면 법선과 C0->치환기 벡터가 이루는 각. 45° 미만이면 axial이다.
function axialAngle(mol, ringIdx, centerIdx, subIdx) {
  const p = ringIdx.map((i) => mol.atoms[i].pos);
  const n = unit(cross(sub(p[2], p[0]), sub(p[4], p[0])));
  const v = unit(sub(mol.atoms[subIdx].pos, mol.atoms[centerIdx].pos));
  const c = Math.abs(dot(n, v));
  return Math.acos(Math.min(1, c)) * 180 / Math.PI;
}

// 메틸 탄소는 두 상태 모두 인덱스 6이다(고리 탄소 0–5 다음에 오는 골격 원자).
test('ch02: 상태 0은 axial-메틸, 상태 1은 equatorial-메틸이다', () => {
  const m = missionById('ch02-chair-axial-equatorial');
  const ring = [0, 1, 2, 3, 4, 5];
  const ax = loadStart(m.probe.states[0]);
  const eq = loadStart(m.probe.states[1]);
  assert.ok(axialAngle(ax, ring, 0, 6) < 45, 'state 0의 메틸은 axial이어야 한다');
  assert.ok(axialAngle(eq, ring, 0, 6) > 45, 'state 1의 메틸은 equatorial이어야 한다');
  assert.equal(formula(ax), 'C7H14');
});

test('ch02: equatorial이 실제로 더 안정하다 (미션의 정답 근거)', () => {
  const m = missionById('ch02-chair-axial-equatorial');
  const out = runProbe(m.probe);
  const kcal = (label) => Number(out.rows.find((r) => r.label === label).text.match(/-?[\d.]+/)[0]);
  assert.ok(kcal('equatorial') < kcal('axial'));
  assert.equal(out.trust.key, 'relative');
});

test('ch02: 부탄 anti 미션은 정답/오답을 가른다', () => {
  const m = missionById('ch02-butane-anti');
  const gauche = loadStart(m.start);
  assert.equal(evaluate(m, { mol: gauche, selection: [], answer: null }).pass, false);
  const anti = loadStart({ preset: 'butane' });
  assert.equal(evaluate(m, { mol: anti, selection: [], answer: null }).pass, true);
});

test('ch01: 물 미션의 probe가 104.5° 부근을 낸다', () => {
  const out = runProbe(missionById('ch01-water-vsepr').probe);
  const deg = Number(out.rows[0].text.match(/[\d.]+/)[0]);
  assert.ok(deg > 100 && deg < 110, `기대 ~104.5°, 실제 ${deg}`);
});

test('ch01: 이성질체 미션의 두 상태는 분자식이 같고 위상이 다르다', () => {
  const out = runProbe(missionById('ch01-structural-isomer').probe);
  assert.equal(out.rows[0].text, 'C4H10');
  assert.equal(out.rows[1].text, 'C4H10');
  assert.equal(out.rows[2].text, '다릅니다');
});

test('ch03: 에틸렌 회전장벽이 에탄보다 훨씬 크다', () => {
  const out = runProbe(missionById('ch03-pi-rotation').probe);
  const val = (s) => Number(out.rows.find((r) => r.label.includes(s)).text.match(/[\d.]+/)[0]);
  assert.ok(val('에틸렌') > val('에탄') * 3);
});
