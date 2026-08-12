import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePredicate, loadStart, runProbe, evaluate, maxHintLevel, validateMission } from '../src/mission.js';
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

test('runProbe: 단일 상태 각도 측정은 geometry 등급', () => {
  const out = runProbe({
    kind: 'minimize',
    states: [{ preset: 'water' }],
    report: [{ label: 'H–O–H', value: 'angle', atoms: [1, 0, 2] }],
  });
  assert.equal(out.trust.key, 'geometry');
  assert.equal(out.rows.length, 1);
  assert.match(out.rows[0].text, /10[0-9]\.[0-9]°/); // 최적화 후 ~104.5°
});

test('runProbe: 같은 위상 두 상태의 총에너지 비교는 relative 등급', () => {
  const out = runProbe({
    kind: 'minimize',
    states: [
      { preset: 'butane' },
      { preset: 'butane', setDihedral: { atoms: [0, 1, 2, 3], deg: 60 } },
    ],
    report: [
      { label: 'anti', value: 'energy', state: 0 },
      { label: 'gauche', value: 'energy', state: 1 },
    ],
  });
  assert.equal(out.trust.key, 'relative');
  assert.equal(out.rows.length, 2);
});

test('runProbe: 위상이 다른 두 상태의 총에너지는 throw한다', () => {
  assert.throws(() => runProbe({
    kind: 'minimize',
    states: [{ preset: 'ethane' }, { preset: 'ethylene' }],
    report: [{ label: 'A', value: 'energy', state: 0 }, { label: 'B', value: 'energy', state: 1 }],
  }), /총에너지는 비교할 수 없습니다/);
});

test('runProbe: 위상이 달라도 barrier 비교는 허용된다', () => {
  const out = runProbe({
    kind: 'scanDihedral',
    states: [{ preset: 'ethane' }, { preset: 'ethylene' }],
    scan: { atoms: [2, 0, 1, 5], stepDeg: 30 },
    report: [
      { label: '에탄', value: 'barrier', state: 0 },
      { label: '에틸렌', value: 'barrier', state: 1 },
    ],
  });
  assert.equal(out.trust.key, 'relative');
  const val = (s) => Number(out.rows.find((r) => r.label === s).text.match(/[\d.]+/)[0]);
  assert.ok(val('에틸렌') > val('에탄') * 3); // π 장벽이 σ 장벽보다 압도적으로 크다
});

test('runProbe: formula·topologyEqual 리포트', () => {
  const out = runProbe({
    kind: 'measure',
    states: [
      { preset: 'butane' },
      { atoms: [['C', [0, 0, 0]], ['C', [1.53, 0, 0]], ['C', [-0.5, 1.45, 0]], ['C', [-0.5, -0.7, 1.26]]],
        bonds: [[0, 1], [0, 2], [0, 3]], syncH: true, relax: true },
    ],
    report: [
      { label: 'n-부탄 분자식', value: 'formula', state: 0 },
      { label: '아이소부탄 분자식', value: 'formula', state: 1 },
      { label: '연결 방식이 같은가', value: 'topologyEqual' },
    ],
  });
  assert.equal(out.trust.key, 'geometry');
  assert.equal(out.rows[0].text, 'C4H10');
  assert.equal(out.rows[1].text, 'C4H10');
  assert.equal(out.rows[2].text, '다릅니다');
});

const H4 = ['힌트1', '힌트2', '힌트3', '정답'];

const antiMission = {
  id: 'test-anti', chapter: 2, concept: '배좌', type: 'build', title: 't', brief: 'b',
  start: { preset: 'butane', setDihedral: { atoms: [0, 1, 2, 3], deg: 60 } },
  check: { all: [{ formula: 'C4H10' }, { dihedral: [0, 1, 2, 3], within: [150, 210] }] },
  diagnostics: [{
    when: { dihedral: [0, 1, 2, 3], within: [40, 80] },
    message: 'gauche 배좌입니다.',
  }],
  hints: H4, trust: 'geometry',
};

test('evaluate: 정답 상태는 통과한다', () => {
  const mol = loadStart({ preset: 'butane' }); // anti
  const out = evaluate(antiMission, { mol, selection: [], answer: null });
  assert.equal(out.pass, true);
  assert.equal(out.diagnostic, null);
});

test('evaluate: 지정 오답 상태는 지정 진단을 낸다', () => {
  const mol = loadStart(antiMission.start); // gauche
  const out = evaluate(antiMission, { mol, selection: [], answer: null });
  assert.equal(out.pass, false);
  assert.equal(out.diagnostic, 'gauche 배좌입니다.');
});

test('evaluate: 매칭되는 진단이 없으면 일반 메시지가 나온다', () => {
  const mol = loadStart({ preset: 'butane', setDihedral: { atoms: [0, 1, 2, 3], deg: 110 } });
  const out = evaluate(antiMission, { mol, selection: [], answer: null });
  assert.equal(out.pass, false);
  assert.match(out.diagnostic, /이면각/);
});

test('evaluate: predict 미션은 answer로 채점한다', () => {
  const m = {
    id: 't2', chapter: 1, concept: 'c', type: 'predict', title: 't', brief: 'b',
    start: { preset: 'water' },
    choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    answer: 'b',
    probe: { kind: 'minimize', states: [{ preset: 'water' }],
             report: [{ label: '각', value: 'angle', atoms: [1, 0, 2] }] },
    hints: H4, trust: 'geometry',
  };
  const mol = loadStart(m.start);
  assert.equal(evaluate(m, { mol, selection: [], answer: 'b' }).pass, true);
  assert.equal(evaluate(m, { mol, selection: [], answer: 'a' }).pass, false);
});

test('maxHintLevel: 정답 힌트는 3회 시도 후에만 열린다', () => {
  assert.equal(maxHintLevel(0), 3);
  assert.equal(maxHintLevel(2), 3);
  assert.equal(maxHintLevel(3), 4);
  assert.equal(maxHintLevel(9), 4);
});

test('validateMission: 정상 미션은 통과', () => {
  assert.doesNotThrow(() => validateMission(antiMission));
});

test('validateMission: 힌트가 4단 미만이면 throw', () => {
  assert.throws(() => validateMission({ ...antiMission, hints: ['a', 'b'] }), /힌트/);
});

test('validateMission: 알 수 없는 술어는 throw', () => {
  assert.throws(
    () => validateMission({ ...antiMission, check: { pKa: 7 } }),
    /pKa/,
  );
});

test('validateMission: answer가 choices에 없으면 throw', () => {
  assert.throws(() => validateMission({
    ...antiMission, type: 'classify',
    choices: [{ id: 'a', label: 'A' }], answer: 'z',
  }), /answer/);
});

test('validateMission: 알 수 없는 type은 throw', () => {
  assert.throws(() => validateMission({ ...antiMission, type: 'guess' }), /type/);
});

test('validateMission: 위상이 다른 상태의 energy probe는 throw', () => {
  assert.throws(() => validateMission({
    ...antiMission, type: 'predict',
    choices: [{ id: 'a', label: 'A' }], answer: 'a', check: undefined,
    probe: {
      kind: 'minimize', states: [{ preset: 'ethane' }, { preset: 'ethylene' }],
      report: [{ label: 'A', value: 'energy', state: 0 }, { label: 'B', value: 'energy', state: 1 }],
    },
  }), /총에너지는 비교할 수 없습니다/);
});
