import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMolecule, addAtom, addBond, neighbors, measure } from '../src/model.js';
import {
  canBond, snapTarget, vseprCheck, newSnapEvents, SNAP_RADIUS_FACTOR, idealDirection, openSlots, stability,
  implicitH, formula, syncHydrogens, hudSummary, geometryName, bondDistanceOk, cycleBondOrder, electronDomains,
  slotKinds,
} from '../src/snap.js';
import { distance, angleDeg, dot, dihedralDeg, add } from '../src/geom.js';
import { loadPreset } from '../src/presets.js';
import { minimize } from '../src/uff.js';

test('canBond: 원자가가 남으면 허용', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'H', [1.1, 0, 0]);
  const r = canBond(m, 0, 1);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.targetLength - 1.109) < 0.02);
});

test('canBond: 원자가가 가득 차면 차단한다 (CH5 방지)', () => {
  const m = loadPreset('methane');
  addAtom(m, 'H', [3, 0, 0]);
  const r = canBond(m, 0, 5);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'valence-full');
});

test('canBond: H끼리는 절대 연결되지 않는다 (H 사슬 방지)', () => {
  const m = createMolecule();
  addAtom(m, 'H', [0, 0, 0]);
  addAtom(m, 'H', [0.74, 0, 0]);
  addBond(m, 0, 1);              // H2 분자: 둘 다 원자가를 다 썼다
  addAtom(m, 'H', [1.5, 0, 0]);
  assert.equal(canBond(m, 1, 2).ok, false);
  assert.equal(canBond(m, 1, 2).reason, 'valence-full');
});

test('canBond: 이미 결합된 쌍은 거부', () => {
  const m = loadPreset('methane');
  assert.equal(canBond(m, 0, 1).reason, 'already-bonded');
});

test('canBond: 초원자가는 허용하되 표시한다', () => {
  const m = createMolecule();
  addAtom(m, 'S', [0, 0, 0]);
  for (let k = 0; k < 3; k++) { addAtom(m, 'F', [k + 1, 0, 0]); addBond(m, 0, k + 1); }
  addAtom(m, 'F', [0, 2, 0]);
  const r = canBond(m, 0, 4);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'ok-expanded');
});

test('snapTarget이 평형 결합 길이로 당긴다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  addAtom(m, 'H', [1.4, 0, 0]); // 조금 먼 위치
  const p = snapTarget(m, 1, 0);
  assert.ok(Math.abs(distance(p, [0, 0, 0]) - 1.109) < 0.02);
  assert.ok(p[1] === 0 && p[2] === 0, '방향은 유지되어야 함');
});

test('snapTarget이 스냅 반경 밖이면 null', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  addAtom(m, 'H', [1.109 * SNAP_RADIUS_FACTOR + 0.5, 0, 0]);
  assert.equal(snapTarget(m, 1, 0), null);
});

test('vseprCheck: 최적화된 메탄은 만족, 찌그러진 메탄은 불만족', () => {
  const good = loadPreset('methane');
  minimize(good);
  assert.equal(vseprCheck(good, 0).satisfied, true);
  assert.equal(vseprCheck(good, 0).ideal, 109.47);

  const bad = loadPreset('methane');
  bad.atoms[1].pos = [1.1, 0, 0];
  bad.atoms[2].pos = [-1.1, 0, 0];
  assert.equal(vseprCheck(bad, 0).satisfied, false);
});

test('newSnapEvents가 새로 만족된 중심만 보고한다', () => {
  const prev = { 0: false, 1: true };
  const next = { 0: true, 1: true };
  assert.deepEqual(newSnapEvents(prev, next), ['0']);
});

test('idealDirection: 메탄을 원자별로 순차 조립하면 정사면체로 수렴한다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  for (let k = 0; k < 4; k++) {
    const idx = addAtom(m, 'H', idealDirection(m, 0));
    addBond(m, 0, idx);
  }
  assert.equal(vseprCheck(m, 0).satisfied, true);
});

test('idealDirection: 두 결합이 있는 중심에 붙일 때 둘 다에 이상각으로 맞는다', () => {
  // N은 전자 도메인 4개(결합3 + 비공유쌍1)이므로 목표는 109.47°다(암모니아 삼각뿔형 방향).
  const m = createMolecule();
  addAtom(m, 'N', [0, 0, 0]);
  addAtom(m, 'H', idealDirection(m, 0));
  addBond(m, 0, 1);
  addAtom(m, 'H', idealDirection(m, 0));
  addBond(m, 0, 2);
  const dir = idealDirection(m, 0);
  const a1 = angleDeg(m.atoms[1].pos, [0, 0, 0], dir);
  const a2 = angleDeg(m.atoms[2].pos, [0, 0, 0], dir);
  assert.ok(Math.abs(a1 - 109.47) < 0.1 && Math.abs(a2 - 109.47) < 0.1);
});

test('idealDirection: 물은 첫 두 H가 109.47°(사면체 방향)로 붙는다 — 180°에 갇히지 않는다', () => {
  const m = createMolecule();
  addAtom(m, 'O', [0, 0, 0]);
  const h1 = idealDirection(m, 0);
  addAtom(m, 'H', h1); addBond(m, 0, 1);
  const h2 = idealDirection(m, 0);
  assert.ok(Math.abs(angleDeg(h1, [0, 0, 0], h2) - 109.47) < 0.1);
});

test('stability: 최적화된 메탄은 100점, 초원자가 SF6는 감점된다', () => {
  const good = loadPreset('methane');
  minimize(good);
  assert.equal(stability(good).score, 100);

  const sf6 = loadPreset('sf6');
  const s = stability(sf6);
  assert.ok(s.score < 100);
  assert.ok(s.issues.some((x) => x.msg.includes('초원자가')));
});

test('formula: 있는 원자만 Hill 표기로 센다(메탄 -> CH4)', () => {
  const m = loadPreset('methane');
  assert.equal(formula(m), 'CH4');
});

test('formula: 탄소가 없으면 H도 포함해 전부 알파벳순(회귀 — 예전엔 H가 통째로 누락됐다)', () => {
  assert.equal(formula(loadPreset('water')), 'H2O');
  assert.equal(formula(loadPreset('ammonia')), 'H3N');
});

test('implicitH: 결합 수만큼 자동 계산 — 골격식 규칙 2.2 표', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  addAtom(m, 'C', [1.5, 0, 0]);
  addBond(m, 0, 1); // C0는 결합 1개 -> CH3
  assert.equal(implicitH(m, 0), 3);
  assert.equal(implicitH(m, 1), 3);
});

test('syncHydrogens: 골격만 그린 에탄올(C-C-O)에서 C2H6O를 만든다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  addAtom(m, 'C', [1.5, 0, 0]);
  addAtom(m, 'O', [3.0, 0, 0]);
  addBond(m, 0, 1); addBond(m, 1, 2);
  syncHydrogens(m);
  assert.equal(formula(m), 'C2H6O');
  // 골격식 규칙 3: 채운 뒤 모든 무거운 원자의 원자가가 정확히 찬다.
  for (let i = 0; i < 3; i++) assert.equal(implicitH(m, i), 0);
});

test('syncHydrogens: 원자가를 넘겨 붙은 H는 뗀다(CH5 -> CH4)', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  for (let k = 0; k < 5; k++) {
    const idx = addAtom(m, 'H', [k + 1, 0, 0]);
    addBond(m, 0, idx);
  }
  assert.equal(formula(m), 'CH5');
  syncHydrogens(m);
  assert.equal(formula(m), 'CH4');
  assert.equal(neighbors(m, 0).length, 4);
});

test('syncHydrogens: 두 번 불러도 결과가 같다(멱등)', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  addAtom(m, 'O', [1.4, 0, 0]);
  addBond(m, 0, 1);
  syncHydrogens(m);
  const f1 = formula(m);
  const n1 = m.atoms.length;
  syncHydrogens(m);
  assert.equal(formula(m), f1);
  assert.equal(m.atoms.length, n1);
});

const angleBetween = (u, v) => Math.acos(Math.max(-1, Math.min(1, dot(u, v)))) * 180 / Math.PI;

test('openSlots: 결합 1개짜리 탄소는 정사면체 빈 자리 3개를 준다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  addAtom(m, 'H', [1.1, 0, 0]);
  addBond(m, 0, 1);
  const slots = openSlots(m, 0);
  assert.equal(slots.length, 3);
  for (const v of slots) {
    assert.ok(Math.abs(angleBetween(v, [1, 0, 0]) - 109.47) < 1.5, `기존 결합과의 각: ${angleBetween(v, [1, 0, 0])}`);
  }
  for (let a = 0; a < 3; a++) {
    for (let b = a + 1; b < 3; b++) {
      assert.ok(Math.abs(angleBetween(slots[a], slots[b]) - 109.47) < 1.5,
        `슬롯끼리의 각: ${angleBetween(slots[a], slots[b])}`);
    }
  }
});

test('openSlots: 결정적이다 (같은 분자면 같은 순서·같은 값)', () => {
  const m = loadPreset('water');
  assert.deepEqual(openSlots(m, 0), openSlots(m, 0));
});

test('openSlots: 물의 산소는 비공유쌍 자리 2개가 남는다', () => {
  const m = loadPreset('water');
  assert.equal(openSlots(m, 0).length, 2); // 전자 도메인 4 - 결합 2
});

test('openSlots: 이웃 1개짜리 앵커는 분자 자체를 기준으로 anti(이면각 180°) 자리에서 시작한다 (임의 축 회귀)', () => {
  // C2-C1-O, O는 이웃 1개(C1)뿐 — 에탄올의 -OH에 H를 붙이는 상황과 같다.
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);       // 0: C2
  addAtom(m, 'C', [1.5, 0, 0]);     // 1: C1
  addAtom(m, 'O', [2.2, 1.3, 0]);   // 2: O
  addBond(m, 0, 1);
  addBond(m, 1, 2);
  const slot = openSlots(m, 2)[0];
  const newPos = add(m.atoms[2].pos, slot);
  const dh = dihedralDeg(newPos, m.atoms[2].pos, m.atoms[1].pos, m.atoms[0].pos);
  assert.ok(Math.abs(Math.abs(dh) - 180) < 3, `이면각(C2-C1-O-신규)이 anti(180°)여야 함: ${dh}`);
});

test('idealDirection은 openSlots의 첫 원소와 같다 (기존 동작 보존)', () => {
  const m = loadPreset('methane');
  const m2 = createMolecule();
  addAtom(m2, 'C', [0, 0, 0]);
  addAtom(m2, 'H', [1.1, 0, 0]);
  addBond(m2, 0, 1);
  assert.deepEqual(idealDirection(m2, 0), openSlots(m2, 0)[0]);
  assert.deepEqual(idealDirection(m, 1), openSlots(m, 1)[0]);
});

test('hudSummary: danger를 먼저, 최대 개수만 보여주고 나머지는 센다', () => {
  const st = {
    score: 40,
    issues: [
      { atom: 1, level: 'warn', msg: 'a' },
      { atom: 2, level: 'warn', msg: 'b' },
      { atom: 3, level: 'danger', msg: 'c' },
      { atom: 4, level: 'warn', msg: 'd' },
      { atom: 5, level: 'danger', msg: 'e' },
    ],
  };
  const s = hudSummary(st, 3);
  assert.equal(s.score, 40);
  assert.equal(s.shown.length, 3);
  assert.deepEqual(s.shown.map((x) => x.msg), ['c', 'e', 'a']);
  assert.equal(s.more, 2);
});

test('hudSummary: 이슈가 적으면 more는 0이다', () => {
  const s = hudSummary({ score: 100, issues: [] }, 3);
  assert.equal(s.shown.length, 0);
  assert.equal(s.more, 0);
});

test('vseprCheck: 최적화된 물·암모니아는 만족한다 (오탐 회귀)', () => {
  const w = loadPreset('water');
  minimize(w);
  const vw = vseprCheck(w, 0);
  assert.equal(vw.ideal, 104.51, '물의 이상각은 O_3의 UFF 평형각이어야 한다');
  assert.equal(vw.satisfied, true, '문헌값으로 최적화된 물이 불만족이면 오탐이다');

  const a = loadPreset('ammonia');
  minimize(a);
  const va = vseprCheck(a, 0);
  assert.equal(va.ideal, 106.7);
  assert.equal(va.satisfied, true);
});

test('stability: 최적화된 프리셋에 각도 경고가 없다 (오탐 회귀)', () => {
  for (const key of ['water', 'ammonia', 'ethylene', 'ethane', 'cyclohexane_chair']) {
    const m = loadPreset(key);
    minimize(m);
    const angleIssues = stability(m).issues.filter((x) => x.msg.includes('각도 편차'));
    assert.deepEqual(angleIssues, [], `${key}에 각도 오탐이 남아 있다`);
  }
});

test('geometryName: 전자 도메인과 결합 수로 형상을 부른다', () => {
  const w = loadPreset('water');
  assert.equal(geometryName(w, 0), '굽은형');       // 도메인 4, 결합 2
  const a = loadPreset('ammonia');
  assert.equal(geometryName(a, 0), '삼각뿔형');     // 도메인 4, 결합 3
  const m = loadPreset('methane');
  assert.equal(geometryName(m, 0), '정사면체');     // 도메인 4, 결합 4
  const e = loadPreset('ethylene');
  assert.equal(geometryName(e, 0), '평면 삼각형');  // 결합 3, sp2
  const s = loadPreset('sf6');
  assert.equal(geometryName(s, 0), '정팔면체');     // 결합 6
});

test('stability: 원자가가 모자란 원자를 경고한다 (라디칼 회귀)', () => {
  // CH3-C(-O)(-OH)H 처럼, 이중결합을 못 만들어 결합 1개로 남은 산소.
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  addAtom(m, 'O', [1.4, 0, 0]);
  addBond(m, 0, 1, 1);
  const issues = stability(m).issues;
  assert.ok(issues.some((x) => x.atom === 1 && x.msg.includes('원자가 부족')),
    '결합 1개짜리 산소는 원자가가 1 모자라므로 경고해야 한다');
  assert.equal(issues.find((x) => x.atom === 1 && x.msg.includes('원자가 부족')).level, 'warn');
});

test('stability: 원자가가 꽉 찬 분자에는 부족 경고가 없다', () => {
  const m = loadPreset('methane');
  minimize(m);
  assert.deepEqual(stability(m).issues.filter((x) => x.msg.includes('원자가 부족')), []);
  assert.equal(stability(m).score, 100);
});

test('bondDistanceOk: 결합 길이의 3배를 넘으면 거부한다', () => {
  const near = createMolecule();
  addAtom(near, 'C', [0, 0, 0]);
  addAtom(near, 'C', [1.6, 0, 0]);
  assert.equal(bondDistanceOk(near, 0, 1), true);

  const ring = createMolecule();
  addAtom(ring, 'C', [0, 0, 0]);
  addAtom(ring, 'C', [3.8, 0, 0]);   // 갓 그린 사슬의 양 끝 정도 — 고리 닫기는 허용해야 한다
  assert.equal(bondDistanceOk(ring, 0, 1), true);

  const far = createMolecule();
  addAtom(far, 'C', [0, 0, 0]);
  addAtom(far, 'C', [10, 0, 0]);     // 진단에서 25,189 kcal/mol이 나온 거리
  assert.equal(bondDistanceOk(far, 0, 1), false);
});

test('bondDistanceOk: 애초에 결합 불가한 쌍은 거리와 무관하게 false', () => {
  const m = loadPreset('methane');
  assert.equal(bondDistanceOk(m, 0, 1), false); // 이미 결합됨
});

test('cycleBondOrder: 1 -> 2 -> 3 -> 1로 순환한다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  addAtom(m, 'C', [1.5, 0, 0]);
  addBond(m, 0, 1, 1);
  const b = m.bonds[0];
  assert.equal(cycleBondOrder(m, b).order, 2);
  assert.equal(cycleBondOrder(m, b).order, 3);
  assert.equal(cycleBondOrder(m, b).order, 1);
});

test('cycleBondOrder: 원자가가 모자라면 올리지 않고 거부한다', () => {
  // 메탄의 C-H: 탄소는 이미 결합 4개, 수소는 상한 1이라 이중결합이 불가능하다.
  const m = loadPreset('methane');
  const b = m.bonds[0];
  const r = cycleBondOrder(m, b);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'valence-full');
  assert.equal(b.order, 1, '거부했으면 차수를 바꾸면 안 된다');
});

test('cycleBondOrder: 아세트산을 실제로 만들 수 있다 (C2H4O2 회귀)', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);        // 0 메틸 C
  addAtom(m, 'C', [1.5, 0, 0]);      // 1 카복실 C
  addAtom(m, 'O', [2.1, 1.1, 0]);    // 2 카보닐 O
  addAtom(m, 'O', [2.1, -1.1, 0]);   // 3 하이드록실 O
  addBond(m, 0, 1, 1); addBond(m, 1, 2, 1); addBond(m, 1, 3, 1);
  assert.equal(cycleBondOrder(m, m.bonds[1]).order, 2); // C1=O2로 올린다
  syncHydrogens(m);
  assert.equal(formula(m), 'C2H4O2');
  minimize(m);
  assert.ok(Math.abs(measure(m, [1, 2]) - 1.21) < 0.06, `C=O 길이 ${measure(m, [1, 2])}`);
  assert.ok(Math.abs(measure(m, [1, 3]) - 1.36) < 0.06, `C-O 길이 ${measure(m, [1, 3])}`);
});

test('openSlots: 이중결합 탄소는 120°짜리 빈 자리 2개를 준다 (sp2 회귀)', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  addAtom(m, 'C', [1.33, 0, 0]);
  addBond(m, 0, 1, 2);
  const slots = openSlots(m, 0);
  assert.equal(slots.length, 2, 'sp2 탄소의 남은 시그마 자리는 2개다');
  for (const v of slots) {
    assert.ok(Math.abs(angleBetween(v, [1, 0, 0]) - 120) < 1.5, `C=C와의 각: ${angleBetween(v, [1, 0, 0])}`);
  }
});

test('openSlots: 삼중결합 탄소는 180°짜리 빈 자리 1개를 준다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  addAtom(m, 'C', [1.2, 0, 0]);
  addBond(m, 0, 1, 3);
  const slots = openSlots(m, 0);
  assert.equal(slots.length, 1);
  assert.ok(Math.abs(angleBetween(slots[0], [1, 0, 0]) - 180) < 1.5);
});

test('openSlots: 단일결합만 있는 중심은 예전 그대로다 (회귀 방지)', () => {
  const c = createMolecule();
  addAtom(c, 'C', [0, 0, 0]);
  addAtom(c, 'H', [1.1, 0, 0]);
  addBond(c, 0, 1, 1);
  assert.equal(openSlots(c, 0).length, 3);
  assert.ok(Math.abs(angleBetween(openSlots(c, 0)[0], [1, 0, 0]) - 109.47) < 1.5);

  const w = loadPreset('water');
  assert.equal(openSlots(w, 0).length, 2); // 비공유쌍 자리 2개
});

test('electronDomains: π 결합은 시그마 자리를 차지하지 않는다', () => {
  const ene = createMolecule();
  addAtom(ene, 'C', [0, 0, 0]); addAtom(ene, 'C', [1.33, 0, 0]);
  addBond(ene, 0, 1, 2);
  assert.equal(electronDomains(ene, 0), 3);            // sp2

  const yne = createMolecule();
  addAtom(yne, 'C', [0, 0, 0]); addAtom(yne, 'C', [1.2, 0, 0]);
  addBond(yne, 0, 1, 3);
  assert.equal(electronDomains(yne, 0), 2);            // sp

  const co = createMolecule();
  addAtom(co, 'C', [0, 0, 0]); addAtom(co, 'O', [1.21, 0, 0]);
  addBond(co, 0, 1, 2);
  assert.equal(electronDomains(co, 1), 3);            // 카보닐 O: 시그마1 + 비공유쌍2

  assert.equal(electronDomains(loadPreset('water'), 0), 4);   // 물은 그대로
  assert.equal(electronDomains(loadPreset('methane'), 0), 4); // 메탄도 그대로
});

test('slotKinds: 물의 산소는 빈 자리 둘 다 비공유 전자쌍이다', () => {
  const w = loadPreset('water');
  const kinds = slotKinds(w, 0);
  assert.equal(kinds.length, 2);
  assert.deepEqual(kinds.map((k) => k.kind), ['lonepair', 'lonepair']);
});

test('slotKinds: 결합 1개짜리 탄소는 세 자리 모두 결합 가능하다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  addAtom(m, 'H', [1.1, 0, 0]);
  addBond(m, 0, 1, 1);
  const kinds = slotKinds(m, 0);
  assert.equal(kinds.length, 3);
  assert.deepEqual(kinds.map((k) => k.kind), ['bond', 'bond', 'bond']);
});

test('slotKinds: 하이드록실 산소는 결합 자리 없이 비공유쌍만 남는다', () => {
  // C-O-H: 산소는 원자가 2를 다 썼고 비공유쌍 2개가 남는다.
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'O', [1.4, 0, 0]); addAtom(m, 'H', [1.9, 0.9, 0]);
  addBond(m, 0, 1, 1); addBond(m, 1, 2, 1);
  assert.deepEqual(slotKinds(m, 1).map((k) => k.kind), ['lonepair', 'lonepair']);
});

test('slotKinds: 방향은 openSlots와 정확히 같다 (미리보기가 어긋나면 안 된다)', () => {
  const m = loadPreset('water');
  assert.deepEqual(slotKinds(m, 0).map((k) => k.dir), openSlots(m, 0));
});

test('slotKinds: 원자가가 완전히 찬 탄소는 안전장치 자리도 비공유쌍이 아니다 (아세트산 카보닐 탄소 회귀)', () => {
  // C0-C1(단일)-O2(이중)-O3(단일): 카보닐 탄소(idx 1)는 시그마 자리 3개가 이미 다 찼다.
  // openSlots는 원자가가 꽉 찬 원자에도 안전장치로 최소 1자리를 돌려주는데, 그 자리를
  // "room 이후는 전부 비공유쌍"으로 분류하면 LONE_PAIRS[C]=0인데도 보라색 비공유쌍으로
  // 표시되고 클릭 시 "비공유 전자쌍 자리입니다"라는 틀린 안내가 떴다.
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'C', [1.5, 0, 0]);
  addAtom(m, 'O', [2.1, 1.1, 0]); addAtom(m, 'O', [2.1, -1.1, 0]);
  addBond(m, 0, 1, 1); addBond(m, 1, 2, 2); addBond(m, 1, 3, 1);
  const kinds = slotKinds(m, 1);
  assert.ok(kinds.every((k) => k.kind !== 'lonepair'), '탄소는 비공유 전자쌍을 가질 수 없다');
});
