import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMolecule, addAtom, neighbors, branchAtoms } from '../src/model.js';
import { RING_TEMPLATES, insertRingTemplate } from '../src/presets.js';
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
