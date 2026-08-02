import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPreset } from '../src/presets.js';
import { minimize, energy, scanDihedral, typeAtom, buildTerms } from '../src/uff.js';
import { measure, setDihedral } from '../src/model.js';

const between = (x, lo, hi, label) =>
  assert.ok(x >= lo && x <= hi, `${label}: ${x.toFixed(3)} 이 [${lo}, ${hi}] 밖`);

test('메탄이 정사면체각으로 수렴한다 (109.47°)', () => {
  const m = loadPreset('methane');
  minimize(m);
  for (const [a, b] of [[1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]]) {
    between(measure(m, [a, 0, b]), 108.5, 110.5, 'H-C-H');
  }
  between(measure(m, [0, 1]), 1.05, 1.15, 'C-H 길이');
});

test('물이 굽은형으로 수렴한다 (~104.5°)', () => {
  const m = loadPreset('water');
  minimize(m);
  between(measure(m, [1, 0, 2]), 101, 108, 'H-O-H');
});

test('암모니아가 삼각뿔로 수렴한다 (~106.7°)', () => {
  const m = loadPreset('ammonia');
  minimize(m);
  between(measure(m, [1, 0, 2]), 103, 110, 'H-N-H');
});

// 원자 2·4는 같은 쪽(cis) 수소라 평면일 때 이면각이 0°이고, 2·5가 trans 쌍이라 180°다.
// 평면 시작 구조에서 시작하면 평면성이 유지되는지 알 수 없으므로 60° 비튼 뒤 복원되는지 본다.
test('에틸렌이 평면으로 복원된다', () => {
  const m = loadPreset('ethylene');
  setDihedral(m, [2, 0, 1, 4], 60);
  minimize(m);
  between(Math.abs(measure(m, [2, 0, 1, 4])), 0, 5, 'cis H-C=C-H 이면각');
  between(Math.abs(measure(m, [2, 0, 1, 5])), 175, 180, 'trans H-C=C-H 이면각');
});

test('에탄 회전장벽: 엇갈린형이 최소, 장벽 1.5~3.5 kcal/mol', () => {
  const m = loadPreset('ethane');
  minimize(m);
  const scan = scanDihedral(m, [2, 0, 1, 5], { stepDeg: 10 });
  const barrier = Math.max(...scan.map((p) => p.relative));
  between(barrier, 1.5, 3.5, '에탄 회전장벽');
  const argmin = scan.reduce((a, b) => (a.relative < b.relative ? a : b)).angle;
  assert.ok([60, 180, -60, -180].some((x) => Math.abs(argmin - x) <= 10),
    `최소가 엇갈린형이 아님: ${argmin}°`);
});

test('사이클로헥산 의자 < 보트', () => {
  const chair = loadPreset('cyclohexane_chair');
  const boat = loadPreset('cyclohexane_boat');
  minimize(chair); minimize(boat);
  const dE = energy(boat).total - energy(chair).total;
  assert.ok(dE > 0, `의자가 더 낮아야 함 (ΔE = ${dE.toFixed(2)})`);
});

test('SF6가 팔면체 90°로 수렴한다', () => {
  const m = loadPreset('sf6');
  minimize(m);
  between(measure(m, [1, 0, 3]), 87, 93, 'F-S-F 인접각');
  between(measure(m, [1, 0, 2]), 176, 180, 'F-S-F 대향각');
});

test('PCl5는 축-적도 90°만 검증한다 (UFF 한계 명시)', () => {
  const m = loadPreset('pcl5');
  minimize(m);
  between(measure(m, [1, 0, 4]), 84, 96, '적도-축 Cl-P-Cl');
});

test('부탄 프리셋에 수소가 있고 탄소가 C_3로 타입된다 (C_1 함정 회귀)', () => {
  const m = loadPreset('butane');
  const types = m.atoms.map((_, i) => typeAtom(m, i));
  assert.ok(!types.includes('C_1'), '골격만 있으면 C_1(sp)로 타입되어 비틀림 항이 사라진다');
  assert.ok(buildTerms(m).filter((t) => t.type === 'torsion').length > 0, '비틀림 항이 있어야 배좌 비교가 성립');
});

test('부탄 배좌: anti가 전역 최소, gauche는 ±60~80°의 국소 최소', () => {
  const m = loadPreset('butane');
  minimize(m);
  const scan = scanDihedral(m, [0, 1, 2, 3], { stepDeg: 15, relax: true });
  const at = (a) => scan.find((s) => s.angle === a).relative;
  between(at(180), 0, 0.01, 'anti가 전역 최소여야 함');
  // gauche 국소 최소: UFF는 실험값(65°, 0.9 kcal/mol)보다 각도가 크고 에너지가 높다.
  const gauche = scan.filter((s, i, A) =>
    i > 0 && i < A.length - 1 && s.angle > 0 && s.angle < 120
    && s.relative < A[i - 1].relative && s.relative < A[i + 1].relative);
  assert.equal(gauche.length, 1, 'gauche 극소가 정확히 하나 있어야 함');
  between(gauche[0].angle, 55, 90, 'gauche 이면각');
  between(gauche[0].relative, 0.5, 3, 'anti-gauche 에너지차');
  // syn(0°)이 최고점. UFF는 실험값(~5)보다 과대평가하므로 상한을 넉넉히 둔다.
  between(at(0), 6, 14, 'syn 장벽 (UFF 과대평가)');
  assert.ok(at(0) > at(120), 'syn이 anti-gauche 전이 장벽보다 높아야 함');
});
