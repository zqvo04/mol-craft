# 렌더링 복구 + 코드 리뷰 버그 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3D를 공간채움 덩어리에서 볼-스틱 모형으로 되돌리고, 결합 차수를 반영하지 않아 생긴 기하 오류와 2D 조립의 좌표계 오류를 고치고, 이면각 스캔 UI를 걷어내고, 경고 표시를 옅은 헤일로로 바꾼다.

**Architecture:** 새 모듈을 만들지 않는다. 이번 문제의 대부분은 **직전 개선(T5 결합 차수 편집, T7 CPK 색·크기)이 남긴 후속 미반영**이다 — 결합 차수를 만들 수 있게 해놓고 `openSlots`가 그걸 안 보고, 원소별 반지름을 넣으면서 존재하지 않는 3Dmol API를 썼다. 따라서 수정은 전부 기존 함수의 입력·출력을 맞추는 작업이고, 새 개념은 하나도 도입하지 않는다.

**Tech Stack:** 바닐라 ES 모듈, 빌드 단계 없음. 3Dmol.js(CDN), 테스트는 `node --test`.

## Global Constraints

- 빌드 단계·npm 의존성 추가 금지.
- DOM/3Dmol 배선은 `node --test`로 검증 불가 — 순수 함수로 뽑아 그것만 테스트한다. `src/app.js`는 테스트 대상이 아니다.
- 주석·UI 문자열은 한국어. 기존 파일의 주석 밀도와 어조를 따른다.
- 착수 전 기준선: `node --test` = **134 pass / 0 fail**. 매 태스크 종료 시 전체 스위트가 초록이어야 한다.
- `test/validation.test.js`(문헌값 검증)는 **어떤 태스크에서도 완화하면 안 된다.**
- **3Dmol API를 추측해서 쓰지 않는다.** 스타일 속성을 새로 쓸 일이 생기면 반드시 CDN 번들에서 그 문자열이 실제로 참조되는지 먼저 확인한다(이번 T1 버그의 직접 원인).
- 브랜치: `claude/web-improvement-prep-agdiml`. 태스크마다 커밋.

---

## 진단 결과 (코드로 재현 완료)

### (A) 3D가 볼-스틱이 아니라 공간채움으로 그려진다 — 요구 1

`render()`가 쓰는 `radiusfunc`는 **3Dmol에 존재하지 않는 속성**이다. CDN 번들 전체에서 `radiusfunc` 문자열이 **0회** 등장한다(`colorfunc`는 존재하므로 색만 먹었다).

번들에서 추출한 실제 반지름 결정 로직:

```js
getRadiusFromStyle(atom, style) {
  var r = this.defaultSphereRadius;
  if (style.radius !== undefined) r = style.radius;          // ← 우리가 안 준다
  else if (GLModel.vdwRadii[atom.elem]) r = GLModel.vdwRadii[atom.elem];  // ← 여기로 떨어진다
  if (style.scale !== undefined) r *= style.scale;
  return r;
}
```

`sphere`에 `radius`도 `scale`도 없으므로 **반데르발스 반지름**이 적용된다. 결과:

| 원소 | 의도(공유결합×0.55) | 실제 적용(vdW) |
|---|---|---|
| H | 0.17 | 1.20 |
| C | 0.42 | 1.70 |
| N | 0.39 | 1.55 |
| O | 0.36 | 1.52 |

| 결합 | 길이 | vdW 반지름 합 | 의도한 반지름 합 |
|---|---|---|---|
| C–H | 1.09 | 2.90 → **완전히 겹침** | 0.59 → 막대 보임 |
| C–C | 1.53 | 3.40 → **완전히 겹침** | 0.84 → 막대 보임 |
| O–H | 0.96 | 2.72 → **완전히 겹침** | 0.53 → 막대 보임 |

구가 서로 파고들어 `stick`(반지름 0.14)이 통째로 구 안에 묻힌다. 사진 그대로다. 같은 이유로 **붙이기 고스트 구(반지름 0.32)와 대기 앵커 구(0.5)도 원자 안에 묻혀 안 보이고**, `pickBond`가 노리는 결합 중점도 구에 가려 클릭하기 어렵다.

> 이전 검증에서 내가 "radiusfunc 정상 동작"이라고 보고한 것은 틀렸다. 물 스크린샷에서 O가 H보다 커 보인 것을 근거로 삼았는데, 그 크기 차이는 의도한 값이 아니라 vdW 비(1.52:1.20)였고, 같은 스크린샷이 이미 결합 막대가 없는 공간채움 모형이었다. 크기 차이의 **존재**만 보고 **값**을 확인하지 않은 것이 원인이다.

### (B) `openSlots`가 결합 차수를 보지 않는다 — 요구 4 (리뷰 발견, 최대 건)

`ELECTRON_DOMAINS`는 `MAX_VALENCE + LONE_PAIRS`인 **상수**라 결합 차수와 무관하다. T5로 이중·삼중결합을 만들 수 있게 됐는데 `openSlots`는 그걸 모른다.

```
C=C 를 만든 뒤 C0에 원자를 붙이면
  typeAtom = C_2, UFF theta0 = 120°  (sp2가 맞다)
  openSlots가 준 빈 자리: 3개, 전부 109.47°   ← 2개 · 120°여야 한다

C≡C 를 만든 뒤
  typeAtom = C_1, theta0 = 180°
  openSlots: 3개, 전부 109.47°   ← 1개 · 180°여야 한다
```

이것이 **T1에서 고친 오탐 문제를 다른 문으로 되살린다.** 배치는 109.47°인데 판정(`vseprCheck`)은 theta0 120°를 기준으로 하므로, 이중결합 탄소에 H를 붙이는 순간 즉시 빨간 경고가 뜬다:

```
C=C 만들고 H 4개를 openSlots 자리에 붙임 → 에틸렌 C2H4
  붙인 직후 stability: score 56
    danger: C0 각도 편차 11°
    danger: C1 각도 편차 11°
  구조 최적화 후: score 100 (경고 사라짐)
```

즉 **T5가 열어준 워크플로(이중결합 만들기)를 밟으면 반드시 경고가 뜬다.** 요구 5·6·7이 가리키는 "이상함"의 큰 축이다.

올바른 도메인 수 공식(π 결합은 시그마 자리를 차지하지 않는다):

```
piBonds     = bondOrderSum(i) - neighbors(i).length
sigmaTarget = MAX_VALENCE[el] - piBonds
domains     = sigmaTarget + LONE_PAIRS[el]
```

검산: C=C → 4-1+0 = 3 → 120° ✓ / C≡C → 4-2+0 = 2 → 180° ✓ / 카보닐 O → 2-1+2 = 3 → 120°(O_2 theta0와 일치) ✓ / 나이트릴 N → 3-2+1 = 2 → 180°(N_1) ✓ / 물 O → 2-0+2 = 4 → 109.47° (현행 유지) ✓ / 메탄 C → 4-0+0 = 4 (현행 유지) ✓

### (C) 2D 조립이 좌표계를 섞어 쓴다 — 요구 4 (리뷰 발견)

`layout()`은 **BOND_LEN = 1의 무단위 2D 좌표계**를 돌려준다. `attachAtom2D`가 그 좌표를 그대로 3D 절대좌표(Å)로 넘긴다(`attachAtom`의 `pos2d` 분기: `targetPos = [pos2d[0], pos2d[1], 0]`).

두 가지가 동시에 깨진다.

**결합 길이가 틀린다** — 2D에서 탄소 사슬을 이어 붙이면:

```
  1번째: 실제 1.000 Å / 평형 1.514 Å  → 34% 짧음
  2번째: 실제 1.000 Å / 평형 1.514 Å  → 34% 짧음
  3번째: 실제 2.000 Å / 평형 1.514 Å  → 32% 김
  총 결합 신축 에너지: 267 kcal/mol   (정상이면 ~0)
```

**앵커의 실제 3D 위치를 무시한다** — 이미 3D로 만든 분자에 2D에서 원자를 붙이면 새 원자가 layout 원점 기준 엉뚱한 절대좌표에 생긴다:

```
사이클로헥산 C0의 3D 좌표   : 1.26, 0.73, 0.25
C0의 layout 2D 좌표         : -0.50, 0.87        ← 전혀 다른 좌표계
새 원자가 놓인 3D 좌표      : -1.00, 1.73, 0.00
=> 앵커와의 실제 거리       : 2.485 Å  (평형 1.51)
   결합 신축 에너지         : 333 kcal/mol

3D 복귀 시 minimize(120스텝)로 복구되는가?
   789,980 → 116 kcal/mol, converged=false, 거리 2.271 Å  ← 복구 실패
```

`pos2d` 분기의 원래 의도는 "2D 레이아웃이 흐트러지지 않게 z=0 평면에 둔다"였는데, **`layout()`은 3D 좌표를 아예 읽지 않고 그래프에서 매번 새로 계산**하므로 그 의도 자체가 처음부터 무의미했다. 분기를 지우는 것이 곧 수정이다.

### (D) 무거운 원자가 1개면 2D가 분자식 텍스트만 나온다 — 요구 2

`renderSVG`는 `pos.size <= 1`이면 골격을 그릴 수 없다고 보고 분자식 텍스트로 대체한다. `layout()`이 수소를 배치하지 않기 때문에 NH₃·H₂O·CH₄가 전부 여기 걸린다.

```
ammonia   무거운원자 1 | layout좌표 1 | <line> 0개 | 텍스트폴백 O
water     무거운원자 1 | layout좌표 1 | <line> 0개 | 텍스트폴백 O
methane   무거운원자 1 | layout좌표 1 | <line> 0개 | 텍스트폴백 O
ethane    무거운원자 2 | layout좌표 2 | <line> 1개 | 텍스트폴백 X
```

골격식 표기법 자체로는 맞는 처리지만(탄소 골격이 없으면 그릴 선이 없다), 화학 교재는 이런 분자를 **구조식**(중심 원자 + 명시적 H)으로 그린다. NH₃가 "NH3" 글자로만 나오는 건 사용자 기대와 어긋난다.

### (E) 이면각 스캔 — 요구 3

제거 대상 표면:

```
index.html : #scan 버튼, #scan-step 셀렉트, #scan-relax 체크박스, 우측 '이면각 스캔' 섹션(#chart)
src/app.js : drawScan(), $('scan').onclick, scanDihedral import
src/uff.js : scanDihedral 함수 본체
```

**주의 — `scanDihedral`을 uff.js에서 지우면 안 된다.** `test/validation.test.js`가 이 함수로 두 개의 핵심 문헌값을 검증한다:

```
test/validation.test.js:44  에탄 회전장벽 1.5~3.5 kcal/mol
test/validation.test.js:83  부탄 anti/gauche 배좌 (완화 스캔)
```

이 둘은 이 저장소에서 물리 정확성을 지키는 가장 값진 테스트다. 따라서 **UI만 걷어내고 `scanDihedral`은 테스트 전용 물리 함수로 남긴다.**

### (F) 그 밖의 리뷰 발견 (경미)

**F-1. `checkSnaps`가 결합 차수를 안 본다** — 완성 판정이 `neighbors().length >= MAX_VALENCE[el]`이라, 에틸렌 탄소(이웃 3개, 원자가 4)는 `3 >= 4`가 거짓이라 **완성 연출이 영원히 안 뜬다.** 다중결합이 있는 모든 중심이 그렇다. `bondOrderSum`으로 비교해야 한다.

**F-2. 프리셋을 바꿔도 다시 프레이밍하지 않는다** — `viewer.zoomTo()`가 `firstRender`일 때 한 번만 불린다. 작은 분자에서 큰 분자로 바꾸거나 사슬을 길게 이어 붙이면 화면 밖으로 나가고, 되돌릴 방법이 수동 줌뿐이다.

### 요구 → 원인 → 태스크 매핑

| 요구 | 원인 | 태스크 |
|---|---|---|
| 1. 결합선이 없음 | (A) 존재하지 않는 `radiusfunc` → vdW 공간채움 | T1 |
| 2. NH₃ 2D가 문자만 | (D) 무거운 원자 1개는 골격식 미성립 | T5 |
| 3. 이면각 스캔 제거 | — | T4 |
| 4. 코드 리뷰 버그 | (B) 결합 차수 미반영 · (C) 2D 좌표계 혼용 · (F-1) · (F-2) | T2, T3, T7 |
| 5. 경고 표시가 마음에 안 듦 | 배지가 여전히 시선을 끈다 + (B) 때문에 오탐도 남아 있다 | T6 (+ T2) |

## File Structure

| 파일 | 변경 |
|---|---|
| `src/app.js` | 스타일 복구(T1) · `pos2d` 분기 삭제(T3) · 스캔 UI 삭제(T4) · 경고 헤일로(T6) · `checkSnaps`·재프레이밍(T7) |
| `src/snap.js` | `electronDomains()` 신설, `openSlots`가 사용(T2) |
| `src/sketch2d.js` | 단일 중심 원자 구조식 렌더(T5) |
| `index.html` | 스캔 UI 마크업 삭제(T4) |
| `README.md` | 전 항목 반영(T8) |

## 태스크 의존 순서

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 (순차)

T1이 먼저인 이유: 화면이 공간채움인 상태로는 이후 태스크의 시각 확인을 전혀 할 수 없다.

---

### Task 1: 3D를 볼-스틱 모형으로 되돌린다

진단 (A). `radiusfunc`는 3Dmol에 없는 속성이라 무시되고, `radius`가 없으니 반데르발스 반지름으로 떨어져 공간채움이 된다.

원소별 반지름 차등을 유지하면서 3Dmol이 실제로 지원하는 방법은 **`scale`** 이다(`getRadiusFromStyle`이 vdW 반지름에 곱한다). 다만 `scale`도 스타일 하나당 상수라 원소별로 다르게 줄 수 없다. 원소별 크기를 진짜로 다르게 하려면 **원자별로 `setStyle`을 나눠 불러야 하는데, 그건 T6(성능)에서 없앤 O(n²) 패턴이다.**

그래서 절충한다: **원소를 원자 반지름이 아니라 색으로 구분하고(T7에서 이미 CPK 색이 들어갔다), 반지름은 고정값 하나로 준다.** 원소별 크기 차등은 포기한다 — 요구 5("원자 구분")는 이미 색으로 해결됐고, 요구 1("결합선이 보여야 한다")이 우선이다.

**Files:**
- Modify: `src/app.js` (`render()`의 `setStyle` 블록, `COVALENT_RADIUS` import)
- Test: 없음 — 3Dmol 배선이다. Step 3의 브라우저 확인으로 대체한다.

**Interfaces:**
- Consumes: `CPK_COLOR`, `strainColor` (변경 없음).
- Produces: 없음. `radii` 지역 변수와 `COVALENT_RADIUS` import가 사라진다(T6에서 배지 위치 계산에 쓰던 것도 함께 정리 — 아래 주의 참고).

> **주의:** `COVALENT_RADIUS`는 `render()`의 선택 배지·경고 배지 위치 계산에도 쓰인다. T1에서는 **import를 지우지 말고** 배지 오프셋 계산만 고정 반지름(`ATOM_RADIUS`)을 쓰도록 바꾼다. `COVALENT_RADIUS`의 최종 정리는 T6에서 경고 배지를 헤일로로 바꿀 때 함께 판단한다.

- [ ] **Step 1: 3Dmol이 지원하는 속성인지 먼저 확인한다**

```bash
curl -sS -o /tmp/3dmol.js https://3Dmol.org/build/3Dmol-min.js
for s in radiusfunc colorfunc "\.radius" "\.scale"; do printf "%-14s %s\n" "$s" "$(grep -o "$s" /tmp/3dmol.js | wc -l)"; done
```
Expected: `radiusfunc` = **0** (이번 버그의 근거), `colorfunc` ≥ 1.

이 확인을 건너뛰지 말 것 — 이 태스크가 존재하는 이유 자체가 "지원 여부를 확인하지 않고 API를 쓴 것"이다.

- [ ] **Step 2: 스타일 블록을 교체한다**

`src/app.js`의 `render()`에서 `const radii = ...`부터 `viewer.setStyle({}, {...});`까지를 아래로 바꾼다.

```js
  // 반지름은 원소와 무관한 고정값이다. 3Dmol의 sphere 스타일에는 원자별 반지름을 넘길
  // 방법이 없고(radiusfunc 같은 속성은 존재하지 않는다 — 예전에 그걸 넘겼다가 조용히
  // 무시당했고, radius가 없으면 반데르발스 반지름으로 떨어져 구가 결합 막대를 통째로
  // 삼킨 공간채움 모형이 됐다), 원자별로 setStyle을 나눠 부르면 O(n²)로 되돌아간다.
  // 원소 구분은 CPK 색이 맡고, 여기서는 결합이 보이는 볼-스틱 비율만 지킨다.
  viewer.setStyle({}, {
    sphere: { radius: ATOM_RADIUS, colorfunc: (atom) => colors[atom.serial] },
    stick: { radius: 0.14, colorfunc: (atom) => colors[atom.serial] },
  });
```

`src/app.js`의 `strainColor` 함수 위(모듈 상수들이 모여 있는 자리)에 상수를 추가한다.

```js
// 볼-스틱 모형의 구 반지름(Å). 가장 짧은 결합(O-H 0.96 Å)에서도 구 두 개가 막대를
// 완전히 덮지 않도록 잡은 값이다 — 0.30 × 2 = 0.60 < 0.96.
const ATOM_RADIUS = 0.30;
```

- [ ] **Step 3: 배지 오프셋을 고정 반지름 기준으로 바꾼다**

`render()`의 선택 배지 루프와 경고 배지 루프에서 각각 아래 줄을 지운다.

```js
    const r = (COVALENT_RADIUS[state.mol.atoms[i].el] ?? 0.7) * 0.55;
```

그리고 `position`의 `y`를 `ATOM_RADIUS` 기준으로 바꾼다(선택 배지는 `+`, 경고 배지는 `-`).

```js
      position: { x: p[0], y: p[1] + ATOM_RADIUS + 0.30, z: p[2] },
```
```js
      position: { x: p[0], y: p[1] - ATOM_RADIUS - 0.30, z: p[2] },
```

- [ ] **Step 4: 전체 확인 + 브라우저 확인**

```bash
node --check src/app.js && node --test
```
Expected: 전체 PASS(이 태스크는 테스트를 추가하지 않는다).

```bash
python3 -m http.server 8000
```
프리셋 `에탄`과 `물`에서 확인한다.
1. **결합 막대가 보여야 한다** — 구가 서로 떨어져 있고 그 사이를 막대가 잇는다.
2. 붙이기 도구로 원자를 조준하면 **고스트 구와 점선이 보여야 한다**(예전엔 원자 안에 묻혀 있었다).
3. 결합 도구로 결합선을 클릭할 수 있어야 한다(중점이 구에 안 가린다).

- [ ] **Step 5: 커밋**

```bash
git add src/app.js
git commit -m "fix: restore ball-and-stick rendering (radiusfunc is not a 3Dmol style property)"
```

---

### Task 2: `openSlots`가 결합 차수를 반영한다

진단 (B). π 결합은 시그마 자리를 차지하지 않는데 `ELECTRON_DOMAINS` 상수는 그걸 모른다. 이중결합 탄소에 원자를 붙이면 120°가 아니라 109.47°로 붙고, 그 즉시 `vseprCheck`(theta0 기준)가 빨간 경고를 낸다.

**Files:**
- Modify: `src/snap.js` (`electronDomains` 신설, `openSlots`가 사용)
- Test: `test/snap.test.js`

**Interfaces:**
- Consumes: `bondOrderSum`, `neighbors` (`src/model.js` — snap.js가 이미 import 중), `MAX_VALENCE`, `LONE_PAIRS`.
- Produces: `electronDomains(mol, i) -> number` — 그 원자가 목표로 삼아야 할 전자 도메인 수. `ELECTRON_DOMAINS` 상수는 **지우지 않는다**(다른 곳에서 쓰고 테스트도 걸려 있다), 다만 `openSlots`는 더 이상 그것을 직접 읽지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/snap.test.js`의 snap import에 `electronDomains`를 추가하고 파일 끝에 붙인다. (`angleBetween` 헬퍼는 이 파일에 이미 있다.)

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/snap.test.js`
Expected: FAIL — `does not provide an export named 'electronDomains'`, 그리고 sp2 테스트가 `3 !== 2`로 실패.

- [ ] **Step 3: 최소 구현**

`src/snap.js`의 `ELECTRON_DOMAINS` 상수 선언 바로 아래에 추가한다.

```js
// 이 원자가 목표로 삼아야 할 전자 도메인 수. ELECTRON_DOMAINS 상수는 결합 차수를 모르는
// 고정값이라, 결합 차수 편집이 생긴 뒤로는 그대로 쓸 수 없다 — π 결합은 시그마 자리를
// 차지하지 않는데도 상수는 늘 4를 돌려줘서, 이중결합 탄소에 원자를 붙이면 120°가 아니라
// 109.47°로 붙었다. 그러면 붙이자마자 vseprCheck(theta0=120° 기준)가 빨간 경고를 냈다.
//   π 결합 수  = 결합차수 합 - 이웃 수
//   시그마 자리 = 최대 원자가 - π 결합 수
//   도메인     = 시그마 자리 + 비공유 전자쌍
// 검산: C=C -> 3(120°) · C≡C -> 2(180°) · 카보닐 O -> 3(120°, O_2 theta0와 일치)
//       물 O -> 4(109.47°, 종전과 같음) · 메탄 C -> 4(종전과 같음)
export function electronDomains(mol, i) {
  const el = mol.atoms[i].el;
  const nb = neighbors(mol, i).length;
  const max = MAX_VALENCE[el];
  if (max === undefined) return nb + 1;
  const piBonds = bondOrderSum(mol, i) - nb;
  return Math.max(1, max - piBonds + (LONE_PAIRS[el] ?? 0));
}
```

`openSlots`에서 도메인 수를 구하는 줄을 바꾼다.

```js
  const total = electronDomains(mol, anchor);
```

(기존 `const total = ELECTRON_DOMAINS[mol.atoms[anchor].el] ?? dirs.length + 1;` 줄을 대체한다. 아래 `want = Math.max(total, dirs.length + 1)` 안전장치는 그대로 둔다 — 초원자가에서 여전히 필요하다.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test`
Expected: 전체 PASS. 기존 `openSlots`/`idealDirection`/`syncHydrogens` 테스트가 전부 초록이어야 한다 — 단일결합만 있는 분자에서는 결과가 바뀌지 않는다는 증거다.

- [ ] **Step 5: 오탐이 실제로 사라졌는지 확인한다**

```bash
node -e "
import('/home/user/mol-craft/src/model.js').then(async (M) => {
  const S = await import('/home/user/mol-craft/src/snap.js');
  const G = await import('/home/user/mol-craft/src/geom.js');
  const m = M.createMolecule();
  M.addAtom(m,'C',[0,0,0]); M.addAtom(m,'C',[1.33,0,0]); M.addBond(m,0,1,2);
  for (const c of [0,1]) for (let k=0;k<2;k++) {
    const s = S.openSlots(m,c)[0];
    const i = M.addAtom(m,'H', G.add(m.atoms[c].pos, G.scale(s,1.08)));
    M.addBond(m,c,i,1);
  }
  console.log(S.formula(m), JSON.stringify(S.stability(m)));
});"
```
Expected: `C2H4` 이고 `issues`가 **빈 배열**(score 100). 수정 전에는 score 56에 danger 2개였다.

- [ ] **Step 6: 커밋**

```bash
git add src/snap.js test/snap.test.js
git commit -m "fix: derive electron domains from bond order so sp2/sp centers place at 120/180"
```

---

### Task 3: 2D 조립의 좌표계 혼용을 없앤다

진단 (C). `layout()`의 무단위 2D 좌표를 3D 절대좌표(Å)로 그대로 쓴다. 결합 길이가 34% 틀리고, 앵커의 실제 3D 위치를 무시해 새 원자가 엉뚱한 곳에 생기며, 3D 복귀 시 최적화가 수렴하지 못한다.

수정은 **삭제**다: `pos2d` 분기를 없애고, 2D는 **방향만** 넘긴다. 길이는 `attachAtom`이 이미 UFF 평형 길이로 계산하고 있다. `layout()`은 3D 좌표를 읽지 않으므로 2D 그림은 영향을 받지 않는다 — `pos2d` 분기의 원래 의도("2D 레이아웃이 흐트러지지 않게")는 처음부터 성립하지 않았다.

**Files:**
- Modify: `src/app.js` (`attachAtom`의 `pos2d` 분기 삭제, `attachAtom2D`)
- Test: 없음 — `attachAtom`은 app.js에 있어 테스트 대상이 아니다. Step 3의 재현 스크립트와 Step 4의 브라우저 확인으로 검증한다.

**Interfaces:**
- Produces: `attachAtom(anchor, { dir })` — `pos2d` 옵션이 **사라진다**. 호출자는 `attachAtom2D` 하나뿐이다.

- [ ] **Step 1: 수정 전 상태를 재현해 기록한다**

```bash
cat > /tmp/probe2d.mjs <<'EOF'
import { createMolecule, addAtom, addBond, measure } from '/home/user/mol-craft/src/model.js';
import { layout, nextChainDir } from '/home/user/mol-craft/src/sketch2d.js';
import { canBond } from '/home/user/mol-craft/src/snap.js';
import { energy } from '/home/user/mol-craft/src/uff.js';
const m = createMolecule();
addAtom(m, 'C', [0, 0, 0]);
for (let s = 0; s < 3; s++) {
  const pos = layout(m);
  const anchor = m.atoms.length - 1;
  const dir = nextChainDir(m, anchor, pos, 1);
  const p = pos.get(anchor);
  const probe = addAtom(m, 'C', [9, 9, 9]);
  const target = canBond(m, anchor, probe).targetLength;
  m.atoms.pop();
  const idx = addAtom(m, 'C', [p[0] + dir[0], p[1] + dir[1], 0]);
  addBond(m, idx, anchor, 1);
  console.log(`  ${s}: 실제 ${measure(m, [anchor, idx]).toFixed(3)} / 평형 ${target.toFixed(3)}`);
}
console.log('결합 신축 에너지:', energy(m).byType.bond.toFixed(1), 'kcal/mol');
EOF
node /tmp/probe2d.mjs
```
Expected(수정 전): `1.000 / 1.514`, `1.000 / 1.514`, `2.000 / 1.514`, 신축 에너지 약 **267 kcal/mol**.

- [ ] **Step 2: `pos2d` 분기를 지운다**

`src/app.js`의 `attachAtom` 시그니처와 좌표 계산을 바꾼다.

```js
function attachAtom(anchor, { dir } = {}) {
```

```js
  const targetPos = add(a, scale(placeDir, check.targetLength));
```

(기존 `const targetPos = pos2d ? [pos2d[0], pos2d[1], 0] : add(...);` 줄을 대체한다.)

- [ ] **Step 3: `attachAtom2D`가 방향만 넘기게 한다**

`src/app.js`의 `attachAtom2D` 전체를 아래로 교체한다.

```js
// 2D 화면에서 붙일 방향은 골격식 레이아웃이 정하고, 길이는 3D와 똑같이 attachAtom이
// UFF 평형 길이로 정한다. 예전엔 layout()의 무단위 좌표(BOND_LEN=1)를 3D 절대좌표(Å)로
// 그대로 넘겨서, 결합 길이가 34% 틀리고 앵커의 실제 3D 위치까지 무시됐다(사이클로헥산에
// 원자 하나를 붙이면 2.5 Å 떨어진 곳에 생겨 신축 에너지가 333 kcal/mol이 됐고, 3D로
// 돌아갈 때 최적화가 수렴하지 못했다). layout()은 3D 좌표를 읽지 않으므로 이렇게 바꿔도
// 2D 그림은 달라지지 않는다.
function attachAtom2D(anchor) {
  const pos = layout(state.mol);
  if (!pos.has(anchor)) return;
  const d = nextChainDir(state.mol, anchor, pos, 1);
  attachAtom(anchor, { dir: [d[0], d[1], 0] });
}
```

- [ ] **Step 4: 수정 후 재현 스크립트로 확인한다**

```bash
cat > /tmp/probe2d_after.mjs <<'EOF'
import { createMolecule, addAtom, addBond, measure } from '/home/user/mol-craft/src/model.js';
import { layout, nextChainDir } from '/home/user/mol-craft/src/sketch2d.js';
import { canBond } from '/home/user/mol-craft/src/snap.js';
import { energy } from '/home/user/mol-craft/src/uff.js';
import { add, scale } from '/home/user/mol-craft/src/geom.js';
const m = createMolecule();
addAtom(m, 'C', [0, 0, 0]);
for (let s = 0; s < 3; s++) {
  const pos = layout(m);
  const anchor = m.atoms.length - 1;
  const d = nextChainDir(m, anchor, pos, 1);
  const placeDir = [d[0], d[1], 0];                     // 수정 후 경로
  const probe = addAtom(m, 'C', [9, 9, 9]);
  const target = canBond(m, anchor, probe).targetLength;
  m.atoms.pop();
  const idx = addAtom(m, 'C', add(m.atoms[anchor].pos, scale(placeDir, target)));
  addBond(m, idx, anchor, 1);
  console.log(`  ${s}: 실제 ${measure(m, [anchor, idx]).toFixed(3)} / 평형 ${target.toFixed(3)}`);
}
console.log('결합 신축 에너지:', energy(m).byType.bond.toFixed(1), 'kcal/mol');
EOF
node /tmp/probe2d_after.mjs
```
Expected: 세 결합 모두 실제 = 평형(1.514), 신축 에너지 **0.0 근처**.

- [ ] **Step 5: 전체 확인 + 브라우저 확인**

```bash
node --check src/app.js && node --test
```
Expected: 전체 PASS.

브라우저에서 `2D 보기` → 탄소를 몇 개 이어 붙인 뒤 `3D 보기`로 돌아간다. 사슬이 정상적인 지그재그 구조여야 하고, 총 에너지가 수천 kcal/mol이 아니어야 한다.

- [ ] **Step 6: 커밋**

```bash
git add src/app.js
git commit -m "fix: 2D placement passes a direction, not layout coordinates as angstroms"
```

---

### Task 4: 이면각 스캔 UI를 제거한다

요구 3. **`src/uff.js`의 `scanDihedral` 함수 본체는 남긴다** — `test/validation.test.js`가 에탄 회전장벽과 부탄 anti/gauche 배좌를 이 함수로 검증하고, 그 둘은 이 저장소의 물리 정확성을 지키는 핵심 테스트다. UI만 걷어낸다.

**Files:**
- Modify: `src/app.js` (`drawScan`, `$('scan').onclick`, `scanDihedral` import)
- Modify: `index.html` (`#scan` 버튼, `#scan-step`, `#scan-relax`, 우측 `이면각 스캔` 섹션)
- Test: 없음(삭제). `test/uff.test.js`의 `scanDihedral` 검증 테스트는 **그대로 둔다**(함수가 남으므로).

- [ ] **Step 1: app.js에서 스캔을 걷어낸다**

- `src/app.js:2`의 uff import에서 `scanDihedral`을 뺀다.

```js
import { energy, minimize, typeAtom, cachedTerms } from './uff.js';
```

- `drawScan(points)` 함수 전체를 삭제한다(그 위 주석 블록 포함).
- `$('scan').onclick = () => { ... };` 핸들러 전체를 삭제한다.

- [ ] **Step 2: index.html에서 스캔 UI를 걷어낸다**

헤더에서 아래 세 줄을 삭제한다.

```html
  <button id="scan">이면각 스캔</button>
  <select id="scan-step" title="스캔 각도 간격"><option value="5">5°</option><option value="10" selected>10°</option>
    <option value="15">15°</option><option value="30">30°</option></select>
  <label class="check"><input type="checkbox" id="scan-relax">완화 스캔</label>
```

`<aside>`에서 스캔 결과 섹션을 삭제한다.

```html
  <section><h2>이면각 스캔</h2><div id="chart">회전 가능한 결합의 원자 4개를 선택하세요</div></section>
```

- [ ] **Step 3: 남은 참조가 없는지 확인한다**

```bash
grep -n "scan\|drawScan\|#chart\|'chart'" src/app.js index.html
```
Expected: 결과 없음. 하나라도 남으면 지운다(`$('scan')`이 null인데 `.onclick`을 대입하면 로드 즉시 터진다).

`src/uff.js`의 `scanDihedral`은 남아 있어야 한다.

```bash
grep -c "export function scanDihedral" src/uff.js
```
Expected: `1`.

- [ ] **Step 4: 전체 확인 + 브라우저 확인**

```bash
node --check src/app.js && node --test
```
Expected: 전체 PASS. **특히 `test/validation.test.js`의 에탄 회전장벽·부탄 배좌 테스트가 여전히 초록이어야 한다** — 물리 함수를 지우지 않았다는 증거다.

브라우저에서 콘솔 에러가 없어야 하고, 헤더에 스캔 버튼·스텝 셀렉트·완화 체크박스가 없어야 하며, 우측 패널에 스캔 섹션이 없어야 한다. 이면각 **회전 슬라이더**는 그대로 남아 동작해야 한다.

- [ ] **Step 5: 커밋**

```bash
git add src/app.js index.html
git commit -m "refactor: remove the dihedral scan UI, keep scanDihedral for the physics tests"
```

---

### Task 5: 무거운 원자가 1개인 분자를 2D 구조식으로 그린다

진단 (D). NH₃·H₂O·CH₄는 무거운 원자가 1개라 골격식이 성립하지 않아 분자식 텍스트로 대체된다. 화학 교재는 이런 분자를 중심 원자 + 명시적 H의 **구조식**으로 그린다.

**Files:**
- Modify: `src/sketch2d.js` (`renderSVG`의 `pos.size <= 1` 분기)
- Test: `test/sketch2d.test.js`

**Interfaces:**
- Consumes: `neighbors` (이미 import 중), `formula`.
- Produces: `renderSVG`의 단일 중심 분기가 텍스트 대신 SVG 구조식을 낸다. 중심 원자와 각 H에 `data-atom` 히트타깃이 붙어 기존 도구(붙이기/지우개/선택)가 그대로 동작한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/sketch2d.test.js` 끝에 추가한다.

```js
test('renderSVG: 무거운 원자가 1개면 중심 + 명시적 H 구조식을 그린다', () => {
  const m = loadPreset('ammonia');
  const svg = renderSVG(m);
  assert.ok(svg.includes('>N<'), '중심 원소 기호가 있어야 한다');
  assert.equal((svg.match(/>H</g) ?? []).length, 3, 'H 3개가 각각 그려져야 한다');
  assert.equal((svg.match(/<line/g) ?? []).length, 3, 'N-H 결합선 3개');
  // 중심 1개 + H 3개 전부 클릭 가능해야 도구가 동작한다.
  assert.equal((svg.match(/data-atom=/g) ?? []).length, 4);
});

test('renderSVG: 물도 같은 방식으로 그린다', () => {
  const svg = renderSVG(loadPreset('water'));
  assert.ok(svg.includes('>O<'));
  assert.equal((svg.match(/>H</g) ?? []).length, 2);
  assert.equal((svg.match(/<line/g) ?? []).length, 2);
});

test('renderSVG: 무거운 원자가 2개 이상이면 종전 골격식 그대로다 (회귀 방지)', () => {
  const svg = renderSVG(loadPreset('ethane'));
  assert.ok(!svg.includes('>H<'), '골격식은 탄소의 H를 그리지 않는다');
  assert.equal((svg.match(/<line/g) ?? []).length, 1);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/sketch2d.test.js`
Expected: FAIL — 암모니아 SVG가 `viewBox="0 0 140 40"`짜리 텍스트 폴백이라 `>N<`도 `<line`도 없다.

- [ ] **Step 3: 최소 구현**

`src/sketch2d.js`의 `renderSVG` 안에서 `if (pos.size <= 1) { ... }` 블록 전체를 아래로 교체한다.

```js
  // 무거운 원자가 1개뿐이면(NH3·H2O·CH4 등) 골격식이 성립하지 않는다 — 탄소 골격이 없어
  // 그릴 선이 없기 때문이다. 예전엔 분자식 텍스트만 찍었는데, 화학 교재는 이런 분자를
  // 중심 원자 + 명시적 H의 구조식으로 그린다. 수소를 방사형으로 균등 배치하고 중심과
  // 각 H 모두에 히트타깃을 붙여, 2D에서도 붙이기/지우개/선택이 그대로 동작하게 한다.
  if (pos.size <= 1) {
    const center = [...pos.keys()][0];
    if (center === undefined) {
      return `<svg viewBox="0 0 140 40"><text x="70" y="25" text-anchor="middle" font-size="16" `
        + `fill="var(--fg)" font-family="sans-serif">${formula(mol)}</text></svg>`;
    }
    const hs = neighbors(mol, center).filter((n) => mol.atoms[n].el === 'H');
    const R = 46, CX = 90, CY = 90;
    let body = '';
    hs.forEach((h, k) => {
      // 위쪽(-90°)에서 시작해 시계 방향으로 균등 분배한다.
      const t = (-90 + (360 / hs.length) * k) * Math.PI / 180;
      const [hx, hy] = [CX + R * Math.cos(t), CY + R * Math.sin(t)];
      // 결합선은 양끝 라벨을 피해 안쪽으로 물린다.
      const [sxp, syp] = [CX + 15 * Math.cos(t), CY + 15 * Math.sin(t)];
      const [exp, eyp] = [CX + (R - 13) * Math.cos(t), CY + (R - 13) * Math.sin(t)];
      body += `<line x1="${sxp.toFixed(1)}" y1="${syp.toFixed(1)}" x2="${exp.toFixed(1)}" y2="${eyp.toFixed(1)}" `
        + 'stroke="var(--fg)" stroke-width="1.6"/>'
        + `<text x="${hx.toFixed(1)}" y="${(hy + 5).toFixed(1)}" text-anchor="middle" font-size="15" `
        + 'fill="var(--fg)" font-family="sans-serif">H</text>'
        + `<circle data-atom="${h}" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="12" `
        + 'fill="transparent" style="cursor:pointer"/>';
    });
    const bad = new Set(stability(mol).issues.map((x) => x.atom));
    return `<svg viewBox="0 0 180 180" width="100%" height="100%">${body}`
      + `<text x="${CX}" y="${CY + 6}" text-anchor="middle" font-size="18" `
      + `fill="${bad.has(center) ? '#dc2626' : 'var(--fg)'}" font-family="sans-serif">${mol.atoms[center].el}</text>`
      + `<circle data-atom="${center}" cx="${CX}" cy="${CY}" r="14" fill="transparent" style="cursor:pointer"/></svg>`;
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test`
Expected: 전체 PASS. 기존 2D 테스트(에탄·에틸렌 골격식, 쐐기/파선, `data-bond`, 선택 강조)가 전부 그대로여야 한다.

- [ ] **Step 5: 브라우저 확인**

프리셋 `암모니아 NH₃` → `2D 보기`. N을 중심으로 H 3개가 선으로 이어져 보여야 한다. 지우개로 H 하나를 클릭하면 지워지고, 붙이기로 H를 다시 붙일 수 있어야 한다. 물·메탄도 같은 방식으로 나와야 한다.

- [ ] **Step 6: 커밋**

```bash
git add src/sketch2d.js test/sketch2d.test.js
git commit -m "feat: draw single-heavy-atom molecules as structural formulas in 2D"
```

---

### Task 6: 경고 표시를 옅은 헤일로로 바꾼다

요구 5. 배지(`✕`/`▲`)는 시선을 강하게 끌고 분자 위에 글자를 얹는다. 원자 주변을 은은하게 감싸는 **옅은 색 신호**로 바꾼다 — 어느 원자인지는 알려주되 형태와 색을 가리지 않는다.

T1에서 원자 반지름이 0.30으로 고정됐으므로 헤일로 반지름도 고정값 하나면 된다.

**선택 표시(순서 번호 배지)는 그대로 둔다** — 사용자가 지적한 것은 경고 표시이고, 순서 번호는 이면각 선택에서 실제로 필요한 정보다.

**Files:**
- Modify: `src/app.js` (`render()`의 경고 배지 루프 → 헤일로 구)
- Test: 없음 — 3Dmol 배선이다. Step 3의 브라우저 확인으로 대체한다.

**Interfaces:**
- Produces: 경고는 `overlayLabels`가 아니라 `selectionShapes`(셰이프 수명주기)로 옮겨간다. `overlayLabels`에는 선택 순서 배지만 남는다.

- [ ] **Step 1: 경고 루프를 헤일로로 교체한다**

`src/app.js`의 `render()`에서 경고 배지 루프(`for (const [i, level] of worst) { ... overlayLabels.push(viewer.addLabel(...)) ... }`)와 그 위 주석 블록을 아래로 바꾼다.

```js
  // 경고는 원자를 감싸는 옅은 헤일로로 낸다. 배지(✕/▲)는 분자 위에 글자를 얹어 시선을
  // 너무 강하게 끌었고, 그 전의 와이어프레임 구는 그물이 원자 모양을 가렸다. 반투명 구를
  // 원자보다 조금 크게 깔면 "여기가 문제"라는 신호는 남고 형태와 CPK 색은 그대로 보인다.
  // 어떤 문제인지(원자가 부족/초과·각도 편차)는 좌상단 HUD 칩이 글자로 알려준다.
  for (const [i, level] of worst) {
    const p = state.mol.atoms[i].pos;
    selectionShapes.push(viewer.addSphere({
      center: { x: p[0], y: p[1], z: p[2] },
      radius: ATOM_RADIUS * 2.1,
      color: level === 'danger' ? '#dc2626' : '#f59e0b',
      opacity: level === 'danger' ? 0.24 : 0.16,
    }));
  }
```

- [ ] **Step 2: 남은 참조를 정리한다**

`COVALENT_RADIUS`가 더 이상 `render()`에서 쓰이지 않으면 `src/app.js`의 params import에서 뺀다.

```bash
grep -n "COVALENT_RADIUS" src/app.js
```
결과가 import 줄 하나뿐이면 그 줄에서 `COVALENT_RADIUS`를 지운다. 다른 곳에서 쓰고 있으면 그대로 둔다.

- [ ] **Step 3: 전체 확인 + 브라우저 확인**

```bash
node --check src/app.js && node --test
```
Expected: 전체 PASS.

브라우저에서:
1. 프리셋 `PCl₅` → P 원자 주위에 **옅은 빨간 기운**이 감돌아야 한다. 글자 배지는 없어야 한다.
2. 프리셋 `SF₆` → S 주위에 **옅은 주황**.
3. 프리셋 `물`·`암모니아` → 아무 헤일로도 없어야 한다(T1에서 오탐을 없앴다).
4. 프리셋을 여러 번 바꿔도 헤일로가 쌓이지 않아야 한다.
5. 원자를 선택하면 노란 순서 배지는 **그대로** 떠야 한다.

- [ ] **Step 4: 커밋**

```bash
git add src/app.js
git commit -m "feat: signal problem atoms with a soft halo instead of a text badge"
```

---

### Task 7: 리뷰에서 나온 경미한 버그 둘

진단 (F-1), (F-2).

**Files:**
- Modify: `src/app.js` (`checkSnaps`, 프리셋 로드 시 재프레이밍)
- Test: 없음 — 둘 다 app.js의 UI 동작이다. Step 3의 브라우저 확인으로 검증한다.

- [ ] **Step 1: `checkSnaps`가 결합 차수를 보게 한다**

`src/app.js`의 `checkSnaps`에서 완성 판정 줄을 바꾼다.

```js
function checkSnaps() {
  const next = {};
  for (let i = 0; i < state.mol.atoms.length; i++) {
    const nb = neighbors(state.mol, i).length;
    const max = MAX_VALENCE[state.mol.atoms[i].el];
    // 이웃 수가 아니라 결합차수 합으로 "원자가를 다 썼는지"를 본다 — 이웃 수로 세면
    // 에틸렌 탄소(이웃 3개, 원자가 4)가 영원히 미완성으로 남아 완성 연출이 안 떴다.
    if (nb >= 2 && max !== undefined && bondOrderSum(state.mol, i) >= max) {
      next[i] = vseprCheck(state.mol, i).satisfied;
    }
  }
```

(아래 `for (const idx of newSnapEvents(...))` 이하는 그대로 둔다.)

`src/app.js`의 model import에 `bondOrderSum`을 추가한다.

```js
import {
  neighbors, bondOrderSum, measure, addAtom, addBond, removeAtom, branchAtoms, setDihedral,
  duplicateAtoms, isTorsionChain, pruneAtom,
} from './model.js';
```

- [ ] **Step 2: 프리셋을 바꾸면 다시 프레이밍한다**

`src/app.js`의 `$('preset').onchange` 핸들러에서 `render()` 앞에 한 줄을 넣는다.

```js
$('preset').onchange = (ev) => {
  state.mol = loadPreset(ev.target.value);
  state.selection = [];
  state.snapState = {};
  checkSnaps();
  // 분자가 통째로 바뀌면 화면에 맞춰 다시 잡아준다 — zoomTo는 최초 렌더에서 한 번만
  // 불리기 때문에, 작은 분자에서 큰 분자로 바꾸면 화면 밖으로 나가도 되돌릴 방법이
  // 수동 줌뿐이었다.
  firstRender = true;
  render();
```

(그 아래 `const note = ...; if (note) toast(note);`는 그대로 둔다.)

- [ ] **Step 3: 전체 확인 + 브라우저 확인**

```bash
node --check src/app.js && node --test
```
Expected: 전체 PASS.

브라우저에서:
1. 프리셋 `메탄` → `사이클로헥산 (의자)` → 큰 분자가 화면에 맞게 다시 잡혀야 한다.
2. 결합 도구로 C=C를 만든 뒤 붙이기로 H를 채워 에틸렌을 완성하면 **완성 연출(소리 + 토스트)** 이 떠야 한다(예전엔 다중결합 중심에서 영원히 안 떴다).

- [ ] **Step 4: 커밋**

```bash
git add src/app.js
git commit -m "fix: count bond order for completion feedback, refit the view on preset change"
```

---

### Task 8: README 반영 + 최종 검증

**Files:**
- Modify: `README.md`
- Test: 전체 스위트

- [ ] **Step 1: 이면각 스캔 항목을 지운다**

`- **이면각 스캔:** ...` 항목 전체를 삭제한다. `- **이면각 직접 회전:** ...` 항목은 그대로 둔다.

`## 테스트` 절의 문장을 바꾼다(스캔은 이제 UI가 아니라 테스트 전용 물리 함수다).

```markdown
`test/validation.test.js`가 문헌값(정사면체 109.47°, 에탄 회전장벽, 의자<보트, 부탄 anti/gauche)을
검증한다. 회전장벽·배좌 검증은 `uff.scanDihedral`을 쓰는데, 이 함수는 화면에 노출되지 않는
테스트 전용 물리 함수다. 이 테스트가 깨지면 물리 결과를 신뢰하지 말 것.
```

- [ ] **Step 2: 원자 색 항목에서 크기 문구를 바로잡는다**

`- **원자 색:**` 항목을 아래로 교체한다(원소별 크기 차등은 T1에서 포기했다).

```markdown
- **원자 색:** 원소는 CPK 표준 색으로 구분한다. 구 크기는 원소와 무관한 고정값이다 —
  3Dmol의 sphere 스타일에는 원자별 반지름을 넘길 방법이 없고, 원자마다 스타일을 따로
  지정하면 원자 수의 제곱에 비례해 느려진다. 헤더의 색상 셀렉트를 `응력 히트맵`으로
  바꾸면 원자별 변형 에너지를 파랑~빨강으로 칠하고 좌하단 범례가 나타난다.
```

- [ ] **Step 3: 경고 표시 항목을 헤일로로 바꾼다**

`- **선택·경고 표시:**` 항목을 아래로 교체한다.

```markdown
- **선택·경고 표시:** 선택한 원자에는 노란 **순서 배지**(1·2·3·4)가 뜬다 — 이면각은 고른
  순서가 i-j-k-l로 그대로 쓰이므로 순서가 보여야 한다. 문제가 있는 원자는 **옅은 헤일로**로
  감싼다(빨강=심각, 주황=경고). 어떤 문제인지는 좌상단 안정도 HUD의 칩이 글자로 알려준다.
```

`- **안정도 HUD:**` 항목의 둘째·셋째 줄도 헤일로를 가리키도록 맞춘다.

```markdown
- **안정도 HUD:** 뷰어 좌상단에 0~100 점수와 심각한 문제 칩 최대 3개(+나머지 개수)가 뜬다.
  어느 원자가 문제인지는 그 원자를 감싼 옅은 헤일로가 3D 화면에서 직접 가리킨다.
```

- [ ] **Step 4: 2D 항목에 단일 중심 구조식을 명시한다**

`- **2D 보기(골격 구조식):**` 항목의 마지막(선택 강조 문장 뒤)에 한 문장을 덧붙인다.

```markdown
  무거운 원자가 하나뿐인 분자(NH₃·H₂O·CH₄ 등)는 골격식이 성립하지 않으므로 중심 원자와
  명시적 H를 잇는 구조식으로 그린다 — 이 화면에서도 H를 직접 클릭해 붙이고 지울 수 있다.
```

- [ ] **Step 5: 결합 각도 항목에 결합 차수 반영을 명시한다**

`- **결합 각도:**` 항목 끝에 한 문장을 덧붙인다.

```markdown
  목표 도메인 수는 결합 차수를 반영한다 — π 결합은 시그마 자리를 차지하지 않으므로,
  이중결합 탄소에는 120°(평면 삼각형), 삼중결합 탄소에는 180°(직선) 방향으로 붙는다.
```

- [ ] **Step 6: 최종 전체 검증**

```bash
node --test
```
Expected: fail 0. `test/validation.test.js`가 전부 초록인지 눈으로 확인한다 — 특히 에탄 회전장벽과 부탄 배좌(T4에서 `scanDihedral`을 남긴 이유).

```bash
python3 -m http.server 8000
```
브라우저 콘솔을 열고 **에러 0개**를 확인하면서 밟는다.
1. **결합 막대가 보인다**(요구 1의 핵심 회귀). 프리셋 전부 순회.
2. 프리셋 `암모니아` → `2D 보기` → N + H 3개 구조식(요구 2의 핵심 회귀).
3. 헤더에 이면각 스캔 UI가 없다. 이면각 회전 슬라이더는 동작한다.
4. 물·암모니아에 헤일로가 없다. PCl₅에는 옅은 빨간 헤일로.
5. 결합 도구로 C=C를 만들고 붙이기로 H를 붙이면 **120°로 붙고 경고가 안 뜬다**(요구 4의 핵심 회귀).
6. 2D에서 탄소를 몇 개 이어 붙인 뒤 3D 복귀 → 정상적인 사슬, 총 에너지가 수천이 아니다.
7. 프리셋을 작은 것 → 큰 것으로 바꾸면 화면에 다시 맞춰진다.
8. 지우개 가지치기, 우클릭 삭제, `Ctrl+Z`, XYZ/MOL/PDB 내보내기, 링크 복사.

- [ ] **Step 7: 커밋 & 푸시**

```bash
git add README.md
git commit -m "docs: update README for ball-and-stick rendering, halo warnings, scan removal"
git push -u origin claude/web-improvement-prep-agdiml
```

---

## 명시적으로 하지 않는 것

- **원소별 원자 크기 차등** — T1에서 포기한다. 3Dmol의 sphere 스타일은 원자별 반지름을 받지 못하고, 원자마다 `setStyle`을 나눠 부르면 이전 개선에서 없앤 O(n²) 병목으로 되돌아간다. 원소 구분은 CPK 색이 맡는다. 굳이 하려면 원소별로 원자를 그룹 지어 `setStyle`을 **원소 종류 수만큼**(원자 수가 아니라) 부르는 방법이 있는데, 지금 필요한 이득이 아니다.
- **초원자가 중심의 배치 각도** — `electronDomains`는 π 결합만 보정한다. SF₆·PCl₅를 한 원자씩 조립할 때 90°(팔면체)가 아니라 109.47° 방향으로 붙는 것은 종전 그대로다. 고치려면 `IDEAL_ANGLES[5]`/`[6]`의 다중 각도 집합을 `openSlots`가 다룰 수 있어야 하는데, 별도 계획 규모다.
- **방향족 인식(C_R/N_R/O_R)** — 휘켈 판정이 따로 필요하다. 결합 차수 편집이 있으므로 벤젠은 케쿨레 구조로 손수 만들 수 있다.
- **형식 전하·라디칼 데이터 모델** — 경고는 이미 나오지만 `atom.charge`를 도입하지는 않는다.
- **2D 고스트 위치의 정확도** — `layout()`이 매번 처음부터 배치하므로 미리보기와 최종 위치가 어긋날 수 있다. 증분 배치가 필요해 별도 계획 규모다. (T3는 3D 좌표의 정확성만 고친다.)
- **이면각 스캔의 완전 삭제** — `scanDihedral`은 물리 검증 테스트가 쓰므로 남긴다. UI만 없앤다.

## Self-Review

**1. 요구 커버리지**

| 요구 | 태스크 | 검증 방법 |
|---|---|---|
| 1. 결합선이 없음 | T1 | 브라우저(자동 테스트 불가 — 3Dmol 배선). Step 1의 번들 grep이 원인의 증거 |
| 2. NH₃ 2D가 문자만 | T5 | 자동 테스트 3개(암모니아·물·에탄 회귀) |
| 3. 이면각 스캔 제거 | T4 | grep 잔여 0 + validation.test.js 유지 확인 |
| 4. 코드 리뷰 버그 | T2(sp2/sp), T3(2D 좌표계), T7(완성 판정·재프레이밍) | T2는 자동 테스트 4개 + 재현 스크립트, T3은 수정 전/후 재현 스크립트, T7은 브라우저 |
| 5. 경고 표시 | T6(+T2가 오탐 제거) | 브라우저 |

**2. 플레이스홀더 스캔** — "적절히 처리"류 문구 없음. 모든 코드 단계에 실제 코드가 있다. 자동 테스트가 불가능한 태스크(T1·T3·T6·T7)는 그 사실을 태스크 머리에 명시하고, 수정 전/후를 수치로 비교하는 재현 스크립트(T3) 또는 구체적 브라우저 절차로 대체했다.

**3. 타입 일관성**
- `ATOM_RADIUS`: T1에서 신설, T1(스타일·배지 오프셋)과 T6(헤일로 반지름)이 함께 쓴다. 두 곳의 기준이 같아야 헤일로가 원자를 정확히 감싼다. 일치.
- `electronDomains(mol, i) -> number`: T2에서 신설, `openSlots`가 유일한 소비자. `ELECTRON_DOMAINS` 상수는 남으므로 기존 테스트·import가 깨지지 않는다. 일치.
- `attachAtom(anchor, { dir })`: T3에서 `pos2d` 옵션이 사라진다. 호출자는 3D 클릭 핸들러(`{ dir: state.ghost.slots[...] }`)와 `attachAtom2D`(`{ dir: [d0, d1, 0] }`) 둘뿐이고 양쪽 다 `dir`만 넘긴다. 일치.
- 경고 표시의 수명주기: T6에서 `overlayLabels`(라벨) → `selectionShapes`(셰이프)로 옮긴다. `render()`의 정리 블록이 두 배열을 모두 비우고 있으므로 추가 작업이 없다. 일치.
- `bondOrderSum`: T7에서 app.js에 새로 import한다. `src/model.js`가 이미 export 중. 일치.
- T4가 `scanDihedral`을 app.js import에서만 빼고 `uff.js`에는 남기므로, `test/uff.test.js`의 `scanDihedral` 검증 테스트와 `test/validation.test.js`의 두 문헌값 테스트가 그대로 통과한다. 일치.
