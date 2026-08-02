import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMolecule, addAtom, addBond } from '../src/model.js';
import { typeAtom, hybridization } from '../src/uff.js';
import { UFF_PARAMS } from '../src/params.js';

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
