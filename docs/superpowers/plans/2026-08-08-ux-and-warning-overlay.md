# 조작감 개선 + 경고 오버레이 + 수소 자동채움 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2D↔3D 전환이 분자를 멋대로 바꾸지 않게 하고, 경고 하이라이트를 실제로 보이게 만들고, WASD 카메라와 도구 힌트로 조작감을 전문 도구 수준으로 올린다.

**Architecture:** 이번 문제 중 셋(1·3·4번)은 **잘못된 자리에 구현했기 때문에** 생겼다. 수소 채움은 사용자 명령이어야 하는데 화면 전환에 얹혀 있고, 경고 하이라이트는 화면 신호여야 하는데 3D 반투명 구로 만들어 조명에 색이 씻겨나갔다. 그래서 수정은 "기능을 옮기는 것"이지 새 알고리즘이 아니다. 2번(조작감)만 실제 신규 코드이며, 그것도 3Dmol이 이미 제공하는 `rotate`/`zoom`/`translate`에 키 상태 루프를 얹는 것이 전부다.

**Tech Stack:** 바닐라 ES 모듈, 빌드 단계 없음. 3Dmol.js(CDN), 테스트는 `node --test`.

## Global Constraints

- 빌드 단계·npm 의존성 추가 금지.
- DOM/3Dmol 배선은 `node --test`로 검증 불가 — 순수 함수로 뽑아 그것만 테스트한다. `src/app.js`는 테스트 대상이 아니다.
- 주석·UI 문자열은 한국어. 기존 파일의 주석 밀도와 어조를 따른다.
- 착수 전 기준선: `node --test` = **141 pass / 0 fail**. 매 태스크 종료 시 전체 스위트가 초록이어야 한다.
- `test/validation.test.js`(문헌값 검증)는 **어떤 태스크에서도 완화하면 안 된다.**
- **3Dmol API를 추측해서 쓰지 않는다.** 새 메서드를 쓰기 전 CDN 번들에 그 이름이 실제로 있는지 grep으로 먼저 확인한다(이전 라운드에서 존재하지 않는 `radiusfunc`를 써서 렌더링이 통째로 깨진 적이 있다).
- 분자를 바꾸는 모든 조작은 `pushUndo()`를 먼저 부른다. 되돌릴 수 없는 변형을 만들지 않는다.
- 브랜치: `claude/web-improvement-prep-agdiml`. 태스크마다 커밋.

---

## 진단 결과 (코드로 재현 완료)

### (A) 2D→3D 전환이 분자를 멋대로 바꾼다 — 요구 1

`$('view2d').onclick`이 3D로 돌아갈 때마다 `syncHydrogens(state.mol)`를 **무조건** 부른다. `syncHydrogens`는 원자가가 빈 자리를 전부 H로 채운다.

```
2D에서 만든 것 : C4     (탄소 사슬 4개 — 여기에 O를 더 붙일 생각이었다)
3D 전환 후     : C4H10  ← 묻지도 않고 H 10개가 붙었다

의도: C-O 단일결합을 그려두고 나중에 차수를 2로 올려 카보닐(C=O)을 만들 계획
  현재    : CO
  전환 후 : CH4O  ← C에 H3, O에 H1이 붙어 메탄올이 됐다
```

게다가 **이 변형에는 `pushUndo()`가 없다.**

```
grep -c pushUndo  (view2d 핸들러 안)  →  0
```

즉 `Ctrl+Z`로도 되돌릴 수 없다. 화면을 보려고 버튼을 눌렀을 뿐인데 분자가 영구히 바뀐다.

사용자가 덧붙인 "비공유전자쌍의 도입 검토"는 이 문제의 다른 얼굴이다 — 산소의 빈 자리 두 개는 **채워야 할 결함이 아니라 비공유 전자쌍**인데, 지금 UI에는 그 구분이 어디에도 드러나지 않는다. `openSlots`는 이미 비공유쌍 자리를 계산해 돌려주지만(물의 O → 2개), 붙이기 도구로 조준하면 `canBond`가 거부해 그냥 **빨간 구**만 뜬다. 왜 빨간지는 알려주지 않는다.

### (B) 경고 하이라이트가 사실상 보이지 않는다 — 요구 4

CH₃ 라디칼(탄소 원자가 1 부족 → `warn`)을 띄우고 화면 픽셀을 직접 읽었다. warn 헤일로 색은 `#f59e0b` = `rgb(245,158,11)`이다.

```
탄소 중심에서 아래로 스캔 (배경 248,250,252 / 탄소 CPK 96,96,96 / warn 헤일로 245,158,11)
  +  0px rgb( 68, 66, 63)   ← 원자 위. R이 G·B보다 겨우 2~5 높다
  + 32px rgb( 93, 91, 88)
  + 56px rgb(236,237,237)   ← 헤일로 영역인데 R≈G≈B
  + 64px rgb(245,246,246)   ← 오렌지라면 G=158·B=11이어야 한다
  + 80px rgb(242,244,246)
  + 88px rgb(248,250,252)   ← 배경
```

**헤일로가 색을 거의 잃고 옅은 회백색 얼룩으로만 남는다.** 원인은 세 가지가 겹친 것이다.

1. `opacity: 0.16`(warn)은 밝은 배경(248,250,252)에서 애초에 거의 사라진다.
2. 3Dmol의 반투명 구는 **조명을 받는다.** 하이라이트가 색을 씻어내 회백색이 된다(측정값이 산술 혼합 예측치보다도 더 하얗게 나온 이유).
3. 구는 3D 물체라 원자 뒤로 잘리고 두께가 생겨, 화면에서는 "테두리"가 아니라 "흐릿한 공"이 된다.

여기에 **네 번째 문제**가 있다. 별도로 측정한 PCl₅ 화면:

```
P 원자 픽셀 rgb(243,122,0)
```

P의 CPK 색이 `#ff8000`(주황), S는 `#e6c53d`(노랑)이다. warn 헤일로 `#f59e0b`와 **색이 사실상 같아서**, 하필 경고가 가장 자주 뜨는 초원자가 원소에서 신호와 원소색이 구분되지 않는다.

→ 3D 반투명 구로는 이 문제를 못 고친다. 경고는 **화면 공간(screen-space) 신호**여야 한다.

### (C) 카메라를 키보드로 못 움직인다 — 요구 2

현재 조작 전부:

```
마우스 드래그 : 3Dmol 기본 궤도 회전
휠            : 확대/축소 (붙이기 조준 중에는 슬롯 순환)
R             : 붙일 자리 순환
1~9           : 원소 핫바
우클릭        : 원자 삭제
Ctrl+A/Z/D · Del · Esc
```

**키보드 카메라 조작이 하나도 없다.** 마인크래프트식 조작감의 뼈대인 "키를 누르고 있으면 계속 움직인다"가 없어서, 시점을 조금 돌리려면 매번 마우스로 드래그해야 한다. `w`·`a`·`s`·`d`·`q`·`e`는 현재 아무 데도 안 쓰여 충돌 없이 배정할 수 있다(`Ctrl+A`·`Ctrl+D`는 수식키가 있어 구분된다).

### (D) 결합 도구가 무엇인지 화면에 안 나온다 — 요구 3

`#tool-bond` 버튼의 라벨은 그냥 **"결합"** 이고, 실제 동작 두 가지는 `title` 속성(마우스를 올려야 뜨는 툴팁)에만 적혀 있다.

```html
<button id="tool-bond" ... title="결합: 원자 두 개를 순서대로 클릭해 잇기(고리 닫기) · 결합선을 클릭하면 차수 1↔2↔3">결합</button>
```

한 도구가 성격이 다른 두 일(원자 잇기 / 결합 차수 바꾸기)을 하는데 이름은 하나뿐이고, 첫 원자를 찍어 `pendingBond` 상태가 되어도 화면에 아무 안내가 없다(3D에서 하늘색 구가 하나 뜰 뿐이다). 다른 도구들도 마찬가지로 상시 설명이 없다.

### 요구 → 원인 → 태스크 매핑

| 요구 | 원인 | 태스크 |
|---|---|---|
| 1. 2D→3D에서 H가 멋대로 붙음 | (A) 화면 전환에 `syncHydrogens`가 얹혀 있고 되돌리기도 없음 | T1 |
| 1-보조. 비공유전자쌍 도입 검토 | (A) 빈 자리가 "결함"인지 "비공유쌍"인지 UI에 안 드러남 | T2 |
| 2. 조작감이 조잡함 | (C) 키보드 카메라 없음 | T4 |
| 3. 결합 도구 용도 불명 | (D) 설명이 툴팁에만 있음 | T5 |
| 4. 옅은 경고 하이라이트가 안 됨 | (B) 3D 반투명 구는 조명에 색이 씻기고 원소색과 충돌 | T3 |

## File Structure

| 파일 | 변경 |
|---|---|
| `src/snap.js` | `slotKinds()` 신설 — 빈 자리를 결합 가능/비공유쌍으로 분류(T2) |
| `src/app.js` | 자동 수소채움 제거·수소 채우기 버튼(T1) · 슬롯 종류별 고스트(T2) · 경고 글로우 오버레이(T3) · WASD 카메라(T4) · 도구 힌트(T5) |
| `index.html` | 수소 버튼(T1) · `#warnlayer`와 글로우 CSS(T3) · `#toolhint`(T5) · 결합 도구 라벨(T5) |
| `README.md` | 전 항목 반영(T6) |

## 태스크 의존 순서

T1 → T2 → T3 → T4 → T5 → T6 (순차)

T3(경고 오버레이)이 T4(카메라)보다 먼저인 이유: 오버레이는 카메라가 움직일 때 위치를 따라가야 하므로, 추적 루프를 먼저 만들어 두면 T4가 그 위에 얹힌다.

---

### Task 1: 2D→3D 전환에서 수소 자동 채움을 걷어낸다

진단 (A). 화면 전환 버튼이 분자를 되돌릴 수 없게 바꾼다. 수소 채움은 **사용자가 명시적으로 요청할 때만** 일어나야 한다.

`syncHydrogens` 함수 자체는 그대로 둔다 — 유용한 기능이고 테스트도 걸려 있다. 부르는 자리만 옮긴다.

**Files:**
- Modify: `src/app.js` (`$('view2d').onclick`, 새 `$('fill-h')` 핸들러)
- Modify: `index.html` (툴바에 "수소 채우기" 버튼)
- Test: 없음 — app.js 배선이다. Step 4의 재현 스크립트와 Step 5의 브라우저 확인으로 검증한다.

**Interfaces:**
- Consumes: `syncHydrogens`(`src/snap.js`, 변경 없음), `pushUndo`·`minimize`·`render`(app.js 내부).
- Produces: 없음. `view2d` 핸들러가 분자를 더 이상 변형하지 않는다.

- [ ] **Step 1: 수정 전 동작을 재현해 기록한다**

```bash
cat > /tmp/probe_sync.mjs <<'EOF'
import { createMolecule, addAtom, addBond } from '/home/user/mol-craft/src/model.js';
import { syncHydrogens, formula } from '/home/user/mol-craft/src/snap.js';
const m = createMolecule();
for (let k = 0; k < 4; k++) addAtom(m, 'C', [k * 1.5, 0, 0]);
addBond(m, 0, 1); addBond(m, 1, 2); addBond(m, 2, 3);
console.log('2D에서 만든 것:', formula(m));
syncHydrogens(m);
console.log('syncHydrogens 후:', formula(m));
EOF
node /tmp/probe_sync.mjs
```
Expected: `C4` → `C4H10`. 이 함수 자체는 정상 동작이다 — 문제는 **아무도 요청하지 않았는데 화면 전환이 이걸 부르는 것**이다.

- [ ] **Step 2: 화면 전환에서 변형을 뺀다**

`src/app.js`의 `$('view2d').onclick`에서 `syncHydrogens`/`minimize` 줄을 지우고 주석을 남긴다.

```js
$('view2d').onclick = () => {
  state.flat = !state.flat;
  document.body.dataset.flat = String(state.flat);
  $('sketch2d').hidden = !state.flat;
  $('view2d').textContent = state.flat ? '3D 보기' : '2D 보기(골격식)';
  $('view2d').setAttribute('aria-pressed', String(state.flat));
  // 화면 전환은 보기만 바꾼다 — 분자는 손대지 않는다. 예전엔 3D로 돌아올 때마다
  // syncHydrogens가 빈 원자가를 전부 H로 채웠는데, 되돌리기 스냅샷도 없어서
  // "탄소 골격만 그려두고 나중에 O를 붙이려던" 계획이 C4H10으로 굳어버렸고
  // 카보닐을 만들려고 남겨둔 C-O가 메탄올이 됐다. 수소 채움은 이제 명시적 버튼이다.
  render();
};
```

- [ ] **Step 3: 명시적 "수소 채우기" 버튼을 만든다**

`index.html`의 툴바에서 `#view2d` 버튼 앞에 넣는다.

```html
  <button id="fill-h" title="빈 원자가를 수소로 채웁니다 (되돌리기 가능)">수소 채우기</button>
```

`src/app.js`에서 `$('view2d').onclick` 근처에 핸들러를 추가한다.

```js
// 빈 원자가를 수소로 채운다. 예전엔 2D->3D 전환이 이걸 몰래 했는데, 화면을 보려고
// 누른 버튼이 분자를 영구히 바꾸는 건(되돌리기 스냅샷도 없었다) 사용자가 예상할 수 없다.
// 이제는 이 버튼을 눌러야만 채워지고, Ctrl+Z로 되돌릴 수 있다.
$('fill-h').onclick = () => {
  const before = state.mol.atoms.length;
  pushUndo();
  syncHydrogens(state.mol);
  const added = state.mol.atoms.length - before;
  if (added === 0) { state.undoStack.pop(); toast('채울 빈 자리가 없습니다'); return; }
  minimize(state.mol, { maxSteps: 120 });
  checkSnaps();
  render();
  toast(`수소 ${added}개 추가`);
};
```

- [ ] **Step 4: 화면 전환이 더 이상 분자를 안 바꾸는지 확인한다**

```bash
grep -n "syncHydrogens" src/app.js
```
Expected: import 줄과 `$('fill-h').onclick` 안, 이 두 곳만. `view2d` 핸들러에는 없어야 한다.

```bash
node --check src/app.js && node --test
```
Expected: 전체 PASS(이 태스크는 테스트를 추가하지 않는다).

- [ ] **Step 5: 브라우저 확인**

```bash
python3 -m http.server 8000
```
1. 프리셋 `에탄` → `2D 보기` → `3D 보기` → **총 에너지와 원자 수가 그대로**여야 한다.
2. 2D에서 탄소를 몇 개 이어 붙인 뒤 3D로 돌아온다 → H가 저절로 붙지 않아야 한다.
3. `수소 채우기`를 누른다 → H가 채워지고 토스트에 개수가 뜬다.
4. `Ctrl+Z` → 채워진 H가 전부 사라져야 한다.

- [ ] **Step 6: 커밋**

```bash
git add src/app.js index.html
git commit -m "fix: stop the 2D/3D toggle from silently filling hydrogens, make it an explicit button"
```

---

### Task 2: 비공유 전자쌍 자리를 눈에 보이게 한다

진단 (A)의 후반. 산소의 빈 자리 두 개는 결함이 아니라 비공유 전자쌍인데, 붙이기 도구로 조준하면 `canBond`가 거부해 **빨간 구**만 뜨고 이유는 안 알려준다. 사용자가 "비공유전자쌍의 도입 검토"라고 한 지점이다.

`openSlots`는 이미 비공유쌍 자리를 포함해 돌려준다. 그걸 **결합 가능 / 비공유쌍**으로 나누기만 하면 된다 — 새 기하 계산은 없다.

**Files:**
- Modify: `src/snap.js` (`slotKinds` 신설)
- Modify: `src/app.js` (`previewAttach`, `drawGhost`, `REASON_MSG`)
- Test: `test/snap.test.js`

**Interfaces:**
- Consumes: `openSlots`, `canBond`, `bondOrderSum`, `MAX_VALENCE`, `EXPANDED_VALENCE` (전부 `src/snap.js`에 이미 있다).
- Produces: `slotKinds(mol, anchor) -> { dir: number[], kind: 'bond' | 'lonepair' }[]` — `openSlots`와 **같은 순서·같은 방향**을 유지하되 각 자리에 종류를 붙인다. 앞에서부터 결합 가능한 자리(남은 원자가 수만큼), 나머지가 비공유쌍이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/snap.test.js`의 snap import에 `slotKinds`를 추가하고 파일 끝에 붙인다.

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/snap.test.js`
Expected: FAIL — `does not provide an export named 'slotKinds'`.

- [ ] **Step 3: 최소 구현**

`src/snap.js`의 `openSlots` 바로 아래에 추가한다.

```js
// 빈 자리를 "실제로 결합할 수 있는 자리"와 "비공유 전자쌍 자리"로 나눈다.
// openSlots는 전자 도메인 전체(결합 자리 + 비공유쌍)를 돌려주므로, 물의 산소를 조준하면
// 자리 두 개가 보이는데 canBond는 거부한다 — 화면에는 빨간 구만 뜨고 "왜 안 되는지"는
// 어디에도 안 나왔다. 남은 원자가 수만큼 앞에서부터 결합 자리로 보고 나머지를 비공유쌍으로
// 표시하면, 붙일 수 없는 이유가 그림으로 설명된다.
// 방향과 순서는 openSlots 그대로다 — 미리보기와 실제 부착 위치가 어긋나면 안 된다.
export function slotKinds(mol, anchor) {
  const el = mol.atoms[anchor].el;
  const normal = MAX_VALENCE[el];
  const capMax = EXPANDED_VALENCE[el] ?? normal;
  const room = capMax === undefined ? 0 : Math.max(0, capMax - bondOrderSum(mol, anchor));
  return openSlots(mol, anchor).map((dir, k) => ({ dir, kind: k < room ? 'bond' : 'lonepair' }));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/snap.test.js`
Expected: PASS.

- [ ] **Step 5: 고스트가 자리 종류를 색으로 구분하게 한다**

`src/app.js`의 snap import에 `slotKinds`를 추가한다.

`previewAttach`에서 `openSlots` 대신 `slotKinds`를 쓰고 종류를 함께 담는다. (기존 `const slots = openSlots(state.mol, anchor);` 줄과 그 아래 `slots[slot]` 사용부를 바꾼다.)

```js
function previewAttach(anchor, el) {
  const a = state.mol.atoms[anchor].pos;
  const kinds = slotKinds(state.mol, anchor);
  const slots = kinds.map((k) => k.dir);
  const slot = ((state.slot % slots.length) + slots.length) % slots.length;
  const idx = addAtom(state.mol, el, add(a, scale(slots[slot], 2.5)));
  const check = canBond(state.mol, anchor, idx);
  state.mol.atoms.pop();
  const len = check.ok ? check.targetLength : 1.6;
  return {
    anchor, slots, slot, kinds: kinds.map((k) => k.kind),
    pos: add(a, scale(slots[slot], len)),
    ok: check.ok, reason: check.reason, el,
  };
}
```

`drawGhost`에서 비활성 자리를 그릴 때 종류별로 색을 나눈다. 기존 루프의 색 지정을 바꾼다.

```js
  // 활성이 아닌 빈 자리들. 비공유 전자쌍 자리는 보라로 구분한다 — 거기엔 원자를 붙일 수
  // 없고, 붙일 수 없다는 사실 자체가 화학 정보다(물의 산소가 왜 두 자리를 남기는지).
  if (g.slots.length > 1) {
    const len = Math.hypot(g.pos[0] - a[0], g.pos[1] - a[1], g.pos[2] - a[2]);
    g.slots.forEach((d, k) => {
      if (k === g.slot) return;
      const p = add(a, scale(d, len));
      ghostShapes.push(viewer.addSphere({
        center: { x: p[0], y: p[1], z: p[2] }, radius: 0.18,
        color: g.kinds[k] === 'lonepair' ? '#a855f7' : color,
        opacity: g.kinds[k] === 'lonepair' ? 0.30 : 0.16,
      }));
    });
  }
```

> 기존 코드의 `if (g.ok && g.slots.length > 1)` 조건에서 `g.ok &&`를 뺀다 — 결합이 불가능한 앵커(물의 산소 등)일수록 비공유쌍 자리를 보여줘야 하기 때문이다.

활성 자리가 비공유쌍이면 그 색도 보라로 맞춘다. `drawGhost`의 `color` 계산 줄을 바꾼다.

```js
  const color = g.kinds[g.slot] === 'lonepair' ? '#a855f7'
    : !g.ok ? '#dc2626' : g.reason === 'ok' ? '#22c55e' : '#f59e0b';
```

- [ ] **Step 6: 거부 사유 문구를 정확하게 만든다**

`src/app.js`의 클릭 핸들러에서 붙이기 실패 시, 활성 자리가 비공유쌍이면 전용 안내를 낸다. `viewerEl`의 click 핸들러 안 `place` 분기를 바꾼다.

```js
  if (state.tool === 'place') {
    if (!state.ghost) return;
    if (state.ghost.ok) attachAtom(state.ghost.anchor, { dir: state.ghost.slots[state.ghost.slot] });
    else if (state.ghost.kinds[state.ghost.slot] === 'lonepair') {
      toast('비공유 전자쌍 자리입니다 — 원자가 들어갈 수 없습니다', 'err');
    } else toast(REASON_MSG[state.ghost.reason] ?? '결합할 수 없습니다', 'err');
    return;
  }
```

- [ ] **Step 7: 전체 확인 + 브라우저 확인**

Run: `node --test`
Expected: 전체 PASS.

브라우저에서 프리셋 `물` → 붙이기 도구(팔레트 `H`) → 산소를 조준한다.
1. 보라색 자리 두 개가 보여야 한다.
2. 클릭하면 `비공유 전자쌍 자리입니다` 토스트가 떠야 한다.
3. 프리셋 `에탄`에서 H 하나를 지우고 그 탄소를 조준하면 자리가 **초록**(결합 가능)이어야 한다.

- [ ] **Step 8: 커밋**

```bash
git add src/snap.js src/app.js test/snap.test.js
git commit -m "feat: distinguish lone-pair slots from bondable slots in the placement ghost"
```

---

### Task 3: 경고 하이라이트를 화면 오버레이로 옮긴다

진단 (B). 3D 반투명 구는 조명에 색이 씻겨 회백색 얼룩이 되고, P·S처럼 CPK 색이 주황·노랑인 원소에서는 신호와 원소색이 구분되지 않는다. 경고는 3D 물체가 아니라 **화면 위에 얹는 신호**여야 한다.

HTML `div` + CSS `radial-gradient`로 만든다. 항상 정면을 향하고, 조명의 영향을 받지 않고, 색·부드러움·맥동을 CSS로 정확히 통제할 수 있다. `#boxselect`가 이미 같은 오버레이 패턴을 쓰고 있다.

**Files:**
- Modify: `index.html` (`#warnlayer` 컨테이너 + 글로우 CSS)
- Modify: `src/app.js` (헤일로 구 제거, 글로우 갱신 함수와 추적 루프)
- Test: 없음 — 순수 DOM/3Dmol 배선이다. Step 5의 픽셀 측정으로 검증한다.

**Interfaces:**
- Consumes: `viewer.modelToScreen`(이미 `pickAtom`이 쓴다 — 페이지 좌표를 돌려주므로 뷰어 rect와 스크롤을 빼야 한다), `state.lastStability`.
- Produces: `syncWarnGlows()` (app.js 내부) — 문제 원자마다 `.warnglow` div를 만들고 화면 좌표에 맞춘다.

- [ ] **Step 1: 3Dmol에 필요한 것만 쓰는지 확인한다**

```bash
curl -sS -o /tmp/3dmol.js https://3Dmol.org/build/3Dmol-min.js
grep -c "modelToScreen" /tmp/3dmol.js
```
Expected: 1 이상. (이 태스크는 새 3Dmol API를 쓰지 않는다 — 이미 쓰고 있는 `modelToScreen` 하나뿐이다.)

- [ ] **Step 2: 마크업과 스타일을 넣는다**

`index.html`의 `#viewer` 안, `#boxselect` 옆에 컨테이너를 추가한다.

```html
  <div id="warnlayer"></div>
```

`<style>`의 `#boxselect` 규칙 아래에 추가한다.

```css
  /* 경고 하이라이트. 3D 반투명 구로 만들었더니 3Dmol 조명이 색을 씻어내
     회백색 얼룩(측정값 rgb(245,246,246))이 됐고, P·S처럼 CPK 색이 주황·노랑인
     원소에서는 신호와 원소색이 구분되지 않았다. 화면 위에 얹는 CSS 글로우는
     조명과 무관하고 색을 그대로 유지한다. */
  #warnlayer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .warnglow {
    position: absolute;
    width: 58px; height: 58px;
    margin: -29px 0 0 -29px;      /* 중심 정렬 — transform은 안 쓴다(매 프레임 갱신이라 left/top이 싸다) */
    border-radius: 50%;
    animation: glowpulse 2.2s ease-in-out infinite;
  }
  .warnglow.warn   { background: radial-gradient(circle, rgba(245,158,11,.55) 0%, rgba(245,158,11,.18) 45%, transparent 70%); }
  .warnglow.danger { background: radial-gradient(circle, rgba(220,38,38,.60) 0%, rgba(220,38,38,.20) 45%, transparent 70%); }
  @keyframes glowpulse { 50% { opacity: .45; } }
  body[data-flat="true"] #warnlayer { display: none; }
```

- [ ] **Step 3: 3D 헤일로 구를 걷어내고 글로우로 바꾼다**

`src/app.js`의 `render()`에서 헤일로 구 루프(`for (const [i, level] of worst) { ... viewer.addSphere({ ... radius: ATOM_RADIUS * 2.1 ... }) ... }`)와 그 위 주석 블록을 **삭제**하고, 대신 문제 원자 목록만 모듈 변수에 남긴다.

```js
  // 경고는 3D 셰이프가 아니라 화면 위 CSS 글로우로 낸다(syncWarnGlows). 반투명 구는
  // 3Dmol 조명에 색이 씻겨 회백색 얼룩이 됐고, P(#ff8000)·S(#e6c53d)처럼 CPK 색이
  // 주황·노랑인 원소에서는 신호와 원소색이 아예 구분되지 않았다.
  warnAtoms = [...worst].map(([i, level]) => ({ i, level }));
```

`src/app.js`의 모듈 변수 선언부(`let bondHover2d = null;` 근처)에 추가한다.

```js
let warnAtoms = [];      // [{ i, level }] — 경고 글로우를 띄울 원자. render()가 채운다.
let warnGlowEls = [];    // 재사용하는 .warnglow div들. 개수가 바뀔 때만 다시 만든다.
```

- [ ] **Step 4: 글로우를 화면 좌표에 맞추는 함수와 추적 루프를 만든다**

`src/app.js`의 `render()` 아래에 추가한다.

```js
// 문제 원자의 3D 좌표를 화면 좌표로 옮겨 글로우 div를 얹는다. modelToScreen은 페이지
// 좌표(rect+scroll 포함)를 돌려주므로 뷰어 rect와 스크롤을 빼야 한다(pickAtom과 같은 규칙).
// div 개수가 바뀔 때만 DOM을 다시 만들고, 그 외에는 left/top만 갱신한다.
function syncWarnGlows() {
  const layer = $('warnlayer');
  if (warnGlowEls.length !== warnAtoms.length) {
    layer.innerHTML = '';
    warnGlowEls = warnAtoms.map(() => layer.appendChild(document.createElement('div')));
  }
  if (warnAtoms.length === 0) return;
  const rect = viewerEl.getBoundingClientRect();
  warnAtoms.forEach((w, k) => {
    const p = state.mol.atoms[w.i]?.pos;
    const el = warnGlowEls[k];
    if (!p) { el.style.display = 'none'; return; }
    const s = viewer.modelToScreen({ x: p[0], y: p[1], z: p[2] });
    el.className = `warnglow ${w.level}`;
    el.style.display = 'block';
    el.style.left = `${s.x - rect.left - window.scrollX}px`;
    el.style.top = `${s.y - rect.top - window.scrollY}px`;
  });
}

// 카메라가 움직여도 글로우가 따라붙어야 하는데 3Dmol에는 카메라 변경 이벤트가 없다.
// 글로우가 있을 때만 도는 rAF 루프로 매 프레임 위치를 다시 잡는다(div 몇 개짜리 작업이라
// WebGL 렌더에 비하면 비용이 없다시피 하다).
function warnGlowLoop() {
  if (warnAtoms.length) syncWarnGlows();
  requestAnimationFrame(warnGlowLoop);
}
requestAnimationFrame(warnGlowLoop);
```

`render()`의 끝(`saveLocal();` 앞)에서 한 번 부른다.

```js
  syncWarnGlows();
```

> `viewerEl`은 `src/app.js` 아래쪽(`const viewerEl = $('viewer');`)에서 선언된다. `syncWarnGlows`는 함수라 호이스팅되지만 **실행 시점**에 `viewerEl`이 필요하므로, `warnGlowLoop`의 첫 프레임이 그 선언보다 늦게 돌도록 `requestAnimationFrame`으로 시작하는 지금 형태를 유지한다(모듈 최상위 동기 실행 중에는 부르지 않는다).

- [ ] **Step 5: 픽셀로 검증한다 (이 태스크의 핵심 확인)**

수정 전 측정값은 `rgb(245,246,246)`(R≈G≈B, 색이 없음)이었다. 같은 분자로 다시 잰다.

```bash
python3 -m http.server 8000 &
node -e "
import('/home/user/mol-craft/src/model.js').then(async (M) => {
  const IO = await import('/home/user/mol-craft/src/io.js');
  const m = M.createMolecule();
  M.addAtom(m,'C',[0,0,0]);
  const T=0.63;
  for (const p of [[T,T,T],[-T,-T,T],[-T,T,-T]]) { const i=M.addAtom(m,'H',p); M.addBond(m,0,i); }
  console.log('HASH=' + IO.encodeState(m));
});"
```

출력된 해시로 `http://localhost:8000/#s=<HASH>`를 열고(CH₃ 라디칼 — 탄소가 `warn`), 탄소 중심 바깥쪽 픽셀을 읽는다.

Expected: 글로우 영역에서 **G와 B가 R보다 뚜렷하게 낮아야 한다**(주황 `rgba(245,158,11,...)`가 실제로 섞였다는 뜻). 수정 전처럼 R≈G≈B면 실패다.

- [ ] **Step 6: 브라우저 확인**

1. 위 CH₃ 라디칼 → 탄소 주위에 **은은한 주황 글로우**가 맥동해야 한다.
2. 프리셋 `PCl₅` → P 주위 글로우가 P의 주황 CPK 색과 **구분되어** 보여야 한다(글로우는 원자 바깥으로 퍼진다).
3. 마우스로 회전·확대해도 글로우가 원자를 **따라와야** 한다.
4. 프리셋 `물`·`메탄` → 글로우가 없어야 한다.
5. `2D 보기`로 가면 글로우가 사라져야 한다.
6. 프리셋을 여러 번 바꿔도 글로우가 쌓이지 않아야 한다.

- [ ] **Step 7: 전체 확인 + 커밋**

```bash
node --check src/app.js && node --test
```
Expected: 전체 PASS.

```bash
git add src/app.js index.html
git commit -m "feat: render stability warnings as a screen-space CSS glow instead of a 3D sphere"
```

---

### Task 4: WASD 카메라 조작

진단 (C). 키보드 카메라 조작이 하나도 없다. 마인크래프트식 조작감의 핵심은 **키를 누르고 있으면 계속 움직이는 것**이므로, 단발 `keydown`이 아니라 키 상태 집합 + `requestAnimationFrame` 루프로 만든다.

**Files:**
- Modify: `src/app.js` (키 상태 집합, 카메라 루프, keydown/keyup 핸들러)
- Modify: `index.html` (`#toolhint`에 넣을 조작 안내는 T5에서 — 여기서는 마크업 변경 없음)
- Test: 없음 — 3Dmol 카메라 배선이다. Step 4의 브라우저 확인으로 검증한다.

**Interfaces:**
- Consumes: `viewer.rotate(angleDeg, axis)`, `viewer.zoom(factor)`, `viewer.translate(dx, dy)`.
- Produces: 없음(app.js 내부).

- [ ] **Step 1: 쓰려는 3Dmol 메서드가 실재하는지 확인한다**

```bash
for m in "rotate" "zoom" "translate"; do printf "%-12s %s\n" "$m" "$(grep -o "$m(" /tmp/3dmol.js | wc -l)"; done
```
Expected: 셋 다 1 이상. **0이면 그 조작은 빼고 진행한다** — 존재하지 않는 API를 추측해서 쓰다가 렌더링이 통째로 깨진 전례가 있다.

- [ ] **Step 2: 키 상태 집합과 카메라 루프를 만든다**

`src/app.js`의 키보드 핸들러 근처에 추가한다.

```js
// ---- 키보드 카메라 -----------------------------------------------------------
// 마인크래프트식 조작감의 핵심은 "누르고 있으면 계속 움직인다"이다. keydown 한 번에 한 칸씩
// 돌리면 뚝뚝 끊겨서 오히려 마우스 드래그보다 못하다. 눌린 키를 집합으로 들고 있다가
// 매 프레임 적용한다.
// W/S 상하 회전 · A/D 좌우 회전 · Q/E 확대·축소 · Shift와 함께면 평행이동(패닝).
const CAMERA_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e']);
const heldKeys = new Set();
const ROT_STEP = 2.0;   // 프레임당 도(度)
const PAN_STEP = 2.5;   // 프레임당 픽셀
const ZOOM_STEP = 1.02; // 프레임당 배율

function cameraLoop() {
  if (heldKeys.size) {
    const pan = heldKeys.has('shift');
    if (pan) {
      let dx = 0, dy = 0;
      if (heldKeys.has('a')) dx -= PAN_STEP;
      if (heldKeys.has('d')) dx += PAN_STEP;
      if (heldKeys.has('w')) dy -= PAN_STEP;
      if (heldKeys.has('s')) dy += PAN_STEP;
      if (dx || dy) viewer.translate(dx, dy);
    } else {
      if (heldKeys.has('a')) viewer.rotate(-ROT_STEP, 'y');
      if (heldKeys.has('d')) viewer.rotate(ROT_STEP, 'y');
      if (heldKeys.has('w')) viewer.rotate(-ROT_STEP, 'x');
      if (heldKeys.has('s')) viewer.rotate(ROT_STEP, 'x');
    }
    if (heldKeys.has('q')) viewer.zoom(1 / ZOOM_STEP);
    if (heldKeys.has('e')) viewer.zoom(ZOOM_STEP);
    viewer.render();
  }
  requestAnimationFrame(cameraLoop);
}
requestAnimationFrame(cameraLoop);

document.addEventListener('keyup', (ev) => {
  heldKeys.delete(ev.key.toLowerCase());
  if (!ev.shiftKey) heldKeys.delete('shift');
});
// 창을 벗어나면 키가 눌린 채로 남아 카메라가 계속 도는 것을 막는다.
window.addEventListener('blur', () => heldKeys.clear());
```

- [ ] **Step 3: keydown에서 카메라 키를 잡는다**

`src/app.js`의 기존 `document.addEventListener('keydown', ...)` 핸들러에서, 입력 요소 가드 바로 다음에 넣는다.

```js
  // 카메라 키는 수식키가 없을 때만 잡는다(Ctrl+A 전체선택, Ctrl+D 복제와 겹치지 않게).
  const k = ev.key.toLowerCase();
  if (CAMERA_KEYS.has(k) && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    ev.preventDefault();
    heldKeys.add(k);
    if (ev.shiftKey) heldKeys.add('shift'); else heldKeys.delete('shift');
    return;
  }
```

> `r`(붙일 자리 순환)과 숫자 핫바는 그대로 둔다 — `CAMERA_KEYS`에 없으므로 이 분기를 지나쳐 기존 처리로 간다.

- [ ] **Step 4: 브라우저 확인**

1. `W`·`A`·`S`·`D`를 **누르고 있으면** 분자가 부드럽게 계속 회전해야 한다(한 칸씩 끊기면 실패).
2. `Q`·`E`로 확대·축소.
3. `Shift+WASD`로 평행이동.
4. `Ctrl+A`(전체 선택)·`Ctrl+D`(복제)가 여전히 동작하고, 카메라가 움직이지 않아야 한다.
5. 우측 패널 입력란(이면각 슬라이더)에 포커스를 준 상태에서는 WASD가 카메라를 안 움직여야 한다.
6. 브라우저 탭을 벗어났다 돌아오면 카메라가 저절로 돌고 있지 않아야 한다.
7. T3의 경고 글로우가 WASD 회전 중에도 원자를 따라와야 한다.

- [ ] **Step 5: 전체 확인 + 커밋**

```bash
node --check src/app.js && node --test
```
Expected: 전체 PASS.

```bash
git add src/app.js
git commit -m "feat: WASD/QE keyboard camera with held-key continuous motion"
```

---

### Task 5: 도구 힌트 줄 + 결합 도구 명확화

진단 (D). 도구 설명이 툴팁에만 있고, 결합 도구는 성격이 다른 두 일을 하면서 이름은 "결합" 하나뿐이다. 첫 원자를 찍어도 화면에 안내가 없다.

툴바 아래에 **현재 도구의 사용법과 상태를 항상 보여주는 한 줄**을 둔다. 마인크래프트가 핫바에서 선택한 아이템 이름을 띄우는 것과 같은 역할이다.

**Files:**
- Modify: `index.html` (`#toolhint` 마크업 + CSS, 결합 버튼 라벨)
- Modify: `src/app.js` (`updateToolHint` 신설, 상태가 바뀌는 지점에서 호출)
- Test: 없음 — DOM 배선이다. Step 5의 브라우저 확인으로 검증한다.

**Interfaces:**
- Consumes: `state.tool`, `state.element`, `state.pendingBond`, `state.selection`.
- Produces: `updateToolHint()` (app.js 내부) — `#toolhint`의 텍스트를 현재 도구와 상태에 맞게 갱신한다.

- [ ] **Step 1: 마크업과 스타일을 넣는다**

`index.html`에서 결합 버튼 라벨을 바꾼다(두 가지 일을 한다는 걸 이름에서 드러낸다).

```html
    <button id="tool-bond" class="tool" data-tool="bond" title="원자 두 개를 순서대로 클릭하면 잇고, 결합선을 클릭하면 차수가 바뀝니다">결합·차수</button>
```

`#toolbar` 닫는 `</div>` **바로 뒤**에 힌트 줄을 추가한다.

```html
<div id="toolhint"></div>
```

`<style>`에 규칙을 추가한다(`#toolbar-sep` 규칙 근처).

```css
  /* 현재 도구가 무슨 일을 하는지 항상 한 줄로 보여준다 — 예전엔 툴팁에만 있어서
     '결합' 도구가 원자 잇기와 차수 바꾸기를 겸한다는 걸 알 방법이 없었다. */
  #toolhint {
    grid-column: 1 / -1;
    padding: 6px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    font-size: 12px;
    color: var(--muted-fg);
    min-height: 28px;
  }
  #toolhint b { color: var(--fg); font-weight: 600; }
```

`body`의 `grid-template-rows`에 줄이 하나 늘었으므로 맞춘다.

```css
    grid-template-rows: auto auto auto 1fr;
```

그리고 좁은 화면 규칙도 함께 맞춘다.

```css
  @media (max-width: 720px) {
    body { grid-template-columns: 1fr; grid-template-rows: auto auto auto 55vh 1fr; }
```

- [ ] **Step 2: 힌트 문구를 만드는 함수를 추가한다**

`src/app.js`의 `setTool` 근처에 추가한다.

```js
// 현재 도구의 사용법과 진행 상태를 한 줄로 보여준다. 도구가 무엇을 하는지 화면에 늘
// 떠 있어야 한다 — 특히 '결합·차수'는 원자 잇기와 차수 바꾸기를 겸하는데 그 사실이
// 툴팁에만 있어서 아무도 몰랐다.
const TOOL_HINT = {
  select: '<b>선택</b> — 원자 클릭. Shift+클릭으로 여러 개, 빈 곳 드래그로 박스 선택. 2~4개를 고르면 거리·각도·이면각이 우측에 나옵니다.',
  erase: '<b>지우개</b> — 원자를 클릭하면 그 원자와, 그 때문에 본체에서 떨어져 나가는 조각까지 함께 지웁니다. 우클릭으로도 됩니다.',
  bond: '<b>결합·차수</b> — 원자 <u>두 개</u>를 차례로 클릭하면 새 결합을 만듭니다(고리 닫기). 이미 있는 <u>결합선</u>을 클릭하면 차수가 1 → 2 → 3 → 1로 바뀝니다(C=O·C≡N을 이걸로 만듭니다).',
  place: '<b>붙이기</b> — 원자를 조준하면 빈 자리가 보입니다. <b>R</b> 키나 휠로 자리를 바꾸고 클릭해 붙입니다. 보라색 자리는 비공유 전자쌍이라 붙일 수 없습니다.',
};

function updateToolHint() {
  let msg = TOOL_HINT[state.tool] ?? '';
  if (state.tool === 'place') msg += ` 현재 원소: <b>${state.element}</b>`;
  if (state.tool === 'bond' && state.pendingBond !== null) {
    const i = state.pendingBond;
    msg = `<b>결합·차수</b> — <b>${state.mol.atoms[i].el}${i}</b> 선택됨. 이을 원자를 클릭하세요 (Esc 취소).`;
  }
  if (state.tool === 'select' && state.selection.length >= 2) {
    msg += ` · <b>${state.selection.length}개</b> 선택됨`;
  }
  msg += ' <span style="opacity:.7">· 카메라: WASD 회전 · QE 확대축소 · Shift+WASD 이동</span>';
  $('toolhint').innerHTML = msg;
}
```

- [ ] **Step 3: 상태가 바뀌는 지점에서 부른다**

- `setTool` 끝에 `updateToolHint();` 추가.
- `render()` 끝(`saveLocal();` 앞)에 `updateToolHint();` 추가 — 선택·`pendingBond` 변화가 전부 `render()`를 거치므로 이 한 곳이면 나머지가 따라온다.

- [ ] **Step 4: 전체 확인**

```bash
node --check src/app.js && node --test
```
Expected: 전체 PASS.

- [ ] **Step 5: 브라우저 확인**

1. 도구를 바꿀 때마다 툴바 아래 한 줄이 그 도구 설명으로 바뀌어야 한다.
2. `결합·차수` 도구로 원자 하나를 클릭 → `... 선택됨. 이을 원자를 클릭하세요 (Esc 취소)`로 바뀌어야 한다. `Esc`를 누르면 원래 설명으로 돌아온다.
3. 팔레트에서 `O`를 고르면 `현재 원소: O`가 보여야 한다.
4. 선택 도구로 원자 3개를 고르면 `3개 선택됨`이 보여야 한다.
5. 힌트 줄이 생겨도 3D 뷰어와 우측 패널 레이아웃이 깨지지 않아야 한다(좁은 화면도 확인).

- [ ] **Step 6: 커밋**

```bash
git add src/app.js index.html
git commit -m "feat: always-visible tool hint line, rename the bond tool to 결합·차수"
```

---

### Task 6: README 반영 + 최종 검증

**Files:**
- Modify: `README.md`
- Test: 전체 스위트

- [ ] **Step 1: 조작법 표의 결합 도구 이름을 맞춘다**

표의 `**결합**` 행 이름을 `**결합·차수**`로 바꾼다(내용은 그대로).

- [ ] **Step 2: 카메라 조작을 문서화한다**

`- **키보드:**` 항목 앞에 추가한다.

```markdown
- **카메라(키보드):** `W`·`A`·`S`·`D`로 회전, `Q`·`E`로 확대/축소, `Shift`와 함께 누르면
  평행이동. 누르고 있는 동안 계속 움직인다(한 칸씩 끊기지 않는다). 마우스 드래그 회전과
  휠 확대/축소는 그대로 쓸 수 있다.
- **도구 힌트:** 툴바 바로 아래에 현재 도구가 무슨 일을 하는지, 지금 어떤 상태인지가
  항상 한 줄로 떠 있다(결합 도구가 첫 원자를 기다리는 중인지 등).
```

- [ ] **Step 3: 수소 채우기를 문서화한다**

`- **2D 보기(골격 구조식):**` 항목에서 `3D로 돌아가면 부족한 원자가를 자동으로 채운다(syncHydrogens) — 이미 완전한 분자면 아무 변화도 없다.` 부분을 아래로 바꾼다.

```markdown
화면 전환은 보기만 바꾸고 분자는 손대지 않는다 — 빈 원자가를 수소로 채우려면 툴바의
`수소 채우기`를 직접 누른다(되돌리기 가능). 예전엔 3D로 돌아올 때마다 자동으로 채워서,
탄소 골격만 그려두고 나중에 산소를 붙이려던 계획이 그 자리에서 굳어버렸다.
```

- [ ] **Step 4: 비공유 전자쌍 표시를 문서화한다**

`- **마인크래프트식 배치:**` 항목 끝에 한 문장을 덧붙인다.

```markdown
  빈 자리 중 **보라색**은 비공유 전자쌍 자리다 — 원자가 들어갈 수 없고, 물의 산소가 왜
  두 자리를 남기는지를 그림으로 보여준다.
```

- [ ] **Step 5: 경고 표시 항목을 글로우로 바꾼다**

`- **선택·경고 표시:**` 항목과 `- **안정도 HUD:**` 항목에서 "헤일로"라는 표현을 아래처럼 바꾼다.

```markdown
- **선택·경고 표시:** 선택한 원자에는 노란 **순서 배지**(1·2·3·4)가 뜬다 — 이면각은 고른
  순서가 i-j-k-l로 그대로 쓰이므로 순서가 보여야 한다. 문제가 있는 원자에는 **은은한 글로우**가
  맥동한다(빨강=심각, 주황=경고). 3D 셰이프가 아니라 화면 위에 얹는 CSS 신호라서 조명에
  색이 씻기지 않고, P·S처럼 CPK 색이 주황·노랑인 원소에서도 신호가 구분된다.
- **안정도 HUD:** 뷰어 좌상단에 0~100 점수와 심각한 문제 칩 최대 3개(+나머지 개수)가 뜬다.
  어느 원자가 문제인지는 그 원자에 얹힌 글로우가 3D 화면에서 직접 가리킨다.
```

`## 물리 모델과 한계`의 `- **원자가 미충족 경고:**` 항목에서 `빨강 헤일로`·`주황 헤일로`를 각각 `빨강 글로우`·`주황 글로우`로 바꾼다.

- [ ] **Step 6: 최종 전체 검증**

```bash
node --test
```
Expected: fail 0. `test/validation.test.js`가 전부 초록인지 확인한다.

```bash
python3 -m http.server 8000
```
브라우저 콘솔을 열고 **에러 0개**를 확인하면서 밟는다.
1. `2D 보기` ↔ `3D 보기` 왕복 → **총 에너지와 원자 수가 변하지 않는다**(요구 1의 핵심 회귀).
2. `수소 채우기` → H가 붙고 토스트가 뜬다. `Ctrl+Z`로 되돌아간다.
3. 프리셋 `물` → 붙이기 도구로 산소 조준 → 보라색 비공유쌍 자리 2개.
4. CH₃ 라디칼(T3 Step 5의 해시 링크) → 탄소에 **주황 글로우가 맥동**한다(요구 4의 핵심 회귀).
5. `W`·`A`·`S`·`D`를 누르고 있으면 부드럽게 회전하고, 글로우가 따라온다(요구 2).
6. 도구를 바꿀 때마다 툴바 아래 힌트가 바뀐다. `결합·차수`로 원자 하나를 찍으면 진행 상태가 뜬다(요구 3).
7. 프리셋 전부 순회 · 지우개 가지치기 · 우클릭 삭제 · 결합 차수 순환 · `구조 최적화` · 이면각 회전 슬라이더 · XYZ/MOL/PDB 내보내기 · 링크 복사.

- [ ] **Step 7: 커밋 & 푸시**

```bash
git add README.md
git commit -m "docs: update README for explicit hydrogen fill, lone-pair slots, glow warnings, WASD camera"
git push -u origin claude/web-improvement-prep-agdiml
```

---

## 명시적으로 하지 않는 것

- **비공유 전자쌍을 데이터 모델에 넣기** — T2는 `MAX_VALENCE`와 `LONE_PAIRS`로 이미 계산되는 값을 **표시**만 한다. `atom.lonePairs`를 실제 필드로 두려면 형식 전하·라디칼·이온까지 함께 설계해야 하고, 그건 별도 계획 규모다. 지금 필요한 것은 "왜 이 자리가 비어도 되는지"를 사용자가 아는 것이다.
- **1인칭 카메라** — 마인크래프트의 WASD는 1인칭 이동이지만, 분자 뷰어에서 카메라가 분자 안으로 들어가는 것은 쓸모가 없다. T4는 궤도(orbit) 카메라를 키보드로 돌리는 데까지만 한다.
- **화면 중앙 크로스헤어 조준** — 마인크래프트는 커서가 아니라 화면 중앙으로 조준한다. 이 앱은 마우스 커서 조준이 이미 정확하게 동작하고(고스트 미리보기), 크로스헤어로 바꾸면 정밀 선택이 오히려 어려워진다.
- **결합 도구를 두 개로 쪼개기** — 툴바 버튼이 늘어나는 것보다 힌트 줄 하나로 설명하는 편이 작다(T5). 힌트를 붙였는데도 여전히 헷갈린다는 피드백이 오면 그때 쪼갠다.
- **방향족 인식·형식 전하** — 종전과 같이 범위 밖.
- **글로우 크기를 줌에 맞춰 조절** — T3은 고정 58px로 둔다. 확대해도 글로우가 커지지 않지만 "어느 원자가 문제인지" 알리는 목적에는 충분하다. 필요해지면 `modelToScreen`으로 원자 두 점을 투영해 화면 배율을 역산하면 된다.

## Self-Review

**1. 요구 커버리지**

| 요구 | 태스크 | 검증 방법 |
|---|---|---|
| 1. 2D→3D에서 H 자동 추가 | T1 | `grep`으로 호출 위치 확인 + 브라우저 왕복 시 원자 수 불변 |
| 1-보조. 비공유전자쌍 | T2 | 자동 테스트 4개(물·탄소·하이드록실·방향 일치) |
| 2. 조작감 (WASD) | T4 | 브라우저(자동 테스트 불가). Step 1의 3Dmol API 존재 확인이 선행 |
| 3. 결합 도구 용도 불명 | T5 | 브라우저(라벨 변경 + 상시 힌트 + 진행 상태) |
| 4. 경고 하이라이트 | T3 | **픽셀 측정**(수정 전 `rgb(245,246,246)` R≈G≈B → 수정 후 G·B가 R보다 낮아야 함) |

**2. 플레이스홀더 스캔** — "적절히 처리"류 문구 없음. 모든 코드 단계에 실제 코드가 있다. 자동 테스트가 불가능한 태스크(T1·T3·T4·T5)는 그 사실을 태스크 머리에 명시하고, 수치로 판정 가능한 픽셀 측정(T3) 또는 구체적 브라우저 절차로 대체했다.

**3. 타입 일관성**
- `slotKinds(mol, anchor) -> { dir, kind }[]`: T2에서 신설. `previewAttach`가 `dir`만 뽑아 기존 `slots` 배열 형태를 유지하고 `kinds`를 따로 담으므로, `drawGhost`·클릭 핸들러·`cycleSlot`이 쓰는 `state.ghost.slots`의 의미가 바뀌지 않는다. `openSlots`와 순서·방향이 같다는 것은 T2 Step 1의 네 번째 테스트가 고정한다. 일치.
- `state.ghost`: T2에서 `kinds: string[]` 필드가 추가된다. 읽는 곳은 `drawGhost`와 클릭 핸들러 둘뿐이고 둘 다 같은 태스크에서 함께 고친다. 일치.
- `warnAtoms: { i, level }[]`: T3에서 신설. `render()`가 쓰고 `syncWarnGlows()`가 읽는다. 기존 `worst` Map을 그대로 배열로 옮긴 것이라 등급 값(`'danger'`/`'warn'`)이 CSS 클래스 이름과 같아야 한다 — `.warnglow.warn`/`.warnglow.danger`가 그 값과 일치한다. 일치.
- `ATOM_RADIUS`: T3에서 경고 구가 사라지면 이 상수를 쓰는 곳은 스타일과 선택 배지 오프셋만 남는다. 삭제하지 않는다. 일치.
- `CAMERA_KEYS`/`heldKeys`: T4에서 신설. `keydown` 핸들러가 `CAMERA_KEYS`를 참조하는데 둘 다 같은 파일 모듈 스코프의 `const`라 **선언이 사용보다 앞에 와야 한다**(`const`는 호이스팅돼도 TDZ에 걸린다). T4 Step 2의 블록을 기존 `keydown` 핸들러보다 **위**에 두는 것이 안전하다 — Step 2가 "키보드 핸들러 근처"라고만 했으므로 구현 시 반드시 위쪽에 배치할 것.
- `updateToolHint()`: T5에서 신설. `setTool`과 `render()` 두 곳에서 호출한다. `$('toolhint')`는 T5 Step 1에서 마크업을 먼저 넣으므로 null이 되지 않는다. 일치.
