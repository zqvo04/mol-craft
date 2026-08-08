# 화학 정확성 + 조립 UX 2차 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 오탐 경고를 없애고, 이중·삼중결합을 손으로 만들 수 있게 하고, 원소를 눈으로 구분할 수 있게 하고, 잘못된 입력(먼 거리 결합·가짜 이면각)을 막는다.

**Architecture:** 물리 엔진은 손대지 않는다 — 진단 결과 UFF 최적화·이면각 스캔 자체는 문헌값과 일치한다(아래 진단 참고). 고쳐야 할 것은 전부 **판정 기준과 입력 검증과 표시 방법**이다. VSEPR 이상각의 출처를 `IDEAL_ANGLES[배위수]`에서 UFF `theta0`(원자 타입별 실측 평형각)로 바꾸는 것이 가장 큰 한 방이고, 나머지는 각각 독립적인 작은 수정이다.

**Tech Stack:** 바닐라 ES 모듈, 빌드 단계 없음. 3Dmol.js(CDN), 테스트는 `node --test`.

## Global Constraints

- 빌드 단계·npm 의존성 추가 금지. `index.html`을 그대로 서빙하는 구조 유지.
- DOM/3Dmol 배선은 `node --test`로 검증 불가 — 순수 함수로 뽑아내 그것만 테스트한다. `src/app.js`는 테스트 대상이 아니다.
- 주석·UI 문자열은 한국어. 기존 파일의 주석 밀도와 어조를 그대로 따른다.
- 착수 전 기준선: `node --test` = **114 pass / 0 fail**. 매 태스크 종료 시 전체 스위트가 초록이어야 한다.
- `test/validation.test.js`(문헌값 검증)는 **어떤 태스크에서도 완화하면 안 된다.** 깨지면 되돌리고 원인부터 밝힌다.
- 브랜치: `claude/web-improvement-prep-agdiml`. 태스크마다 커밋.

---

## 진단 결과 (코드로 재현 완료)

착수 전에 이 절을 반드시 읽을 것. "무엇이 고장났는가"에 대한 추측이 아니라 실측 결과다.

### 물리 엔진은 정상이다

| 검증 | 결과 | 문헌값 |
|---|---|---|
| 조립한 에탄 C-C 길이 | 1.526 Å | 1.53 Å |
| 조립한 에탄 회전장벽 | 2.88 kcal/mol | ~3.0 |
| 아세트산(이중결합 지정 시) C=O | 1.224 Å | 1.21 |
| 아세트산 C-O | 1.380 Å | 1.36 |
| 아세트산 O=C-O 각 | 120.6° | ~123 |
| `minimize` 수렴 | butane 126스텝 converged | — |

**그러므로 "구조 최적화가 제 기능을 못한다"의 원인은 최적화 알고리즘이 아니다.**

### 실제 원인 7가지

**(A) VSEPR 판정이 배위수 기준이라 O·N이 전부 오탐이다 — 최대 원인**

`vseprCheck`는 `IDEAL_ANGLES[이웃수]`를 쓰는데, 원자를 배치하는 `openSlots`/`idealDirection`은 `ELECTRON_DOMAINS`(결합 + 비공유 전자쌍)를 쓴다. 두 기준이 비공유쌍 있는 원소에서 어긋난다.

```
물(문헌값 104.51°로 완벽히 최적화된 상태)
  → vseprCheck의 ideal = IDEAL_ANGLES[2] = 180°  →  "편차 75° danger" 빨간 경고
암모니아(문헌값 106.71°)
  → vseprCheck의 ideal = IDEAL_ANGLES[3] = 120°  →  "편차 13° danger" 빨간 경고
```

프리셋 8개 중 물·암모니아만 78점, 나머지는 100점. **사진의 빨간 그물 구는 거의 전부 이 오탐이다.**

해결책 검증 완료 — 이상각을 UFF `theta0`(원자 타입별 실측 평형각)에서 가져오면:

```
methane  C_3   theta0=109.47  최대편차 0.00°
water    O_3   theta0=104.51  최대편차 0.00°
ammonia  N_3   theta0=106.70  최대편차 0.01°
ethylene C_2   theta0=120.00  최대편차 0.39°
sf6      S_3+6 theta0= 90.00  최대편차 0.00°
pcl5     P_3+5 theta0= 90.00  최대편차 0.00°
chair    C_3   theta0=109.47  최대편차 1.23°
```

전 프리셋이 허용오차 3° 안에 들어온다. 게다가 UFF가 실제로 최소화하는 목표값이므로 "VSEPR 만족"과 "최적화 수렴"이 같은 뜻이 된다.

**(B) 이중결합을 만들 수 없어서 아세트산이 아세트산이 안 된다**

사용자 조립 흐름을 그대로 시뮬레이션한 결과:

```
CH4 → H 하나 제거 → C 붙임 → O 붙임 → O 붙임 → H 붙임 → O에 H 붙임
결과 분자식: C2H5O2      (아세트산은 C2H4O2)
결합: 전부 order 1
원자 5(=O가 되어야 할 산소): 결합 1개뿐 → 원자가 미충족(라디칼)인데 아무 경고 없음
```

즉 만들어진 것은 `CH3-CH(-O•)(-OH)`이라는 존재하지 않는 분자다. **결합 차수 편집이 없으면 카보닐·나이트릴·방향족을 포함한 유기화학의 절반을 만들 수 없다.** 지난 계획에서 범위 밖으로 뺀 항목인데, 지금 6번·7번 불만의 직접 원인이다.

**(C) 원자가 미충족(라디칼)에 경고가 없다**

`stability()`는 원자가 *초과*만 본다. 위 사례의 산소처럼 결합이 *모자란* 원자는 아무 표시가 없다. 정작 화학적으로 틀린 원자가 조용하고, 멀쩡한 -OH가 빨갛다.

**(D) 결합 도구가 거리를 전혀 안 본다**

```
10 Å 떨어진 탄소 두 개를 결합 도구로 이음 → canBond: ok
결합 후 실제 거리 10.00 Å (이상적 1.514 Å)
결합 신축 에너지: 25,189 kcal/mol
```

화면에는 공간을 가로지르는 막대가 그려진다. **"이상한 결합"의 정체.**

**(E) 이면각 슬라이더·스캔이 가짜 입력을 통과시킨다**

`updateDihedralPanel`은 `선택 4개` + `branchAtoms !== null`만 본다. i-j, j-k, k-l이 실제로 결합돼 있는지는 확인하지 않는다.

```
메탄에서 H1, C0, H2, H3 선택 (진짜 이면각 아님)
  → 슬라이더 활성화됨
  → 90° 조작 → 원자가 하나도 안 움직임
  → 이면각 스캔 → 전부 0.00인 평평한 선, 오류 메시지 없음
```

**"이면각 스캔이 제 기능을 못한다"의 정체.** 스캔 코드가 아니라 입력 검증이 없는 것이다.

**(F) 원소를 눈으로 구분할 방법이 전혀 없다**

```js
sphere: { radius: 0.30, colorfunc: ... }   // 모든 원소가 같은 반지름
stick:  { radius: 0.14, colorfunc: ... }   // 색은 응력 히트맵뿐
```

H도 C도 O도 같은 크기, 같은 색. 라벨도 없다. 사진에서 무엇이 탄소이고 산소인지 알 수 없는 이유.

**(G) 완성 토스트가 틀린 형상 이름을 부른다**

`GEOMETRY_NAME[배위수]`이므로 물(결합 2개)은 "직선형 완성"이라고 알린다. 실제로는 굽은형이다.

### 사용자 요구 → 원인 → 태스크 매핑

| 요구 | 원인 | 태스크 |
|---|---|---|
| 1. 노랑/빨강 경고가 아쉬움 | 와이어프레임 구가 원자를 통째로 덮음 + 경고 대부분이 (A) 오탐 | T1(오탐 제거) + T8(배지형 표시) |
| 2. 중간 삭제 시 고아 파편 | `deleteAtom`이 원자 하나만 지움. `branchAtoms`가 이미 있는데 안 씀 | T6 |
| 3. 학습/연구 모드 무의미 | — | T9 |
| 4. 스캔·최적화 작동 안 함 | (E) 입력 검증 부재. 물리는 정상 | T4 |
| 5. 원자 구분 안 됨 | (F) | T7 |
| 6. CH3COOH가 이상함 | (B) 이중결합 불가 + (C) 라디칼 무경고 + (A) 오탐 | T1 + T2 + T5 |
| 7. 이상한 결합 다수 | (A)(B)(C)(D)(E) 전부 | T1~T5 |

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/params.js` | 원소 상수표 | `CPK_COLOR` 추가 |
| `src/snap.js` | 결합 판정·VSEPR·안정도 | `vseprCheck` 이상각 출처 변경 / `geometryName` 신설 / 라디칼 경고 / `cycleBondOrder` 신설 / `bondDistanceOk` 신설 |
| `src/model.js` | 분자 그래프 | `isTorsionChain` 신설 / `pruneAtom` 신설 |
| `src/uff.js` | 역장 | `scanDihedral` 입력 검증만 추가 |
| `src/sketch2d.js` | 2D SVG | 결합 히트타깃(`data-bond`) 추가 |
| `src/app.js` | UI 배선 | 모드 제거, 원소 색·크기, 배지 표시, 결합 히트테스트, 가지치기 |
| `index.html` | 마크업 | 모드 셀렉트 제거, 색상 기준 셀렉트 추가 |
| `README.md` | 문서 | 전 항목 반영 |

## 태스크 의존 순서

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 (순차)

T1이 가장 먼저인 이유: 오탐 경고를 먼저 없애야 이후 태스크에서 "진짜 경고"를 눈으로 확인할 수 있다.

---

### Task 1: VSEPR 이상각을 UFF theta0 기준으로 바꾼다 (오탐 제거)

진단 (A)와 (G)를 함께 고친다. `vseprCheck`의 이상각을 `IDEAL_ANGLES[배위수]`가 아니라 `UFF_PARAMS[typeAtom(...)].theta0`에서 가져오고, 완성 토스트의 형상 이름도 전자 도메인 기준으로 바로잡는다.

`IDEAL_ANGLES` 자체는 지우지 않는다 — `openSlots`가 새 원자를 **배치**할 때 쓰는 이상적 기하는 여전히 그 표가 맞다(정사면체 방향 4개를 만들려면 109.47°가 필요하다). 바뀌는 것은 이미 배치된 구조를 **평가**하는 기준뿐이다.

**Files:**
- Modify: `src/snap.js` (import 줄, `vseprCheck`, `geometryName` 신설)
- Modify: `src/app.js` (`GEOMETRY_NAME` 상수와 `checkSnaps`의 토스트 문구)
- Test: `test/snap.test.js`

**Interfaces:**
- Consumes: `UFF_PARAMS`(`src/params.js`), `typeAtom`(`src/uff.js` — snap.js가 이미 import 중).
- Produces:
  - `vseprCheck(mol, i, tol?)` — 반환 필드는 그대로(`center/coordination/ideal/angles/satisfied`). `ideal`의 **의미**가 "배위수 기준 이상각"에서 "이 원자 타입의 UFF 평형각"으로 바뀐다. 미지원 원소는 `ideal: null`, `satisfied: false`.
  - `geometryName(mol, i) -> string` — 결합 수와 전자 도메인 수로 형상 이름을 만든다(`'굽은형'`, `'삼각뿔형'` 등). 모르는 조합은 `'배위 N'`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/snap.test.js`의 snap import에 `geometryName`을 추가하고, 파일 끝에 붙인다.

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/snap.test.js`
Expected: FAIL — `does not provide an export named 'geometryName'`, 그리고 물 테스트가 `104.51 !== 180`으로 실패.

- [ ] **Step 3: 최소 구현**

`src/snap.js`의 params import에 `UFF_PARAMS`를 추가한다.

```js
import { MAX_VALENCE, EXPANDED_VALENCE, UFF_PARAMS } from './params.js';
```

`vseprCheck` 전체를 아래로 교체한다(기존 함수와 그 위 주석 블록).

```js
// 이상각은 UFF theta0 — 그 원자 타입의 실측 평형 결합각이다.
// 예전엔 IDEAL_ANGLES[배위수]를 썼는데, 원자를 배치하는 openSlots는 ELECTRON_DOMAINS
// (결합 + 비공유 전자쌍) 기준이라 두 기준이 비공유쌍 있는 원소에서 정면으로 어긋났다:
// 문헌값(104.51°)으로 완벽히 최적화된 물이 IDEAL_ANGLES[2]=180° 기준으로 "편차 75° danger"가
// 됐고, 암모니아도 마찬가지였다. 화면의 빨간 경고가 거의 전부 이 오탐이었다.
// theta0는 UFF가 실제로 최소화하는 목표값이기도 해서, 이제 "VSEPR 만족"과 "최적화 수렴"이
// 같은 뜻이 된다(물 104.51 · 암모니아 106.70 · 메탄 109.47 · 에틸렌 120 · SF6 90).
// IDEAL_ANGLES는 그대로 둔다 — 새 원자를 어느 방향에 붙일지(openSlots)는 여전히 그 표가 맞다.
export function vseprCheck(mol, centerIdx, toleranceDeg = ANGLE_TOLERANCE_DEG) {
  const nb = neighbors(mol, centerIdx);
  let theta0 = null;
  try { theta0 = UFF_PARAMS[typeAtom(mol, centerIdx)].theta0; }
  catch { /* 미지원 원소 — 판정하지 않는다 */ }

  const angles = [];
  for (let a = 0; a < nb.length; a++) {
    for (let b = a + 1; b < nb.length; b++) {
      const actual = angleDeg(mol.atoms[nb[a]].pos, mol.atoms[centerIdx].pos, mol.atoms[nb[b]].pos);
      // 180° 대향각은 어떤 형상에서도 허용한다(팔면체/삼각쌍뿔의 축 방향).
      const candidates = theta0 === null ? [180] : [theta0, 180];
      const best = candidates.reduce((p, c) =>
        Math.abs(actual - c) < Math.abs(actual - p) ? c : p);
      angles.push({ atoms: [nb[a], centerIdx, nb[b]], actual, ideal: best, deviation: Math.abs(actual - best) });
    }
  }
  return {
    center: centerIdx,
    coordination: nb.length,
    ideal: theta0,
    angles,
    satisfied: theta0 !== null && angles.length > 0
      && angles.every((x) => x.deviation <= toleranceDeg),
  };
}
```

같은 파일의 `vseprCheck` 바로 아래에 `geometryName`을 추가한다.

```js
// VSEPR 형상 이름. 결합 수만으로 부르면 물이 "직선형"이 된다(결합 2개) — 비공유쌍까지
// 세는 전자 도메인 수와 함께 봐야 굽은형/삼각뿔형이 제대로 나온다.
const GEOMETRY_BY_DOMAIN_BONDS = {
  '2-2': '직선형',
  '3-3': '평면 삼각형', '3-2': '굽은형',
  '4-4': '정사면체', '4-3': '삼각뿔형', '4-2': '굽은형',
  '5-5': '삼각쌍뿔', '6-6': '정팔면체',
};
export function geometryName(mol, i) {
  const bonds = neighbors(mol, i).length;
  // 초원자가(SF6는 결합 6개인데 ELECTRON_DOMAINS[S]=4)에서는 결합 수 자체가 도메인 수다.
  const domains = Math.max(ELECTRON_DOMAINS[mol.atoms[i].el] ?? bonds, bonds);
  return GEOMETRY_BY_DOMAIN_BONDS[`${domains}-${bonds}`] ?? `배위 ${bonds}`;
}
```

> `ELECTRON_DOMAINS`는 같은 파일 위쪽에 이미 선언돼 있으므로 추가 import가 필요 없다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/snap.test.js`
Expected: PASS.

- [ ] **Step 5: 완성 토스트를 새 함수에 연결한다**

`src/app.js`의 snap import에 `geometryName`을 추가한다.

```js
import {
  canBond, vseprCheck, newSnapEvents, idealDirection, openSlots, stability, hudSummary,
  geometryName, syncHydrogens,
} from './snap.js';
```

`src/app.js`의 `GEOMETRY_NAME` 상수 선언(`const GEOMETRY_NAME = { 2: '직선형', ... };`)을 **통째로 삭제**하고, `checkSnaps` 안의 토스트 줄을 바꾼다.

```js
  for (const idx of newSnapEvents(state.snapState, next)) {
    const v = vseprCheck(state.mol, Number(idx));
    playClick(1320); // 성공은 높은 음
    toast(`${state.mol.atoms[idx].el}${idx}: ${geometryName(state.mol, Number(idx))} 완성 (${v.ideal}°)`);
  }
```

- [ ] **Step 6: 전체 확인**

Run: `node --test`
Expected: 전체 PASS. `test/validation.test.js` 포함.

- [ ] **Step 7: 커밋**

```bash
git add src/snap.js src/app.js test/snap.test.js
git commit -m "fix: judge VSEPR against UFF theta0 so water and ammonia stop false-alarming"
```

---

### Task 2: 원자가 미충족(라디칼)을 경고한다

진단 (C). `stability()`가 원자가 *초과*만 보고 *미충족*은 안 본다. 아세트산 시도에서 결합 1개짜리로 남은 산소가 조용히 통과한 이유다. `implicitH`가 이미 "부족한 원자가 수"를 정확히 계산하므로 그 값만 읽으면 된다.

수소가 자동으로 채워지는 경로(`syncHydrogens`)를 거치기 전 상태에서도 조립 중에는 부족한 게 정상이므로, **경고 등급은 `warn`**으로 둔다(빨간 `danger`가 아니다). 사용자가 "여긴 아직 안 끝났다"를 알 수 있으면 충분하다.

**Files:**
- Modify: `src/snap.js` (`stability`)
- Test: `test/snap.test.js`

**Interfaces:**
- Consumes: `implicitH(mol, i)` (같은 파일에 이미 존재).
- Produces: `stability().issues`에 `{ atom, level: 'warn', msg: '<el><i> 원자가 부족(n)' }` 항목이 추가될 수 있다. 점수 계산 규칙은 그대로(`warn` 12점 감점).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/snap.test.js` 끝에 추가한다.

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/snap.test.js`
Expected: FAIL — 첫 테스트의 `assert.ok(...)`가 `원자가 부족` 항목을 못 찾음.

- [ ] **Step 3: 최소 구현**

`src/snap.js`의 `stability` 안, 원자가 *초과* 판정 블록 바로 뒤에 추가한다. (`if (normal !== undefined && used > capMax) {...} else if (...) {...}` 체인 다음 줄.)

```js
    // 원자가 미충족(라디칼). 이중결합을 만들지 못해 결합 1개로 남은 산소처럼, 화학적으로
    // 존재할 수 없는 상태인데 지금까지 아무 표시가 없었다 — 정작 틀린 원자가 조용하고
    // 멀쩡한 -OH가 빨갰다. 조립 중에는 부족한 게 정상이므로 danger가 아니라 warn이다.
    const deficit = implicitH(mol, i);
    if (deficit > 0) {
      issues.push({ atom: i, level: 'warn', msg: `${el}${i} 원자가 부족(${deficit})` });
    }
```

> `implicitH`는 같은 파일 아래쪽에 선언돼 있다. 함수 선언이므로 호이스팅되어 `stability`에서 바로 부를 수 있다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/snap.test.js`
Expected: PASS.

- [ ] **Step 5: 전체 확인**

Run: `node --test`
Expected: 전체 PASS. 기존 `'stability: 최적화된 메탄은 100점...'` 테스트가 그대로 초록이어야 한다(메탄은 원자가가 꽉 차 있어 새 경고가 안 붙는다). SF6 테스트도 그대로여야 한다.

- [ ] **Step 6: 커밋**

```bash
git add src/snap.js test/snap.test.js
git commit -m "feat: warn on unfilled valence so dangling radicals stop passing silently"
```

---

### Task 3: 결합 도구가 거리를 확인한다

진단 (D). 10 Å 떨어진 원자 둘을 이으면 결합 에너지가 25,189 kcal/mol이 되고 화면에는 공간을 가로지르는 막대가 생긴다.

거리 판정을 `canBond`에 넣으면 **안 된다** — `attachAtom`/`previewAttach`가 새 원자를 임시로 2.5 Å(2D 경로는 `[0,0,0]`) 위치에 꽂아놓고 `canBond`를 부르는 구조라, 거리 조건을 넣는 순간 붙이기가 전부 막힌다. 거리 판정은 결합 도구 경로 전용의 별도 함수여야 한다.

한계 배수는 넉넉하게 잡는다(고리 닫기가 주 용도인데, 갓 그린 사슬의 양 끝은 3~4 Å 떨어져 있는 게 정상이다). 대신 결합을 만든 뒤 곧바로 완화를 돌려 실제로 제 길이가 되게 한다.

**Files:**
- Modify: `src/snap.js` (`bondDistanceOk` 신설)
- Modify: `src/app.js` (`handleBondClick`, `REASON_MSG`)
- Test: `test/snap.test.js`

**Interfaces:**
- Consumes: `canBond`(같은 파일), `distance`(`src/geom.js` — 이미 import 중).
- Produces: `bondDistanceOk(mol, i, j) -> boolean` — 두 원자가 결합 도구로 이어도 될 만큼 가까운지. 결합 불가 쌍(`canBond.ok === false`)이면 `false`.
- Produces: 새 reason 문자열 `'too-far'`는 `canBond`가 아니라 `app.handleBondClick`이 직접 만들어 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/snap.test.js`의 snap import에 `bondDistanceOk`를 추가하고 파일 끝에 붙인다.

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/snap.test.js`
Expected: FAIL — `does not provide an export named 'bondDistanceOk'`.

- [ ] **Step 3: 최소 구현**

`src/snap.js`의 `snapTarget` 함수 바로 아래에 추가한다.

```js
// 결합 도구('기존 원자 두 개를 잇기') 전용 거리 판정. canBond에는 절대 넣지 않는다 —
// attachAtom/previewAttach가 새 원자를 임시로 2.5 Å(2D는 원점) 자리에 꽂고 canBond를
// 부르는 구조라, 거기에 거리 조건이 들어가면 붙이기 자체가 막힌다.
// 배수를 넉넉히 잡는 이유: 이 도구의 주 용도인 고리 닫기에서는 갓 그린 사슬의 양 끝이
// 3~4 Å 떨어져 있는 게 정상이다. 그보다 멀면 사용자가 엉뚱한 원자를 찍은 것으로 본다
// (10 Å 결합은 신축 에너지 25,000 kcal/mol짜리 막대가 되어 화면을 가로지른다).
export const BOND_TOOL_MAX_FACTOR = 3.0;

export function bondDistanceOk(mol, i, j) {
  const check = canBond(mol, i, j);
  if (!check.ok) return false;
  return distance(mol.atoms[i].pos, mol.atoms[j].pos) <= check.targetLength * BOND_TOOL_MAX_FACTOR;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/snap.test.js`
Expected: PASS.

- [ ] **Step 5: 결합 도구에 연결한다**

`src/app.js`의 snap import에 `bondDistanceOk`를 추가한다.

`REASON_MSG`에 항목을 추가한다.

```js
  'too-far': '너무 멀리 떨어진 원자입니다 — 가까운 원자끼리 이으세요',
```

`handleBondClick`에서 `canBond` 확인 뒤, `addBond` 앞에 거리 확인과 완화를 넣는다.

```js
  const check = canBond(state.mol, anchor, hit);
  if (!check.ok) {
    toast(REASON_MSG[check.reason] ?? '결합할 수 없습니다', 'err');
    playClick(180);
    render();
    return;
  }
  if (!bondDistanceOk(state.mol, anchor, hit)) {
    toast(REASON_MSG['too-far'], 'err');
    playClick(180);
    render();
    return;
  }
  pushUndo();
  addBond(state.mol, anchor, hit, 1);
  // 고리를 닫으면 두 끝이 아직 제 결합 길이가 아니다 — 붙이기와 달리 위치를 새로 정하는
  // 조작이 아니므로, 여기서만 완화를 돌려 실제 구조로 만든다(붙이기는 "본 자리에 그대로
  // 박힌다"를 지켜야 하므로 자동 완화하지 않는다).
  minimize(state.mol, { maxSteps: 200 });
  playClick(880);
```

- [ ] **Step 6: 전체 확인**

Run: `node --test`
Expected: 전체 PASS.

- [ ] **Step 7: 커밋**

```bash
git add src/snap.js src/app.js test/snap.test.js
git commit -m "fix: reject bond-tool bonds across implausible distances, relax after ring closure"
```

---

### Task 4: 이면각 슬라이더·스캔이 진짜 이면각만 받는다

진단 (E). 메탄에서 H1·C0·H2·H3을 고르면 슬라이더가 활성화되고, 조작해도 원자가 하나도 안 움직이며, 스캔은 전부 0인 평평한 선을 그린다. 오류 메시지도 없다. **"스캔이 제 기능을 못한다"의 정체가 이것이다.**

`branchAtoms !== null`만으로는 부족하다 — i-j, j-k, k-l 세 결합이 실제로 존재하는지 확인해야 한다.

**Files:**
- Modify: `src/model.js` (`isTorsionChain` 신설)
- Modify: `src/uff.js` (`scanDihedral` 입구 검증)
- Modify: `src/app.js` (`updateDihedralPanel`, 슬라이더 핸들러, 스캔 버튼)
- Test: `test/model.test.js`, `test/uff.test.js`

**Interfaces:**
- Consumes: `bondBetween(mol, i, j)` (`src/model.js`에 이미 존재).
- Produces: `isTorsionChain(mol, [i, j, k, l]) -> boolean` — 원자 4개가 서로 다르고 i-j, j-k, k-l이 전부 결합돼 있으면 true.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/model.test.js`의 model import에 `isTorsionChain`을 추가하고 파일 끝에 붙인다.

```js
test('isTorsionChain: 실제 결합 사슬만 통과시킨다', () => {
  const b = loadPreset('butane');
  assert.equal(isTorsionChain(b, [0, 1, 2, 3]), true);   // C-C-C-C
  assert.equal(isTorsionChain(b, [4, 0, 1, 2]), true);   // H-C-C-C

  const m = loadPreset('methane');
  // 진단에서 슬라이더가 잘못 활성화되던 조합: H-C-H-H는 이면각이 아니다.
  assert.equal(isTorsionChain(m, [1, 0, 2, 3]), false);
  assert.equal(isTorsionChain(m, [1, 0, 2, 1]), false);  // 중복 원자
});
```

`test/model.test.js` 상단에 `loadPreset` import가 없으면 추가한다.

```js
import { loadPreset } from '../src/presets.js';
```

`test/uff.test.js` 끝에 추가한다.

```js
test('scanDihedral: 이면각이 아닌 4개는 조용히 0을 내지 않고 거부한다', () => {
  const m = loadPreset('methane');
  assert.throws(() => scanDihedral(m, [1, 0, 2, 3], { stepDeg: 60 }),
    /이면각/, '전부 0인 평평한 선을 돌려주면 안 된다');
});
```

`test/uff.test.js` 상단 import에 `scanDihedral`이 없으면 추가한다.

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/model.test.js test/uff.test.js`
Expected: FAIL — `does not provide an export named 'isTorsionChain'`, 그리고 `scanDihedral`이 던지지 않아 `assert.throws` 실패.

- [ ] **Step 3: 최소 구현**

`src/model.js`의 `setDihedral` 바로 위에 추가한다.

```js
// i-j-k-l이 진짜 이면각인지. 세 결합이 전부 실재해야 한다.
// branchAtoms만으로는 부족하다: 메탄에서 H-C-H-H를 고르면 branchAtoms는 null이 아니어서
// 슬라이더가 활성화되는데, 정작 회전축 반대편에 원자가 없어 조작해도 아무것도 안 움직이고
// 스캔은 전부 0인 평평한 선이 나왔다(오류 메시지도 없이).
export function isTorsionChain(mol, [i, j, k, l]) {
  if (new Set([i, j, k, l]).size !== 4) return false;
  return !!(bondBetween(mol, i, j) && bondBetween(mol, j, k) && bondBetween(mol, k, l));
}
```

`src/uff.js`의 `scanDihedral` 첫 줄에 검증을 넣는다. import에 `isTorsionChain`을 추가한다.

```js
import { neighbors, bondOrderSum, bondBetween, setDihedral, isTorsionChain } from './model.js';
```

```js
export function scanDihedral(mol, idx, { stepDeg = 10, relax = false } = {}) {
  if (!isTorsionChain(mol, idx)) {
    throw new Error('선택한 원자 4개가 이어진 이면각이 아닙니다 (i-j-k-l이 전부 결합돼 있어야 합니다)');
  }
  const snapshot = mol.atoms.map((a) => [...a.pos]);
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/model.test.js test/uff.test.js`
Expected: PASS.

- [ ] **Step 5: 이면각 패널을 새 검증에 연결한다**

`src/app.js`의 model import에 `isTorsionChain`을 추가한다.

`updateDihedralPanel`에서 `branchAtoms` 확인 **앞**에 사슬 확인을 넣는다.

```js
  if (!isTorsionChain(state.mol, s)) {
    slider.disabled = true;
    $('dihedral-info').textContent = '이어진 원자 4개(i-j-k-l)를 순서대로 선택하세요';
    return;
  }
  if (branchAtoms(state.mol, s[1], s[2]) === null) {
    slider.disabled = true;
    $('dihedral-info').textContent = '고리 결합 — 직접 회전 불가';
    return;
  }
```

`$('scan').onclick`의 선택 개수 확인 뒤에 같은 확인을 넣는다.

```js
$('scan').onclick = () => {
  if (state.selection.length !== 4) { toast('원자 4개를 순서대로 선택하세요', 'err'); return; }
  if (!isTorsionChain(state.mol, state.selection)) {
    toast('이어진 원자 4개(i-j-k-l)를 선택하세요', 'err');
    return;
  }
  try {
```

- [ ] **Step 6: 전체 확인**

Run: `node --test`
Expected: 전체 PASS. `test/validation.test.js`의 에탄·부탄 스캔 테스트는 전부 진짜 사슬이므로 그대로 통과해야 한다.

- [ ] **Step 7: 커밋**

```bash
git add src/model.js src/uff.js src/app.js test/model.test.js test/uff.test.js
git commit -m "fix: validate that dihedral selections are real i-j-k-l chains"
```

---

### Task 5: 결합 차수 편집 (단일 ↔ 이중 ↔ 삼중)

진단 (B). 이중결합을 만들 수 없어서 아세트산이 `C2H5O2`(라디칼 포함)로 나온다. 검증 결과, 차수만 지정할 수 있으면 물리 엔진은 정확한 아세트산을 만든다(C=O 1.224 / C-O 1.380 / O=C-O 120.6°). **7개 요구 중 가장 큰 기능 결손이다.**

조작: 결합 도구를 든 채 **결합선을 클릭**하면 차수가 1→2→3→1로 순환한다. 원자 클릭(기존: 두 원자 잇기)과 결합선 클릭이 같은 도구 안에서 갈린다 — 새 도구 버튼을 만들지 않는다.

**Files:**
- Modify: `src/snap.js` (`cycleBondOrder` 신설)
- Modify: `src/app.js` (`pickBond` 신설, 클릭 핸들러 분기, 2D 클릭 핸들러)
- Modify: `src/sketch2d.js` (`data-bond` 히트타깃)
- Test: `test/snap.test.js`, `test/sketch2d.test.js`

**Interfaces:**
- Consumes: `bondOrderSum`, `MAX_VALENCE`, `EXPANDED_VALENCE` (snap.js가 이미 전부 씀).
- Produces:
  - `cycleBondOrder(mol, bond) -> { ok: true, order } | { ok: false, reason }` — `bond`는 `mol.bonds`의 원소를 그대로 넘긴다(제자리 수정). 올릴 때만 원자가를 확인하고, 상한을 넘으면 차수를 **바꾸지 않고** 거부한다.
  - `renderSVG`의 결합선마다 `data-bond="<i>-<j>"` 투명 히트타깃이 추가된다.
  - `pickBond(px, py, threshold?) -> bond | null` (app.js 내부, export 안 함).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/snap.test.js`의 snap import에 `cycleBondOrder`를 추가하고 파일 끝에 붙인다.

```js
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
```

`test/snap.test.js` 상단 import에 `measure`가 없으면 model import에 추가한다.

`test/sketch2d.test.js` 끝에 추가한다.

```js
test('renderSVG: 결합마다 data-bond 히트타깃을 낸다', () => {
  const m = loadPreset('ethane');
  const svg = renderSVG(m);
  // 에탄의 무거운 원자 결합은 C-C 하나뿐이다(C-H는 골격식에 안 그린다).
  assert.equal((svg.match(/data-bond="0-1"/g) ?? []).length, 1);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/snap.test.js test/sketch2d.test.js`
Expected: FAIL — `does not provide an export named 'cycleBondOrder'`, 그리고 `data-bond`를 못 찾음.

- [ ] **Step 3: `cycleBondOrder` 구현**

`src/snap.js`의 `canBond` 바로 아래에 추가한다.

```js
// 결합 차수를 1 -> 2 -> 3 -> 1로 돌린다. 올릴 때만 원자가를 확인하면 된다(내리는 건 늘 안전).
// 이 함수가 없으면 카보닐·나이트릴·방향족을 손으로 만들 수 없다 — 아세트산을 조립하면
// 이중결합을 못 만들어 C2H5O2(결합 1개짜리 산소 = 라디칼)라는 존재하지 않는 분자가 나왔다.
// bond는 mol.bonds의 원소를 그대로 받아 제자리에서 고친다(addBond가 이미 같은 규약이다).
export function cycleBondOrder(mol, bond) {
  const next = bond.order >= 3 ? 1 : bond.order + 1;
  const delta = next - bond.order;
  if (delta > 0) {
    for (const idx of [bond.i, bond.j]) {
      const el = mol.atoms[idx].el;
      const normal = MAX_VALENCE[el];
      if (normal === undefined) return { ok: false, reason: 'unsupported-element' };
      const capMax = EXPANDED_VALENCE[el] ?? normal;
      if (bondOrderSum(mol, idx) + delta > capMax) return { ok: false, reason: 'valence-full' };
    }
  }
  bond.order = next;
  return { ok: true, order: next };
}
```

- [ ] **Step 4: 2D 히트타깃 구현**

`src/sketch2d.js`의 `renderSVG` 안, `hitsSvg`를 만드는 블록 **앞**에 결합 히트타깃을 추가한다.

```js
  // 결합 차수 편집용 히트타깃. 원자 히트타깃(hitsSvg)보다 먼저 그려서 원자가 위에 오게 한다
  // (원자와 결합이 겹치는 지점에서는 원자 클릭이 이겨야 한다).
  let bondHitsSvg = '';
  for (const b of heavyBonds) {
    const p = pos.get(b.i), q = pos.get(b.j);
    bondHitsSvg += `<line data-bond="${b.i}-${b.j}" x1="${sx(p[0]).toFixed(1)}" y1="${sy(p[1]).toFixed(1)}" `
      + `x2="${sx(q[0]).toFixed(1)}" y2="${sy(q[1]).toFixed(1)}" `
      + 'stroke="transparent" stroke-width="12" style="cursor:pointer"/>';
  }
```

같은 함수의 반환문에 `bondHitsSvg`를 `hitsSvg` 앞에 끼운다.

```js
  return `<svg viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" width="100%" height="100%">`
    + `${selSvg}${bondsSvg}${labelsSvg}${bondHitsSvg}${hitsSvg}${ghostSvg}${bondPreviewSvg}</svg>`;
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `node --test test/snap.test.js test/sketch2d.test.js`
Expected: PASS. 특히 아세트산 회귀 테스트가 `C2H4O2`를 내야 한다.

- [ ] **Step 6: 3D 결합 히트테스트와 클릭 배선**

`src/app.js`의 snap import에 `cycleBondOrder`를 추가한다.

`pickAtom` 바로 아래에 `pickBond`를 추가한다.

```js
// 결합 중점을 화면에 투영해 가장 가까운 결합을 찾는다(pickAtom과 같은 좌표 규칙).
// 임계값을 원자보다 작게 잡아, 원자 근처에서는 원자 클릭이 이기게 한다.
function pickBond(px, py, thresholdPx = 16) {
  let best = null, bestD = thresholdPx;
  for (const b of state.mol.bonds) {
    const p = state.mol.atoms[b.i].pos, q = state.mol.atoms[b.j].pos;
    const s = viewer.modelToScreen({ x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2, z: (p[2] + q[2]) / 2 });
    const d = Math.hypot(s.x - px, s.y - py);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}
```

`handleBondClick` 바로 위에 차수 순환 처리를 추가한다.

```js
// 결합 도구로 결합선을 클릭하면 차수를 1 -> 2 -> 3 -> 1로 돌린다(원자를 클릭하면
// 기존대로 두 원자를 잇는다 — 같은 도구 안에서 클릭 대상으로만 갈린다).
function handleBondOrderClick(bond) {
  const r = cycleBondOrder(state.mol, bond);
  if (!r.ok) {
    toast(REASON_MSG[r.reason] ?? '차수를 바꿀 수 없습니다', 'err');
    playClick(180);
    return;
  }
  // cycleBondOrder가 이미 제자리에서 바꿔버렸으므로, 되돌리기 스냅샷은 되돌린 뒤에 찍는다.
  bond.order = r.order === 1 ? 3 : r.order - 1;
  pushUndo();
  bond.order = r.order;
  playClick(660 + r.order * 220);
  toast(`결합 차수 ${r.order}`);
  checkSnaps();
  render();
}
```

3D 클릭 핸들러(`viewerEl.addEventListener('click', ...)`)에서 원자 히트 실패 시 결합을 확인하도록 바꾼다.

```js
  const hit = pickAtom(ev.pageX, ev.pageY, 24);
  if (hit === -1) {
    if (state.tool === 'bond') {
      const b = pickBond(ev.pageX, ev.pageY);
      if (b) handleBondOrderClick(b);
    }
    return;
  }
  handleAtomClick(hit, ev.shiftKey);
```

2D 클릭 핸들러(`sketch2dEl.addEventListener('click', ...)`)에서 원자 히트타깃이 없을 때 결합 히트타깃을 본다.

```js
sketch2dEl.addEventListener('click', (ev) => {
  if (!state.flat) return;
  const hit = ev.target.closest('[data-atom]');
  if (!hit) {
    const bh = ev.target.closest('[data-bond]');
    if (bh && state.tool === 'bond') {
      const [i, j] = bh.dataset.bond.split('-').map(Number);
      const bond = state.mol.bonds.find((b) => b.i === i && b.j === j);
      if (bond) handleBondOrderClick(bond);
    }
    return;
  }
  const idx = Number(hit.dataset.atom);
```

> 아래 `if (state.tool === 'place') { ... }` 이하는 그대로 둔다.

`index.html`의 결합 도구 버튼 툴팁을 갱신한다.

```html
    <button id="tool-bond" class="tool" data-tool="bond" title="결합: 원자 두 개를 순서대로 클릭해 잇기(고리 닫기) · 결합선을 클릭하면 차수 1↔2↔3">결합</button>
```

- [ ] **Step 7: 전체 확인 + 수동 확인**

Run: `node --test`
Expected: 전체 PASS.

```bash
python3 -m http.server 8000
```
1. 프리셋 `에틸렌` → 결합 도구 → C=C 결합선 클릭 → 차수가 3, 1, 2로 돌아야 한다(클릭할 때마다 토스트).
2. 메탄에서 C-H 결합선 클릭 → `원자가가 가득 찼습니다` 토스트, 차수 그대로.
3. `Ctrl+Z` → 차수가 되돌아가야 한다.
4. 2D 보기에서도 같은 동작.

- [ ] **Step 8: 커밋**

```bash
git add src/snap.js src/sketch2d.js src/app.js index.html test/snap.test.js test/sketch2d.test.js
git commit -m "feat: edit bond order by clicking a bond, so carbonyls and acetic acid are buildable"
```

---

### Task 6: 가지치기 삭제

요구 2. 사슬 중간을 지우면 그 뒤가 허공에 떠버려서 여러 번 지워야 한다. `branchAtoms`가 이미 있지만 삭제 경로가 안 쓴다.

"가지치기"의 정의: 원자를 지운 뒤 남은 **가장 큰 연결 성분만 남긴다**. 사슬 중간을 자르면 본체가 남고 떨어져 나간 조각이 함께 사라진다. 동점이면 더 작은 인덱스를 포함한 쪽을 남긴다(결정적).

지우개 도구의 기본 동작을 가지치기로 바꾸고, `Del` 키(선택 삭제)는 지금처럼 **고른 것만 정확히** 지운다 — 두 동작을 도구로 구분해 새 모드를 만들지 않는다.

**Files:**
- Modify: `src/model.js` (`pruneAtom` 신설)
- Modify: `src/app.js` (`deleteAtom`)
- Test: `test/model.test.js`

**Interfaces:**
- Consumes: `removeAtom`, `neighbors` (같은 파일).
- Produces: `pruneAtom(mol, i) -> number[]` — 실제로 지워진 원자 인덱스들(원본 기준, 내림차순). 지울 게 없거나 분자가 전부 사라질 상황이면 아무것도 안 지우고 `[]`를 돌려준다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/model.test.js`의 model import에 `pruneAtom`을 추가하고 파일 끝에 붙인다.

```js
test('pruneAtom: 사슬 중간을 자르면 떨어져 나간 작은 쪽이 함께 사라진다', () => {
  // C0-C1-C2-C3 사슬(수소 없음). C1을 자르면 C0 쪽(1개)이 작고 C2-C3 쪽(2개)이 크다.
  const m = createMolecule();
  for (let k = 0; k < 4; k++) addAtom(m, 'C', [k * 1.5, 0, 0]);
  addBond(m, 0, 1); addBond(m, 1, 2); addBond(m, 2, 3);
  pruneAtom(m, 1);
  assert.equal(m.atoms.length, 2, 'C2, C3만 남아야 한다');
  assert.equal(m.bonds.length, 1);
});

test('pruneAtom: 말단을 자르면 그 하나만 사라진다', () => {
  const m = loadPreset('methane');
  pruneAtom(m, 1); // H 하나
  assert.equal(m.atoms.length, 4);
});

test('pruneAtom: 고리는 끊어져도 하나로 이어져 있어 전부 남는다', () => {
  const m = loadPreset('cyclohexane_chair');
  const before = m.atoms.length;
  pruneAtom(m, 0); // 고리 탄소 하나 — 나머지는 여전히 한 덩어리다
  assert.equal(m.atoms.length, before - 3, '탄소 1개 + 거기 붙은 H 2개만 사라진다');
});

test('pruneAtom: 원자가 하나뿐이면 아무것도 지우지 않는다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  assert.deepEqual(pruneAtom(m, 0), []);
  assert.equal(m.atoms.length, 1);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/model.test.js`
Expected: FAIL — `does not provide an export named 'pruneAtom'`.

- [ ] **Step 3: 최소 구현**

`src/model.js`의 `removeAtom` 바로 아래에 추가한다.

```js
// 연결 성분 목록. 각 성분은 원자 인덱스 배열이다.
function components(mol) {
  const seen = new Set();
  const out = [];
  for (let s = 0; s < mol.atoms.length; s++) {
    if (seen.has(s)) continue;
    const comp = [];
    const stack = [s];
    seen.add(s);
    while (stack.length) {
      const cur = stack.pop();
      comp.push(cur);
      for (const n of neighbors(mol, cur)) {
        if (!seen.has(n)) { seen.add(n); stack.push(n); }
      }
    }
    out.push(comp.sort((a, b) => a - b));
  }
  return out;
}

// 가지치기 삭제: 원자를 지운 뒤 가장 큰 연결 성분만 남긴다. 사슬 중간을 자르면 본체가
// 남고 떨어져 나간 조각이 함께 사라진다 — 예전엔 원자 하나만 지워서 뒤쪽 가지가 허공에
// 떠버렸고, 사용자가 남은 조각을 하나씩 다시 지워야 했다.
// 크기가 같으면 더 작은 인덱스를 포함한 쪽을 남긴다(결정적).
// 반환값은 실제로 지운 원본 인덱스들(내림차순). 분자가 통째로 사라질 상황이면 아무것도 안 한다.
export function pruneAtom(mol, i) {
  if (mol.atoms.length <= 1) return [];
  const probe = { atoms: mol.atoms.map((a) => ({ ...a, pos: [...a.pos] })), bonds: mol.bonds.map((b) => ({ ...b })) };
  removeAtom(probe, i);
  if (probe.atoms.length === 0) return [];

  const comps = components(probe);
  const keep = comps.reduce((best, c) =>
    (c.length > best.length || (c.length === best.length && c[0] < best[0]) ? c : best));
  const keepSet = new Set(keep);
  // probe 인덱스를 원본 인덱스로 되돌린다 — removeAtom이 i보다 큰 인덱스를 1씩 당겼다.
  const toOriginal = (p) => (p >= i ? p + 1 : p);
  const doomed = [i];
  for (let p = 0; p < probe.atoms.length; p++) {
    if (!keepSet.has(p)) doomed.push(toOriginal(p));
  }
  const sorted = [...new Set(doomed)].sort((a, b) => b - a);
  for (const idx of sorted) removeAtom(mol, idx);
  return sorted;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/model.test.js`
Expected: PASS.

- [ ] **Step 5: 지우개에 연결한다**

`src/app.js`의 model import에 `pruneAtom`을 추가하고, `deleteAtom`을 바꾼다.

```js
// 원자 하나를 뗀다(지우개 도구·우클릭). 떨어져 나가는 작은 조각은 함께 지운다
// (model.pruneAtom) — 사슬 중간을 자를 때마다 남은 파편을 하나씩 다시 지우던 불편을 없앤다.
function deleteAtom(i) {
  const removed = pruneAtom(state.mol, i);
  if (removed.length === 0) { toast('마지막 원자는 삭제할 수 없습니다', 'err'); return; }
  pushUndo();
  // pruneAtom이 이미 지워버렸으므로 스냅샷은 되돌린 상태로 남길 수 없다 — undo 스택에는
  // 이 함수에 들어오기 전 상태가 필요하다. 그래서 지우기 전에 한 번 더 확인하고(위 길이 검사)
  // 여기서는 지운 뒤의 정리만 한다. (undo 스냅샷 순서는 아래 Step 6에서 바로잡는다.)
  state.selection = [];
  state.snapState = {};
  playClick(220);
  checkSnaps();
  render();
}
```

- [ ] **Step 6: 되돌리기 순서를 바로잡는다**

Step 5의 코드는 `pushUndo`가 삭제 **뒤**에 불려서 되돌리기가 깨진다. 아래로 교체한다.

```js
// 원자 하나를 뗀다(지우개 도구·우클릭). 떨어져 나가는 작은 조각은 함께 지운다
// (model.pruneAtom) — 사슬 중간을 자를 때마다 남은 파편을 하나씩 다시 지우던 불편을 없앤다.
// 선택 삭제(Del)는 지금처럼 "고른 것만 정확히" 지운다 — 두 동작을 도구로 구분한다.
function deleteAtom(i) {
  if (state.mol.atoms.length <= 1) { toast('마지막 원자는 삭제할 수 없습니다', 'err'); return; }
  pushUndo();
  const removed = pruneAtom(state.mol, i);
  if (removed.length === 0) { state.undoStack.pop(); return; }
  state.selection = [];
  state.snapState = {};
  playClick(220);
  if (removed.length > 1) toast(`${removed.length}개 원자 제거(가지치기)`);
  checkSnaps();
  render();
}
```

- [ ] **Step 7: 전체 확인 + 수동 확인**

Run: `node --test`
Expected: 전체 PASS.

`python3 -m http.server 8000`에서 프리셋 `n-부탄` → 지우개로 가운데 탄소 클릭 → 한쪽 조각이 통째로 사라지고 본체만 남아야 한다. `Ctrl+Z`로 전부 복구돼야 한다.

- [ ] **Step 8: 커밋**

```bash
git add src/model.js src/app.js test/model.test.js
git commit -m "feat: eraser prunes the detached fragment instead of leaving orphans"
```

---

### Task 7: 원소별 색과 크기 (CPK) + 색상 기준 토글

진단 (F). 모든 원자가 반지름 0.30에 응력 히트맵 색이라 H·C·O가 전부 같아 보인다.

기본을 **원소 색(CPK)**으로 바꾼다 — 조립이 주 활동이므로 원소 구분이 우선이다. 응력 히트맵은 분석용 기능이라 버리지 않고 헤더의 셀렉트로 전환한다(범례도 그때만 보인다). 반지름은 이미 있는 `COVALENT_RADIUS`를 그대로 쓴다.

**Files:**
- Modify: `src/params.js` (`CPK_COLOR` 추가)
- Modify: `src/app.js` (`render`의 스타일, `state.colorBy`, 셀렉트 배선)
- Modify: `index.html` (색상 기준 셀렉트, 범례 표시 규칙)
- Test: `test/params.test.js` (신규)

**Interfaces:**
- Consumes: `COVALENT_RADIUS`(이미 `params.js`에 있음), `strainColor`(app.js).
- Produces: `CPK_COLOR: Record<string, string>` — `ELEMENTS` 12종 전부에 대한 `#rrggbb`.
- Produces: `state.colorBy: 'element' | 'strain'`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

새 파일 `test/params.test.js`를 만든다.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CPK_COLOR, COVALENT_RADIUS, MAX_VALENCE } from '../src/params.js';

// app.js의 팔레트와 같은 목록. 여기 없는 원소를 팔레트에 넣으면 색이 없어 검게 그려진다.
const ELEMENTS = ['H', 'C', 'N', 'O', 'F', 'S', 'P', 'Cl', 'Si', 'B', 'Br', 'I'];

test('CPK_COLOR가 팔레트의 모든 원소를 덮는다', () => {
  for (const el of ELEMENTS) {
    assert.match(CPK_COLOR[el] ?? '', /^#[0-9a-f]{6}$/i, `${el} 색 누락`);
  }
});

test('CPK_COLOR와 COVALENT_RADIUS가 같은 원소 집합을 다룬다', () => {
  assert.deepEqual(Object.keys(CPK_COLOR).sort(), Object.keys(COVALENT_RADIUS).sort());
  assert.deepEqual(Object.keys(CPK_COLOR).sort(), Object.keys(MAX_VALENCE).sort());
});

test('수소가 탄소보다 작게 그려진다', () => {
  assert.ok(COVALENT_RADIUS.H < COVALENT_RADIUS.C);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/params.test.js`
Expected: FAIL — `does not provide an export named 'CPK_COLOR'`.

- [ ] **Step 3: 최소 구현**

`src/params.js`의 `COVALENT_RADIUS` 바로 아래에 추가한다.

```js
// CPK/Jmol 표준 원소 색. 화학자가 기대하는 관례색이라 임의로 바꾸지 않는다.
// 수소만 순백(#ffffff) 대신 아주 밝은 회색으로 둔다 — 이 앱의 밝은 배경(#f8fafc)에서
// 순백 구는 윤곽이 사라진다(3Dmol 음영이 있어도 가장자리가 배경에 묻는다).
export const CPK_COLOR = {
  H: '#e8e8e8', B: '#ffb5b5', C: '#606060', N: '#3050f8', O: '#ff0d0d', F: '#90e050',
  Si: '#f0c8a0', P: '#ff8000', S: '#e6c53d', Cl: '#1ff01f', Br: '#a62929', I: '#940094',
};
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/params.test.js`
Expected: PASS.

- [ ] **Step 5: 마크업에 색상 기준 셀렉트를 넣는다**

`index.html`의 헤더에서 프리셋 셀렉트 뒤에 추가한다.

```html
  <select id="colorby" title="원자 색을 무엇으로 칠할지">
    <option value="element">원소 색</option>
    <option value="strain">응력 히트맵</option>
  </select>
```

범례는 응력 모드에서만 보이게 한다. `index.html`의 `<style>`에서 `body[data-flat="true"] #legend, ...` 규칙 아래에 추가한다.

```css
  body:not([data-colorby="strain"]) #legend { display: none; }
```

- [ ] **Step 6: 렌더에 연결한다**

`src/app.js`의 params import를 바꾼다.

```js
import { MAX_VALENCE, CPK_COLOR, COVALENT_RADIUS } from './params.js';
```

`state`에 필드를 추가한다.

```js
  colorBy: 'element', // 'element' | 'strain' — 조립 중에는 원소 구분이 우선이라 원소 색이 기본이다
```

`render()`의 스타일 지정 블록을 교체한다.

```js
  const vmax = Math.max(0.5, ...e.perAtom); // 0.5 kcal/mol 미만 차이는 노이즈로 본다
  // 원자마다 setStyle을 부르면 3Dmol이 호출마다 전체 원자를 훑어서 O(n²)가 된다 —
  // colorfunc 하나로 넘겨 setStyle은 딱 한 번만 부른다(serial = XYZ 모델의 0-based 인덱스).
  // 예전엔 색이 응력 히트맵뿐이고 반지름도 전부 0.30이라 H·C·O가 화면에서 완전히 똑같이
  // 보였다. 조립 중에는 원소 구분이 우선이므로 CPK 색이 기본이고, 응력 히트맵은 헤더
  // 셀렉트로 전환한다. 반지름은 이미 있는 공유결합 반지름을 그대로 쓴다(H가 눈에 띄게 작다).
  const colors = state.mol.atoms.map((a, i) =>
    (state.colorBy === 'strain' ? strainColor(e.perAtom[i], vmax) : CPK_COLOR[a.el] ?? '#909090'));
  const radii = state.mol.atoms.map((a) => (COVALENT_RADIUS[a.el] ?? 0.7) * 0.55);
  viewer.setStyle({}, {
    sphere: { colorfunc: (atom) => colors[atom.serial], radiusfunc: (atom) => radii[atom.serial] },
    stick: { radius: 0.14, colorfunc: (atom) => colors[atom.serial] },
  });
```

> `radiusfunc`가 이 3Dmol 빌드에서 동작하지 않으면(구가 전부 기본 크기로 나오면) 폴백:
> `sphere`에 `radius: 0.30`을 다시 주고 반지름 차등은 포기한다. 색 구분만으로도 요구 5는
> 해소되므로, 크기까지 못 되면 그 사실을 커밋 메시지에 적고 넘어간다.

셀렉트를 배선한다(`$('preset').onchange` 근처).

```js
$('colorby').onchange = (ev) => {
  state.colorBy = ev.target.value;
  document.body.dataset.colorby = state.colorBy;
  render();
};
document.body.dataset.colorby = state.colorBy;
```

- [ ] **Step 7: 전체 확인 + 수동 확인**

Run: `node --test`
Expected: 전체 PASS.

`python3 -m http.server 8000`에서:
1. 기본 상태에서 물 프리셋 → 산소가 빨강, 수소가 밝은 회색이고 산소가 더 커야 한다.
2. 색상 기준을 `응력 히트맵`으로 → 예전처럼 파랑~빨강 히트맵 + 좌하단 범례가 보여야 한다.
3. `원소 색`으로 되돌리면 범례가 사라져야 한다.

- [ ] **Step 8: 커밋**

```bash
git add src/params.js src/app.js index.html test/params.test.js
git commit -m "feat: color and size atoms by element (CPK) with a strain-heatmap toggle"
```

---

### Task 8: 경고·선택 표시를 배지로 바꾼다

요구 1. 지금은 원자를 통째로 감싸는 와이어프레임 구(경고)와 반투명 노란 구(선택)라 원자 모양과 색을 가린다. T7에서 원소 색이 들어오면 더 가린다.

3Dmol의 `addLabel`로 원자 **위에 떠 있는 작은 배지**로 바꾼다. 항상 화면을 향하고, 원자를 안 가리고, 선택은 **순서 번호**를 보여줘서 이면각 선택(순서가 의미를 갖는다)에 실제로 도움이 된다.

**Files:**
- Modify: `src/app.js` (`render`의 선택·경고 표시, 라벨 정리)
- Test: 없음 — 순수 3Dmol 배선이다. Step 4의 수동 확인으로 대체한다.

**Interfaces:**
- Consumes: `stability`, `hudSummary`(이미 사용 중), `COVALENT_RADIUS`(T7에서 import됨).
- Produces: 없음(app.js 내부 표현만 바뀐다). `selectionShapes`/`warnShapes` 배열은 라벨 배열로 대체된다.

- [ ] **Step 1: 라벨 수명주기를 만든다**

`src/app.js`의 `selectionShapes`/`warnShapes` 선언을 바꾼다.

```js
let firstRender = true;
let selectionShapes = []; // '결합' 도구의 대기 앵커 강조 구 — 이 배열만 지웠다 다시 그린다.
let overlayLabels = [];   // 선택 순서 배지 + 경고 배지. 셰이프와 수명주기가 달라 따로 관리한다.
let bondHover2d = null;
```

`render()`의 정리 블록을 바꾼다.

```js
  for (const s of selectionShapes) viewer.removeShape(s);
  selectionShapes = [];
  for (const l of overlayLabels) viewer.removeLabel(l);
  overlayLabels = [];
```

- [ ] **Step 2: 선택 표시를 순서 배지로 바꾼다**

`render()`의 선택 강조 루프를 교체한다.

```js
  // 선택 표시는 원자를 덮는 반투명 구가 아니라 원자 위에 뜨는 순서 배지다 — 구는 원소 색과
  // 모양을 가렸고, 무엇보다 "몇 번째로 고른 원자인지"를 보여주지 못했다(이면각은 순서가
  // 의미를 갖는다: i-j-k-l).
  state.selection.forEach((i, order) => {
    const p = state.mol.atoms[i].pos;
    const r = (COVALENT_RADIUS[state.mol.atoms[i].el] ?? 0.7) * 0.55;
    overlayLabels.push(viewer.addLabel(String(order + 1), {
      position: { x: p[0], y: p[1] + r + 0.30, z: p[2] },
      backgroundColor: '#eab308', backgroundOpacity: 0.95,
      fontColor: '#1c1917', fontSize: 12, borderThickness: 0,
      alignment: 'center', inFront: true,
    }));
  });
```

- [ ] **Step 3: 경고 표시를 배지로 바꾼다**

`render()`의 경고 와이어프레임 루프를 교체한다(`const st = stability(...)` 이후 부분).

```js
  // 경고도 배지로 낸다. 기호는 HUD 칩과 똑같이 맞춘다(danger ✕ / warn ▲) — 화면 아래위에서
  // 같은 기호를 쓰면 "이 칩이 저 원자"라는 연결이 설명 없이 읽힌다.
  // 선택 배지와 겹치지 않게 반대쪽(아래)에 단다.
  for (const [i, level] of worst) {
    const p = state.mol.atoms[i].pos;
    const r = (COVALENT_RADIUS[state.mol.atoms[i].el] ?? 0.7) * 0.55;
    overlayLabels.push(viewer.addLabel(level === 'danger' ? '✕' : '▲', {
      position: { x: p[0], y: p[1] - r - 0.30, z: p[2] },
      backgroundColor: level === 'danger' ? '#dc2626' : '#f59e0b', backgroundOpacity: 0.95,
      fontColor: '#ffffff', fontSize: 12, borderThickness: 0,
      alignment: 'center', inFront: true,
    }));
  }
```

- [ ] **Step 4: 전체 확인 + 수동 확인**

Run: `node --test`
Expected: 전체 PASS(이 태스크는 테스트를 추가하지 않는다 — 순수 3Dmol 배선이다).

`python3 -m http.server 8000`에서:
1. 원자를 4개 순서대로 클릭 → 각 원자 위에 노란 `1 2 3 4` 배지가 순서대로 떠야 한다. 반투명 노란 구는 더 이상 없어야 한다.
2. 결합 도구로 O에 H를 하나만 붙인 상태를 만든다 → 그 O 아래에 주황 `▲` 배지(원자가 부족)가 떠야 한다.
3. `Esc` → 배지가 전부 사라져야 한다.
4. 프리셋을 여러 번 바꿔가며 배지가 쌓이지 않는지 확인한다(라벨 정리 누락 시 계속 누적된다).

> 라벨이 누적되면 `viewer.removeLabel`이 이 빌드에서 안 먹는 것이므로, `render()` 정리
> 블록에서 `viewer.removeAllLabels()`를 쓰고 `overlayLabels` 배열을 지운다.

- [ ] **Step 5: 커밋**

```bash
git add src/app.js
git commit -m "feat: replace engulfing wireframe/sphere markers with floating badges"
```

---

### Task 9: 학습/연구 모드를 제거한다

요구 3. 모드가 패널 노출과 붙인 뒤 자동 최적화 여부만 갈랐는데, 지금은 둘 다 의미가 없다. 분석 패널은 항상 보이면 되고, 자동 최적화는 마인크래프트식 배치("본 자리에 그대로 박힌다")와 정면으로 충돌한다.

`openSlots`가 이미 정확한 VSEPR 방향과 UFF 평형 길이로 놓으므로 붙인 직후 구조는 이미 국소적으로 최적에 가깝다. 자동 최적화는 없애고, 필요하면 사용자가 `구조 최적화`를 누른다(고리 닫기 후 완화는 T3에서 이미 그 경로에만 남겼다).

**Files:**
- Modify: `src/app.js` (`state.mode`, `attachAtom`의 자동 최적화, 모드 셀렉트 배선)
- Modify: `index.html` (모드 셀렉트, `.research-only` CSS 규칙과 클래스)
- Test: 없음(삭제 작업) — 전체 스위트로 회귀만 확인한다.

- [ ] **Step 1: app.js에서 모드를 걷어낸다**

- `state`에서 `mode: 'learn',` 줄을 삭제한다.
- `state.tool` 주석에서 `mode(학습/연구)는 패널 노출만 결정한다.` 문장을 지운다.
- `attachAtom`에서 자동 최적화 줄을 삭제한다.

```js
  // (삭제) if (state.mode === 'learn' && !pos2d) minimize(state.mol, { maxSteps: 120 });
```

  그 위 주석 블록에서 자동 최적화를 설명하던 문장도 함께 정리하고, 아래 문장으로 대체한다.

```js
  // 붙인 원자는 미리보기로 보여준 자리에 그대로 남는다 — openSlots가 이미 정확한 VSEPR
  // 방향과 UFF 평형 길이로 놓으므로 국소적으로는 이미 최적에 가깝다. 전체 완화가 필요하면
  // 사용자가 '구조 최적화'를 누른다(예전 학습 모드의 자동 최적화는 붙일 때마다 구조 전체를
  // 움직여서 "본 자리에 박힌다"는 감각을 깨뜨렸다).
```

- `$('mode').onchange = ...` 핸들러 전체를 삭제한다.
- `document.body.dataset.mode = state.mode;` 줄을 삭제한다.

- [ ] **Step 2: index.html에서 모드를 걷어낸다**

- 헤더의 `<select id="mode">...</select>` 줄을 삭제한다.
- `<style>`에서 아래 규칙과 그 위 주석을 삭제한다.

```css
  body[data-mode="learn"] .research-only { display: none; }
```

- `<aside>`의 두 곳에서 `class="research-only"`만 지운다(섹션 자체는 남긴다 — 이제 항상 보인다).

```html
  <section><h2>항별 분해 (kcal/mol)</h2><div id="breakdown"></div></section>
  <section><h2>최적화 리플레이</h2>
```

- [ ] **Step 3: 남은 참조가 없는지 확인한다**

```bash
grep -n "state.mode\|research-only\|data-mode\|'learn'\|\"learn\"" src/ index.html
```
Expected: 결과 없음. 하나라도 남으면 그 자리에서 지운다(`$('mode')`가 null인데 참조하면 로드 즉시 터진다).

- [ ] **Step 4: 전체 확인 + 수동 확인**

Run: `node --test`
Expected: 전체 PASS.

`python3 -m http.server 8000`에서 콘솔에 에러가 없어야 하고, 헤더에 모드 셀렉트가 없어야 하며, 우측 패널의 `항별 분해`와 `최적화 리플레이`가 항상 보여야 한다. 원자를 붙여도 구조 전체가 움직이지 않아야 한다.

- [ ] **Step 5: 커밋**

```bash
git add src/app.js index.html
git commit -m "refactor: drop the learn/research mode split"
```

---

### Task 10: README 반영 + 최종 검증

**Files:**
- Modify: `README.md`
- Test: 전체 스위트

- [ ] **Step 1: 조작법의 결합 도구 행을 갱신한다**

조작법 표의 `**결합**` 행을 아래로 바꾼다.

```markdown
| **결합** | 원자 두 개를 순서대로 클릭 / 결합선 클릭 | 원자 둘을 클릭하면 새 결합을 만든다 — **고리를 닫는 유일한 방법**이다. 너무 멀리 떨어진 원자끼리는 거부한다(공간을 가로지르는 막대가 생기던 문제). **결합선을 클릭하면 차수가 1 → 2 → 3 → 1로 순환한다** — 카보닐(C=O)·나이트릴(C≡N)은 이걸로 만든다 |
```

- [ ] **Step 2: 지우개 행을 갱신한다**

```markdown
| **지우개** | 원자 클릭 | 그 원자를 떼고, 그 결과 본체에서 떨어져 나가는 조각도 함께 뗀다(가지치기). 고른 것만 정확히 지우려면 선택 후 `Del`을 쓴다 |
```

- [ ] **Step 3: 원소 색 항목을 추가한다**

`- **키보드:**` 항목 앞에 넣는다.

```markdown
- **원자 색:** 기본은 CPK 표준 원소 색이고 크기도 원소별 공유결합 반지름을 따른다(수소가
  눈에 띄게 작다). 헤더의 색상 셀렉트를 `응력 히트맵`으로 바꾸면 예전처럼 원자별 변형
  에너지를 파랑~빨강으로 칠하고 좌하단 범례가 나타난다.
- **선택·경고 표시:** 선택한 원자에는 노란 **순서 배지**(1·2·3·4)가 뜬다 — 이면각은 고른
  순서가 i-j-k-l로 그대로 쓰이므로 순서가 보여야 한다. 문제가 있는 원자에는 아래쪽에 경고
  배지가 뜬다(**✕** 심각 / **▲** 경고). 기호는 좌상단 안정도 HUD의 칩과 같다.
```

- [ ] **Step 4: 학습/연구 모드 절을 삭제한다**

`## 학습 모드 vs 연구 모드` 절 전체(제목과 본문 3줄)를 지운다. 조작법 첫 문단의 아래 문장도 지운다.

```markdown
도구(툴바)가 클릭 동작을 결정한다. 학습/연구 모드와는 무관하다 — 연구 모드에서도 조립하고,
학습 모드에서도 측정할 수 있다.
```

대신 이렇게 남긴다.

```markdown
도구(툴바)가 클릭 동작을 결정한다.
```

- [ ] **Step 5: 이면각 항목에 검증 규칙을 명시한다**

`- **이면각 직접 회전:**` 항목과 `- **이면각 스캔:**` 항목에 각각 한 문장을 덧붙인다.

```markdown
- **이면각 직접 회전:** 원자 4개를 순서대로 선택하면 "이면각 회전" 슬라이더가 활성화된다. 슬라이더를 움직이면 그 결합을 기준으로 구조가 실시간으로 회전한다. 고리에 속한 결합은 회전할 수 없다(비활성 표시). 네 원자가 **실제로 이어져 있어야**(i-j, j-k, k-l이 전부 결합) 활성화된다 — 예전엔 아무 원자 4개나 골라도 활성화됐고, 조작해도 아무것도 안 움직였다.
- **이면각 스캔:** 원자 4개 선택 후 "이면각 스캔". 스텝 각도(5/10/15/30°)와 완화 스캔(각 각도에서 나머지 구조를 재최적화, 느리지만 더 정확) 여부를 직접 고른다. 이어지지 않은 4개를 고르면 거부한다 — 예전엔 전부 0인 평평한 선을 아무 말 없이 그렸다.
```

- [ ] **Step 6: 물리 모델 절에 VSEPR 판정 기준을 명시한다**

`- **혼성(원자 타입) 판정:**` 항목 아래에 추가한다.

```markdown
- **VSEPR 판정 기준:** 안정도 HUD와 VSEPR 패널의 "이상각"은 그 원자 타입의 UFF 평형각
  (`theta0`)이다 — 물 104.51° · 암모니아 106.70° · 메탄 109.47° · sp² 120° · 초원자가 90°.
  배위수만으로 판정하면 비공유 전자쌍이 무시되어, 문헌값으로 완벽히 최적화된 물이 "편차 75°"
  같은 오탐 경고를 받는다. 새 원자를 **어느 방향에 붙일지**는 여전히 전자 도메인 수 기준이다.
- **원자가 미충족 경고:** 결합이 모자란 원자(예: 이중결합을 안 올린 카보닐 산소)는 경고로
  표시한다. 조립 중에는 정상 상태이므로 심각(✕)이 아니라 경고(▲)다.
```

- [ ] **Step 7: 최종 전체 검증**

```bash
node --test
```
Expected: fail 0. `test/validation.test.js`가 전부 초록인지 눈으로 확인한다.

```bash
python3 -m http.server 8000
```
브라우저 콘솔을 열고 **에러 0개**를 확인하면서 아래를 밟는다.
1. 새로고침 → 마지막 구조 복원. 헤더에 모드 셀렉트 없음, 색상 셀렉트 있음.
2. 프리셋 전부 순회 — **물·암모니아에 빨간 경고 배지가 없어야 한다**(이번 개선의 핵심 회귀).
3. 아세트산 조립: 메탄 → H 하나 지우기 → C 붙이기 → O 두 개 붙이기 → 결합 도구로 C=O 결합선 클릭해 차수 2로 → 남은 O에 H 붙이기 → `구조 최적화`. 분자식이 `C2H4O2`가 되고 경고 배지가 없어야 한다.
4. 지우개로 사슬 중간 클릭 → 떨어져 나간 조각이 함께 사라짐. `Ctrl+Z`로 복구.
5. 결합 도구로 아주 멀리 떨어진 원자 둘 클릭 → `너무 멀리 떨어진 원자입니다` 거부.
6. 메탄에서 H·C·H·H 4개 선택 → 슬라이더 비활성 + 안내 문구. 스캔 버튼 → 거부 토스트.
7. 부탄에서 C0·C1·C2·C3 선택 → 슬라이더 활성, 스캔이 제대로 된 곡선(장벽 ~10 kcal/mol).
8. 색상 셀렉트를 `응력 히트맵`으로 → 히트맵 + 범례. 되돌리면 원소 색.
9. 2D 보기 → 조립·선택·결합선 클릭(차수)·우클릭 삭제 → 3D 복귀.
10. XYZ/MOL/PDB 내보내기, 링크 복사.

- [ ] **Step 8: 커밋 & 푸시**

```bash
git add README.md
git commit -m "docs: update README for VSEPR theta0 judging, bond order editing, pruning, CPK colors"
git push -u origin claude/web-improvement-prep-agdiml
```

---

## 명시적으로 하지 않는 것

- **방향족 인식(C_R/N_R/O_R)** — `findRings`는 있지만 휘켈 판정이 따로 필요하다. 결합 차수 편집(T5)이 들어간 뒤에는 벤젠을 케쿨레 구조로 손수 만들 수 있으므로 급하지 않다.
- **형식 전하·라디칼 명시 표기** — T2가 "원자가 부족"으로 경고는 하지만, 전하를 데이터 모델에 넣지는 않는다. 넣으려면 `atom.charge`와 `MAX_VALENCE` 보정이 함께 필요해 별도 계획 규모다.
- **정전기(부분전하) 항** — UFF 4개 항 그대로. README가 이미 미지원으로 명시.
- **격자(voxel) 스냅** — 지난 계획과 같은 이유로 제외(결합각이 화학적으로 틀어진다).
- **2D 고스트 위치 정확도** — `layout()`이 매번 처음부터 배치하므로 미리보기와 최종 위치가 어긋날 수 있다. 증분 배치로 바꾸는 건 별도 계획 규모다.
- **`IDEAL_ANGLES` 삭제** — T1이 판정에서만 떼어냈다. 배치(`openSlots`)는 여전히 이 표가 맞으므로 남긴다.

## Self-Review

**1. 요구 커버리지**

| 요구 | 태스크 | 검증 방법 |
|---|---|---|
| 1. 경고 표시가 아쉬움 | T1(오탐 제거) + T8(배지) | T1은 자동 테스트(물·암모니아 회귀), T8은 수동 확인 |
| 2. 중간 삭제 시 고아 | T6 | 자동 테스트 4개(사슬 중간·말단·고리·단일 원자) |
| 3. 모드 제거 | T9 | `grep`으로 잔여 참조 0 확인 |
| 4. 스캔·최적화 | T4 | 자동 테스트(`isTorsionChain`, `scanDihedral` throws) |
| 5. 원자 구분 | T7 | 자동 테스트(색 표 완전성) + 수동 확인(크기) |
| 6. CH3COOH | T1+T2+T5 | 자동 테스트(`C2H4O2` + C=O 1.21 회귀) |
| 7. 이상한 결합 전반 | T1~T5 | 각 태스크의 회귀 테스트 |

**2. 플레이스홀더 스캔** — "적절히 처리"류 문구 없음. 모든 코드 단계에 실제 코드가 있다. 자동 테스트가 불가능한 태스크(T8, T9)는 그 사실을 태스크 머리에 명시하고 구체적 수동 절차로 대체했다. T7의 `radiusfunc`는 이 3Dmol 빌드에서 미검증이라 폴백을 함께 적었다.

**3. 타입 일관성**
- `vseprCheck().ideal`: T1에서 `number | null`(예전엔 항상 number). 이를 읽는 곳은 `app.checkSnaps`의 토스트뿐이고, 그 경로는 `satisfied === true`일 때만 도달하므로 `null`이 될 수 없다. 일치.
- `geometryName(mol, i) -> string`: T1에서 신설, `app.checkSnaps`가 유일한 소비자. `GEOMETRY_NAME` 상수는 같은 태스크에서 삭제된다. 일치.
- `cycleBondOrder(mol, bond)`: T5. `bond`는 `mol.bonds`의 원소 참조(제자리 수정) — `app.handleBondOrderClick`과 2D 핸들러가 둘 다 `state.mol.bonds`에서 찾아 넘긴다. 일치.
- `pruneAtom(mol, i) -> number[]`: T6. `app.deleteAtom`이 `.length`만 본다. 일치.
- `isTorsionChain(mol, idx4) -> boolean`: T4. `uff.scanDihedral`·`app.updateDihedralPanel`·`app.$('scan').onclick` 셋이 소비. 일치.
- `bondDistanceOk(mol, i, j) -> boolean`: T3. `app.handleBondClick`이 유일한 소비자. 일치.
- `CPK_COLOR`/`COVALENT_RADIUS`: T7에서 `app.render`가, T8에서 배지 위치 계산이 `COVALENT_RADIUS`를 같은 배율(`* 0.55`)로 쓴다. 두 곳의 배율이 어긋나면 배지가 원자에 파묻히므로 **같은 값**이어야 한다. 일치.
- `overlayLabels`: T8에서 `selectionShapes`/`warnShapes`를 대체한다. T8 이전 태스크(T1~T7)는 이 배열들을 건드리지 않으므로 순서상 충돌 없음. 일치.
