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

test('시드 미션은 10개이고 네 유형이 모두 쓰인다', () => {
  assert.equal(MISSIONS.length, 10);
  const types = new Set(MISSIONS.map((m) => m.type));
  for (const t of ['build', 'measure', 'predict', 'classify']) assert.ok(types.has(t), t);
});

// validateMission은 선택지가 비어 있지 않은지만 본다(가짜 미션을 쓰는 단위 테스트 때문).
// 실제 미션의 하한은 여기서 강제한다 — 선택지가 하나뿐인 문제는 문제가 아니다.
test('선택형 미션의 선택지는 2개 이상이다', () => {
  for (const m of MISSIONS.filter((x) => x.type !== 'build')) {
    assert.ok(m.choices.length >= 2, `${m.id}: 선택지 ${m.choices.length}개`);
  }
});

test('ch04: 벤젠 고리 결합은 여섯 개가 모두 같은 길이다', () => {
  const mol = loadStart(missionById('ch04-benzene-bond-length').start);
  const lens = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]].map((p) => measure(mol, p));
  const spread = Math.max(...lens) - Math.min(...lens);
  assert.ok(spread < 0.01, `결합 길이 편차 ${spread}`);
  assert.ok(Math.abs(lens[0] - 1.40) < 0.03, `기대 ~1.40 Å, 실제 ${lens[0]}`);
});

test('ch04: 올바른 결합을 선택하고 올바른 답을 고르면 통과', () => {
  const m = missionById('ch04-benzene-bond-length');
  const mol = loadStart(m.start);
  assert.equal(evaluate(m, { mol, selection: [1, 2], answer: 'b' }).pass, true);
  assert.equal(evaluate(m, { mol, selection: [1, 2], answer: 'a' }).pass, false);
  assert.equal(evaluate(m, { mol, selection: [0, 6], answer: 'b' }).pass, false); // C–H를 쟀다
});

test('ch06: trans-diaxial 다이브로마이드의 Br–C–C–Br이 anti-periplanar다', () => {
  const mol = loadStart(missionById('ch06-anti-periplanar').start);
  assert.equal(mol.atoms[7].el, 'Br');
  assert.equal(mol.atoms[8].el, 'Br');
  const d = Math.abs(measure(mol, [7, 0, 1, 8]));
  assert.ok(d > 150, `기대 ~180°, 실제 ${d}`);
});

test('ch08: 에폭사이드 C–O–C가 THP보다 훨씬 좁다', () => {
  const out = runProbe(missionById('ch08-ring-strain').probe);
  const deg = (s) => Number(out.rows.find((r) => r.label.includes(s)).text.match(/[\d.]+/)[0]);
  assert.ok(deg('에폭사이드') < 70, `기대 ~60°, 실제 ${deg('에폭사이드')}`);
  assert.ok(deg('테트라하이드로피란') > 100);
  assert.equal(out.trust.key, 'geometry');
});

test('ch09: 아세트알데하이드 시작 구조는 sp2 카보닐이다', () => {
  const mol = loadStart(missionById('ch09-carbonyl-addition').start);
  assert.equal(formula(mol), 'C2H4O');
  assert.ok(Math.abs(measure(mol, [0, 1, 2]) - 120) < 8);
});

test('ch09: 수화물(gem-다이올)을 만들면 통과한다', () => {
  const m = missionById('ch09-carbonyl-addition');
  const wrong = loadStart(m.start);
  assert.equal(evaluate(m, { mol: wrong, selection: [], answer: null }).pass, false);
  // O를 카보닐 탄소에 붙이고 C=O를 단일결합으로 낮춘 상태
  const right = loadStart({
    atoms: [['C', [0, 0, 0]], ['C', [1.52, 0, 0]], ['O', [2.14, 1.16, 0]], ['O', [2.14, -1.16, 0]]],
    bonds: [[0, 1], [1, 2], [1, 3]],
    syncH: true, relax: true,
  });
  assert.equal(formula(right), 'C2H6O2');
  assert.equal(evaluate(m, { mol: right, selection: [], answer: null }).pass, true);
});

test('ch15: trans-2-뷰텐이 cis보다 안정하고 위상은 같다', () => {
  const m = missionById('ch15-cis-trans-alkene');
  const out = runProbe(m.probe);
  const kcal = (s) => Number(out.rows.find((r) => r.label.includes(s)).text.match(/-?[\d.]+/)[0]);
  assert.ok(kcal('trans') < kcal('cis'));
  assert.equal(out.trust.key, 'relative'); // 위상이 같으므로 blocked이 아니다
});

test('ch15: cis 상태의 이면각이 실제로 0° 부근이다', () => {
  const m = missionById('ch15-cis-trans-alkene');
  const cis = loadStart(m.probe.states.find((s) => s.setDihedral?.deg === 0));
  assert.ok(Math.abs(measure(cis, [0, 1, 2, 3])) < 30);
});
