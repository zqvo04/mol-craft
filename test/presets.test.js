import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMolecule, addAtom, addBond, neighbors, branchAtoms, bondOrderSum } from '../src/model.js';
import { RING_TEMPLATES, STRUCTURE_LIBRARY, computeRingPlacement, insertRingTemplate, validateStructureAttachment } from '../src/presets.js';
import { MAX_VALENCE } from '../src/params.js';
import { energy } from '../src/uff.js';

test('insertRingTemplate이 벤젠 고리를 열린 자리에 붙인다', () => {
  const m = createMolecule();
  const c = addAtom(m, 'C', [0, 0, 0]);
  insertRingTemplate(m, c, RING_TEMPLATES.benzene, [1, 0, 0]);

  const ringAtoms = m.atoms.filter((a) => a.type === 'C_R');
  assert.equal(ringAtoms.length, 6);
  const aromaticBonds = m.bonds.filter((b) => b.order === 1.5);
  assert.equal(aromaticBonds.length, 6);
  assert.ok(neighbors(m, c).length >= 1); // 앵커가 고리 첫 원자와 결합됨

  const e = energy(m);
  assert.ok(Number.isFinite(e.total));
});

test('insertRingTemplate이 사이클로헥산 고리를 붙인다(단일결합, 비방향족)', () => {
  const m = createMolecule();
  const c = addAtom(m, 'C', [0, 0, 0]);
  const idxMap = insertRingTemplate(m, c, RING_TEMPLATES.cyclohexane, [1, 0, 0]);
  const ringCarbons = idxMap.slice(0, 6);
  assert.equal(ringCarbons.length, 6);
  assert.ok(ringCarbons.every((i) => m.atoms[i].el === 'C'));
  // 고리 결합이므로 branchAtoms가 null(단순 가지치기 불가)을 돌려줘야 한다.
  assert.equal(branchAtoms(m, ringCarbons[0], ringCarbons[1]), null);

  const e = energy(m);
  assert.ok(Number.isFinite(e.total));
});

test('구조 단위 라이브러리의 모든 템플릿은 첨부 원자가를 넘지 않는다', () => {
  assert.ok(STRUCTURE_LIBRARY.length >= 8);
  for (const unit of STRUCTURE_LIBRARY) {
    const template = RING_TEMPLATES[unit.key];
    const [el] = template.atoms[0];
    const internalOrder = template.bonds
      .filter(([i, j]) => i === 0 || j === 0)
      .reduce((sum, [, , order]) => sum + (order ?? 1), 0);
    assert.ok(internalOrder + 1 <= MAX_VALENCE[el], `${unit.key} 첨부 원자의 원자가`);
  }
});

test('방향족 벤젠의 첨부 탄소는 수소 과잉 없이 결합차수 합 4를 유지한다', () => {
  const m = createMolecule();
  const anchor = addAtom(m, 'C', [0, 0, 0]);
  const idxMap = insertRingTemplate(m, anchor, RING_TEMPLATES.benzene, [1, 0, 0]);
  assert.equal(bondOrderSum(m, idxMap[0]), 4);
  assert.equal(neighbors(m, idxMap[0]).filter((i) => m.atoms[i].el === 'H').length, 0);
});

test('포화된 앵커는 구조 단위를 붙일 수 없다고 명확히 거부한다', () => {
  const m = createMolecule();
  const c = addAtom(m, 'C', [0, 0, 0]);
  for (let i = 0; i < 4; i++) {
    const h = addAtom(m, 'H', [i + 1, 0, 0]);
    addBond(m, c, h);
  }
  assert.deepEqual(validateStructureAttachment(m, c, RING_TEMPLATES.benzene), { ok: false, reason: 'anchor-valence' });
});

test('구조 단위의 회전 미리보기는 앵커 거리와 원자 수를 유지한다', () => {
  const m = createMolecule();
  const anchor = addAtom(m, 'C', [0, 0, 0]);
  const base = computeRingPlacement(m, anchor, RING_TEMPLATES.cyclopentane, [1, 0, 0], 0);
  const turned = computeRingPlacement(m, anchor, RING_TEMPLATES.cyclopentane, [1, 0, 0], 90);
  assert.equal(base.length, turned.length);
  assert.ok(Math.abs(base[0][1][0] - turned[0][1][0]) < 1e-8);
  assert.notDeepEqual(base[1][1], turned[1][1]);
});
