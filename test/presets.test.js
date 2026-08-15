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

test('이미다졸·피리미딘·퓨린은 생체유기 구조 단위 라이브러리에 평면 방향족 골격으로 제공된다', () => {
  for (const key of ['imidazole', 'pyrimidine', 'purine']) {
    const template = RING_TEMPLATES[key];
    assert.ok(template, `${key} 템플릿 존재`);
    assert.ok(STRUCTURE_LIBRARY.some((unit) => unit.key === key), `${key} 라이브러리 진입점`);
    assert.ok(template.atoms.some(([el, , type]) => el === 'N' && type === 'N_R'), `${key} 질소 sp² 타입`);
    assert.ok(template.bonds.filter(([, , order]) => order === 1.5).length >= 5, `${key} 방향족 결합`);
  }
  assert.deepEqual(RING_TEMPLATES.purine.aromaticFusedAtoms, [3, 4]);
});

test('핵산 카드용 실제 핵염기 다섯 종은 N-글리코사이드 첨부 지점과 태그를 보존한다', () => {
  for (const key of ['adenine', 'guanine', 'cytosine', 'thymine', 'uracil']) {
    const template = RING_TEMPLATES[key];
    assert.equal(template.nucleobase, key);
    assert.equal(template.atoms[0][0], 'N');
    assert.equal(template.attachType, 'N_R');
    assert.ok(STRUCTURE_LIBRARY.some((unit) => unit.key === key));
  }
});

test('핵염기 다섯 종은 공명형 sp2 질소·π 결합·첨부 원자 원자가를 함께 만족한다', () => {
  for (const key of ['adenine', 'guanine', 'cytosine', 'thymine', 'uracil']) {
    const template = RING_TEMPLATES[key];
    const internalOrder = template.bonds.filter(([i, j]) => i === 0 || j === 0)
      .reduce((sum, [, , order]) => sum + (order ?? 1), 0);
    assert.ok(template.atoms.some(([el, , type]) => el === 'N' && type === 'N_R'), `${key} sp2 질소`);
    assert.ok(template.bonds.some(([, , order]) => order === 2), `${key} π 결합`);
    assert.ok(internalOrder + 1 <= MAX_VALENCE.N, `${key} N-글리코사이드 첨부 원자가`);
  }
});

test('핵염기 다섯 종은 케쿨레 공명 결합과 sp2 고리 원자 표현을 유지한다', () => {
  const ringSizes = { adenine: 9, guanine: 9, cytosine: 6, thymine: 6, uracil: 6 };
  for (const [key, ringSize] of Object.entries(ringSizes)) {
    const template = RING_TEMPLATES[key];
    const ringAtoms = template.atoms.slice(0, ringSize);
    const ringPiBonds = template.bonds.filter(([i, j, order]) => i < ringSize && j < ringSize && order === 2);
    assert.ok(ringPiBonds.length >= 1, `${key} 고리 내 케쿨레 π 결합`);
    assert.ok(template.bonds.filter(([, , order]) => order === 2).length >= 3, `${key} 케토형을 포함한 전체 π 결합`);
    assert.ok(ringAtoms.every(([, , type]) => ['C_R', 'C_2', 'N_R'].includes(type)), `${key} sp2 고리 원자 타입`);
    assert.ok(ringAtoms.some(([el, , type]) => el === 'N' && type === 'N_R'), `${key} 방향족 질소 타입`);
  }
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
