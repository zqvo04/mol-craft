import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPreset } from '../src/presets.js';
import { minimize, energy, scanDihedral } from '../src/uff.js';
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
