import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePredicate, loadStart } from '../src/mission.js';
import { loadPreset } from '../src/presets.js';
import { setDihedral, measure as measure3 } from '../src/model.js';
import { topologyKey, energy } from '../src/uff.js';
import { formula } from '../src/snap.js';

function ctxFor(mol, extra = {}) {
  return {
    mol,
    selection: [],
    answer: null,
    startTopology: topologyKey(mol),
    startEnergy: energy(mol).total,
    ...extra,
  };
}

test('formula 술어', () => {
  const ctx = ctxFor(loadPreset('butane'));
  assert.equal(evaluatePredicate({ formula: 'C4H10' }, ctx), true);
  assert.equal(evaluatePredicate({ formula: 'C4H8' }, ctx), false);
});

test('topologyMatches 술어는 좌표 변화에 영향받지 않는다', () => {
  const mol = loadPreset('butane');
  const ctx = ctxFor(mol);
  setDihedral(mol, [0, 1, 2, 3], 60);
  assert.equal(evaluatePredicate({ topologyMatches: 'start' }, ctx), true);
});

test('dihedral 술어는 ±180 경계를 순환으로 처리한다', () => {
  const mol = loadPreset('butane');
  setDihedral(mol, [0, 1, 2, 3], -170);
  const ctx = ctxFor(mol);
  assert.equal(
    evaluatePredicate({ dihedral: [0, 1, 2, 3], within: [150, 210] }, ctx), true,
  );
  setDihedral(mol, [0, 1, 2, 3], 60);
  assert.equal(
    evaluatePredicate({ dihedral: [0, 1, 2, 3], within: [150, 210] }, ctxFor(mol)), false,
  );
});

test('angle·distance 술어는 순환하지 않는다', () => {
  const ctx = ctxFor(loadPreset('water'));
  assert.equal(evaluatePredicate({ angle: [1, 0, 2], within: [100, 110] }, ctx), true);
  assert.equal(evaluatePredicate({ angle: [1, 0, 2], within: [170, 190] }, ctx), false);
  assert.equal(evaluatePredicate({ distance: [0, 1], within: [0.9, 1.1] }, ctx), true);
});

test('ringCount·ringSize 술어', () => {
  const ctx = ctxFor(loadPreset('cyclohexane_chair'));
  assert.equal(evaluatePredicate({ ringCount: 1 }, ctx), true);
  assert.equal(evaluatePredicate({ ringSize: [6] }, ctx), true);
  assert.equal(evaluatePredicate({ ringSize: [5] }, ctx), false);
});

test('noSevere 술어는 정상 프리셋에서 참이다', () => {
  assert.equal(evaluatePredicate({ noSevere: true }, ctxFor(loadPreset('methane'))), true);
});

test('hasGroup 술어는 이웃 원소·차수 다중집합으로 매칭한다', () => {
  const ctx = ctxFor(loadPreset('ethylene'));
  // sp2 탄소: 이웃에 차수 2의 C 하나와 차수 1의 H 둘
  assert.equal(evaluatePredicate({
    hasGroup: { el: 'C', bonded: [{ el: 'C', order: 2 }, { el: 'H', order: 1 }, { el: 'H', order: 1 }] },
  }, ctx), true);
  assert.equal(evaluatePredicate({
    hasGroup: { el: 'C', bonded: [{ el: 'O', order: 2 }] },
  }, ctx), false);
});

test('selectionEquals는 순서를 무시한다', () => {
  const ctx = ctxFor(loadPreset('water'), { selection: [2, 0, 1] });
  assert.equal(evaluatePredicate({ selectionEquals: [0, 1, 2] }, ctx), true);
  assert.equal(evaluatePredicate({ selectionEquals: [0, 1] }, ctx), false);
});

test('answerEquals 술어', () => {
  const ctx = ctxFor(loadPreset('water'), { answer: 'b' });
  assert.equal(evaluatePredicate({ answerEquals: 'b' }, ctx), true);
  assert.equal(evaluatePredicate({ answerEquals: 'a' }, ctx), false);
});

test('energyDelta는 시작 구조 대비 총에너지 변화를 본다', () => {
  const mol = loadPreset('butane');
  const ctx = ctxFor(mol);
  assert.equal(evaluatePredicate({ energyDelta: true, within: [-0.001, 0.001] }, ctx), true);
});

test('strainByType 술어', () => {
  const ctx = ctxFor(loadPreset('methane'));
  assert.equal(evaluatePredicate({ strainByType: 'angle', within: [-1, 1e9] }, ctx), true);
});

test('all·any·not 조합자', () => {
  const ctx = ctxFor(loadPreset('butane'));
  assert.equal(evaluatePredicate({ all: [{ formula: 'C4H10' }, { ringCount: 0 }] }, ctx), true);
  assert.equal(evaluatePredicate({ all: [{ formula: 'C4H10' }, { ringCount: 1 }] }, ctx), false);
  assert.equal(evaluatePredicate({ any: [{ formula: 'X' }, { ringCount: 0 }] }, ctx), true);
  assert.equal(evaluatePredicate({ not: { ringCount: 1 } }, ctx), true);
});

test('알 수 없는 술어는 throw한다', () => {
  assert.throws(() => evaluatePredicate({ pKa: 7 }, ctxFor(loadPreset('water'))), /pKa/);
});

test('loadStart: preset 그대로', () => {
  const m = loadStart({ preset: 'butane' });
  assert.equal(formula(m), 'C4H10');
});

test('loadStart: ringTemplate로 벤젠을 만든다', () => {
  const m = loadStart({ ringTemplate: 'benzene' });
  assert.equal(formula(m), 'C6H6');
  assert.ok(Math.abs(measure3(m, [0, 1]) - 1.40) < 0.02);
});

test('loadStart: 골격 + syncH가 수소를 채운다', () => {
  const m = loadStart({
    atoms: [['C', [0, 0, 0]], ['C', [1.34, 0, 0]]],
    bonds: [[0, 1, 2]],
    syncH: true,
  });
  assert.equal(formula(m), 'C2H4');
});

test('loadStart: setDihedral이 배좌를 바꾼다', () => {
  const m = loadStart({ preset: 'butane', setDihedral: { atoms: [0, 1, 2, 3], deg: 60 } });
  assert.ok(Math.abs(measure3(m, [0, 1, 2, 3]) - 60) < 1);
});

test('loadStart: replace는 인덱스를 밀지 않는다', () => {
  const m = loadStart({ preset: 'cyclohexane_chair', replace: [{ atom: 7, el: 'C' }], syncH: true });
  assert.equal(m.atoms[7].el, 'C');
  for (let i = 0; i < 6; i++) assert.equal(m.atoms[i].el, 'C'); // 고리 인덱스 보존
  assert.equal(formula(m), 'C7H14');
});

test('loadStart: flipZ는 z부호만 뒤집는다', () => {
  const a = loadStart({ preset: 'cyclohexane_chair' });
  const b = loadStart({ preset: 'cyclohexane_chair', flipZ: true });
  assert.equal(b.atoms[0].pos[2], -a.atoms[0].pos[2]);
  assert.equal(b.atoms[0].pos[0], a.atoms[0].pos[0]);
});

test('loadStart: relax는 에너지를 낮춘다', () => {
  const raw = loadStart({ preset: 'cyclohexane_boat' });
  const done = loadStart({ preset: 'cyclohexane_boat', relax: true });
  assert.ok(energy(done).total < energy(raw).total);
});

test('loadStart: 소스가 없으면 throw', () => {
  assert.throws(() => loadStart({ syncH: true }), /시작구조/);
});
