# 미션 엔진 + 신뢰등급 배지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mol-craft에 선언형 미션 엔진과 수치 신뢰등급을 넣어, 유기화학 대표 개념 10개를 학생이 직접 조작하고 검증하며 배우게 한다.

**Architecture:** 채점은 기존 함수(`formula`·`topologyKey`·`measure`·`energy`·`stability`·`findRings`)를 얇게 감싼 **선언형 술어**의 조합이다. 새 화학 로직은 없다. `mission.js`·`trust.js`는 DOM을 모르는 순수 모듈이라 `node --test`에서 그대로 검증되고, `mission-ui.js`만 DOM을 만진다. `app.js`(1305줄)는 세 지점만 바뀐다.

**Tech Stack:** 바닐라 ES 모듈. 빌드 없음. npm 의존성 0개. 테스트는 `node --test`(Node 22).

**Spec:** `docs/superpowers/specs/2026-08-12-mission-engine-design.md`

## Global Constraints

- **npm 의존성을 추가하지 않는다.** CI(`.github/workflows/test.yml`)에 install 단계가 없다.
- **빌드 단계를 추가하지 않는다.** `index.html`을 그대로 서빙하는 정적 배포다.
- 모든 새 모듈은 ES 모듈(`export`)이며 `src/` 바로 아래 둔다. `package.json`은 `"type": "module"`이다.
- 테스트는 `node:test` + `node:assert/strict`. 기존 `test/*.test.js` 스타일을 따른다.
- 주석·UI 문자열·커밋 메시지 본문은 한국어. 기존 코드베이스 규약이다.
- `src/app.js`에는 미션 로직을 넣지 않는다. 허용된 변경은 Task 9에 열거된 세 지점뿐이다.
- 위상(`topologyKey`)이 다른 두 구조의 **총에너지**는 어떤 경로로도 화면에 비교 표시하지 않는다.
- 원자 인덱스는 절대 밀리지 않아야 한다. 시작구조 변환에 **원자 삭제를 넣지 않는다**(Task 3의 불변식).

---

## 스펙에서 변경한 2건

플랜 작성 중 확인한 사실 때문에 스펙의 두 결정을 바꾼다.

**1. `start`를 base64 문자열이 아니라 선언형 골격 + 변환으로 한다.**
스펙 §5는 `start: { state: '<encodeState 문자열>' }`였다. base64는 사람이 읽거나 diff할 수 없고, 저작할 때마다 별도 도구가 필요하다. 대신 `PRESETS`와 같은 모양의 원자·결합 리터럴에 `replace`/`setDihedral`/`flipZ`/`syncH`/`relax` 변환을 얹는다. 무거운 원자 골격만 적고 `syncHydrogens()`가 수소를 채우므로 리터럴이 작다.

**2. 시드 10번을 글루코스 α/β → cis/trans-2-뷰텐(Ch15)으로 바꾼다.**
글루코스 피라노스는 올바른 의자에 아노머 배치를 얹은 좌표를 손으로 저작해야 하고(무거운 원자 12개 + 입체 배치 검증), 그 작업의 본체는 프리셋 확충 = S5의 범위다. cis/trans-2-뷰텐은 **위상이 같아**(같은 연결 그래프, 기하만 다름) 총에너지 비교가 🟡로 정당하고, `cis 이중결합의 꺾임 → 밀집 불가 → 융점 강하`라는 Ch15의 핵심을 그대로 담는다. 저작 비용은 무거운 원자 4개다. 글루코스 α/β는 S5로 넘긴다.

나머지는 스펙 그대로다.

---

## File Structure

| 파일 | 책임 | DOM | 테스트 |
|---|---|---|---|
| `src/trust.js` (신규, ~60줄) | 신뢰등급 상수·판정·비교 가능성 가드 | 없음 | `test/trust.test.js` |
| `src/mission.js` (신규, ~260줄) | 술어 평가기 · 시작구조 로더 · probe 실행기 · 채점 · 스키마 검증 | 없음 | `test/mission.test.js` |
| `src/mission-data.js` (신규, ~320줄) | 시드 미션 10개 선언형 데이터 | 없음 | `test/mission-data.test.js` |
| `src/mission-ui.js` (신규, ~230줄) | 미션 패널 렌더 · 진도 localStorage | 있음 | 수동 확인(Task 9) |
| `src/app.js` (수정, 3지점) | 마운트 · 시작구조 로드 콜백 · 상태 게터 | 있음 | 수동 확인 |
| `index.html` (수정) | `<section id="mission">` 추가 · 총에너지 배지 자리 | — | 수동 확인 |
| `README.md` (수정) | 미션 모드·신뢰등급 문서화 | — | — |

`mission.js`가 260줄로 가장 크지만 네 관심사(술어·로더·probe·채점)가 같은 데이터 스키마를 공유해 함께 바뀐다. 더 쪼개면 스키마 지식이 파일 사이에 흩어진다.

---

## Task 1: 신뢰등급 모듈 (`trust.js`)

**Files:**
- Create: `src/trust.js`
- Test: `test/trust.test.js`

**Interfaces:**
- Consumes: `uff.topologyKey`
- Produces:
  - `TRUST: Record<'geometry'|'relative'|'blocked', { key, badge, label, note }>`
  - `sameTopology(molA, molB): boolean`
  - `trustFor(valueKind: string, crossTopology: boolean): TrustEntry` — `valueKind`는 `'angle'|'dihedral'|'distance'|'formula'|'topologyEqual'|'barrier'|'energy'`
  - `assertComparable(molA, molB, context: string): void` — 위상이 다르면 throw

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/trust.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRUST, sameTopology, trustFor, assertComparable } from '../src/trust.js';
import { loadPreset } from '../src/presets.js';

test('기하량은 항상 geometry 등급이다', () => {
  for (const kind of ['angle', 'dihedral', 'distance', 'formula', 'topologyEqual']) {
    assert.equal(trustFor(kind, false).key, 'geometry');
    assert.equal(trustFor(kind, true).key, 'geometry');
  }
});

test('배좌 장벽은 위상이 달라도 relative로 허용된다', () => {
  assert.equal(trustFor('barrier', false).key, 'relative');
  assert.equal(trustFor('barrier', true).key, 'relative');
});

test('총에너지는 같은 위상에서만 relative, 다르면 blocked', () => {
  assert.equal(trustFor('energy', false).key, 'relative');
  assert.equal(trustFor('energy', true).key, 'blocked');
});

test('sameTopology는 좌표가 달라도 위상이 같으면 참', () => {
  const a = loadPreset('butane');
  const b = loadPreset('butane');
  b.atoms[0].pos = [9, 9, 9];
  assert.equal(sameTopology(a, b), true);
  assert.equal(sameTopology(loadPreset('ethane'), loadPreset('ethylene')), false);
});

test('assertComparable은 위상이 다르면 throw한다', () => {
  assert.throws(
    () => assertComparable(loadPreset('ethane'), loadPreset('ethylene'), 'ch99-test'),
    /ch99-test/,
  );
  assert.doesNotThrow(() => assertComparable(loadPreset('ethane'), loadPreset('ethane'), 'ok'));
});

test('relative 등급 문구에 UFF 과대평가 경고가 들어 있다', () => {
  assert.match(TRUST.relative.note, /과대평가/);
});

test('알 수 없는 valueKind는 throw한다', () => {
  assert.throws(() => trustFor('pKa', false), /pKa/);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/trust.test.js`
Expected: FAIL — `Cannot find module '../src/trust.js'`

- [ ] **Step 3: 최소 구현을 쓴다**

`src/trust.js`:

```js
// 학습 플랫폼의 신뢰는 "무엇을 모르는지 말하는 것"에서 나온다.
// 화면에 나가는 모든 수치에 등급을 붙이고, 🔴는 아예 표시하지 않는다.
import { topologyKey } from './uff.js';

export const TRUST = {
  geometry: {
    key: 'geometry',
    badge: '🟢',
    label: '기하 — 신뢰',
    note: '결합각·결합길이·이면각은 UFF 평형값에서 직접 나옵니다.',
  },
  relative: {
    key: 'relative',
    badge: '🟡',
    label: '상대에너지 — 정성 비교용',
    note: 'UFF는 배좌 장벽을 과대평가합니다(부탄 syn: UFF 6–14, 문헌 4.5–6.1 kcal/mol). '
        + '순서만 참고하고 절대 수치는 신뢰하지 마십시오.',
  },
  blocked: {
    key: 'blocked',
    badge: '🔴',
    label: '비교 불가',
    note: '위상이 다른 두 구조의 총에너지, pKa, 반응 에너지, 전이상태는 이 모델의 범위 밖입니다.',
  },
};

// 좌표에서만 나오는 값 — 위상이 달라도 비교해도 된다.
const GEOMETRIC = new Set(['angle', 'dihedral', 'distance', 'formula', 'topologyEqual']);

export const sameTopology = (a, b) => topologyKey(a) === topologyKey(b);

// 배좌 장벽(barrier)은 각 분자 "내부"의 상대값이므로, 두 분자의 장벽을 나란히 놓는 것은
// 서로 다른 위상 사이에서도 성립한다. 총에너지(energy)만 위상 동일성을 요구한다.
export function trustFor(valueKind, crossTopology) {
  if (GEOMETRIC.has(valueKind)) return TRUST.geometry;
  if (valueKind === 'barrier') return TRUST.relative;
  if (valueKind === 'energy') return crossTopology ? TRUST.blocked : TRUST.relative;
  throw new Error(`trustFor: 알 수 없는 값 종류 "${valueKind}"`);
}

export function assertComparable(molA, molB, context) {
  if (!sameTopology(molA, molB)) {
    throw new Error(`${context}: 위상이 다른 두 구조의 총에너지는 비교할 수 없습니다`);
  }
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --test test/trust.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/trust.js test/trust.test.js
git commit -m "feat: 수치 신뢰등급 모듈 추가"
```

---

## Task 2: 술어 평가기 (`mission.js` 1부)

**Files:**
- Create: `src/mission.js`
- Test: `test/mission.test.js`

**Interfaces:**
- Consumes: `snap.formula`, `snap.stability`, `model.measure`, `model.findRings`, `model.neighbors`, `uff.topologyKey`, `uff.energy`
- Produces:
  - `evaluatePredicate(pred: object, ctx: Ctx): boolean`
  - `Ctx = { mol, selection: number[], answer: string|null, startTopology: string, startEnergy: number }`
  - `PREDICATE_NAMES: string[]` — Task 5의 스키마 검증이 쓴다

술어 12종과 조합자 `all`/`any`/`not`만 지원한다. 그 이상은 필요해질 때 추가한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/mission.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePredicate } from '../src/mission.js';
import { loadPreset } from '../src/presets.js';
import { setDihedral } from '../src/model.js';
import { topologyKey, energy } from '../src/uff.js';

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
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/mission.test.js`
Expected: FAIL — `Cannot find module '../src/mission.js'`

- [ ] **Step 3: 최소 구현을 쓴다**

`src/mission.js` (이 태스크에서 만드는 부분):

```js
// 미션 채점기. 화학 판정은 전부 기존 함수에 위임하고, 여기서는 그것을 선언형으로 엮는다.
// DOM을 모른다 — mission-ui.js만 화면을 만진다.
import { formula, stability } from './snap.js';
import { measure, findRings, neighbors } from './model.js';
import { topologyKey, energy } from './uff.js';

// 각도 구간 판정. 이면각만 순환(cyclic)이다 — measure()가 -180~180을 돌려주므로
// anti 배좌를 [150, 210]으로 적으면 -170°가 걸러진다. 360 법으로 정규화해야 한다.
function inWindow(value, [lo, hi], cyclic) {
  if (!cyclic) return value >= lo && value <= hi;
  const n = (x) => ((x % 360) + 360) % 360;
  const v = n(value), a = n(lo), b = n(hi);
  return a <= b ? (v >= a && v <= b) : (v >= a || v <= b);
}

const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

function bondOrderBetween(mol, i, j) {
  const b = mol.bonds.find((x) => (x.i === i && x.j === j) || (x.i === j && x.j === i));
  return b ? b.order : 0;
}

// { el, bonded: [{el, order}, ...] } 를 만족하는 원자가 하나라도 있는가.
// 이웃을 다중집합으로 소진시켜 매칭한다 — 같은 (원소, 차수) 쌍이 두 번 요구되면
// 실제로도 두 개가 있어야 한다.
function matchGroup(mol, spec) {
  for (let i = 0; i < mol.atoms.length; i++) {
    if (mol.atoms[i].el !== spec.el) continue;
    const pool = neighbors(mol, i).map((j) => ({
      el: mol.atoms[j].el,
      order: bondOrderBetween(mol, i, j),
    }));
    let ok = true;
    for (const want of spec.bonded) {
      const k = pool.findIndex((x) => x.el === want.el && x.order === want.order);
      if (k < 0) { ok = false; break; }
      pool.splice(k, 1);
    }
    if (ok) return true;
  }
  return false;
}

// 각 술어는 (arg, pred, ctx)를 받는다. arg는 술어 이름이 가리키는 값(pred[name])이다.
const PREDICATES = {
  formula: (arg, p, ctx) => formula(ctx.mol) === arg,
  topologyMatches: (arg, p, ctx) => topologyKey(ctx.mol) === ctx.startTopology,
  distance: (arg, p, ctx) => inWindow(measure(ctx.mol, arg), p.within, false),
  angle: (arg, p, ctx) => inWindow(measure(ctx.mol, arg), p.within, false),
  dihedral: (arg, p, ctx) => inWindow(measure(ctx.mol, arg), p.within, true),
  energyDelta: (arg, p, ctx) => inWindow(energy(ctx.mol).total - ctx.startEnergy, p.within, false),
  strainByType: (arg, p, ctx) => inWindow(energy(ctx.mol).byType[arg], p.within, false),
  noSevere: (arg, p, ctx) => !stability(ctx.mol).issues.some((x) => x.level === 'danger'),
  ringCount: (arg, p, ctx) => findRings(ctx.mol).length === arg,
  ringSize: (arg, p, ctx) => {
    const got = findRings(ctx.mol).map((r) => r.length).sort((x, y) => x - y);
    return sameSet(got, [...arg]);
  },
  hasGroup: (arg, p, ctx) => matchGroup(ctx.mol, arg),
  selectionEquals: (arg, p, ctx) => sameSet(ctx.selection, arg),
  answerEquals: (arg, p, ctx) => ctx.answer === arg,
};

export const PREDICATE_NAMES = Object.keys(PREDICATES);

export function evaluatePredicate(pred, ctx) {
  if (pred.all) return pred.all.every((p) => evaluatePredicate(p, ctx));
  if (pred.any) return pred.any.some((p) => evaluatePredicate(p, ctx));
  if (pred.not) return !evaluatePredicate(pred.not, ctx);
  const name = PREDICATE_NAMES.find((k) => k in pred);
  if (!name) throw new Error(`알 수 없는 술어: ${JSON.stringify(pred)}`);
  return PREDICATES[name](pred[name], pred, ctx);
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --test test/mission.test.js`
Expected: PASS (13 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/mission.js test/mission.test.js
git commit -m "feat: 미션 술어 평가기 추가"
```

---

## Task 3: 시작구조 로더 (`mission.js` 2부)

**Files:**
- Modify: `src/mission.js` (Task 2 파일 끝에 추가)
- Test: `test/mission.test.js` (Task 2 파일 끝에 추가)

**Interfaces:**
- Consumes: `presets.loadPreset`, `presets.RING_TEMPLATES`, `model.createMolecule/addAtom/addBond/setDihedral`, `snap.syncHydrogens`, `uff.minimize`
- Produces: `loadStart(start: StartSpec): Molecule`

```
StartSpec = {
  preset?: string,                          // PRESETS 키
  ringTemplate?: string,                    // RING_TEMPLATES 키
  atoms?: [el, [x,y,z]][],                  // 무거운 원자 골격
  bonds?: [i, j, order?][],
  replace?: { atom: number, el: string }[], // 원소 교체(삭제 없음)
  setDihedral?: { atoms: [number,number,number,number], deg: number },
  flipZ?: boolean,
  syncH?: boolean,
  relax?: boolean,
}
```

**불변식: 시작구조 변환은 원자를 삭제하지 않는다.** `addAtom`은 항상 뒤에 붙고 `syncHydrogens`의 채우기도 뒤에 붙으므로, `replace`가 가리키는 인덱스와 골격 인덱스는 변환 뒤에도 그대로다. 미션의 `check`·`probe`가 인덱스를 쓸 수 있는 근거다. `syncHydrogens`는 과잉 수소를 **떼기도** 하므로, 원소 교체로 원자가가 줄어드는 변환(예: C→O)은 쓰지 않는다 — 그런 구조는 골격 리터럴로 직접 적는다.

적용 순서: materialize → replace → setDihedral → flipZ → syncH → relax.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/mission.test.js` 끝에 추가:

```js
import { loadStart } from '../src/mission.js';
import { formula } from '../src/snap.js';
import { measure as measure3 } from '../src/model.js';

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
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/mission.test.js`
Expected: FAIL — `loadStart is not a function` (또는 import 오류)

- [ ] **Step 3: 최소 구현을 쓴다**

`src/mission.js` 상단 import에 추가:

```js
import { createMolecule, addAtom, addBond, setDihedral } from './model.js';
import { syncHydrogens } from './snap.js';
import { minimize } from './uff.js';
import { loadPreset, RING_TEMPLATES } from './presets.js';
```

(기존 `import { measure, findRings, neighbors } from './model.js';`와 `import { formula, stability } from './snap.js';`는 위 목록으로 합쳐서 각 모듈당 import 한 줄이 되게 정리한다.)

파일 끝에 추가:

```js
// ---- 시작구조 로더 --------------------------------------------------------
// 미션 데이터를 사람이 읽고 diff할 수 있게, base64 상태 문자열이 아니라 선언형으로 적는다.
// 무거운 원자 골격만 쓰고 syncH가 수소를 채우므로 리터럴이 짧다.
//
// 불변식: 이 함수는 원자를 삭제하지 않는다. addAtom과 syncHydrogens의 채우기는 항상
// 뒤에 붙으므로 골격 인덱스와 replace 인덱스는 변환 뒤에도 그대로다 —
// 미션의 check·probe가 인덱스를 쓸 수 있는 근거다.
function materialize(start) {
  if (start.preset) return loadPreset(start.preset);
  if (start.ringTemplate) {
    const t = RING_TEMPLATES[start.ringTemplate];
    if (!t) throw new Error(`알 수 없는 고리 템플릿: ${start.ringTemplate}`);
    const m = createMolecule();
    for (const [el, pos, type] of t.atoms) {
      const idx = addAtom(m, el, pos);
      if (type) m.atoms[idx].type = type;
    }
    for (const [i, j, order] of t.bonds) addBond(m, i, j, order ?? 1);
    return m;
  }
  if (start.atoms) {
    const m = createMolecule();
    for (const [el, pos] of start.atoms) addAtom(m, el, pos);
    for (const [i, j, order] of start.bonds ?? []) addBond(m, i, j, order ?? 1);
    return m;
  }
  throw new Error('시작구조를 만들 수 없습니다: preset·ringTemplate·atoms 중 하나가 필요합니다');
}

export function loadStart(start) {
  const mol = materialize(start);
  for (const r of start.replace ?? []) mol.atoms[r.atom].el = r.el;
  if (start.setDihedral) setDihedral(mol, start.setDihedral.atoms, start.setDihedral.deg);
  if (start.flipZ) for (const a of mol.atoms) a.pos = [a.pos[0], a.pos[1], -a.pos[2]];
  if (start.syncH) syncHydrogens(mol);
  if (start.relax) minimize(mol, { maxSteps: 400 });
  return mol;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --test test/mission.test.js`
Expected: PASS (21 tests)

`replace` 후 `formula`가 `C7H14`인지 확인하는 테스트가 핵심이다 — H7을 C로 바꾸면 그 탄소에 H 3개가 붙어 메틸사이클로헥세인(C7H14)이 되어야 한다. 값이 다르면 `syncHydrogens`가 기대와 다르게 동작하는 것이므로 진행 전에 원인을 찾는다.

- [ ] **Step 5: 커밋**

```bash
git add src/mission.js test/mission.test.js
git commit -m "feat: 선언형 시작구조 로더 추가"
```

---

## Task 4: probe 실행기 (`mission.js` 3부)

**Files:**
- Modify: `src/mission.js`
- Test: `test/mission.test.js`

**Interfaces:**
- Consumes: Task 3의 `loadStart`, Task 1의 `trustFor`/`sameTopology`, `uff.minimize/energy/scanDihedral`, `model.measure`, `snap.formula`, `uff.topologyKey`
- Produces:
  - `runProbe(probe: ProbeSpec): { rows: Row[], trust: TrustEntry }`
  - `Row = { label: string, text: string }`

```
ProbeSpec = {
  kind: 'minimize' | 'scanDihedral' | 'measure',
  states: StartSpec[],                 // 1개 또는 2개
  scan?: { atoms: [n,n,n,n], stepDeg?: number },   // kind==='scanDihedral'
  report: { label: string, value: ValueKind, atoms?: number[], state?: 0|1 }[],
}
ValueKind = 'energy' | 'barrier' | 'angle' | 'dihedral' | 'distance' | 'formula' | 'topologyEqual'
```

`report[k].state`는 어느 상태의 값인지(기본 0). `topologyEqual`은 상태 두 개를 요구하며 `atoms`를 쓰지 않는다.

**신뢰 가드:** 상태가 2개이고 위상이 다른데 `value: 'energy'`를 리포트하려 하면 `assertComparable`이 throw한다. 이것이 스펙 §8의 강제 지점이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/mission.test.js` 끝에 추가:

```js
import { runProbe } from '../src/mission.js';

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
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/mission.test.js`
Expected: FAIL — `runProbe is not a function`

- [ ] **Step 3: 최소 구현을 쓴다**

`src/mission.js` import에 추가: `import { topologyKey, energy, minimize, scanDihedral } from './uff.js';` (Task 2·3의 uff import와 합친다), `import { trustFor, sameTopology, assertComparable } from './trust.js';`

파일 끝에 추가:

```js
// ---- probe: predict 미션이 답 확정 후 돌리는 스크립트 계산 ----------------
// 학생이 직접 조작할 필요가 없다. 잠그기 전에는 이 결과를 어떤 형태로도 노출하지 않는다.
const FIXED = 2;

function probeValue(kind, mols, r, scan) {
  const mol = mols[r.state ?? 0];
  if (kind === 'scanDihedral' && r.value === 'barrier') {
    const profile = scanDihedral(mol, scan.atoms, { stepDeg: scan.stepDeg ?? 30 });
    return `${Math.max(...profile.map((p) => p.relative)).toFixed(FIXED)} kcal/mol`;
  }
  switch (r.value) {
    case 'energy': return `${energy(mol).total.toFixed(FIXED)} kcal/mol`;
    case 'angle':
    case 'dihedral': return `${measure(mol, r.atoms).toFixed(1)}°`;
    case 'distance': return `${measure(mol, r.atoms).toFixed(3)} Å`;
    case 'formula': return formula(mol);
    case 'topologyEqual': return sameTopology(mols[0], mols[1]) ? '같습니다' : '다릅니다';
    default: throw new Error(`probe: 알 수 없는 값 종류 "${r.value}"`);
  }
}

export function runProbe(probe) {
  const mols = probe.states.map((s) => loadStart(s));
  if (probe.kind === 'minimize') for (const m of mols) minimize(m, { maxSteps: 400 });

  const cross = mols.length === 2 && !sameTopology(mols[0], mols[1]);
  if (cross && probe.report.some((r) => r.value === 'energy')) {
    assertComparable(mols[0], mols[1], 'probe');
  }
  if (probe.report.some((r) => r.value === 'topologyEqual') && mols.length !== 2) {
    throw new Error('probe: topologyEqual 리포트는 상태 두 개가 필요합니다');
  }

  const rows = probe.report.map((r) => ({
    label: r.label,
    text: probeValue(probe.kind, mols, r, probe.scan),
  }));
  // 화면에는 가장 약한 등급 하나를 붙인다 — 강한 등급이 약한 것을 가리면 안 된다.
  const rank = { geometry: 0, relative: 1, blocked: 2 };
  const trust = probe.report
    .map((r) => trustFor(r.value, cross))
    .reduce((a, b) => (rank[b.key] > rank[a.key] ? b : a));
  return { rows, trust };
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --test test/mission.test.js`
Expected: PASS (26 tests)

에틸렌 장벽 테스트가 느리면(`scanDihedral`은 기본 relax=false라 빠르다) `stepDeg`를 30으로 유지한다.

- [ ] **Step 5: 커밋**

```bash
git add src/mission.js test/mission.test.js
git commit -m "feat: probe 실행기와 신뢰등급 가드 추가"
```

---

## Task 5: 채점·진단·힌트·스키마 검증 (`mission.js` 4부)

**Files:**
- Modify: `src/mission.js`
- Test: `test/mission.test.js`

**Interfaces:**
- Consumes: Task 2 `evaluatePredicate`/`PREDICATE_NAMES`, Task 3 `loadStart`
- Produces:
  - `makeContext(mission, { mol, selection, answer }): Ctx`
  - `evaluate(mission, input): { pass: boolean, diagnostic: string|null }`
  - `maxHintLevel(attempts: number): number`
  - `validateMission(mission): void` — 위반 시 throw
  - `MISSION_TYPES: string[]`

채점 실패 시 `diagnostics`를 선언 순서대로 검사해 **첫 매칭 하나만** 반환한다. 매칭이 없으면 실패한 술어 이름의 일반 메시지를 만든다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/mission.test.js` 끝에 추가:

```js
import { evaluate, maxHintLevel, validateMission } from '../src/mission.js';

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
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/mission.test.js`
Expected: FAIL — `evaluate is not a function`

- [ ] **Step 3: 최소 구현을 쓴다**

`src/mission.js` 파일 끝에 추가:

```js
// ---- 채점 ----------------------------------------------------------------
export const MISSION_TYPES = ['build', 'measure', 'predict', 'classify'];

// 술어별 일반 실패 메시지. 지정 진단이 없을 때만 쓴다.
const GENERIC = {
  formula: '분자식이 목표와 다릅니다.',
  topologyMatches: '연결 방식이 시작 구조와 달라졌습니다. 배좌만 바꾸면 되는 미션입니다.',
  distance: '지정한 두 원자 사이의 거리가 목표 범위 밖입니다.',
  angle: '지정한 결합각이 목표 범위 밖입니다.',
  dihedral: '이면각이 목표 범위 밖입니다.',
  energyDelta: '에너지 변화가 목표 범위 밖입니다.',
  strainByType: '해당 스트레인 항이 목표 범위 밖입니다.',
  noSevere: '심각한 문제가 있는 원자가 남아 있습니다. 빨간 글로우를 확인하세요.',
  ringCount: '고리 개수가 목표와 다릅니다.',
  ringSize: '고리 크기가 목표와 다릅니다.',
  hasGroup: '목표 작용기가 보이지 않습니다.',
  selectionEquals: '요청한 원자를 선택하지 않았습니다. 측정 대상을 다시 고르세요.',
  answerEquals: '선택한 답이 맞지 않습니다.',
};

// 실패한 술어 중 첫 번째를 찾아 일반 메시지를 만든다. all 트리를 깊이 우선으로 훑는다.
function firstFailure(pred, ctx) {
  if (pred.all) {
    for (const p of pred.all) { const f = firstFailure(p, ctx); if (f) return f; }
    return null;
  }
  if (pred.any) return pred.any.some((p) => evaluatePredicate(p, ctx)) ? null : pred.any[0];
  if (pred.not) return evaluatePredicate(pred, ctx) ? null : pred;
  return evaluatePredicate(pred, ctx) ? null : pred;
}

export function makeContext(mission, { mol, selection, answer }) {
  const start = loadStart(mission.start);
  return {
    mol,
    selection: selection ?? [],
    answer: answer ?? null,
    startTopology: topologyKey(start),
    startEnergy: energy(start).total,
  };
}

export function evaluate(mission, input) {
  const ctx = makeContext(mission, input);
  const check = mission.check ?? { answerEquals: mission.answer };
  if (evaluatePredicate(check, ctx)) return { pass: true, diagnostic: null };

  for (const d of mission.diagnostics ?? []) {
    if (evaluatePredicate(d.when, ctx)) return { pass: false, diagnostic: d.message };
  }
  const failed = firstFailure(check, ctx);
  const name = failed && PREDICATE_NAMES.find((k) => k in failed);
  return { pass: false, diagnostic: GENERIC[name] ?? '아직 목표에 도달하지 않았습니다.' };
}

// 힌트는 한 번에 한 단계씩만 열린다. 정답(4단)은 3회 시도 후에만 —
// 즉시 열면 미션이 무의미해지고, 끝까지 막으면 학생이 이탈한다.
export const maxHintLevel = (attempts) => (attempts >= 3 ? 4 : 3);

// ---- 스키마 검증 ---------------------------------------------------------
// 저작 오류는 학생에게 보이기 전에 테스트에서 죽어야 한다.
function walkPredicate(pred, id) {
  if (pred.all) return pred.all.forEach((p) => walkPredicate(p, id));
  if (pred.any) return pred.any.forEach((p) => walkPredicate(p, id));
  if (pred.not) return walkPredicate(pred.not, id);
  if (!PREDICATE_NAMES.some((k) => k in pred)) {
    throw new Error(`${id}: 알 수 없는 술어 ${JSON.stringify(pred)}`);
  }
}

export function validateMission(m) {
  const id = m.id ?? '(id 없음)';
  for (const f of ['id', 'chapter', 'concept', 'type', 'title', 'brief', 'start']) {
    if (m[f] === undefined) throw new Error(`${id}: 필수 필드 누락 — ${f}`);
  }
  if (!MISSION_TYPES.includes(m.type)) throw new Error(`${id}: 알 수 없는 type "${m.type}"`);
  if (!Array.isArray(m.hints) || m.hints.length < 4) {
    throw new Error(`${id}: 힌트는 4단계여야 합니다`);
  }
  if (!['geometry', 'relative'].includes(m.trust)) {
    throw new Error(`${id}: trust는 geometry 또는 relative여야 합니다`);
  }
  if (m.type === 'build' && !m.check) throw new Error(`${id}: build 미션에는 check가 필요합니다`);
  if (m.type !== 'build') {
    // 선택지는 비어 있지만 않으면 된다 — 개수 하한은 미션 데이터 쪽에서 볼 문제다.
    // (초안은 여기서 >= 2를 요구했는데, 위 테스트 두 개가 선택지 1개짜리 가짜 미션을 쓰므로
    //  모순이었다. 실제 미션의 >= 2 하한은 Task 7의 mission-data 테스트가 강제한다.)
    if (!Array.isArray(m.choices) || m.choices.length === 0) {
      throw new Error(`${id}: ${m.type} 미션에는 선택지가 필요합니다`);
    }
    if (!m.choices.some((c) => c.id === m.answer)) {
      throw new Error(`${id}: answer "${m.answer}"가 choices에 없습니다`);
    }
  }
  if (m.check) walkPredicate(m.check, id);
  for (const d of m.diagnostics ?? []) {
    if (!d.when || !d.message) throw new Error(`${id}: diagnostics 항목에 when·message가 필요합니다`);
    walkPredicate(d.when, id);
  }
  loadStart(m.start);                 // 시작구조가 실제로 만들어지는지
  if (m.probe) runProbe(m.probe);     // 신뢰등급 가드가 여기서 throw한다
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --test test/mission.test.js`
Expected: PASS (37 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/mission.js test/mission.test.js
git commit -m "feat: 미션 채점·오답 진단·힌트 해금·스키마 검증 추가"
```

---

## Task 6: 시드 미션 1–5 (`mission-data.js`)

**Files:**
- Create: `src/mission-data.js`
- Test: `test/mission-data.test.js`

**Interfaces:**
- Consumes: Task 5 `validateMission`, Task 3 `loadStart`
- Produces: `MISSIONS: Mission[]` (이 태스크에서 5개, Task 7에서 10개로), `missionById(id): Mission`

담당 미션: Ch1 VSEPR(predict) · Ch1 이성질체(classify) · Ch2 부탄 anti(build) · Ch2 의자 axial/equatorial(predict) · Ch3 π 회전장벽(predict).

**Ch2 의자 미션의 근거 (구현 중 초안이 틀린 것으로 판명 — 아래가 최종):**

`cyclohexane_chair`에서 C0의 두 수소는 인덱스 6·7이고, 실측한 고리 평면 법선과의 각은 **H6 = 69.67°(equatorial), H7 = 0.74°(axial)**다. 여기까지는 초안이 맞았다.

**틀린 것은 `flipZ`로 고리를 뒤집으려 한 부분이다.** 분자 전체의 z를 뒤집는 것은 순수 거울반사여서 내부 기하가 전부 보존된다 — 실측 결과 두 상태의 메틸이 똑같이 axial(9.32°)이었고 에너지도 비트 단위로 같았다(11.375 = 11.375). 진짜 고리 뒤집기는 고리 z를 뒤집으면서 **각 탄소의 두 치환기 자리를 맞바꿔야** 하는데 `flipZ`는 앞부분만 한다.

`replace`로 H6·H7을 각각 치환하는 우회로도 쓸 수 없다. `topologyKey`가 원자 인덱스 순서를 반영하므로 `…,H,C,…` vs `…,C,H,…`가 **다른 위상으로 읽혀** 같은 분자 하나가 🔴로 오탐된다.

최종 구현: 두 상태 모두 **무거운 원자 골격 리터럴**(고리 탄소 6개 + 메틸 탄소 인덱스 6, `syncH`, `relax`)로 만들고, 메틸 좌표만 axial 방향 `[1.27, 0.74, 1.78]` / equatorial 방향 `[2.50, 1.44, -0.28]`으로 달리한다. 원자 순서가 같아 `topologyKey`가 보존되고 🟡 비교가 정당해진다. 일치환 사이클로헥세인에서 "같은 의자의 다른 자리"는 고리 뒤집기와 기하학적으로 동일하다.

실측 확인: axial 9.28° / equatorial 70.36°, E = 11.375 / 8.348 (gap 3.03 kcal/mol, 문헌 ~1.7 — UFF가 1.8배 과대평가. 튜닝하지 않는다. 순서만 미션의 주장이고, 격차 자체는 🟡 배지가 설명한다).

아래 테스트가 이 axial/equatorial 판정을 고리 법선 각으로 실제 검증한다.

**`flipZ`는 결국 어떤 미션도 쓰지 않는다.** Task 7 완료 후 `loadStart`에서 제거한다(Task 7 Step 5).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/mission-data.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MISSIONS, missionById } from '../src/mission-data.js';
import { validateMission, loadStart, evaluate, runProbe } from '../src/mission.js';
import { measure } from '../src/model.js';
import { sub, unit, cross, dot } from '../src/geom.js';
import { formula } from '../src/snap.js';

test('모든 미션이 스키마 검증을 통과한다', () => {
  for (const m of MISSIONS) validateMission(m);
});

test('미션 id는 중복되지 않는다', () => {
  assert.equal(new Set(MISSIONS.map((m) => m.id)).size, MISSIONS.length);
});

// 고리 평면 법선과 C0->치환기 벡터가 이루는 각. 45° 미만이면 axial이다.
function axialAngle(mol, ringIdx, centerIdx, subIdx) {
  const p = ringIdx.map((i) => mol.atoms[i].pos);
  const n = unit(cross(sub(p[2], p[0]), sub(p[4], p[0])));
  const v = unit(sub(mol.atoms[subIdx].pos, mol.atoms[centerIdx].pos));
  const c = Math.abs(dot(n, v));
  return Math.acos(Math.min(1, c)) * 180 / Math.PI;
}

test('ch02: 상태 0은 axial-메틸, flipZ 상태는 equatorial-메틸이다', () => {
  const m = missionById('ch02-chair-axial-equatorial');
  const ring = [0, 1, 2, 3, 4, 5];
  const ax = loadStart(m.probe.states[0]);
  const eq = loadStart(m.probe.states[1]);
  assert.ok(axialAngle(ax, ring, 0, 7) < 45, 'state 0의 메틸은 axial이어야 한다');
  assert.ok(axialAngle(eq, ring, 0, 7) > 45, 'state 1의 메틸은 equatorial이어야 한다');
  assert.equal(formula(ax), 'C7H14');
});

test('ch02: equatorial이 실제로 더 안정하다 (미션의 정답 근거)', () => {
  const m = missionById('ch02-chair-axial-equatorial');
  const out = runProbe(m.probe);
  const kcal = (label) => Number(out.rows.find((r) => r.label === label).text.match(/-?[\d.]+/)[0]);
  assert.ok(kcal('equatorial') < kcal('axial'));
  assert.equal(out.trust.key, 'relative');
});

test('ch02: 부탄 anti 미션은 정답/오답을 가른다', () => {
  const m = missionById('ch02-butane-anti');
  const gauche = loadStart(m.start);
  assert.equal(evaluate(m, { mol: gauche, selection: [], answer: null }).pass, false);
  const anti = loadStart({ preset: 'butane' });
  assert.equal(evaluate(m, { mol: anti, selection: [], answer: null }).pass, true);
});

test('ch01: 물 미션의 probe가 104.5° 부근을 낸다', () => {
  const out = runProbe(missionById('ch01-water-vsepr').probe);
  const deg = Number(out.rows[0].text.match(/[\d.]+/)[0]);
  assert.ok(deg > 100 && deg < 110, `기대 ~104.5°, 실제 ${deg}`);
});

test('ch01: 이성질체 미션의 두 상태는 분자식이 같고 위상이 다르다', () => {
  const out = runProbe(missionById('ch01-structural-isomer').probe);
  assert.equal(out.rows[0].text, 'C4H10');
  assert.equal(out.rows[1].text, 'C4H10');
  assert.equal(out.rows[2].text, '다릅니다');
});

test('ch03: 에틸렌 회전장벽이 에탄보다 훨씬 크다', () => {
  const out = runProbe(missionById('ch03-pi-rotation').probe);
  const val = (s) => Number(out.rows.find((r) => r.label.includes(s)).text.match(/[\d.]+/)[0]);
  assert.ok(val('에틸렌') > val('에탄') * 3);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/mission-data.test.js`
Expected: FAIL — `Cannot find module '../src/mission-data.js'`

- [ ] **Step 3: 최소 구현을 쓴다**

`src/mission-data.js`:

```js
// 시드 미션. 전부 molcraft-gap.md §5의 "즉시 가능" 항목이라 현재 엔진으로 정직하게 성립한다.
// Ch5(입체)·Ch10(아마이드)·Ch12(스펙트럼)·Ch13(헤테로고리)·Ch17(단백질)은 의도적으로 뺐다 —
// 지금 엔진으로 다루면 틀리게 가르치게 된다(CIP 부재, 아마이드 비평면, 피롤 lone pair 오표시).

export const MISSIONS = [
  {
    id: 'ch01-water-vsepr',
    chapter: 1,
    concept: '전자 도메인과 VSEPR',
    type: 'predict',
    title: '물은 왜 직선이 아닌가',
    brief: '산소에 붙은 결합은 두 개뿐입니다. 그런데도 H–O–H가 180°가 아닌 이유를 먼저 예측하세요.',
    start: { preset: 'water' },
    choices: [
      { id: 'a', label: '180° — 결합이 둘이니 직선이다' },
      { id: 'b', label: '120° — 평면 삼각형의 일부다' },
      { id: 'c', label: '약 104.5° — 비공유 전자쌍 두 개가 자리를 차지한다' },
      { id: 'd', label: '90° — 산소의 p 궤도 각도 그대로다' },
    ],
    answer: 'c',
    probe: {
      kind: 'minimize',
      states: [{ preset: 'water' }],
      report: [{ label: '최적화 후 H–O–H', value: 'angle', atoms: [1, 0, 2] }],
    },
    hints: [
      'VSEPR이 세는 것은 결합이 아니라 전자 도메인입니다.',
      '산소의 비공유 전자쌍이 몇 개인지 세어 보세요. 붙이기 도구에서 보라색 자리로 보입니다.',
      '결합 2개 + 비공유쌍 2개 = 도메인 4개. 도메인 4개의 기본 배치는 정사면체(109.5°)입니다.',
      '정답은 약 104.5°입니다. 비공유쌍이 결합쌍보다 더 넓게 퍼져 결합각을 109.5°보다 좁힙니다.',
    ],
    trust: 'geometry',
  },

  {
    id: 'ch01-structural-isomer',
    chapter: 1,
    concept: '구조 이성질체',
    type: 'classify',
    title: 'n-부탄과 아이소부탄의 관계',
    brief: '두 분자는 분자식이 같습니다. 그렇다면 어떤 관계입니까?',
    start: { preset: 'butane' },
    choices: [
      { id: 'a', label: '같은 분자 — 배좌만 다르다' },
      { id: 'b', label: '구조 이성질체 — 원자 연결 방식이 다르다' },
      { id: 'c', label: '거울상 이성질체' },
      { id: 'd', label: '분자식이 애초에 다르다' },
    ],
    answer: 'b',
    probe: {
      kind: 'measure',
      states: [
        { preset: 'butane' },
        {
          atoms: [['C', [0, 0, 0]], ['C', [1.53, 0, 0]],
                  ['C', [-0.5, 1.45, 0]], ['C', [-0.5, -0.7, 1.26]]],
          bonds: [[0, 1], [0, 2], [0, 3]],
          syncH: true, relax: true,
        },
      ],
      report: [
        { label: 'n-부탄 분자식', value: 'formula', state: 0 },
        { label: '아이소부탄 분자식', value: 'formula', state: 1 },
        { label: '연결 방식이 같은가', value: 'topologyEqual' },
      ],
    },
    hints: [
      '배좌는 결합을 끊지 않고 회전만으로 서로 바뀝니다.',
      '아이소부탄의 가운데 탄소에는 탄소가 몇 개 붙어 있는지 세어 보세요.',
      'n-부탄은 사슬(각 탄소에 탄소 최대 2개), 아이소부탄은 가지(가운데 탄소에 탄소 3개)입니다. 회전으로는 절대 바뀌지 않습니다.',
      '정답은 구조 이성질체입니다. 분자식은 같고(C4H10) 연결 방식이 다릅니다.',
    ],
    trust: 'geometry',
  },

  {
    id: 'ch02-butane-anti',
    chapter: 2,
    concept: '배좌와 스트레인',
    type: 'build',
    title: '부탄을 anti 배좌로 만들어라',
    brief: 'σ 결합은 자유롭게 회전합니다. 지금은 gauche입니다 — 가장 안정한 배치로 돌리세요.',
    start: { preset: 'butane', setDihedral: { atoms: [0, 1, 2, 3], deg: 60 } },
    check: {
      all: [
        { formula: 'C4H10' },
        { topologyMatches: 'start' },
        { dihedral: [0, 1, 2, 3], within: [150, 210] },
      ],
    },
    diagnostics: [
      {
        when: { dihedral: [0, 1, 2, 3], within: [40, 80] },
        message: 'gauche 배좌 그대로입니다. anti는 이면각 180° — 메틸 두 개가 정반대를 봐야 합니다.',
      },
      {
        when: { dihedral: [0, 1, 2, 3], within: [-20, 20] },
        message: 'syn(가려진) 배좌입니다. 가장 불안정한 배치예요. 180°까지 더 돌리세요.',
      },
      {
        when: { not: { formula: 'C4H10' } },
        message: '원자가 늘거나 줄었습니다. 이 미션은 회전만으로 풀립니다 — 실행취소(Ctrl+Z)하세요.',
      },
    ],
    hints: [
      '배좌는 σ 결합의 회전으로만 바뀝니다. 결합을 끊거나 원자를 붙일 필요가 없습니다.',
      '중심 C–C 결합(C1–C2)을 사이에 둔 이면각을 보세요.',
      '탄소 4개를 C0→C1→C2→C3 순서로 선택하면 우측 패널의 "이면각 회전" 슬라이더가 켜집니다.',
      '목표 이면각은 180°입니다.',
    ],
    trust: 'geometry',
  },

  {
    id: 'ch02-chair-axial-equatorial',
    chapter: 2,
    concept: '고리 배좌 — axial과 equatorial',
    type: 'predict',
    title: '메틸은 axial이 편한가 equatorial이 편한가',
    brief: '메틸사이클로헥세인의 의자 두 개는 같은 분자입니다. 어느 쪽이 더 안정할지 먼저 답하세요.',
    start: { preset: 'cyclohexane_chair', replace: [{ atom: 7, el: 'C' }], syncH: true, relax: true },
    choices: [
      { id: 'a', label: 'axial — 고리 축 방향이라 자리를 덜 차지한다' },
      { id: 'b', label: 'equatorial — 고리 바깥으로 뻗어 반발이 적다' },
      { id: 'c', label: '완전히 같다 — 같은 분자이므로' },
    ],
    answer: 'b',
    probe: {
      kind: 'minimize',
      states: [
        { preset: 'cyclohexane_chair', replace: [{ atom: 7, el: 'C' }], syncH: true, relax: true },
        { preset: 'cyclohexane_chair', replace: [{ atom: 7, el: 'C' }], flipZ: true, syncH: true, relax: true },
      ],
      report: [
        { label: 'axial', value: 'energy', state: 0 },
        { label: 'equatorial', value: 'energy', state: 1 },
      ],
    },
    hints: [
      '의자 뒤집기(ring flip)는 결합을 끊지 않습니다 — 같은 분자의 두 배좌입니다.',
      'axial 치환기는 고리 같은 면의 다른 axial 수소들과 마주 봅니다.',
      '그 마주 봄이 1,3-diaxial 반발입니다. equatorial에는 그런 상대가 없습니다.',
      'equatorial이 더 안정합니다. 메틸의 경우 실제 차이는 약 1.7 kcal/mol입니다.',
    ],
    trust: 'relative',
  },

  {
    id: 'ch03-pi-rotation',
    chapter: 3,
    concept: 'π 결합이 회전을 막는다',
    type: 'predict',
    title: '에탄과 에틸렌을 같은 각도로 비틀면',
    brief: '두 분자의 C–C 결합을 각각 끝까지 비틀어 봅니다. 회전 장벽이 어떻게 다를지 예측하세요.',
    start: { preset: 'ethylene' },
    choices: [
      { id: 'a', label: '거의 같다 — 둘 다 C–C 결합이다' },
      { id: 'b', label: '에탄이 훨씬 크다 — 수소가 더 많아서' },
      { id: 'c', label: '에틸렌이 훨씬 크다 — π 결합이 깨져야 하므로' },
    ],
    answer: 'c',
    probe: {
      kind: 'scanDihedral',
      states: [{ preset: 'ethane' }, { preset: 'ethylene' }],
      scan: { atoms: [2, 0, 1, 5], stepDeg: 30 },
      report: [
        { label: '에탄 회전 장벽', value: 'barrier', state: 0 },
        { label: '에틸렌 회전 장벽', value: 'barrier', state: 1 },
      ],
    },
    hints: [
      'σ 결합은 축 대칭이라 회전해도 겹침이 변하지 않습니다.',
      'π 결합은 축 위가 아니라 축의 위아래에서 겹칩니다.',
      '90°로 비틀면 두 p 궤도가 수직이 되어 π 겹침이 0이 됩니다 — 결합 하나를 깨는 셈입니다.',
      '에틸렌의 장벽이 압도적으로 큽니다. 에탄은 약 3 kcal/mol, 에틸렌은 그 수십 배입니다.',
    ],
    trust: 'relative',
  },
];

export const missionById = (id) => {
  const m = MISSIONS.find((x) => x.id === id);
  if (!m) throw new Error(`알 수 없는 미션: ${id}`);
  return m;
};
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --test test/mission-data.test.js`
Expected: PASS (8 tests)

**실패했을 때 확인할 것:**
- `ch02: 상태 0은 axial-메틸` 실패 → `cyclohexane_chair`의 axial 수소는 7이 아니다. 프리셋 좌표에서 C0(`[1.26, 0.73, 0.25]`)로부터 고리 평면 법선에 가까운 쪽 수소 인덱스를 찾아 `replace`의 `atom` 값을 그것으로 바꾸고, 테스트의 `subIdx`도 같이 바꾼다.
- `ch03` 장벽 비교 실패 → `scan.atoms`가 두 프리셋 모두에서 이어진 이면각인지 확인한다. 에탄은 H2–C0–C1–H5, 에틸렌은 H2–C0–C1–H4다. 인덱스가 다르면 상태별 scan이 필요하므로 `probe.scan`을 `scan: [{atoms}, {atoms}]` 배열로 확장하고 `probeValue`에서 `scan[r.state ?? 0]`을 쓰도록 Task 4를 함께 고친다.

- [ ] **Step 5: 커밋**

```bash
git add src/mission-data.js test/mission-data.test.js
git commit -m "feat: 시드 미션 5개 추가 (Ch1 VSEPR·이성질체, Ch2 배좌·의자, Ch3 pi 회전)"
```

---

## Task 7: 시드 미션 6–10 (`mission-data.js`)

**Files:**
- Modify: `src/mission-data.js`
- Test: `test/mission-data.test.js`

**Interfaces:**
- Consumes: Task 6의 `MISSIONS` 배열
- Produces: `MISSIONS`가 10개가 된다. 새 export 없음.

담당 미션: Ch4 벤젠 결합길이(measure) · Ch6 anti-periplanar(measure) · Ch8 고리 각 스트레인(predict) · Ch9 카보닐 sp²→sp³(build) · Ch15 cis/trans 알켄(predict).

**Ch6의 근거:** `cyclohexane_chair`에서 인접한 C0·C1의 axial 수소는 각각 7·8이며 고리 평면 기준 서로 반대편(+Z / −Z)이다. 둘을 Br로 바꾸면 **trans-1,2-다이브로모사이클로헥세인의 diaxial 배좌**가 되고, Br–C–C–Br 이면각이 anti-periplanar(≈180°)가 된다. E2가 요구하는 바로 그 기하다. 아래 테스트가 이 값을 직접 잰다.

**Ch8이 각도를 재는 이유:** 에폭사이드와 테트라하이드로피란은 위상이 다르므로 총에너지나 `byType.angle`을 비교하면 🔴다. 대신 각 분자의 C–O–C 결합각을 재서 sp³ 이상각(109.5°)에서 얼마나 벗어났는지를 본다 — 순수 기하량이라 🟢이고 개념은 그대로 전달된다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/mission-data.test.js` 끝에 추가:

```js
test('시드 미션은 10개이고 네 유형이 모두 쓰인다', () => {
  assert.equal(MISSIONS.length, 10);
  const types = new Set(MISSIONS.map((m) => m.type));
  for (const t of ['build', 'measure', 'predict', 'classify']) assert.ok(types.has(t), t);
});

// validateMission은 선택지가 비어 있지 않은지만 본다(가짜 미션을 쓰는 단위 테스트 때문).
// 실제 미션의 하한은 여기서 강제한다 — 선택지가 하나뿐인 문제는 문제가 아니다.
test('선택형 미션의 선택지는 2개 이상이다', () => {
  for (const m of MISSIONS.filter((x) => x.type !== 'build')) {
    assert.ok(m.choices.length >= 2, `${m.id}: 선택지 ${m.choices.length}개`);
  }
});

test('ch04: 벤젠 고리 결합은 여섯 개가 모두 같은 길이다', () => {
  const mol = loadStart(missionById('ch04-benzene-bond-length').start);
  const lens = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]].map((p) => measure(mol, p));
  const spread = Math.max(...lens) - Math.min(...lens);
  assert.ok(spread < 0.01, `결합 길이 편차 ${spread}`);
  assert.ok(Math.abs(lens[0] - 1.40) < 0.03, `기대 ~1.40 Å, 실제 ${lens[0]}`);
});

test('ch04: 올바른 결합을 선택하고 올바른 답을 고르면 통과', () => {
  const m = missionById('ch04-benzene-bond-length');
  const mol = loadStart(m.start);
  assert.equal(evaluate(m, { mol, selection: [1, 2], answer: 'b' }).pass, true);
  assert.equal(evaluate(m, { mol, selection: [1, 2], answer: 'a' }).pass, false);
  assert.equal(evaluate(m, { mol, selection: [0, 6], answer: 'b' }).pass, false); // C–H를 쟀다
});

test('ch06: trans-diaxial 다이브로마이드의 Br–C–C–Br이 anti-periplanar다', () => {
  const mol = loadStart(missionById('ch06-anti-periplanar').start);
  assert.equal(mol.atoms[7].el, 'Br');
  assert.equal(mol.atoms[8].el, 'Br');
  const d = Math.abs(measure(mol, [7, 0, 1, 8]));
  assert.ok(d > 150, `기대 ~180°, 실제 ${d}`);
});

test('ch08: 에폭사이드 C–O–C가 THP보다 훨씬 좁다', () => {
  const out = runProbe(missionById('ch08-ring-strain').probe);
  const deg = (s) => Number(out.rows.find((r) => r.label.includes(s)).text.match(/[\d.]+/)[0]);
  assert.ok(deg('에폭사이드') < 70, `기대 ~60°, 실제 ${deg('에폭사이드')}`);
  assert.ok(deg('테트라하이드로피란') > 100);
  assert.equal(out.trust.key, 'geometry');
});

test('ch09: 아세트알데하이드 시작 구조는 sp2 카보닐이다', () => {
  const mol = loadStart(missionById('ch09-carbonyl-addition').start);
  assert.equal(formula(mol), 'C2H4O');
  assert.ok(Math.abs(measure(mol, [0, 1, 2]) - 120) < 8);
});

test('ch09: 수화물(gem-다이올)을 만들면 통과한다', () => {
  const m = missionById('ch09-carbonyl-addition');
  const wrong = loadStart(m.start);
  assert.equal(evaluate(m, { mol: wrong, selection: [], answer: null }).pass, false);
  // O를 카보닐 탄소에 붙이고 C=O를 단일결합으로 낮춘 상태
  const right = loadStart({
    atoms: [['C', [0, 0, 0]], ['C', [1.52, 0, 0]], ['O', [2.14, 1.16, 0]], ['O', [2.14, -1.16, 0]]],
    bonds: [[0, 1], [1, 2], [1, 3]],
    syncH: true, relax: true,
  });
  assert.equal(formula(right), 'C2H6O2');
  assert.equal(evaluate(m, { mol: right, selection: [], answer: null }).pass, true);
});

test('ch15: trans-2-뷰텐이 cis보다 안정하고 위상은 같다', () => {
  const m = missionById('ch15-cis-trans-alkene');
  const out = runProbe(m.probe);
  const kcal = (s) => Number(out.rows.find((r) => r.label.includes(s)).text.match(/-?[\d.]+/)[0]);
  assert.ok(kcal('trans') < kcal('cis'));
  assert.equal(out.trust.key, 'relative'); // 위상이 같으므로 blocked이 아니다
});

test('ch15: cis 상태의 이면각이 실제로 0° 부근이다', () => {
  const m = missionById('ch15-cis-trans-alkene');
  const cis = loadStart(m.probe.states.find((s) => s.setDihedral?.deg === 0));
  assert.ok(Math.abs(measure(cis, [0, 1, 2, 3])) < 30);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/mission-data.test.js`
Expected: FAIL — `assert.equal(MISSIONS.length, 10)`이 5를 받는다

- [ ] **Step 3: 최소 구현을 쓴다**

`src/mission-data.js`의 `MISSIONS` 배열 끝(`ch03-pi-rotation` 뒤)에 추가:

```js
  {
    id: 'ch04-benzene-bond-length',
    chapter: 4,
    concept: '공명과 결합 길이 균등화',
    type: 'measure',
    title: '벤젠의 C–C 결합은 몇 종류인가',
    brief: '케쿨레 구조는 단일결합과 이중결합이 번갈아 있다고 말합니다. 고리 결합 하나를 직접 재고, 그 값이 뜻하는 바를 고르세요.',
    start: { ringTemplate: 'benzene' },
    choices: [
      { id: 'a', label: '두 종류 — 단일 1.54 Å와 이중 1.34 Å가 번갈아 나온다' },
      { id: 'b', label: '한 종류 — 여섯 개가 모두 약 1.40 Å로 같다' },
      { id: 'c', label: '여섯 개가 전부 제각각이다' },
    ],
    answer: 'b',
    check: {
      all: [
        {
          any: [
            { selectionEquals: [0, 1] }, { selectionEquals: [1, 2] }, { selectionEquals: [2, 3] },
            { selectionEquals: [3, 4] }, { selectionEquals: [4, 5] }, { selectionEquals: [5, 0] },
          ],
        },
        { answerEquals: 'b' },
      ],
    },
    diagnostics: [
      {
        when: { not: {
          any: [
            { selectionEquals: [0, 1] }, { selectionEquals: [1, 2] }, { selectionEquals: [2, 3] },
            { selectionEquals: [3, 4] }, { selectionEquals: [4, 5] }, { selectionEquals: [5, 0] },
          ],
        } },
        message: '고리를 이루는 탄소 두 개(이웃한 것)를 선택해야 합니다. C–H 결합이나 떨어진 원자를 고르면 안 됩니다.',
      },
    ],
    hints: [
      '고리 탄소 두 개를 선택하면 우측 "선택 측정"에 거리가 나옵니다.',
      '이웃한 고리 탄소 여러 쌍을 차례로 재서 값을 비교해 보세요.',
      '단일 C–C는 1.54 Å, 이중 C=C는 1.34 Å입니다. 잰 값은 그 사이입니다.',
      '여섯 결합이 모두 약 1.40 Å로 같습니다. 공명으로 π 전자가 고리 전체에 퍼져 있기 때문입니다.',
    ],
    trust: 'geometry',
  },

  {
    id: 'ch06-anti-periplanar',
    chapter: 6,
    concept: 'E2의 anti-periplanar 요구',
    type: 'measure',
    title: 'E2가 요구하는 기하를 재라',
    brief: 'trans-1,2-다이브로모사이클로헥세인의 diaxial 배좌입니다. 두 브로민 사이의 이면각을 재고, 그 값이 무엇을 뜻하는지 고르세요.',
    start: {
      preset: 'cyclohexane_chair',
      replace: [{ atom: 7, el: 'Br' }, { atom: 8, el: 'Br' }],
      syncH: true, relax: true,
    },
    choices: [
      { id: 'a', label: '약 60° — gauche 배치다' },
      { id: 'b', label: '약 180° — anti-periplanar다. E2가 요구하는 기하다' },
      { id: 'c', label: '약 90° — 수직이다' },
      { id: 'd', label: '약 0° — 겹쳐 있다(syn)' },
    ],
    answer: 'b',
    check: { all: [{ selectionEquals: [7, 0, 1, 8] }, { answerEquals: 'b' }] },
    diagnostics: [
      {
        when: { not: { selectionEquals: [7, 0, 1, 8] } },
        message: '브로민–탄소–탄소–브로민 네 원자를 순서대로 선택해야 이면각이 나옵니다.',
      },
    ],
    hints: [
      'E2는 이탈기와 β-수소가 같은 평면에서 정반대를 볼 때만 한 번에 일어납니다.',
      '두 브로민과 그 사이의 탄소 두 개, 모두 네 원자를 순서대로 선택하세요.',
      'Br–C–C–Br 순서로 고르면 "선택 측정"에 이면각이 나옵니다.',
      '약 180° — anti-periplanar입니다. 두 axial 치환기가 인접 탄소에서 정반대를 봅니다.',
    ],
    trust: 'geometry',
  },

  {
    id: 'ch08-ring-strain',
    chapter: 8,
    concept: '고리 크기와 각 스트레인',
    type: 'predict',
    title: '에폭사이드는 왜 그렇게 반응성이 큰가',
    brief: '삼원자 고리 에폭사이드와 육원자 고리 테트라하이드로피란의 C–O–C 각을 비교합니다. 먼저 예측하세요.',
    start: {
      atoms: [['C', [-0.74, -0.40, 0]], ['C', [0.74, -0.40, 0]], ['O', [0, 0.80, 0]]],
      bonds: [[0, 1], [0, 2], [1, 2]],
      syncH: true, relax: true,
    },
    choices: [
      { id: 'a', label: '둘 다 109.5° 부근 — sp³ 산소이므로' },
      { id: 'b', label: '에폭사이드가 훨씬 좁다 — 삼각형이라 60°에 가깝게 눌린다' },
      { id: 'c', label: '테트라하이드로피란이 더 좁다 — 고리가 크면 접히므로' },
    ],
    answer: 'b',
    probe: {
      kind: 'measure',
      states: [
        {
          atoms: [['C', [-0.74, -0.40, 0]], ['C', [0.74, -0.40, 0]], ['O', [0, 0.80, 0]]],
          bonds: [[0, 1], [0, 2], [1, 2]],
          syncH: true, relax: true,
        },
        {
          // cyclohexane_chair의 고리 좌표에서 한 자리를 산소로 바꾼 육원자 고리(옥세인).
          atoms: [
            ['O', [1.26, 0.73, 0.25]], ['C', [0.00, 1.46, -0.25]], ['C', [-1.26, 0.73, 0.25]],
            ['C', [-1.26, -0.73, -0.25]], ['C', [0.00, -1.46, 0.25]], ['C', [1.26, -0.73, -0.25]],
          ],
          bonds: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]],
          syncH: true, relax: true,
        },
      ],
      report: [
        { label: '에폭사이드 C–O–C', value: 'angle', atoms: [0, 2, 1], state: 0 },
        { label: '테트라하이드로피란 C–O–C', value: 'angle', atoms: [1, 0, 5], state: 1 },
      ],
    },
    hints: [
      'sp³ 원자가 원하는 결합각은 109.5°입니다.',
      '삼원자 고리는 삼각형입니다. 삼각형의 내각 합은 180°입니다.',
      '정삼각형이면 각 내각이 60° — sp³가 원하는 109.5°에서 약 50° 눌린 셈입니다.',
      '에폭사이드가 훨씬 좁습니다(≈60°). 이 각 스트레인이 고리를 열려는 반응의 구동력입니다.',
    ],
    trust: 'geometry',
  },

  {
    id: 'ch09-carbonyl-addition',
    chapter: 9,
    concept: '친핵성 첨가 — sp²에서 sp³로',
    type: 'build',
    title: '카보닐에 물을 더해 수화물을 만들어라',
    brief: '아세트알데하이드의 카보닐 탄소에 산소를 하나 더 붙이고, C=O를 단일결합으로 낮춰 gem-다이올(C2H6O2)을 만드세요.',
    start: {
      atoms: [['C', [0, 0, 0]], ['C', [1.50, 0, 0]], ['O', [2.14, 1.11, 0]]],
      bonds: [[0, 1], [1, 2, 2]],
      syncH: true, relax: true,
    },
    check: {
      all: [
        { formula: 'C2H6O2' },
        { hasGroup: { el: 'C', bonded: [{ el: 'C', order: 1 }, { el: 'O', order: 1 }, { el: 'O', order: 1 }, { el: 'H', order: 1 }] } },
        { noSevere: true },
      ],
    },
    diagnostics: [
      {
        when: { formula: 'C2H4O' },
        message: '아직 아무것도 붙지 않았습니다. 붙이기 도구에서 O를 골라 카보닐 탄소에 붙이세요.',
      },
      {
        when: { hasGroup: { el: 'O', bonded: [{ el: 'C', order: 2 }] } },
        message: 'C=O 이중결합이 남아 있습니다. 결합·차수 도구로 그 결합선을 클릭해 단일결합으로 낮추세요.',
      },
    ],
    hints: [
      '친핵체가 카보닐 탄소를 공격하면 π 결합의 전자쌍이 산소로 밀려납니다.',
      '그러면 그 탄소의 결합 상대가 3개에서 4개로 늘고, 남은 C=O는 C–O가 됩니다.',
      '① 붙이기 도구로 O를 카보닐 탄소에 붙인다 ② 결합·차수 도구로 C=O 선을 클릭해 단일로 낮춘다 ③ 수소 채우기를 누른다.',
      '완성 분자식은 C2H6O2입니다. 그 탄소의 결합각이 120°에서 109.5°로 바뀐 것을 "선택 측정"으로 확인하세요.',
    ],
    trust: 'geometry',
  },

  {
    id: 'ch15-cis-trans-alkene',
    chapter: 15,
    concept: 'cis 이중결합의 꺾임',
    type: 'predict',
    title: 'cis와 trans 중 어느 쪽이 안정한가',
    brief: '2-뷰텐의 두 기하 이성질체는 연결 방식이 같습니다. 어느 쪽이 더 안정할지 먼저 답하세요. 지방산의 융점이 여기서 갈립니다.',
    start: {
      atoms: [['C', [-1.50, 0.60, 0]], ['C', [-0.67, -0.45, 0]],
              ['C', [0.67, -0.45, 0]], ['C', [1.50, 0.60, 0]]],
      bonds: [[0, 1], [1, 2, 2], [2, 3]],
      syncH: true,
      setDihedral: { atoms: [0, 1, 2, 3], deg: 180 },
      relax: true,
    },
    choices: [
      { id: 'a', label: 'cis — 두 메틸이 가까워 서로 끌어당긴다' },
      { id: 'b', label: 'trans — 두 메틸이 정반대라 반발이 적다' },
      { id: 'c', label: '같다 — 같은 분자식이므로' },
    ],
    answer: 'b',
    probe: {
      kind: 'minimize',
      states: [
        {
          atoms: [['C', [-1.50, 0.60, 0]], ['C', [-0.67, -0.45, 0]],
                  ['C', [0.67, -0.45, 0]], ['C', [1.50, 0.60, 0]]],
          bonds: [[0, 1], [1, 2, 2], [2, 3]],
          syncH: true, setDihedral: { atoms: [0, 1, 2, 3], deg: 0 }, relax: true,
        },
        {
          atoms: [['C', [-1.50, 0.60, 0]], ['C', [-0.67, -0.45, 0]],
                  ['C', [0.67, -0.45, 0]], ['C', [1.50, 0.60, 0]]],
          bonds: [[0, 1], [1, 2, 2], [2, 3]],
          syncH: true, setDihedral: { atoms: [0, 1, 2, 3], deg: 180 }, relax: true,
        },
      ],
      report: [
        { label: 'cis (0°)', value: 'energy', state: 0 },
        { label: 'trans (180°)', value: 'energy', state: 1 },
      ],
    },
    hints: [
      'π 결합은 회전하지 않으므로 cis와 trans는 서로 변환되지 않습니다 — 별개의 화합물입니다.',
      'cis에서는 두 메틸이 이중결합의 같은 쪽에 있습니다. 얼마나 가까운지 보세요.',
      '가까운 두 덩어리 사이에는 반데르발스 반발이 생깁니다. trans에는 그 반발이 없습니다.',
      'trans가 더 안정합니다. 그래서 cis 지방산은 사슬이 꺾여 촘촘히 쌓이지 못하고, 융점이 낮아 상온에서 액체입니다.',
    ],
    trust: 'relative',
  },
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --test`
Expected: 전체 스위트 PASS (기존 테스트 + trust 7 + mission 37 + mission-data 17)

**실패했을 때 확인할 것:**
- `ch06` 이면각이 180°에서 멀다 → `cyclohexane_chair`의 인접 axial 수소 쌍이 7·8이 아니다. Task 6의 `axialAngle` 헬퍼로 C0·C1 각각의 axial 수소 인덱스를 찾아 `replace`와 테스트를 함께 고친다.
- `ch09` 통과 상태가 실패 → `hasGroup`이 요구하는 이웃 다중집합을 실제 구조와 대조한다. gem-다이올 탄소의 이웃은 C 1개(단일)·O 2개(단일)·H 1개다.
- `ch08` THP 각이 100° 미만 → `relax`의 `maxSteps`가 부족하다. `loadStart`의 400을 800으로 올린다(Task 3 수정).

- [ ] **Step 5: 커밋**

```bash
git add src/mission-data.js test/mission-data.test.js
git commit -m "feat: 시드 미션 5개 추가 (Ch4 벤젠, Ch6 E2, Ch8 고리 스트레인, Ch9 카보닐, Ch15 cis/trans)"
```

---

## Task 8: 미션 패널 UI (`mission-ui.js`)

**Files:**
- Create: `src/mission-ui.js`
- Test: 없음(DOM 모듈). 로직은 Task 2–7에서 이미 검증됐다. 화면 확인은 Task 9에서 한다.

**Interfaces:**
- Consumes: `mission-data.MISSIONS`, `mission.evaluate/maxHintLevel/loadStart/runProbe/validateMission`. 등급 문구는 `runProbe`가 결과에 실어 주므로 `trust.js`를 직접 import하지 않는다.
- Produces: `initMissionPanel(root: HTMLElement, hooks): void`

```
hooks = {
  loadMolecule(mol): void,      // app이 state.mol을 교체하고 다시 그린다
  getMolecule(): Molecule,
  getSelection(): number[],
}
```

- [ ] **Step 1: 구현을 쓴다**

이 태스크는 순수 뷰라 실패 테스트를 먼저 쓰지 않는다. 채점·진단·힌트·probe는 전부 Task 2–7에서 테스트된 순수 함수이고, 여기서는 그것을 호출해 DOM에 옮기기만 한다.

`src/mission-ui.js`:

```js
// 미션 패널. 채점·진단·힌트·probe는 mission.js가 전부 처리하므로 여기서는 화면만 만든다.
import { MISSIONS } from './mission-data.js';
import { evaluate, maxHintLevel, loadStart, runProbe, validateMission } from './mission.js';

const LS_KEY = 'molcraft:progress';

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) ?? {}; }
  catch { return {}; }
}

function saveProgress(p) {
  // 저장 실패(용량 초과·프라이빗 모드)가 앱을 막으면 안 된다 — app.js의 saveLocal과 같은 정책이다.
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* 무시 */ }
}

const entryFor = (p, id) => p[id] ?? { status: 'todo', attempts: 0, hintLevel: 0 };
const STATUS_ICON = { todo: '·', failed: '✗', passed: '✓' };

export function initMissionPanel(root, hooks) {
  for (const m of MISSIONS) validateMission(m); // 저작 오류를 첫 화면에서 드러낸다
  let progress = loadProgress();
  let current = null;   // 진행 중 미션
  let answer = null;    // predict/classify/measure의 선택
  let locked = false;   // predict: 답을 확정했는가
  let probeRows = null;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  function renderList() {
    root.replaceChildren();
    root.append(el('h2', null, '미션'));

    const chapters = [...new Set(MISSIONS.map((m) => m.chapter))].sort((a, b) => a - b);
    const sel = el('select');
    sel.append(new Option('전체', 'all'));
    for (const c of chapters) sel.append(new Option(`${c}장`, String(c)));
    root.append(sel);

    const list = el('div', 'mission-list');
    root.append(list);

    const paint = () => {
      list.replaceChildren();
      const shown = MISSIONS.filter((m) => sel.value === 'all' || String(m.chapter) === sel.value)
        // 틀린 미션을 위로 올린다 — 오답 큐.
        .sort((a, b) => (entryFor(progress, b.id).status === 'failed' ? 1 : 0)
                      - (entryFor(progress, a.id).status === 'failed' ? 1 : 0));
      for (const m of shown) {
        const b = el('button', 'mission-item',
          `${STATUS_ICON[entryFor(progress, m.id).status]} ${m.chapter}장 · ${m.title}`);
        b.addEventListener('click', () => open(m));
        list.append(b);
      }
    };
    sel.addEventListener('change', paint);
    paint();
  }

  function open(m) {
    current = m;
    answer = null;
    locked = false;
    probeRows = null;
    hooks.loadMolecule(loadStart(m.start));
    renderCard();
  }

  function renderCard() {
    const m = current;
    const st = entryFor(progress, m.id);
    root.replaceChildren();

    const back = el('button', 'mission-back', '← 미션 목록');
    back.addEventListener('click', () => { current = null; renderList(); });
    root.append(back);

    root.append(el('h2', null, m.title));
    root.append(el('div', 'mission-meta', `${m.chapter}장 · ${m.concept}`));
    root.append(el('p', 'mission-brief', m.brief));

    if (m.choices) {
      const box = el('div', 'mission-choices');
      for (const c of m.choices) {
        const b = el('button', 'mission-choice', c.label);
        if (answer === c.id) b.classList.add('active');
        b.disabled = locked;
        b.addEventListener('click', () => { answer = c.id; renderCard(); });
        box.append(b);
      }
      root.append(box);
    }

    const submit = el('button', 'mission-submit',
      m.type === 'predict' && !locked ? '답을 확정하고 계산 실행' : '제출');
    submit.addEventListener('click', onSubmit);
    root.append(submit);

    if (probeRows) {
      const box = el('div', 'mission-probe');
      box.append(el('h3', null, '계산 결과'));
      for (const r of probeRows.rows) box.append(el('div', null, `${r.label}: ${r.text}`));
      box.append(el('div', 'mission-trust',
        `${probeRows.trust.badge} ${probeRows.trust.label} — ${probeRows.trust.note}`));
      root.append(box);
    }

    if (st.message) {
      root.append(el('div', st.status === 'passed' ? 'mission-ok' : 'mission-bad', st.message));
    }

    const cap = maxHintLevel(st.attempts);
    const hintBtn = el('button', 'mission-hint',
      st.hintLevel >= cap ? `힌트 (${st.hintLevel}/${cap} — 더 시도해야 열립니다)` : '힌트 보기');
    hintBtn.disabled = st.hintLevel >= cap;
    hintBtn.addEventListener('click', () => {
      progress[m.id] = { ...st, hintLevel: st.hintLevel + 1 };
      saveProgress(progress);
      renderCard();
    });
    root.append(hintBtn);

    for (let i = 0; i < st.hintLevel; i++) {
      root.append(el('div', 'mission-hint-text', `${i + 1}. ${m.hints[i]}`));
    }
  }

  function onSubmit() {
    const m = current;
    const st = entryFor(progress, m.id);

    // predict는 답을 확정해 잠근 뒤에야 계산을 돌린다 — 먼저 보여주면 학습 효과가 사라진다.
    if (m.type === 'predict' && !locked) {
      if (!answer) return;
      locked = true;
      try { probeRows = runProbe(m.probe); }
      catch (e) { probeRows = { rows: [{ label: '오류', text: e.message }], trust: TRUST_FALLBACK }; }
    }

    let out;
    try {
      out = evaluate(m, {
        mol: hooks.getMolecule(),
        selection: hooks.getSelection(),
        answer,
      });
    } catch (e) {
      // 채점 오류는 학생의 오답이 아니다 — 시도 횟수에 넣지 않는다.
      progress[m.id] = { ...st, message: `채점 오류: ${e.message}` };
      saveProgress(progress);
      return renderCard();
    }

    progress[m.id] = {
      ...st,
      attempts: st.attempts + 1,
      status: out.pass ? 'passed' : 'failed',
      message: out.pass ? '통과했습니다.' : out.diagnostic,
    };
    saveProgress(progress);
    renderCard();
  }

  renderList();
}

const TRUST_FALLBACK = { badge: '🔴', label: '계산 실패', note: '이 미션의 계산을 실행할 수 없습니다.' };
```

- [ ] **Step 2: 문법 오류가 없는지 확인한다**

Run: `node --input-type=module -e "import('./src/mission-ui.js').then(()=>console.log('ok')).catch(e=>{console.error(e.message);process.exit(1)})"`
Expected: `document is not defined`가 **아니라** `ok` 또는 `localStorage is not defined`. 모듈 최상위에는 DOM 접근이 없으므로 import만으로는 실패하지 않아야 한다. 다른 오류가 나오면 그 줄을 고친다.

- [ ] **Step 3: 기존 테스트가 깨지지 않았는지 확인한다**

Run: `node --test`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add src/mission-ui.js
git commit -m "feat: 미션 패널 UI와 진도 저장 추가"
```

---

## Task 9: app 통합 + 신뢰등급 배지

**Files:**
- Modify: `index.html` (패널 섹션 추가, 스타일 추가)
- Modify: `src/app.js` (세 지점)
- Test: 수동 확인 절차 아래 명시

**Interfaces:**
- Consumes: `mission-ui.initMissionPanel`, `trust.TRUST`
- Produces: 없음(최종 통합)

`app.js`에 허용되는 변경은 이 세 가지뿐이다.
1. `mission-ui`·`trust` import
2. `initMissionPanel(...)` 호출 (`restoreOnLoad` 이후)
3. `updatePanels`에서 총에너지 옆에 신뢰등급 배지 붙이기

- [ ] **Step 1: `index.html`에 패널 자리와 스타일을 추가한다**

`index.html`의 `<aside>` 안, `<section><h2>총 에너지</h2>…</section>` **바로 위**에 추가:

```html
  <section id="mission"></section>
```

`<style>` 블록 끝에 추가:

```css
  #mission .mission-list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
  #mission .mission-item, #mission .mission-choice { text-align: left; width: 100%; }
  #mission .mission-choice.active { outline: 2px solid var(--accent, #4a9eff); }
  #mission .mission-meta { font-size: 12px; opacity: 0.7; }
  #mission .mission-brief { font-size: 13px; line-height: 1.5; }
  #mission .mission-choices { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
  #mission .mission-probe { margin-top: 8px; font-size: 13px; }
  #mission .mission-trust, #trust-badge { font-size: 11px; opacity: 0.85; line-height: 1.4; }
  #mission .mission-ok { color: #2e9e5b; font-size: 13px; margin-top: 8px; }
  #mission .mission-bad { color: #d1603d; font-size: 13px; margin-top: 8px; }
  #mission .mission-hint-text { font-size: 12px; opacity: 0.9; margin-top: 4px; }
```

`#total` 아래(같은 `<section>` 안, `<div id="warn">` 뒤)에 추가:

```html
    <div id="trust-badge"></div>
```

- [ ] **Step 2: `app.js`에 import를 추가한다**

`src/app.js`의 import 블록 끝(`import { renderSVG, layout, nextChainDir } from './sketch2d.js';` 뒤)에 추가:

```js
import { initMissionPanel } from './mission-ui.js';
import { TRUST } from './trust.js';
```

- [ ] **Step 3: 총에너지에 신뢰등급 배지를 붙인다**

`src/app.js`의 `updatePanels()` 안, `#total`을 채우는 줄 바로 뒤에 추가:

```js
  // 총에너지는 항상 "같은 위상 안에서의 상대 비교"로만 읽어야 한다. 미션과 무관하게 상시 표시한다.
  document.getElementById('trust-badge').textContent =
    `${TRUST.relative.badge} ${TRUST.relative.label} — ${TRUST.relative.note}`;
```

- [ ] **Step 4: 미션 패널을 마운트한다**

`src/app.js`의 `restoreOnLoad()` 호출 뒤(파일 하단, 초기화가 끝나는 지점)에 추가:

```js
// 미션 패널. app은 상태를 넘겨주기만 하고 채점 로직은 전부 mission.js에 있다.
initMissionPanel(document.getElementById('mission'), {
  loadMolecule(mol) {
    pushUndo();
    state.mol = mol;
    state.selection = [];
    render();
    saveLocal();
  },
  getMolecule: () => state.mol,
  getSelection: () => state.selection,
});
```

`pushUndo`·`state`·`render`·`saveLocal`은 모두 `app.js` 안에 이미 있는 이름이다.

- [ ] **Step 5: 자동 테스트가 깨지지 않았는지 확인한다**

Run: `node --test`
Expected: PASS

- [ ] **Step 6: 브라우저에서 수동 확인**

Run: `npm run serve` → `http://localhost:8000`

다음을 순서대로 확인한다. 하나라도 어긋나면 그 태스크로 돌아간다.

1. 우측 패널 맨 위에 `미션` 섹션과 챕터 드롭다운이 보인다.
2. 총에너지 아래에 🟡 신뢰등급 문구가 항상 떠 있다.
3. `2장 · 부탄을 anti 배좌로 만들어라`를 열면 3D 뷰가 gauche 부탄으로 바뀐다.
4. 그 상태에서 바로 `제출` → `gauche 배좌 그대로입니다…` 진단이 뜬다.
5. 탄소 4개를 순서대로 선택 → 이면각 슬라이더로 180°로 돌린 뒤 `제출` → `통과했습니다.`
6. `힌트 보기`를 세 번 누르면 3단까지 열리고 버튼이 비활성화된다. 제출을 3회 한 뒤에는 4단(정답)이 열린다.
7. `1장 · 물은 왜 직선이 아닌가`에서 선택 전 `답을 확정하고 계산 실행`을 눌러도 계산 결과가 뜨지 않는다. 답을 고른 뒤 누르면 선택지가 잠기고 `최적화 후 H–O–H: 104.x°`가 뜬다.
8. `4장 · 벤젠`에서 아무것도 선택하지 않고 제출하면 "고리를 이루는 탄소 두 개…" 진단이 뜨고, 이웃 고리 탄소 두 개를 선택하고 `b`를 고르면 통과한다.
9. 새로고침 후에도 통과·실패 아이콘(✓/✗)이 유지된다.
10. 미션 화면에서도 붙이기·지우개·결합 도구가 그대로 동작한다(샌드박스 유지).

- [ ] **Step 7: 커밋**

```bash
git add index.html src/app.js
git commit -m "feat: 미션 패널을 앱에 연결하고 총에너지에 신뢰등급 배지 추가"
```

---

## Task 10: 문서 갱신

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: README에 미션 모드 절을 추가한다**

`README.md`의 `## 물리 모델과 한계` **바로 앞**에 추가:

```markdown
## 미션 모드

우측 패널의 `미션`에서 교재 대표 개념 10개를 직접 조작하며 확인할 수 있다.
샌드박스를 대체하지 않는다 — 미션 중에도 모든 조립 도구가 그대로 동작한다.

| 유형 | 하는 일 |
|---|---|
| **조립(build)** | 목표 구조를 직접 만든다. 구조를 술어로 채점한다 |
| **측정(measure)** | 지정한 원자를 실제로 재고, 그 값의 의미를 고른다 |
| **예측(predict)** | **먼저 답을 확정해 잠근 뒤** 계산이 돌아간다. 결과를 먼저 보면 학습이 되지 않는다 |
| **판정(classify)** | 구조를 보고 라벨을 고른다 |

- 틀리면 "틀렸습니다"가 아니라 **무엇을 오해했는지**가 나온다(`diagnostics`).
- 힌트는 개념 → 어디를 볼지 → 구체 조작 → 정답 4단이며 한 번에 한 단계씩 열린다.
  정답은 세 번 시도한 뒤에만 열린다.
- 진도는 `localStorage`(키 `molcraft:progress`)에 저장된다. 서버도 계정도 없다.
- 틀린 미션은 목록 위로 올라온다(오답 큐).

미션은 `src/mission-data.js`의 선언형 데이터다. 채점 술어는 기존 함수
(`formula`·`topologyKey`·`measure`·`energy`·`stability`·`findRings`)를 감싼 것뿐이라
새 화학 로직이 없다. 미션을 추가하면 `test/mission-data.test.js`의 스키마 검증이 자동으로 걸린다.

**아직 다루지 않는 장:** Ch5(입체화학)·Ch10(아마이드)·Ch12(스펙트럼)·Ch13(헤테로고리)·Ch17(단백질).
현재 엔진으로는 틀리게 가르치게 되기 때문이다 — CIP/R-S 판정이 없고, 아마이드 N이 평면이 되지 않으며,
`aromatize()`가 피리딘·피롤·푸란을 인식하지 못해 피롤 질소에 비공유 전자쌍 자리를 잘못 표시한다.
이 장들은 화학 정확성 복구 작업 이후에 추가한다.

## 신뢰등급

화면에 나가는 모든 수치에 등급이 붙는다.

| 등급 | 대상 | 표시 |
|---|---|---|
| 🟢 기하 | 결합각·결합길이·이면각·좌표 거리 | 그대로 |
| 🟡 상대에너지 | **같은 위상 안에서의** 배좌 비교 | 표시 + 과대평가 경고 |
| 🔴 비교 불가 | 위상이 다른 두 구조의 총에너지, pKa, 반응 에너지, 전이상태 | **표시하지 않는다** |

🔴는 문구로 막는 게 아니라 코드로 막는다 — 위상이 다른 두 상태의 총에너지를 리포트하려는
미션은 로드 시점에 예외를 던지고, `test/mission-data.test.js`가 그것을 검증한다.
```

- [ ] **Step 2: 테스트 절에 새 스위트를 적는다**

`README.md`의 `## 테스트` 절 끝에 추가:

```markdown
`test/mission.test.js`와 `test/mission-data.test.js`는 미션 술어·채점·힌트 해금·신뢰등급 가드와
시드 미션 10개의 정답/오답 왕복을 검증한다. UFF나 `snap` 쪽을 고쳤을 때 미션이 조용히 깨지는 것을
여기서 잡는다.
```

- [ ] **Step 3: 전체 테스트를 한 번 더 돌린다**

Run: `node --test`
Expected: PASS

- [ ] **Step 4: 커밋하고 푸시한다**

```bash
git add README.md
git commit -m "docs: 미션 모드와 신뢰등급 문서화"
git push -u origin claude/computational-chemistry-consulting-nu9hbp
```

---

## Self-Review

**스펙 커버리지**

| 스펙 절 | 태스크 |
|---|---|
| §4 아키텍처(4개 신규 파일, app 3지점) | Task 1·2·8·9 |
| §5 미션 스키마 | Task 5(검증) · Task 6·7(데이터) |
| §5 술어 12종 + all/any/not | Task 2 |
| §5 이면각 360 법 정규화 | Task 2 Step 1 전용 테스트 |
| §5 원자 인덱스 안정성 | Task 3 불변식 + `replace` 인덱스 보존 테스트 |
| §6 네 유형 | Task 5(채점 분기) · Task 8(흐름) · Task 7(네 유형 사용 테스트) |
| §6 measure 2단 채점 | Task 7 ch04·ch06(`selectionEquals` + `answerEquals`) |
| §7 probe | Task 4 |
| §8 신뢰등급 3단 | Task 1 |
| §8 강제 지점 1(위상 가드 throw) | Task 4 `assertComparable` · Task 5 `validateMission` |
| §8 강제 지점 2(총에너지 배지 상시) | Task 9 Step 3 |
| §8 강제 지점 3(문헌값 병기) | Task 1 `TRUST.relative.note` |
| §9 진단 첫 매칭 1개 | Task 5 `evaluate` |
| §9 일반 메시지 폴백 | Task 5 `GENERIC` + `firstFailure` |
| §9 힌트 4단·3회 후 해금 | Task 5 `maxHintLevel` · Task 8 렌더 |
| §10 진도 localStorage + 오답 큐 + 실패 무시 | Task 8 |
| §11 시드 10개 + 제외 장 | Task 6·7 · Task 10(README에 제외 사유) |
| §12 테스트 6항목 | Task 1·2·3·4·5·6·7 |
| §13 오류 처리 5항목 | Task 5(스키마·가드) · Task 8(디코드 실패·채점 오류·저장 실패) |
| §14 UI 배치 | Task 9 |
| §15 `level` 필드 미도입 | 스키마에 없음 |

빠진 스펙 요구사항은 없다.

**Placeholder 스캔:** "TBD"·"적절히 처리"·"위와 유사"·코드 없는 코드 단계 없음. 모든 술어·미션·UI가 실제 코드로 적혀 있다.

**타입 일관성 확인:**
- `evaluatePredicate(pred, ctx)` — Task 2 정의, Task 5 `firstFailure`/`evaluate`/`walkPredicate`에서 같은 시그니처로 호출.
- `loadStart(start)` — Task 3 정의, Task 4 `runProbe`·Task 5 `makeContext`/`validateMission`·Task 6·7 테스트·Task 8 `open`에서 동일.
- `runProbe(probe)` → `{ rows, trust }` — Task 4 정의, Task 6·7 테스트와 Task 8 `probeRows`가 같은 모양을 읽는다.
- `evaluate(mission, input)` → `{ pass, diagnostic }` — Task 5 정의, Task 6·7 테스트와 Task 8 `onSubmit`이 동일.
- `maxHintLevel(attempts)` → number — Task 5 정의, Task 8 `cap`.
- `trustFor(kind, cross)` → `TrustEntry{key,badge,label,note}` — Task 1 정의, Task 4가 `rank[b.key]`·Task 8이 `badge/label/note`를 읽는다.
- `initMissionPanel(root, hooks)`의 `hooks` 3개(`loadMolecule`·`getMolecule`·`getSelection`) — Task 8 정의, Task 9가 전부 제공한다.
- `PREDICATE_NAMES` — Task 2 export, Task 5 `walkPredicate`/`evaluate`에서 사용.
- 미션 데이터의 `probe.report[].value` 7종은 Task 4 `probeValue`의 case와 Task 1 `trustFor`의 분기에 모두 존재한다.

불일치 없음.
