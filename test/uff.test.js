import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMolecule, addAtom, addBond } from '../src/model.js';
import {
  typeAtom, hybridization, bondLength, buildTerms, energy, gradient, minimize, topologyKey, cachedTerms,
} from '../src/uff.js';
import { UFF_PARAMS } from '../src/params.js';
import { loadPreset } from '../src/presets.js';

function build(spec) {
  const m = createMolecule();
  for (const [el, pos] of spec.atoms) addAtom(m, el, pos);
  for (const b of spec.bonds) addBond(m, b[0], b[1], b[2] ?? 1);
  return m;
}

test('파라미터 표의 모든 항목이 8개 필드를 갖는다', () => {
  for (const [k, p] of Object.entries(UFF_PARAMS)) {
    for (const f of ['r1', 'theta0', 'x1', 'D1', 'Z', 'V', 'U', 'chi']) {
      assert.equal(typeof p[f], 'number', `${k}.${f} 누락`);
    }
    assert.ok(p.r1 > 0 && p.x1 > 0 && p.D1 > 0, `${k}: 물리적으로 불가능한 값`);
  }
});

test('메탄 탄소는 C_3, 수소는 H_', () => {
  const m = build({
    atoms: [['C', [0, 0, 0]], ['H', [1, 0, 0]], ['H', [-1, 0, 0]], ['H', [0, 1, 0]], ['H', [0, -1, 0]]],
    bonds: [[0, 1], [0, 2], [0, 3], [0, 4]],
  });
  assert.equal(typeAtom(m, 0), 'C_3');
  assert.equal(typeAtom(m, 1), 'H_');
});

test('에틸렌 탄소는 C_2 (이중결합)', () => {
  const m = build({
    atoms: [['C', [0, 0, 0]], ['C', [1.33, 0, 0]], ['H', [-0.5, 0.9, 0]], ['H', [-0.5, -0.9, 0]],
            ['H', [1.83, 0.9, 0]], ['H', [1.83, -0.9, 0]]],
    bonds: [[0, 1, 2], [0, 2], [0, 3], [1, 4], [1, 5]],
  });
  assert.equal(typeAtom(m, 0), 'C_2');
  assert.equal(hybridization('C_2'), 'sp2');
});

test('물 산소는 O_3, 암모니아 질소는 N_3', () => {
  const w = build({ atoms: [['O', [0, 0, 0]], ['H', [1, 0, 0]], ['H', [0, 1, 0]]], bonds: [[0, 1], [0, 2]] });
  assert.equal(typeAtom(w, 0), 'O_3');
  const n = build({
    atoms: [['N', [0, 0, 0]], ['H', [1, 0, 0]], ['H', [0, 1, 0]], ['H', [0, 0, 1]]],
    bonds: [[0, 1], [0, 2], [0, 3]],
  });
  assert.equal(typeAtom(n, 0), 'N_3');
});

test('SF6 황은 S_3+6, PCl5 인은 P_3+5 (초원자가)', () => {
  const s = build({
    atoms: [['S', [0, 0, 0]], ...[[1.6,0,0],[-1.6,0,0],[0,1.6,0],[0,-1.6,0],[0,0,1.6],[0,0,-1.6]]
      .map((p) => ['F', p])],
    bonds: [[0,1],[0,2],[0,3],[0,4],[0,5],[0,6]],
  });
  assert.equal(typeAtom(s, 0), 'S_3+6');
  const p = build({
    atoms: [['P', [0, 0, 0]], ...[[2,0,0],[-1,1.7,0],[-1,-1.7,0],[0,0,2],[0,0,-2]].map((q) => ['Cl', q])],
    bonds: [[0,1],[0,2],[0,3],[0,4],[0,5]],
  });
  assert.equal(typeAtom(p, 0), 'P_3+5');
});

test('미지원 원소는 명확한 예외를 던진다', () => {
  const m = build({ atoms: [['Uu', [0, 0, 0]]], bonds: [] });
  assert.throws(() => typeAtom(m, 0), /지원하지 않는 원소/);
});

test('hybridization은 theta0가 아니라 타입 이름으로 판정한다', () => {
  // N_2(111.2°)와 O_R(110°)은 theta0가 sp3 범위지만 실제로는 sp2다.
  // theta0 기반 판정은 이 둘을 sp3로 오분류해 비틀림 항 주기를 망친다.
  assert.equal(hybridization('N_2'), 'sp2');
  assert.equal(hybridization('O_R'), 'sp2');
  assert.equal(hybridization('C_R'), 'sp2');
  assert.equal(hybridization('C_3'), 'sp3');
  assert.equal(hybridization('C_1'), 'sp');
  assert.equal(hybridization('S_3+6'), 'sp3');
  assert.equal(hybridization('P_3+5'), 'sp3');
  assert.equal(hybridization('Si3'), 'sp3');
  assert.throws(() => hybridization('Xx_9'), /알 수 없는 UFF 타입/);
});

// 정사면체 메탄(C-H = 0.63*sqrt(3) ≈ 1.091 Å)
function methane() {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  for (const p of [[0.63, 0.63, 0.63], [-0.63, -0.63, 0.63], [-0.63, 0.63, -0.63], [0.63, -0.63, -0.63]])
    addAtom(m, 'H', p);
  for (let i = 1; i <= 4; i++) addBond(m, 0, i);
  return m;
}

test('UFF 자연 결합 길이가 실측에 근접한다', () => {
  assert.ok(Math.abs(bondLength('C_3', 'H_', 1) - 1.109) < 0.01, 'C-H');
  assert.ok(Math.abs(bondLength('C_3', 'C_3', 1) - 1.514) < 0.01, 'C-C');
  assert.ok(bondLength('C_2', 'C_2', 2) < bondLength('C_3', 'C_3', 1), '이중결합이 더 짧아야 함');
});

test('결합 항이 평형 길이에서 0, 늘리면 증가한다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  addAtom(m, 'H', [bondLength('C_3', 'H_', 1), 0, 0]);
  // 메탄으로 만들어 C_3 타이핑을 유도
  for (const p of [[-1, 0, 0], [0, 1, 0], [0, -1, 0]]) addAtom(m, 'H', p);
  for (let i = 1; i <= 4; i++) addBond(m, 0, i);
  const terms = buildTerms(m).filter((t) => t.type === 'bond' && t.atoms.includes(1));
  assert.equal(terms.length, 1);
  const e0 = terms[0].eval(m);
  m.atoms[1].pos[0] += 0.1;
  assert.ok(terms[0].eval(m) > e0 + 1, '0.1 Å 늘리면 눈에 띄게 증가해야 함');
  assert.ok(e0 < 1e-6, '평형 길이에서는 거의 0');
});

test('항 종류별 개수가 맞다 (메탄)', () => {
  const t = buildTerms(methane());
  assert.equal(t.filter((x) => x.type === 'bond').length, 4);
  assert.equal(t.filter((x) => x.type === 'angle').length, 6);   // C(4,2)
  assert.equal(t.filter((x) => x.type === 'torsion').length, 0); // 중심 결합 없음
  // H-H 6쌍은 전부 1-3(결합각)이라 vdW에서 제외된다.
  assert.equal(t.filter((x) => x.type === 'vdw').length, 0);
});

test('vdW 항은 1-4 이상 떨어진 쌍에만 생긴다 (부탄 골격)', () => {
  const m = createMolecule();
  addAtom(m, 'C', [-1.9, 0.55, 0]);
  addAtom(m, 'C', [-0.75, -0.25, 0]);
  addAtom(m, 'C', [0.75, 0.25, 0]);
  addAtom(m, 'C', [1.9, -0.55, 0]);
  addBond(m, 0, 1); addBond(m, 1, 2); addBond(m, 2, 3);
  const vdw = buildTerms(m).filter((x) => x.type === 'vdw');
  assert.equal(vdw.length, 1); // (0,3)만 남는다
  assert.deepEqual(vdw[0].atoms, [0, 3]);
});

test('energy가 항별/원자별로 분해된다', () => {
  const m = methane();
  const e = energy(m);
  assert.ok(Number.isFinite(e.total));
  assert.ok(Math.abs(e.total - (e.byType.bond + e.byType.angle + e.byType.torsion + e.byType.vdw)) < 1e-9);
  assert.ok(Math.abs(e.total - e.perAtom.reduce((a, b) => a + b, 0)) < 1e-9, 'perAtom 합 = total');
  assert.equal(e.perBond.size, 4);
});

// 일그러진 메탄(최소화 시작 구조)
function distortedMethane() {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  for (const p of [[0.9, 0.9, 0.8], [-0.8, -0.9, 0.9], [-0.9, 0.8, -0.8], [0.8, -0.8, -0.95]])
    addAtom(m, 'H', p);
  for (let i = 1; i <= 4; i++) addBond(m, 0, i);
  return m;
}

test('수치 그래디언트가 유한차분 총에너지와 일치한다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  for (const p of [[0.7, 0.7, 0.6], [-0.6, -0.7, 0.7], [-0.7, 0.6, -0.6], [0.6, -0.6, -0.75]])
    addAtom(m, 'H', p);
  for (let i = 1; i <= 4; i++) addBond(m, 0, i);
  const terms = buildTerms(m);
  const g = gradient(m, terms);
  const h = 1e-5, i = 2, d = 1;
  const o = m.atoms[i].pos[d];
  m.atoms[i].pos[d] = o + h; const ep = energy(m, terms).total;
  m.atoms[i].pos[d] = o - h; const em = energy(m, terms).total;
  m.atoms[i].pos[d] = o;
  assert.ok(Math.abs(g[3 * i + d] - (ep - em) / (2 * h)) < 1e-3);
});

test('minimize가 에너지를 낮추고 수렴한다', () => {
  const m = distortedMethane();
  const r = minimize(m);
  assert.ok(r.energyAfter < r.energyBefore);
  assert.equal(r.converged, true);
});

test('frozen 원자는 움직이지 않는다', () => {
  const m = distortedMethane();
  const fixed = [...m.atoms[1].pos];
  minimize(m, { frozen: new Set([1]) });
  assert.deepEqual(m.atoms[1].pos, fixed);
});

test('단일결합 2개짜리 탄소는 sp3다 (C_1 오분류 회귀)', () => {
  const m = build({
    atoms: [['C', [0, 0, 0]], ['C', [1.5, 0, 0]], ['C', [3, 0, 0]]],
    bonds: [[0, 1], [1, 2]],
  });
  assert.equal(typeAtom(m, 1), 'C_3');
  assert.equal(UFF_PARAMS[typeAtom(m, 1)].theta0, 109.47);
});

test('이중결합이 있는 탄소는 sp2, 삼중이면 sp', () => {
  const ene = build({ atoms: [['C', [0, 0, 0]], ['C', [1.33, 0, 0]]], bonds: [[0, 1, 2]] });
  assert.equal(typeAtom(ene, 0), 'C_2');
  const yne = build({ atoms: [['C', [0, 0, 0]], ['C', [1.2, 0, 0]]], bonds: [[0, 1, 3]] });
  assert.equal(typeAtom(yne, 0), 'C_1');
});

test('단일결합 1개짜리 질소·산소는 sp3다', () => {
  const m = build({
    atoms: [['C', [0, 0, 0]], ['N', [1.4, 0, 0]], ['O', [-1.4, 0, 0]]],
    bonds: [[0, 1], [0, 2]],
  });
  assert.equal(typeAtom(m, 1), 'N_3');
  assert.equal(typeAtom(m, 2), 'O_3');
});

test('topologyKey는 좌표에 반응하지 않고 결합·원소에만 반응한다', () => {
  const a = build({ atoms: [['C', [0, 0, 0]], ['H', [1.1, 0, 0]]], bonds: [[0, 1]] });
  const b = build({ atoms: [['C', [5, 5, 5]], ['H', [6.1, 5, 5]]], bonds: [[0, 1]] });
  assert.equal(topologyKey(a), topologyKey(b));

  const c = build({ atoms: [['C', [0, 0, 0]], ['H', [1.1, 0, 0]]], bonds: [[0, 1, 2]] });
  assert.notEqual(topologyKey(a), topologyKey(c));

  const d = build({ atoms: [['C', [0, 0, 0]], ['F', [1.1, 0, 0]]], bonds: [[0, 1]] });
  assert.notEqual(topologyKey(a), topologyKey(d));
});

test('cachedTerms는 같은 위상이면 같은 배열을 재사용하고, 바뀌면 새로 만든다', () => {
  const m = loadPreset('ethane');
  const t1 = cachedTerms(m);
  m.atoms[0].pos[0] += 0.3;            // 좌표만 이동
  assert.equal(cachedTerms(m), t1, '좌표 변화로 재생성하면 안 된다');
  assert.ok(Math.abs(energy(m, cachedTerms(m)).total - energy(m).total) < 1e-9,
    '캐시된 항으로 계산한 에너지가 새로 만든 항과 같아야 한다');

  addAtom(m, 'H', [9, 9, 9]);
  addBond(m, 0, m.atoms.length - 1);   // 위상 변화
  assert.notEqual(cachedTerms(m), t1, '위상이 바뀌면 새로 만들어야 한다');
});
