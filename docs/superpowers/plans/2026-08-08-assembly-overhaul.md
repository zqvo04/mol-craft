# 조립 경험 개선 (Assembly Overhaul) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 화학적으로 불가능한 결합을 차단하고, 붙일 자리를 사용자가 직접 고를 수 있게 만들고(마인크래프트식 조작감), 경고를 문제 원자 위에 직접 그리고, 렌더 병목을 제거한다.

**Architecture:** 새 모듈을 만들지 않는다. 조립 방향 계산은 `snap.idealDirection`의 기존 수식을 그대로 재사용해 "빈 자리 전부 열거"(`openSlots`)로 일반화하고, `idealDirection`은 그 첫 원소를 돌려주는 한 줄이 된다(기존 호출자 전부 무변경). 원자가 판정은 `snap.canBond` 한 곳에서만 바뀌므로 3D·2D 양쪽 경로가 자동으로 같이 고쳐진다. 성능은 `app.render()`의 세 병목(원자별 `setStyle`, 매 렌더 `buildTerms` 재생성, 동기 `localStorage` 쓰기)만 정확히 겨냥한다.

**Tech Stack:** 바닐라 ES 모듈, 빌드 단계 없음. 3Dmol.js(CDN), 테스트는 `node --test` (외부 프레임워크 없음).

## Global Constraints

- 빌드 단계·npm 의존성 추가 금지. `index.html`을 그대로 서빙하는 구조 유지.
- 모든 테스트는 `node --test`로 돌아가야 한다. DOM이 필요한 코드는 테스트하지 않는다 — 순수 함수로 뽑아내서 그것만 테스트한다(`src/app.js`는 테스트 대상 아님).
- 주석·UI 문자열은 한국어. 기존 파일의 주석 밀도와 어조를 따른다.
- 착수 전 기준선: `node --test` = 100 pass / 0 fail. 매 태스크 종료 시 전체 스위트가 초록이어야 한다.
- **결합 차수(단일/이중/삼중) 편집 UI는 이번 범위 밖이다.** 조립으로 만들어지는 결합은 계속 order 1이다.
- **격자(voxel) 스냅 금지.** 마인크래프트에서 가져오는 것은 조작감뿐이고, 좌표는 계속 실제 VSEPR 각도를 따른다.
- 브랜치: `claude/web-improvement-prep-agdiml`. 태스크마다 커밋.

## 사용자 요구 → 태스크 매핑

| 요구 | 진단 | 태스크 |
|---|---|---|
| 1. H 연쇄에 경고 없음 | `stability()`는 이미 danger를 만들지만, 3D 원자 색이 전부 *응력 색*이라 안 보이고 HUD 칩은 수십 개로 벽이 됨 | T1(애초에 못 만들게), T5(문제 원자에 직접 표식 + HUD 요약) |
| 2. 그리드 제거 + 렉 | 그리드 156개 `addLine`. 그 외 `render()`의 원자별 `setStyle`(O(n²))·`buildTerms` 매번 재생성·동기 저장 | T6 |
| 3. 실제 화학법칙 | 원자가 초과가 경고만이고 차단 안 됨. `typeAtom`이 이웃 **개수**로 혼성 판정 → 단일결합 2개짜리 탄소가 sp(180°)로 오분류 | T1, T2 |
| 4. 2D 레고 조립 | 조립 자체는 됨. 선택 상태가 SVG에 아예 안 그려지고, 핫바/우클릭이 2D에 없음 | T4, T7 |
| 5. 마인크래프트 조작감 | 조준 원자 강조 없음, 빈 자리 선택 불가, 우클릭 제거 없음, 핫바 없음 | T3, T4 |
| 6. 직접 조립이 아쉬움 | `idealDirection`이 빈 자리를 **하나만**, 방위각도 임의로 돌려줌 → 탄소 빈 자리 3개 중 어디에 붙을지 못 고름 | T3, T4 |

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/snap.js` | 결합 가능 판정, VSEPR 방향, 안정도 | `canBond` 차단으로 전환 / `openSlots` 신설 / `hudSummary` 신설 |
| `src/uff.js` | 역장·최적화 | `typeAtom` 혼성 판정 수정 / `cachedTerms` 신설 |
| `src/sketch2d.js` | 2D 골격식 SVG | `renderSVG`에 `selection` 옵션 추가 |
| `src/app.js` | UI 배선 | 슬롯 순환·핫바·우클릭·경고 표식·성능·그리드 삭제 |
| `index.html` | 마크업 | 그리드 체크박스 삭제, 팔레트 단축키 표기 |
| `test/snap.test.js` | | 차단 케이스, `openSlots`, `hudSummary` |
| `test/uff.test.js` | | 혼성 판정, `cachedTerms` |
| `test/sketch2d.test.js` | | 선택 렌더 |
| `README.md` | | 바뀐 조작법·규칙 반영 |

---

### Task 1: 화학적으로 불가능한 결합을 차단한다

원자가 상한(`EXPANDED_VALENCE` 있으면 그 값, 없으면 `MAX_VALENCE`)을 넘는 결합을 `canBond`가 거부한다. H는 상한이 1이므로 사진의 H 연쇄가 **처음부터 만들어지지 않는다**. P/S/Si 등 초원자가 확장이 실재하는 원소는 확장 상한까지 계속 허용하되 `ok-expanded` 경고를 유지한다(SF₆·PCl₅ 프리셋 보존).

**Files:**
- Modify: `src/snap.js:38-56` (`canBond`)
- Modify: `src/app.js:323-327` (`REASON_MSG`), `src/app.js:355-360` (`attachAtom`의 결과 분기)
- Test: `test/snap.test.js`

**Interfaces:**
- Consumes: 없음(기존 `MAX_VALENCE`, `EXPANDED_VALENCE`).
- Produces: `canBond(mol, i, j)` → `{ ok:false, reason:'valence-full' }`가 새로 생긴다. `'ok-overloaded'` reason은 **완전히 사라진다** — 이후 태스크에서 이 값을 참조하면 안 된다. 남는 성공 reason은 `'ok'`와 `'ok-expanded'` 둘뿐.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/snap.test.js`의 기존 테스트 `'canBond: 원자가가 가득 차도 이제 막지 않고 overloaded로 표시한다'`(20~26행)를 통째로 아래 두 테스트로 교체한다.

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/snap.test.js`
Expected: FAIL — `Expected values to be strictly equal: true !== false` (지금은 `ok:true`, `reason:'ok-overloaded'`).

- [ ] **Step 3: 최소 구현**

`src/snap.js`의 `canBond` 본문에서 `reason` 루프를 아래로 바꾼다.

```js
  let reason = 'ok';
  for (const idx of [i, j]) {
    const el = mol.atoms[idx].el;
    const used = bondOrderSum(mol, idx);
    const normal = MAX_VALENCE[el];
    const capMax = EXPANDED_VALENCE[el] ?? normal;
    if (normal === undefined) return { ok: false, reason: 'unsupported-element' };
    // 상한을 넘는 결합은 실제 화학에서 불가능하다(H가 결합 2개, 탄소가 5개 등) —
    // 예전엔 "레고처럼 일단 끼울 순 있게" 허용하고 경고만 띄웠는데, 경고가 3D에
    // 안 보여서 H 사슬 같은 구조가 아무 저항 없이 만들어졌다. 이제는 클릭 자체를 막는다.
    // 초원자가 확장이 실재하는 원소(P·S·Si·할로젠)는 EXPANDED_VALENCE까지 계속 허용한다.
    if (used + 1 > capMax) return { ok: false, reason: 'valence-full' };
    if (used + 1 > normal && reason === 'ok') reason = 'ok-expanded';
  }
```

같은 파일 33~37행 주석 블록을 아래로 교체한다.

```js
// 원자가 상한을 넘는 결합은 차단한다. 상한은 EXPANDED_VALENCE(있으면) 또는 MAX_VALENCE다 —
// 그래서 SF6·PCl5 같은 실재하는 초원자가 분자는 여전히 만들 수 있고, H 사슬이나 CH5처럼
// 어떤 조건에서도 존재할 수 없는 결합만 막힌다.
// reason 등급: 'ok' 정상 / 'ok-expanded' 초원자가(EXPANDED_VALENCE 이내, 예: SF6) — 둘 다 ok:true.
// 거부: 'same-atom' / 'already-bonded' / 'unsupported-element' / 'valence-full'.
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/snap.test.js`
Expected: PASS.

- [ ] **Step 5: app.js에서 죽은 분기를 정리한다**

`src/app.js:323-327`의 `REASON_MSG`에 항목을 추가한다.

```js
const REASON_MSG = {
  'already-bonded': '이미 결합되어 있습니다',
  'unsupported-element': '지원하지 않는 원소입니다',
  'same-atom': '같은 원자입니다',
  'valence-full': '원자가가 가득 찼습니다 — 더 붙일 수 없습니다',
};
```

`src/app.js:355-360`의 결과 분기에서 `ok-overloaded` 가지를 지운다.

```js
  addBond(state.mol, idx2, anchor, 1);
  if (check.reason === 'ok-expanded') { playClick(880); toast('초원자가 결합 — UFF 정확도 주의', 'err'); }
  else playClick(880);
```

`src/app.js:321-322`의 주석을 바꾼다.

```js
// canBond가 원자가 상한 초과를 직접 차단하므로(snap.js 참고) 여기 남은 사유는
// 데이터 모델상 불가능한 경우와 원자가 포화뿐이다.
```

- [ ] **Step 6: 전체 스위트 확인**

Run: `node --test`
Expected: 전체 PASS (fail 0).

- [ ] **Step 7: 커밋**

```bash
git add src/snap.js src/app.js test/snap.test.js
git commit -m "feat: block bonds that exceed the valence cap instead of only warning"
```

---

### Task 2: 혼성(원자 타입) 판정을 이웃 개수가 아니라 결합 차수로 한다

`typeAtom`이 C/N/O를 이웃 **개수**로 분류해서, 단일결합 2개만 붙은 탄소가 `C_1`(sp, theta0 = 180°)이 된다. 2D에서 탄소 골격만 그리거나 3D에서 사슬을 한 개씩 조립하는 도중 항상 이 상태를 지나므로, 조립 중 결합각이 실제 화학과 어긋난다(`presets.js`의 주석과 `validation.test.js`의 "C_1 함정" 회귀 테스트가 이 문제를 이미 우회 중이다). 혼성은 결합 개수가 아니라 **최대 결합 차수**가 정한다 — 단일결합만 있으면 sp3, 이중결합이 하나라도 있으면 sp2, 삼중이면 sp.

**Files:**
- Modify: `src/uff.js:8-29` (`typeAtom`)
- Test: `test/uff.test.js`

**Interfaces:**
- Consumes: `model.neighbors`, `model.bondOrderSum` (이미 import됨). 새로 `mol.bonds`를 직접 읽는 지역 헬퍼를 만든다.
- Produces: `typeAtom` 반환값 규칙 변경. C/N/O만 바뀐다. B/S/P/Si/할로젠은 그대로.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/uff.test.js` 끝에 추가한다.

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/uff.test.js`
Expected: FAIL — 첫 테스트에서 `'C_1' !== 'C_3'`.

- [ ] **Step 3: 최소 구현**

`src/uff.js:8-29`의 `typeAtom`을 아래로 교체한다(스위치의 C/N/O 세 줄만 바뀐다).

```js
// 원자 타입 결정: 원소 + 최대 결합 차수 + 이웃 수.
// 혼성은 결합 개수가 아니라 최대 결합 차수가 정한다 — 단일결합만 있으면 sp3, 이중이
// 하나라도 있으면 sp2, 삼중이면 sp. 예전엔 이웃 개수로 판정해서 단일결합 2개짜리 탄소가
// C_1(sp, theta0=180°)이 됐고, 사슬을 한 개씩 조립하는 도중이나 2D에서 골격만 그린
// 상태에서 결합각이 실제 화학과 어긋났다.
// 방향족(C_R/N_R/O_R)은 별도 고리 인식이 필요하므로 여기서 자동 배정하지 않는다.
// atom.type을 직접 지정하면 그 값이 우선한다(사용자 오버라이드 및 방향족 지정 경로).
export function typeAtom(mol, i) {
  const a = mol.atoms[i];
  if (a.type) return a.type;
  const el = a.el;
  const n = neighbors(mol, i).length;
  const bo = bondOrderSum(mol, i);
  const maxOrder = mol.bonds
    .filter((b) => b.i === i || b.j === i)
    .reduce((mx, b) => Math.max(mx, b.order), 0);
  switch (el) {
    case 'H': return 'H_';
    case 'F': return 'F_';
    case 'Cl': return 'Cl';
    case 'Br': return 'Br';
    case 'I': return 'I_';
    case 'B': return n >= 4 ? 'B_3' : 'B_2';
    case 'C': return maxOrder >= 3 ? 'C_1' : maxOrder === 2 ? 'C_2' : 'C_3';
    case 'N': return maxOrder >= 3 ? 'N_1' : maxOrder === 2 ? 'N_2' : 'N_3';
    case 'O': return maxOrder >= 2 ? 'O_2' : 'O_3';
    case 'S': return n >= 3 ? 'S_3+6' : n === 1 && bo >= 2 ? 'S_2' : 'S_3+2';
    case 'P': return n >= 5 ? 'P_3+5' : 'P_3+3';
    case 'Si': return 'Si3';
    default: throw new Error(`지원하지 않는 원소: ${el}`);
  }
}
```

- [ ] **Step 4: 테스트 통과 + 물리 검증 스위트 확인**

Run: `node --test`
Expected: 전체 PASS. **특히 `test/validation.test.js`가 전부 초록이어야 한다** — 메탄 109.47°, 에틸렌 평면 복원, 에탄 회전장벽 1.5~3.5, 의자<보트, 부탄 anti/gauche가 모두 이 함수의 결과에 직접 걸려 있다. 하나라도 깨지면 되돌리고 원인을 먼저 밝힌다.

- [ ] **Step 5: 커밋**

```bash
git add src/uff.js test/uff.test.js
git commit -m "fix: derive hybridization from max bond order, not neighbor count"
```

---

### Task 3: 빈 결합 자리를 전부 열거하는 `openSlots`

지금 `idealDirection`은 빈 자리를 **하나만**, 그것도 첫 슬롯의 방위각을 임의 축으로 정해서 돌려준다(코드 주석이 "원뿔 방위각은 임의"라고 자인). 그래서 탄소의 남은 정사면체 자리 3개 중 어디에 붙일지 사용자가 고를 수 없다 — "직접 조립이 아쉽다"의 직접적 원인이다. 기존 수식을 하나도 바꾸지 않고, "점유된 방향들이 주어졌을 때 다음 이상 방향 하나"를 뽑는 부분을 함수로 떼어내 반복 호출한다.

**Files:**
- Modify: `src/snap.js:129-163` (`idealDirection`)
- Test: `test/snap.test.js`

**Interfaces:**
- Consumes: 없음(기존 `ELECTRON_DOMAINS`, `IDEAL_ANGLES`, `sumFallback`).
- Produces:
  - `openSlots(mol, anchor) -> number[][]` — 길이 3의 단위벡터 배열들. 개수 = `ELECTRON_DOMAINS[el] - 현재 결합 수`(최소 1). 결정적(같은 입력 → 같은 순서·같은 값).
  - `idealDirection(mol, anchor) -> number[]` — 시그니처·반환값 **불변**. 내부적으로 `openSlots(...)[0]`. 기존 호출자(`app.attachAtom`, `app.previewAttach`, `snap.syncHydrogens`)는 수정하지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/snap.test.js`의 import에 `openSlots`를 추가하고(`canBond, ..., idealDirection, openSlots, stability, ...`), `geom.js` import에 `dot`을 추가한다. 파일 끝에 추가한다.

```js
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

test('idealDirection은 openSlots의 첫 원소와 같다 (기존 동작 보존)', () => {
  const m = loadPreset('methane');
  const m2 = createMolecule();
  addAtom(m2, 'C', [0, 0, 0]);
  addAtom(m2, 'H', [1.1, 0, 0]);
  addBond(m2, 0, 1);
  assert.deepEqual(idealDirection(m2, 0), openSlots(m2, 0)[0]);
  assert.deepEqual(idealDirection(m, 1), openSlots(m, 1)[0]);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/snap.test.js`
Expected: FAIL — `SyntaxError: The requested module '../src/snap.js' does not provide an export named 'openSlots'`.

- [ ] **Step 3: 최소 구현**

`src/snap.js:118-163`(주석 블록 + `idealDirection` 전체)을 아래로 교체한다. 두 분기의 수식은 원본 그대로 옮기고, 입력만 `mol/anchor`에서 `dirs`로 바꾼다.

```js
// 점유된 방향 dirs가 주어졌을 때 ideal 각도를 만족하는 "다음" 방향 하나.
// (기존 idealDirection의 본문 그대로 — 계산은 이 한 곳에만 둔다.)
// 0개: 기존 방향이 없으면 sumFallback의 임의 축.
// 1개: 임의의 수직축으로 이상각만큼 회전(원뿔 위 한 점, 방위각은 임의지만 결정적).
// 2개: 두 방향이 이루는 평면에서 해석해(이등분선/법선 기저 분해). 기존 두 결합이 정확히
//   이상각이 아니어도(조립 중간 단계) 강건하다.
// 3개 이상: 대칭 형상에서 -sum이 정확한 다음 방향과 일치한다(정사면체).
//   전자 도메인 5개 이상(초원자가)은 해석해가 없어 sumFallback으로 넘어간다.
function nextIdealDir(dirs, ideal) {
  if (dirs.length === 1 && ideal !== undefined) {
    const ref = Math.abs(dirs[0][0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const axis = cross(dirs[0], ref);
    if (norm(axis) > 1e-6) {
      const t = ideal * Math.PI / 180;
      const c = Math.cos(t), s = Math.sin(t);
      const u = unit(axis);
      // Rodrigues 회전(geom.rotateAround과 동일 공식, 원점 기준이라 인라인).
      return unit(add(add(scale(dirs[0], c), scale(cross(u, dirs[0]), s)), scale(u, dot(u, dirs[0]) * (1 - c))));
    }
  }

  if (dirs.length === 2 && ideal !== undefined) {
    const [d1, d2] = dirs;
    const e1v = add(d1, d2);
    const e3v = cross(d1, d2);
    if (norm(e1v) > 1e-6 && norm(e3v) > 1e-6) {
      const e1 = unit(e1v), e3 = unit(e3v);
      const halfCos = Math.sqrt(Math.max(0, (1 + dot(d1, d2)) / 2)); // cos(θ12/2)
      const cosIdeal = Math.cos(ideal * Math.PI / 180);
      const x = halfCos > 1e-6 ? cosIdeal / halfCos : 0;
      const y2 = 1 - x * x;
      if (y2 >= 0) return unit(add(scale(e1, x), scale(e3, Math.sqrt(y2))));
    }
  }

  return sumFallback(dirs);
}

// 앵커에 남아 있는 결합 자리를 **전부** 열거한다. 목표 각도는 앵커 원소의 전자 도메인 수
// (ELECTRON_DOMAINS = 결합자리 + 비공유쌍) 기준이다 — 결합 개수만 쓰면 물의 두 번째 H가
// 180°(선형)로 붙고, 그 대칭점은 UFF 힘이 정확히 0이라 최적화로도 못 빠져나온다.
// 한 자리를 채운 상태를 다음 호출의 입력으로 넘기며 반복하므로, 결과는 기존 결합과
// 새 슬롯들이 서로 이상각을 이루는 완전한 형상이 된다(정사면체 탄소의 남은 자리 3개 등).
// 이미 도메인이 꽉 찬 원자(외부에서 불러온 과포화 구조)에도 최소 1개는 돌려준다 —
// idealDirection이 절대 undefined를 뱉지 않게 하기 위한 안전장치다.
export function openSlots(mol, anchor) {
  const a = mol.atoms[anchor].pos;
  const dirs = neighbors(mol, anchor).map((n) => unit(sub(mol.atoms[n].pos, a)));
  const total = ELECTRON_DOMAINS[mol.atoms[anchor].el] ?? dirs.length + 1;
  const ideal = IDEAL_ANGLES[total]?.[0];
  const slots = [];
  const want = Math.max(total, dirs.length + 1);
  while (dirs.length + slots.length < want) slots.push(nextIdealDir([...dirs, ...slots], ideal));
  return slots;
}

// 빈 자리 중 첫 번째. 기존 호출자(attachAtom·previewAttach·syncHydrogens)를 위한 유지 API.
export function idealDirection(mol, anchor) {
  return openSlots(mol, anchor)[0];
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test`
Expected: 전체 PASS. 기존 `idealDirection` 테스트와 `syncHydrogens` 테스트가 그대로 초록이어야 한다 — 리팩터링이 동작을 바꾸지 않았다는 증거다.

- [ ] **Step 5: 커밋**

```bash
git add src/snap.js test/snap.test.js
git commit -m "feat: enumerate every open VSEPR slot via openSlots()"
```

---

### Task 4: 마인크래프트식 조작 — 슬롯 순환 · 조준 강조 · 핫바 · 우클릭 제거

T3의 `openSlots`를 UI에 연결한다. 붙이기 도구로 원자를 조준하면 남은 빈 자리가 **전부** 흐리게 보이고, 활성 자리 하나가 깜빡인다. `R` 키나 휠로 활성 자리를 순환한다. 조준 중인 원자에는 마인크래프트의 블록 외곽선에 해당하는 하늘색 와이어프레임 구가 붙는다. 숫자키 1~9가 원소 핫바가 되고, 우클릭이 원자를 제거한다(도구 전환 불필요, 3D·2D 공통).

**Files:**
- Modify: `src/app.js` — `state`(17-29), `attachAtom`(335-367), `previewAttach`(579-587), `drawGhost`(556-567), pointermove 핸들러(589-596), wheel 핸들러(70-76), 클릭 핸들러(677-687), 키보드 핸들러(773-780), `$('palette')` 배선(539-545)
- Modify: `index.html:220` (팔레트 title 문구)
- Test: 없음 — 전부 DOM/3Dmol 배선이라 `node --test`로 검증 불가. 대신 Step 8의 수동 확인 절차를 반드시 수행한다.

**Interfaces:**
- Consumes: `openSlots(mol, anchor)` (T3), `canBond` reason `'valence-full'` (T1).
- Produces: `state.ghost` 모양이 바뀐다 → `{ anchor, slots, slot, pos, ok, reason, el }` (`slots`는 방향 배열, `slot`은 활성 인덱스, `pos`는 활성 슬롯의 최종 좌표). `attachAtom(anchor, { pos2d, dir })` — `dir`이 주어지면 그 방향으로 붙이고, 없으면 종전대로 `idealDirection`을 쓴다(2D 경로 무변경).

- [ ] **Step 1: `openSlots` import와 상태 필드를 추가한다**

`src/app.js:6-8`의 import에 `openSlots`를 넣는다.

```js
import {
  canBond, vseprCheck, newSnapEvents, idealDirection, openSlots, stability, syncHydrogens,
} from './snap.js';
```

`src/app.js:17-29`의 `state`에서 `ghost` 줄을 바꾸고 `slot`을 추가한다.

```js
  ghost: null, // { anchor, slots, slot, pos, ok, reason, el } — slots는 남은 빈 자리 전부
  slot: 0,     // 활성 빈 자리 인덱스. R 키/휠로 순환한다(마인크래프트의 배치 방향 선택에 해당)
```

- [ ] **Step 2: `previewAttach`가 슬롯 전부를 계산하게 한다**

`src/app.js:577-587`을 교체한다.

```js
// canBond는 실존 원자 쌍만 받으므로, attachAtom과 같은 시험 삽입/되돌리기 패턴으로
// "지금 이 앵커에 이 원소를 붙이면 어떻게 되는지"를 부작용 없이 미리 계산한다.
// openSlots가 남은 자리를 전부 주므로 state.slot으로 그중 하나를 활성으로 고른다 —
// 미리 보여준 자리가 곧 실제로 붙는 자리라는 보장은 그대로 유지된다(같은 배열을 쓴다).
function previewAttach(anchor, el) {
  const a = state.mol.atoms[anchor].pos;
  const slots = openSlots(state.mol, anchor);
  const slot = ((state.slot % slots.length) + slots.length) % slots.length;
  const idx = addAtom(state.mol, el, add(a, scale(slots[slot], 2.5)));
  const check = canBond(state.mol, anchor, idx);
  state.mol.atoms.pop();
  const len = check.ok ? check.targetLength : 1.6;
  return { anchor, slots, slot, pos: add(a, scale(slots[slot], len)), ok: check.ok, reason: check.reason, el };
}
```

- [ ] **Step 3: 고스트를 "빈 자리 전부 + 활성 하나 + 조준 외곽선"으로 그린다**

`src/app.js:555-567`의 `drawGhost`를 교체한다.

```js
// 초록: 정상. 주황: 붙지만 초원자가 경고. 빨강: 못 붙음(원자가 포화 등).
// 마인크래프트가 조준한 블록에 검은 외곽선을 그리듯, 조준 중인 원자에 하늘색 와이어프레임
// 구를 씌우고 남은 빈 자리를 전부 흐리게 띄운다 — 활성 자리 하나만 깜빡인다.
function drawGhost() {
  for (const s of ghostShapes) viewer.removeShape(s);
  const g = state.ghost;
  const a = state.mol.atoms[g.anchor].pos;
  const color = !g.ok ? '#dc2626' : g.reason === 'ok' ? '#22c55e' : '#f59e0b';
  const opacity = blinkOn ? 0.6 : 0.22;
  ghostShapes = [
    viewer.addSphere({
      center: { x: a[0], y: a[1], z: a[2] }, radius: 0.44,
      color: '#38bdf8', opacity: 0.9, wireframe: true,
    }),
  ];
  // 활성이 아닌 빈 자리들 — 여기로도 붙일 수 있다는 것을 보여준다(R 키/휠로 전환).
  if (g.ok && g.slots.length > 1) {
    const len = Math.hypot(g.pos[0] - a[0], g.pos[1] - a[1], g.pos[2] - a[2]);
    g.slots.forEach((d, k) => {
      if (k === g.slot) return;
      const p = add(a, scale(d, len));
      ghostShapes.push(viewer.addSphere({
        center: { x: p[0], y: p[1], z: p[2] }, radius: 0.18, color, opacity: 0.16,
      }));
    });
  }
  ghostShapes.push(
    viewer.addSphere({ center: { x: g.pos[0], y: g.pos[1], z: g.pos[2] }, radius: 0.32, color, opacity }),
    viewer.addLine({ start: { x: a[0], y: a[1], z: a[2] }, end: { x: g.pos[0], y: g.pos[1], z: g.pos[2] }, color, dashed: true }),
  );
  viewer.render();
}
```

- [ ] **Step 4: 활성 슬롯 방향으로 실제로 붙인다**

`src/app.js:335-341`의 `attachAtom` 머리를 바꾼다.

```js
function attachAtom(anchor, { pos2d, dir } = {}) {
  const el = state.element;
  const a = state.mol.atoms[anchor].pos;
  const placeDir = dir ?? idealDirection(state.mol, anchor);

  const idx = addAtom(state.mol, el, add(a, scale(placeDir, 2.5)));
```

같은 함수 353행의 `targetPos` 계산에서 `dir`을 `placeDir`로 바꾼다.

```js
  const targetPos = pos2d ? [pos2d[0], pos2d[1], 0] : add(a, scale(placeDir, check.targetLength));
```

`src/app.js:677-687`의 클릭 핸들러에서 활성 슬롯을 넘긴다.

```js
viewerEl.addEventListener('click', (ev) => {
  if (state.tool === 'place') {
    if (!state.ghost) return;
    if (state.ghost.ok) attachAtom(state.ghost.anchor, { dir: state.ghost.slots[state.ghost.slot] });
    else toast(REASON_MSG[state.ghost.reason] ?? '결합할 수 없습니다', 'err');
    return;
  }
  const hit = pickAtom(ev.pageX, ev.pageY, 24);
  if (hit === -1) return;
  handleAtomClick(hit, ev.shiftKey);
});
```

- [ ] **Step 5: 조준 대상이 바뀌면 슬롯 인덱스를 초기화한다**

`src/app.js:589-596`의 pointermove 핸들러를 교체한다.

```js
viewerEl.addEventListener('pointermove', (ev) => {
  if (state.tool !== 'place') return;
  const anchor = pickAtom(ev.pageX, ev.pageY, 40);
  if (anchor === -1) { clearGhost(); return; }
  // 다른 원자를 조준하면 슬롯 선택을 처음으로 되돌린다 — 앵커마다 자리 개수가 다르다.
  if (state.ghost?.anchor !== anchor) state.slot = 0;
  state.ghost = previewAttach(anchor, state.element);
  blinkOn = true;
  drawGhost();
});
```

- [ ] **Step 6: `R` 키와 휠로 슬롯을 순환한다**

`src/app.js:70-76`의 wheel 핸들러를 교체한다(붙이기 조준 중일 때만 가로채고, 그 외에는 종전대로 확대/축소).

```js
document.addEventListener('wheel', (ev) => {
  if (!document.getElementById('viewer').contains(ev.target)) return;
  ev.preventDefault();
  ev.stopPropagation();
  // 붙이기로 원자를 조준 중이면 휠은 확대가 아니라 "붙일 자리 바꾸기"다(마인크래프트 핫바 감각).
  if (state.tool === 'place' && state.ghost && state.ghost.slots.length > 1) {
    cycleSlot(ev.deltaY < 0 ? -1 : 1);
    return;
  }
  viewer.zoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15);
  viewer.render();
}, { capture: true, passive: false });

// 활성 빈 자리를 step만큼 돌린다. state.ghost를 다시 계산해야 pos/색이 함께 갱신된다.
function cycleSlot(step) {
  if (!state.ghost) return;
  state.slot = state.ghost.slot + step;
  state.ghost = previewAttach(state.ghost.anchor, state.element);
  state.slot = state.ghost.slot;
  blinkOn = true;
  drawGhost();
}
```

> `cycleSlot`은 `previewAttach`/`drawGhost` 정의보다 앞에서 호출되지만 `function` 선언은 호이스팅되므로 문제없다. 다만 읽기 편하도록 `cycleSlot`은 `drawGhost` 바로 아래(`src/app.js`의 고스트 섹션)로 옮겨 두어도 된다.

`src/app.js:773-780`의 키보드 핸들러에 `R`과 숫자 핫바를 추가한다(`Escape` 분기 바로 뒤).

```js
  if (ev.key === 'r' || ev.key === 'R') { cycleSlot(1); return; }
  // 원소 핫바: 숫자키 1~9가 팔레트 앞 9개 원소에 대응한다(마인크래프트 핫바).
  if (/^[1-9]$/.test(ev.key) && !ev.ctrlKey && !ev.metaKey) {
    const el = ELEMENTS[Number(ev.key) - 1];
    if (el) { state.element = el; state.slot = 0; setTool('place'); toast(`${el} 선택`); }
    return;
  }
```

- [ ] **Step 7: 우클릭 = 제거 (3D·2D 공통)**

`src/app.js`의 클릭 핸들러 바로 아래에 추가한다.

```js
// 마인크래프트 규약: 좌클릭 배치, 우클릭 제거. 도구를 바꾸지 않고도 즉시 지울 수 있다.
// 3D와 2D가 히트테스트 방식만 다르고 동작은 같으므로 deleteAtom 하나를 공유한다.
viewerEl.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  if (state.flat) return; // 2D가 위에 덮여 있으면 아래 핸들러가 처리한다
  const hit = pickAtom(ev.pageX, ev.pageY, 24);
  if (hit !== -1) deleteAtom(hit);
});
sketch2dEl.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  const hit = ev.target.closest('[data-atom]');
  if (hit) deleteAtom(Number(hit.dataset.atom));
});
```

> `sketch2dEl`은 `src/app.js:693`에서 선언되므로, 이 블록은 그 선언 **뒤**(2D 섹션 끝, 757행의 click 핸들러 아래)에 둔다.

팔레트 버튼에 단축키 번호를 표기한다 — `src/app.js:539`를 바꾼다.

```js
$('palette').innerHTML = ELEMENTS.map((el, k) =>
  `<button data-el="${el}" title="${k < 9 ? `단축키 ${k + 1}` : ''}">${el}</button>`).join('');
```

`src/app.js:540-545`의 팔레트 클릭에서 슬롯을 초기화한다.

```js
$('palette').onclick = (ev) => {
  const btn = ev.target.closest('button[data-el]');
  if (!btn) return;
  state.element = btn.dataset.el;
  state.slot = 0;
  setTool('place');
};
```

`index.html:220`의 title을 바꾼다.

```html
  <div id="palette" title="원소를 고르면 붙이기 도구로 전환됩니다 (숫자키 1~9)"></div>
```

- [ ] **Step 8: 수동 확인**

```bash
node --test          # 여전히 전체 PASS여야 한다
python3 -m http.server 8000
```

`http://localhost:8000`에서 순서대로 확인한다.
1. 메탄 프리셋 → 지우개로 H 3개를 지운다 → 팔레트 `H`(또는 숫자키 1) → 탄소를 조준한다.
   → 탄소에 하늘색 와이어프레임 구, 흐린 빈 자리 2개, 깜빡이는 활성 자리 1개가 보여야 한다.
2. `R`을 누르거나 휠을 굴린다 → 활성 자리가 세 자리를 순환해야 한다(확대/축소가 되면 안 된다).
3. 클릭 → **깜빡이던 바로 그 자리에** H가 붙어야 한다.
4. H를 조준하고 클릭 → 아무 일도 일어나지 않고 `원자가가 가득 찼습니다` 토스트가 떠야 한다(T1 확인).
5. 아무 원자나 우클릭 → 삭제되고 브라우저 컨텍스트 메뉴는 안 떠야 한다. 2D 보기에서도 동일.
6. 붙이기 도구가 아닐 때 휠 → 종전대로 확대/축소.

- [ ] **Step 9: 커밋**

```bash
git add src/app.js index.html
git commit -m "feat: minecraft-style placement — slot cycling, target outline, hotbar, right-click break"
```

---

### Task 5: 경고를 문제 원자 위에 직접 그리고 HUD를 요약한다

T1으로 새 구조에서는 원자가 초과가 애초에 안 생기지만, 링크·localStorage·갤러리로 들어오는 기존 구조에는 여전히 있을 수 있고 VSEPR 편차 경고는 계속 발생한다. 지금은 그 경고가 좌상단 텍스트 칩으로만 나오고, 문제 원자가 많으면 화면 절반을 덮는 칩 벽이 된다. 문제 원자에 **직접** 표식을 그리고 HUD는 요약만 보여준다.

**Files:**
- Modify: `src/snap.js` (파일 끝에 `hudSummary` 추가)
- Modify: `src/app.js:142-187` (`render`), `src/app.js:229-233` (HUD 갱신)
- Test: `test/snap.test.js`

**Interfaces:**
- Consumes: `stability(mol) -> { score, issues: [{ atom, level, msg }] }` (기존).
- Produces: `hudSummary(st, max = 3) -> { score, shown: Issue[], more: number }` — `shown`은 danger 우선 정렬 후 앞에서 `max`개, `more`는 남은 개수.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/snap.test.js`의 snap import에 `hudSummary`를 추가하고 파일 끝에 붙인다.

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/snap.test.js`
Expected: FAIL — `does not provide an export named 'hudSummary'`.

- [ ] **Step 3: 최소 구현**

`src/snap.js`의 `stability` 함수 바로 아래에 추가한다.

```js
// HUD에 실제로 그릴 것만 골라낸다. 문제 원자가 20개면 칩 20개가 화면 절반을 덮어
// 아무것도 못 읽는다 — 심각한 것 몇 개만 보여주고 나머지는 개수로 접는다.
// 위치 정보는 3D 표식(app.render)이 담당하므로 HUD는 "얼마나 나쁜지"만 알리면 된다.
export function hudSummary(st, max = 3) {
  const rank = (x) => (x.level === 'danger' ? 0 : 1);
  const sorted = [...st.issues].sort((a, b) => rank(a) - rank(b));
  return { score: st.score, shown: sorted.slice(0, max), more: Math.max(0, sorted.length - max) };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/snap.test.js`
Expected: PASS.

- [ ] **Step 5: 3D에 표식을 그린다**

`src/app.js:6-8` import에 `hudSummary`를 추가한다.

```js
import {
  canBond, vseprCheck, newSnapEvents, idealDirection, openSlots, stability, hudSummary, syncHydrogens,
} from './snap.js';
```

`src/app.js:139`의 선언 옆에 배열을 추가한다.

```js
let selectionShapes = []; // render()가 만드는 노란 강조 구 — 이 배열만 지웠다 다시 그린다.
let warnShapes = [];      // 문제 원자 위의 경고 표식 — 같은 생명주기로 관리한다.
```

`src/app.js:149-150`의 정리 루프 옆에 추가한다.

```js
  for (const s of selectionShapes) viewer.removeShape(s);
  selectionShapes = [];
  for (const s of warnShapes) viewer.removeShape(s);
  warnShapes = [];
```

`src/app.js:167`(선택 강조 루프) 바로 뒤에 표식 그리기를 넣는다.

```js
  // 경고를 문제 원자 위에 직접 그린다. 지금까지는 좌상단 텍스트 칩뿐이라, 원자 색이 전부
  // 응력 색(파랑~빨강)인 3D 화면에서 어느 원자가 문제인지 알 방법이 없었다.
  // 빨강 와이어프레임 = 심각(원자가 초과 등), 주황 = 경고(VSEPR 편차·초원자가).
  const st = stability(state.mol);
  state.lastStability = st;
  const worst = new Map();
  for (const x of st.issues) {
    if (worst.get(x.atom) !== 'danger') worst.set(x.atom, x.level);
  }
  for (const [i, level] of worst) {
    const p = state.mol.atoms[i].pos;
    warnShapes.push(viewer.addSphere({
      center: { x: p[0], y: p[1], z: p[2] },
      radius: level === 'danger' ? 0.52 : 0.46,
      color: level === 'danger' ? '#dc2626' : '#f59e0b',
      opacity: 0.85, wireframe: true,
    }));
  }
```

- [ ] **Step 6: HUD를 요약으로 바꾼다**

`src/app.js:229-233`을 교체한다(`stability`를 다시 부르지 않고 `render`가 저장해 둔 값을 쓴다 — 한 프레임에 두 번 계산할 이유가 없다).

```js
  // 안정도 HUD: 점수 + 심각한 것 몇 개만. 나머지는 개수로 접고, 어느 원자인지는
  // 3D 표식(render의 warnShapes)이 직접 가리킨다.
  const s2 = hudSummary(state.lastStability ?? stability(state.mol));
  const scoreColor = s2.score >= 80 ? 'var(--success)' : s2.score >= 50 ? 'var(--accent)' : '#dc2626';
  $('stability').innerHTML = `<span style="color:${scoreColor};font-weight:700">${s2.score}</span>`
    + s2.shown.map((x) => `<span class="chip ${x.level}">${x.level === 'danger' ? '✕' : '▲'} ${x.msg}</span>`).join('')
    + (s2.more ? `<span class="chip">+${s2.more}개</span>` : '');
```

- [ ] **Step 7: 전체 확인 + 수동 확인**

Run: `node --test`
Expected: 전체 PASS.

```bash
python3 -m http.server 8000
```
`http://localhost:8000/#s=` 없이 열고, 프리셋 `오염화 인 PCl₅`를 고른다 → 초원자가 경고가 있으므로 P 원자에 주황 와이어프레임 구가 보이고, HUD는 점수 + 칩 최대 3개 + `+N개`로 접혀야 한다.

- [ ] **Step 8: 커밋**

```bash
git add src/snap.js src/app.js test/snap.test.js
git commit -m "feat: draw stability warnings on the offending atoms, collapse the HUD"
```

---

### Task 6: 그리드 제거 + 렌더 병목 제거

그리드(정육면체 6면 × 13줄 × 2 = 156개 `addLine` 셰이프)를 통째로 지운다. 남은 렉의 실제 원인 셋을 정확히 겨냥한다: ① 원자마다 `viewer.setStyle` 개별 호출(3Dmol이 호출마다 전체 원자를 훑으므로 O(n²)) ② `render()`가 매번 `buildTerms`를 새로 만듦(vdW 항이 O(n²)개, 클로저까지 새로 할당) ③ 렌더마다 동기 `localStorage` 쓰기.

**Files:**
- Modify: `src/app.js` — 그리드 블록(78-109) 삭제, `state.showGrid`(24) 삭제, 그리드 배선(807-815) 삭제, `saveLocal`(33-36), `render`(142-187)
- Modify: `src/uff.js` (파일 끝에 `topologyKey` / `cachedTerms` 추가)
- Modify: `index.html:205` (그리드 체크박스 삭제)
- Test: `test/uff.test.js`

**Interfaces:**
- Consumes: `buildTerms(mol)`, `energy(mol, terms)` (기존 — `energy`는 이미 terms를 인자로 받는다).
- Produces:
  - `topologyKey(mol) -> string` — 원소 목록 + 결합 목록(차수 포함)만으로 만든 문자열. 좌표는 절대 포함하지 않는다.
  - `cachedTerms(mol) -> Term[]` — `topologyKey`가 같으면 이전 배열을 그대로 돌려준다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/uff.test.js`의 import에 `topologyKey, cachedTerms`를 추가하고 파일 끝에 붙인다.

```js
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
```

`test/uff.test.js` 상단 import에 `loadPreset`과 `addAtom`이 없으면 추가한다.

```js
import { createMolecule, addAtom, addBond } from '../src/model.js';
import { loadPreset } from '../src/presets.js';
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/uff.test.js`
Expected: FAIL — `does not provide an export named 'topologyKey'`.

- [ ] **Step 3: 최소 구현**

`src/uff.js`의 `energy` 함수 바로 아래에 추가한다.

```js
// 항(term)은 좌표가 아니라 위상(원소 + 결합 목록)에만 의존한다 — bondLength·힘상수는
// 원자 타입에서 나오고, vdW 제외쌍도 결합 그래프에서 나온다. eval은 매번 넘겨받은 mol의
// 현재 좌표를 읽으므로, 위상이 그대로면 좌표가 아무리 움직여도 같은 항을 계속 쓸 수 있다.
export function topologyKey(mol) {
  return mol.atoms.map((a) => a.el + (a.type ?? '')).join(',')
    + '|' + mol.bonds.map((b) => `${b.i}-${b.j}:${b.order}`).join(',');
}

// render()가 클릭·슬라이더·마우스 이동마다 buildTerms를 새로 돌리던 것을 없앤다
// (vdW 항만 O(n²)개, 항마다 클로저 할당). 캐시 슬롯은 하나로 충분하다 — 앱은 한 번에
// 분자 하나만 다룬다.
// ponytail: 슬롯 1개 캐시. 여러 분자를 동시에 다루게 되면 Map으로 바꾼다.
let termCache = { key: null, terms: null };
export function cachedTerms(mol) {
  const key = topologyKey(mol);
  if (termCache.key !== key) termCache = { key, terms: buildTerms(mol) };
  return termCache.terms;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/uff.test.js`
Expected: PASS.

- [ ] **Step 5: 그리드를 통째로 지운다**

- `src/app.js:78-109` — `gridShapes` 선언, `buildGrid()`, `clearGrid()` 전체 삭제(위의 주석 블록 포함).
- `src/app.js:24` — `showGrid: true,` 삭제.
- `src/app.js:807-812` — 그리드 주석과 `$('grid').onchange` 핸들러 삭제.
- `src/app.js:815` — `if (state.showGrid) buildGrid();` 삭제.
- `src/app.js:146-148` — `removeAllShapes()`를 안 쓰는 이유를 설명하던 주석에서 그리드 언급을 뺀다.

```js
  // removeAllShapes()는 쓰지 않는다 — 붙이기 고스트까지 함께 지워버리기 때문이다.
  // 이 함수가 만든 선택 강조 구와 경고 표식만 추적해서 그것만 지운다.
```

- `index.html:205` — 아래 줄 삭제.

```html
  <label class="check"><input type="checkbox" id="grid" checked>그리드</label>
```

- [ ] **Step 6: `setStyle`을 한 번만 부른다**

`src/app.js:151-159`를 교체한다.

```js
  viewer.addModel(toXYZ(state.mol), 'xyz');

  const vmax = Math.max(0.5, ...e.perAtom); // 0.5 kcal/mol 미만 차이는 노이즈로 본다
  // 원자마다 setStyle을 부르면 3Dmol이 호출마다 전체 원자를 훑어서 O(n²)가 된다 —
  // 원자 수십 개만 돼도 클릭·드래그가 눈에 띄게 끊겼다. 색만 원자별로 다르므로
  // colorfunc 하나로 넘겨 setStyle은 딱 한 번만 부른다(serial = XYZ 모델의 0-based 인덱스).
  const colors = state.mol.atoms.map((_, i) => strainColor(e.perAtom[i], vmax));
  viewer.setStyle({}, {
    sphere: { radius: 0.30, colorfunc: (atom) => colors[atom.serial] },
    stick: { radius: 0.14, colorfunc: (atom) => colors[atom.serial] },
  });
```

- [ ] **Step 7: 캐시된 항과 지연 저장을 쓴다**

`src/app.js:1-2`의 import에 `cachedTerms`를 추가한다.

```js
import { energy, minimize, scanDihedral, typeAtom, cachedTerms } from './uff.js';
```

`src/app.js:143`을 바꾼다.

```js
  const e = energy(state.mol, cachedTerms(state.mol));
```

`src/app.js:33-36`의 `saveLocal`을 교체한다.

```js
// render()가 불릴 때마다 동기로 쓰면(마우스 이동·슬라이더 한 칸마다) 문자열 직렬화 +
// localStorage 쓰기가 프레임을 막는다. 마지막 조작에서 400 ms 뒤 한 번만 쓴다.
let saveTimer;
function saveLocal() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, encodeState(state.mol)); }
    catch { /* 용량 초과·프라이빗 모드 등은 무시한다. 저장 실패가 앱을 막으면 안 된다. */ }
  }, 400);
}
```

- [ ] **Step 8: 전체 확인 + 수동 확인**

Run: `node --test`
Expected: 전체 PASS.

```bash
python3 -m http.server 8000
```
1. 그리드가 없고 헤더에 그리드 체크박스도 없어야 한다. 콘솔에 에러가 없어야 한다(`$('grid')`가 null인데 참조하면 여기서 터진다).
2. 프리셋 `사이클로헥산 (의자)`(원자 18개)를 고르고 회전·이면각 슬라이더를 드래그한다 → 끊김 없이 따라와야 한다.
3. 원자 색이 여전히 응력 히트맵(파랑~빨강)으로 보여야 한다 — `colorfunc`가 안 먹으면 전부 회색/기본색이 된다. 그 경우 폴백으로 원자별 `setStyle` 대신 `viewer.getModel().setColorByFunction`이 아니라, `addModel` 후 `viewer.getModel().selectedAtoms({}).forEach((a, i) => { a.color = ...; })`를 쓰고 `setStyle({}, { sphere: {}, stick: {} })`로 바꾼다.
4. 새로고침 → 마지막 구조가 복원돼야 한다(지연 저장이 실제로 쓰이는지 확인).

- [ ] **Step 9: 커밋**

```bash
git add src/app.js src/uff.js index.html test/uff.test.js
git commit -m "perf: drop the reference grid, batch setStyle, cache UFF terms, debounce autosave"
```

---

### Task 7: 2D 골격식에 선택 상태를 그린다

2D에서 `state.selection`이 SVG에 전혀 그려지지 않는다 — 원자를 클릭해도 아무 변화가 없어 보이고, 측정·이면각 패널만 조용히 바뀐다. 3D는 노란 반투명 구로 표시하므로 2D도 같은 색·같은 의미로 맞춘다.

**Files:**
- Modify: `src/sketch2d.js:315` (`renderSVG` 시그니처), 히트타깃 블록(420-425) 앞
- Modify: `src/app.js:180-185` (`render`의 2D 갱신), `src/app.js:707-714` (`renderFlat`)
- Test: `test/sketch2d.test.js`

**Interfaces:**
- Consumes: `state.selection: number[]` (기존).
- Produces: `renderSVG(mol, { scale, ghost, bondPreview, selection })` — `selection`은 원자 인덱스 배열, 기본값 `[]`. 선택된 원자 중 2D에 좌표가 있는 것만(무거운 원자) 노란 원으로 그린다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/sketch2d.test.js` 끝에 추가한다(파일 상단에 이미 `renderSVG`, `loadPreset` import가 있다 — 없으면 추가).

```js
test('renderSVG: 선택된 무거운 원자를 노란 원으로 표시한다', () => {
  const m = loadPreset('ethane');
  assert.ok(!renderSVG(m).includes('data-sel'), '선택이 없으면 표시하지 않는다');
  const svg = renderSVG(m, { selection: [0] });
  assert.equal((svg.match(/data-sel/g) ?? []).length, 1);
});

test('renderSVG: 2D 좌표가 없는 수소를 선택해도 터지지 않는다', () => {
  const m = loadPreset('ethane');
  const svg = renderSVG(m, { selection: [2] }); // 원자 2는 H — layout()이 배치하지 않는다
  assert.ok(!svg.includes('data-sel'));
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/sketch2d.test.js`
Expected: FAIL — 첫 테스트의 `assert.equal(0, 1)`.

- [ ] **Step 3: 최소 구현**

`src/sketch2d.js:315`의 시그니처를 바꾼다.

```js
export function renderSVG(mol, { scale = 42, ghost = null, bondPreview = null, selection = [] } = {}) {
```

`src/sketch2d.js:420`(`let hitsSvg = '';`) 바로 앞에 추가한다.

```js
  // 선택 강조. 3D의 노란 반투명 구(app.render)와 같은 색·같은 의미다. 골격식은 수소에
  // 좌표를 주지 않으므로(H는 라벨에 접힌다) pos에 있는 원자만 그린다.
  let selSvg = '';
  for (const i of selection) {
    if (!pos.has(i)) continue;
    const [x, y] = [sx(pos.get(i)[0]), sy(pos.get(i)[1])];
    selSvg += `<circle data-sel="${i}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" `
      + 'fill="#facc15" opacity="0.35"/>';
  }
```

`src/sketch2d.js:452-453`의 반환문에서 `selSvg`를 결합선 **앞**에 둔다(강조가 선 아래에 깔려야 글자·선을 가리지 않는다).

```js
  return `<svg viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" width="100%" height="100%">`
    + `${selSvg}${bondsSvg}${labelsSvg}${hitsSvg}${ghostSvg}${bondPreviewSvg}</svg>`;
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/sketch2d.test.js`
Expected: PASS.

- [ ] **Step 5: 두 호출부에 선택을 넘긴다**

`src/app.js:180-185`(`render` 안):

```js
  if (state.flat) {
    const bondPreview = state.tool === 'bond' && state.pendingBond !== null
      ? { a: state.pendingBond, b: bondHover2d, ok: bondHover2d == null ? undefined : canBond(state.mol, state.pendingBond, bondHover2d).ok }
      : null;
    $('sketch2d').innerHTML = renderSVG(state.mol, { bondPreview, selection: state.selection });
  }
```

`src/app.js:707-714`(`renderFlat`):

```js
function renderFlat() {
  if (!state.flat) return;
  const ghost = ghost2d && { ...ghost2d, opacity: blink2dOn ? 0.6 : 0.22 };
  const bondPreview = state.tool === 'bond' && state.pendingBond !== null
    ? { a: state.pendingBond, b: bondHover2d, ok: bondHover2d == null ? undefined : canBond(state.mol, state.pendingBond, bondHover2d).ok }
    : null;
  sketch2dEl.innerHTML = renderSVG(state.mol, { ghost, bondPreview, selection: state.selection });
}
```

- [ ] **Step 6: 전체 확인 + 수동 확인**

Run: `node --test`
Expected: 전체 PASS.

`http://localhost:8000`에서 `2D 보기` → 선택 도구로 탄소를 클릭 → 노란 원이 보여야 한다. Shift+클릭으로 여러 개, `Esc`로 해제까지 확인한다.

- [ ] **Step 7: 커밋**

```bash
git add src/sketch2d.js src/app.js test/sketch2d.test.js
git commit -m "feat: show selection highlight in the 2D skeletal view"
```

---

### Task 8: README 반영 + 최종 검증

**Files:**
- Modify: `README.md` (조작법 표, 결합 각도/불안정 항목, 그리드 항목, 안정도 HUD 항목)
- Test: 전체 스위트

- [ ] **Step 1: 조작법 표에 새 조작을 넣는다**

`README.md:22-27`의 표 아래(`- **결합 각도:**` 앞)에 추가한다.

```markdown
- **마인크래프트식 배치:** 붙이기 도구로 원자를 조준하면 그 원자에 하늘색 외곽선이 씌워지고,
  남은 결합 자리가 **전부** 흐린 구로 보인다. 그중 하나만 깜빡이는데 그게 실제로 붙을 자리다.
  `R` 키 또는 휠로 자리를 순환해 원하는 방향을 고른 뒤 클릭한다(휠은 조준 중일 때만 자리
  순환이고, 그 외에는 종전대로 확대/축소다). **우클릭**은 도구와 무관하게 그 원자를 제거한다
  (3D·2D 공통). **숫자키 1~9**는 원소 핫바다(H C N O F S P Cl Si 순).
```

- [ ] **Step 2: 원자가 규칙 설명을 바꾼다**

`README.md:30`의 "불안정해도 일단 붙는다" 항목을 아래로 교체한다.

```markdown
- **불가능한 결합은 막힌다:** 원자가 상한을 넘는 결합은 클릭 자체가 거부된다 — H끼리 사슬을
  잇거나 탄소에 다섯 번째 결합을 다는 것은 어떤 조건에서도 불가능하기 때문이다. 상한은
  초원자가 확장이 실재하는 원소(P·S·Si·할로젠)에서만 확장된 값을 쓰므로 SF₆·PCl₅는 그대로
  만들 수 있다. 미리보기 구 색으로 미리 알 수 있다 — **초록**=정상, **주황**=초원자가(붙지만
  UFF 정확도 주의), **빨강**=못 붙음(원자가 포화·자기 자신·이미 결합됨·미지원 원소).
```

- [ ] **Step 3: 그리드 항목을 지우고 HUD 설명을 갱신한다**

`README.md:38`의 `- **그리드:** ...` 줄을 통째로 삭제한다.

`README.md:39`의 안정도 HUD 항목을 교체한다.

```markdown
- **안정도 HUD:** 뷰어 좌상단에 0~100 점수와 심각한 문제 칩 최대 3개(+나머지 개수)가 뜬다.
  어느 원자가 문제인지는 3D 화면에서 그 원자에 직접 씌워지는 와이어프레임 구가 가리킨다 —
  **빨강**=심각(원자가 초과 등), **주황**=경고(VSEPR 편차·초원자가).
```

- [ ] **Step 4: 2D 항목에 선택 표시를 언급한다**

`README.md:34`의 2D 보기 항목 끝(`...이미 완전한 분자면 아무 변화도 없다.`) 뒤에 한 문장을 덧붙인다.

```markdown
  선택한 원자는 3D와 같은 노란 강조로 표시된다(수소는 골격식에 좌표가 없어 표시되지 않는다).
```

- [ ] **Step 5: 물리 모델 절에 혼성 판정 규칙을 명시한다**

`README.md:59`(`- **역장:** UFF ...`) 아래에 추가한다.

```markdown
- **혼성(원자 타입) 판정:** 결합 개수가 아니라 **최대 결합 차수**로 정한다(단일만=sp3,
  이중 포함=sp2, 삼중=sp). 방향족은 자동 인식하지 않고 케쿨레 구조 그대로 다룬다.
```

- [ ] **Step 6: 최종 전체 검증**

```bash
node --test
```
Expected: fail 0. 특히 `test/validation.test.js`(문헌값 검증)가 전부 초록인지 눈으로 확인한다 — 여기가 빨간불이면 T2의 혼성 판정 변경이 물리 결과를 바꾼 것이므로 되돌린다.

```bash
python3 -m http.server 8000
```
브라우저 콘솔을 열고 아래를 순서대로 밟으면서 **에러가 하나도 없는지** 확인한다.
1. 새로고침 → 마지막 구조 복원.
2. 프리셋 전부 순회(메탄·물·암모니아·에틸렌·에탄·부탄·SF₆·PCl₅·의자·보트).
3. 붙이기(슬롯 순환 포함) → 지우개 → 결합 → 선택 → 복제 → 실행취소.
4. 2D 보기 전환 → 2D에서 조립·선택·우클릭 삭제 → 3D 복귀.
5. 구조 최적화 → 리플레이 슬라이더 → 이면각 회전 → 이면각 스캔.
6. XYZ/MOL/PDB 내보내기, 링크 복사.

- [ ] **Step 7: 커밋 & 푸시**

```bash
git add README.md
git commit -m "docs: update README for valence blocking, slot placement, grid removal"
git push -u origin claude/web-improvement-prep-agdiml
```

---

## 명시적으로 하지 않는 것

- **결합 차수 편집 UI** — 사용자 결정으로 이번 범위 밖. 조립으로 만드는 결합은 계속 order 1이다. 그래서 벤젠·에틸렌은 프리셋으로만 볼 수 있다. 넣게 되면 `handleBondClick`에 "이미 결합된 쌍을 다시 찍으면 차수 순환" 분기를 더하고, 순환마다 `canBond`가 아니라 `bondOrderSum + 1 <= capMax`를 직접 확인하면 된다.
- **격자(voxel) 스냅** — 사용자 결정으로 제외. 좌표를 90°/45° 격자에 맞추면 조립감은 좋아지지만 결합각이 화학적으로 틀어져 UFF 결과 전체가 무의미해진다.
- **방향족 인식(C_R/N_R/O_R)** — `findRings`는 이미 있지만 휘켈 판정이 별도로 필요하다. 결합 차수 편집이 들어온 뒤에 하는 게 맞다.
- **형식 전하·라디칼** — README가 이미 미지원으로 명시. 원자가 차단(T1)이 들어가면 라디칼 중간체를 못 만들게 되는데, 지금 앱이 라디칼을 다루지 않으므로 실질 손실이 없다.
- **해석적 미분** — `gradient`의 항별 중심차분은 원자 수십 개 규모에서 병목이 아니다. `render()` 병목(T6)이 훨씬 크고, 그것부터 지운다.
- **2D 고스트 위치의 정확도** — `layout()`이 매번 처음부터 다시 배치하므로 미리보기와 최종 위치가 어긋날 수 있다(코드 주석에 이미 명시된 한계). 고치려면 `layout()`이 기존 좌표를 존중하도록 증분 배치로 바꿔야 하는데, 그건 별도 계획이 필요한 크기다.

## Self-Review

**1. 요구 커버리지**

| 요구 | 커버 |
|---|---|
| 1. H 연쇄 경고 | T1(생성 차단) + T5(3D 표식·HUD 요약) ✅ |
| 2. 그리드 제거 + 렉 | T6(그리드 삭제 + 3대 병목) ✅ |
| 3. 실제 화학법칙 | T1(원자가 차단) + T2(혼성 판정) ✅ / 결합 차수는 사용자 결정으로 제외(명시함) |
| 4. 2D 레고 조립 | T4(우클릭·핫바가 2D에도 적용) + T7(선택 표시) ✅ |
| 5. 마인크래프트 조작감 | T3 + T4 ✅ |
| 6. 직접 조립 개선 | T3(슬롯 열거) + T4(순환·조준 강조) ✅ |

**2. 플레이스홀더 스캔** — "적절히 처리", "테스트 추가" 같은 문구 없음. 모든 코드 단계에 실제 코드 블록이 있다. DOM 배선 태스크(T4)는 자동 테스트가 불가능하므로 6단계짜리 구체적 수동 확인 절차로 대체했고, 그 사실을 태스크 머리에 명시했다.

**3. 타입 일관성**
- `canBond` reason: T1에서 `'ok-overloaded'` 제거 → T4의 `previewAttach`/`drawGhost`는 `'ok'`/`'ok-expanded'`/`false`만 참조한다. 일치.
- `state.ghost`: T4에서 `{ anchor, slots, slot, pos, ok, reason, el }`로 확장 → `drawGhost`와 클릭 핸들러가 같은 필드명을 쓴다. 2D 전용 `ghost2d`는 `{ anchorIdx, el, ok, reason }`로 **별개 구조**이며 이번에 바꾸지 않는다(`sketch2d.renderSVG`의 `ghost` 옵션이 `anchorIdx`를 기대하므로 건드리면 안 된다).
- `openSlots` 반환은 방향 배열(`number[][]`), `idealDirection` 반환은 방향 하나(`number[]`). T4의 `attachAtom({ dir })`는 후자를 받는다. 일치.
- `hudSummary`는 `{ score, shown, more }` — T5의 HUD 템플릿이 세 필드를 모두 쓴다. 일치.
- `cachedTerms`는 `energy(mol, terms)`의 두 번째 인자로 들어간다 — `energy`의 기존 시그니처(`energy(mol, terms = buildTerms(mol))`) 그대로다. 일치.

## 태스크 의존 순서

T1 → T2 → T3 → T4 (T4는 T1·T3에 의존)
T5는 T1 뒤 아무 때나. T6·T7은 독립.
권장 순서: **T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8**.
