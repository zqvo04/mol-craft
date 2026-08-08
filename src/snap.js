import {
  neighbors, bondOrderSum, bondBetween, addAtom, addBond, removeAtom,
} from './model.js';
import { MAX_VALENCE, EXPANDED_VALENCE, UFF_PARAMS } from './params.js';
import { typeAtom, bondLength } from './uff.js';
import { sub, unit, scale, add, distance, angleDeg, cross, dot, norm } from './geom.js';

export const SNAP_RADIUS_FACTOR = 1.6;
export const ANGLE_TOLERANCE_DEG = 3;

// 배위수 -> VSEPR 이상 결합각. 비공유 전자쌍은 세지 않으므로
// 실제 관측각(물 104.5°, 암모니아 106.7°)과는 약간 다르며, UFF theta0가 그 차이를 담당한다.
export const IDEAL_ANGLES = {
  2: [180],
  3: [120],
  4: [109.47],
  5: [90, 120],
  6: [90],
};

// 정상 원자가 상태의 비공유 전자쌍 수(형식 전하 없는 중성 원자 기준).
export const LONE_PAIRS = { H: 0, B: 0, C: 0, N: 1, O: 2, F: 3, Si: 0, P: 1, S: 2, Cl: 3, Br: 3, I: 3 };

// 전자 도메인 수(결합 자리 + 비공유 전자쌍) = idealDirection이 조준할 실제 VSEPR 형상.
// MAX_VALENCE만 쓰면 물(O, 결합 2개)이 배위수 2 취급되어 직선(180°)으로 붙는다 — 산소는
// 결합이 몇 개 붙었든 항상 4개 도메인(결합2 + 비공유쌍2)이므로 정사면체 각도로 조준해야
// 붙인 순간부터 굽은형에 가깝게 시작하고, 대칭적으로 180°/120°에 갇혀 최적화가 못 빠져나오는
// 문제(대칭점은 기울기가 0이라 무너지지 않음)도 함께 없어진다.
export const ELECTRON_DOMAINS = Object.fromEntries(
  Object.keys(LONE_PAIRS).map((el) => [el, (MAX_VALENCE[el] ?? 0) + LONE_PAIRS[el]]),
);

// 원자가 상한을 넘는 결합은 차단한다. 상한은 EXPANDED_VALENCE(있으면) 또는 MAX_VALENCE다 —
// 그래서 SF6·PCl5 같은 실재하는 초원자가 분자는 여전히 만들 수 있고, H 사슬이나 CH5처럼
// 어떤 조건에서도 존재할 수 없는 결합만 막힌다.
// reason 등급: 'ok' 정상 / 'ok-expanded' 초원자가(EXPANDED_VALENCE 이내, 예: SF6) — 둘 다 ok:true.
// 거부: 'same-atom' / 'already-bonded' / 'unsupported-element' / 'valence-full'.
export function canBond(mol, i, j) {
  if (i === j) return { ok: false, reason: 'same-atom' };
  if (bondBetween(mol, i, j)) return { ok: false, reason: 'already-bonded' };
  let ti, tj;
  try { ti = typeAtom(mol, i); tj = typeAtom(mol, j); }
  catch { return { ok: false, reason: 'unsupported-element' }; }

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
  return { ok: true, reason, targetLength: bondLength(ti, tj, 1) };
}

// moving 원자를 anchor 쪽으로 '자석처럼' 당길 목표 좌표.
// 방향은 그대로 두고 거리만 UFF 평형 길이로 맞춘다.
export function snapTarget(mol, moving, anchor) {
  const check = canBond(mol, moving, anchor);
  if (!check.ok) return null;
  const a = mol.atoms[anchor].pos;
  const d = distance(mol.atoms[moving].pos, a);
  if (d > check.targetLength * SNAP_RADIUS_FACTOR || d === 0) return null;
  return add(a, scale(unit(sub(mol.atoms[moving].pos, a)), check.targetLength));
}

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

// VSEPR 형상 이름. 결합 수만으로 부르면 물이 "직선형"이 된다(결합 2개) — 비공유쌍까지
// 세는 전자 도메인 수와 함께 봐야 굽은형/삼각뿔형이 제대로 나온다.
const GEOMETRY_BY_DOMAIN_BONDS = {
  '2-2': '직선형',
  '3-3': '평면 삼각형', '3-2': '굽은형',
  '4-4': '정사면체', '4-3': '삼각뿔형', '4-2': '굽은형',
  '5-5': '삼각쌍뿔', '6-6': '정팔면체',
};
export function geometryName(mol, i) {
  const el = mol.atoms[i].el;
  const bonds = neighbors(mol, i).length;
  // neighbors는 이중·삼중결합도 이웃 원자 하나로만 세므로 이미 "도메인" 단위다(에틸렌
  // sp2 탄소: 결합 3개 = 도메인 3개). ELECTRON_DOMAINS(=MAX_VALENCE+비공유쌍, 항상 단일결합
  // 가정)를 그대로 쓰면 이중결합 탄소도 도메인 4로 잘못 나온다. 초원자가(SF6: 결합 6개인데
  // 정상 배위수는 2)에서만 비공유쌍 계산이 의미를 잃으므로, 그때는 결합 수 자체가 도메인 수다.
  const normal = MAX_VALENCE[el];
  const domains = normal !== undefined && bonds > normal ? bonds : bonds + (LONE_PAIRS[el] ?? 0);
  return GEOMETRY_BY_DOMAIN_BONDS[`${domains}-${bonds}`] ?? `배위 ${bonds}`;
}

// prev/next는 { [centerIdx]: satisfiedBoolean } 맵.
export function newSnapEvents(prev, next) {
  return Object.keys(next).filter((k) => next[k] && !prev[k]);
}

// 기존 결합들의 합 반대 방향(가장 빈 공간). 대칭이 상쇄되거나(선형/평면 삼각형 정확 대칭)
// 결과가 기존 결합과 거의 겹치면 평면 법선으로 대체한다. 결합이 없거나 전부 한 직선
// 위면 임의의 수직 방향. idealDirection의 최종 폴백이자 배위수 4 이상(초원자가)의 유일한 경로.
function sumFallback(dirs) {
  if (dirs.length === 0) return [1, 0, 0];
  const sum = dirs.reduce((s, v) => sub(s, v), [0, 0, 0]);
  if (norm(sum) >= 1e-3) {
    const candidate = unit(sum);
    if (!dirs.some((v) => dot(candidate, v) > 0.9)) return candidate;
  }
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      const n = cross(dirs[i], dirs[j]);
      if (norm(n) > 1e-3) return unit(n);
    }
  }
  const ref = Math.abs(dirs[0][0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(dirs[0], ref));
}

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

// 결합 원자가·VSEPR 편차로 구조 안정도를 0~100 점수와 이슈 목록으로 요약한다.
// 게이밍 HUD용 — 정밀 물리 판정이 아니라 "어디가 위험한지" 한눈에 보여주는 용도.
export function stability(mol) {
  const issues = [];
  for (let i = 0; i < mol.atoms.length; i++) {
    const nb = neighbors(mol, i);
    if (nb.length === 0) continue;
    const el = mol.atoms[i].el;
    try { typeAtom(mol, i); } catch { continue; }

    // 원자가 초과는 이제 canBond가 막지 않으므로(레고처럼 일단 끼울 수 있게 허용) 여기서
    // 직접 재계산해 경고한다. capMax(EXPANDED_VALENCE)까지는 초원자가로 약한 경고,
    // 그마저 넘기면(예: CH5) 위험으로 표시한다.
    const used = bondOrderSum(mol, i);
    const normal = MAX_VALENCE[el];
    const capMax = EXPANDED_VALENCE[el] ?? normal;
    if (normal !== undefined && used > capMax) {
      issues.push({ atom: i, level: 'danger', msg: `${el}${i} 원자가 초과(${used}/${capMax})` });
    } else if (normal !== undefined && used > normal) {
      issues.push({ atom: i, level: 'warn', msg: `${el}${i} 초원자가` });
    }

    // 원자가 미충족(라디칼). 이중결합을 만들지 못해 결합 1개로 남은 산소처럼, 화학적으로
    // 존재할 수 없는 상태인데 지금까지 아무 표시가 없었다 — 정작 틀린 원자가 조용하고
    // 멀쩡한 -OH가 빨갰다. 조립 중에는 부족한 게 정상이므로 danger가 아니라 warn이다.
    const deficit = implicitH(mol, i);
    if (deficit > 0) {
      issues.push({ atom: i, level: 'warn', msg: `${el}${i} 원자가 부족(${deficit})` });
    }
    if (nb.length >= 2) {
      const v = vseprCheck(mol, i);
      if (!v.satisfied) {
        const worst = Math.max(...v.angles.map((x) => x.deviation));
        issues.push({
          atom: i,
          level: worst > ANGLE_TOLERANCE_DEG * 3 ? 'danger' : 'warn',
          msg: `${mol.atoms[i].el}${i} 각도 편차 ${worst.toFixed(0)}°`,
        });
      }
    }
  }
  const score = Math.max(0, 100
    - issues.filter((x) => x.level === 'warn').length * 12
    - issues.filter((x) => x.level === 'danger').length * 22);
  return { score, issues };
}

// HUD에 실제로 그릴 것만 골라낸다. 문제 원자가 20개면 칩 20개가 화면 절반을 덮어
// 아무것도 못 읽는다 — 심각한 것 몇 개만 보여주고 나머지는 개수로 접는다.
// 위치 정보는 3D 표식(app.render)이 담당하므로 HUD는 "얼마나 나쁜지"만 알리면 된다.
export function hudSummary(st, max = 3) {
  const rank = (x) => (x.level === 'danger' ? 0 : 1);
  const sorted = [...st.issues].sort((a, b) => rank(a) - rank(b));
  return { score: st.score, shown: sorted.slice(0, max), more: Math.max(0, sorted.length - max) };
}

// 골격식 규칙 2.2: "결합 수에 따라 자동 계산"한 H 개수. bondOrderSum은 이미 존재하는
// H 결합까지 포함해 실제 사용 원자가를 그대로 반영하므로, 원소별 채워야 할 나머지가
// 바로 나온다(음수면 원자가 초과 — syncHydrogens가 그만큼 뗀다).
export function implicitH(mol, i) {
  const max = MAX_VALENCE[mol.atoms[i].el];
  return max === undefined ? 0 : max - bondOrderSum(mol, i);
}

// Hill 표기 분자식(탄소 있으면 C, H 먼저 → 나머지 알파벳순; 없으면 전부 알파벳순).
// mol.atoms를 있는 그대로 센다 — "생략된" H를 추론하지 않는다. 이 앱의 데이터 모델은
// H도 항상 실제 원자이므로(UFF가 이웃 수로 원자 타입을 정하기 때문에 그래야 한다),
// 골격식이 숨기는 것은 어디까지나 "그리기"일 뿐 데이터가 아니다.
export function formula(mol) {
  const counts = {};
  for (const a of mol.atoms) counts[a.el] = (counts[a.el] ?? 0) + 1;
  const rest = Object.keys(counts).filter((e) => e !== 'C' && e !== 'H').sort();
  // 탄소가 있으면 C,H를 먼저 쓰고 나머지 알파벳순(Hill 표기). 탄소가 없으면(암모니아, 물
  // 등) H를 포함해 전부 알파벳순 — 예전엔 이 분기가 없어 H가 통째로 누락됐다(NH3 -> "N").
  const order = counts.C ? ['C', 'H', ...rest] : [...rest, 'H'].sort();
  return order.filter((e) => counts[e]).map((e) => e + (counts[e] > 1 ? counts[e] : '')).join('');
}

// 골격식 규칙 3(해석): 무거운 원자마다 부족한 H를 실제 원자로 채우고, 원자가를 넘겨
// 붙어있는 H는 뗀다. 2D에서 탄소 골격만 그려도(사용자가 H를 신경 쓸 필요 없이) 이 함수
// 한 번으로 3D 최적화가 가능한 완전한 분자가 된다 — 2D/3D 사이에 별도 좌표 변환은 없다.
export function syncHydrogens(mol) {
  // 1단계: 부족분을 채운다. addAtom은 끝에만 추가하므로 이 루프가 도는 동안
  // 기존(무거운 원자의) 인덱스는 절대 밀리지 않는다 — 새로 붙인 H를 다시 순회하지도 않는다.
  const heavyCount = mol.atoms.length;
  for (let i = 0; i < heavyCount; i++) {
    if (mol.atoms[i].el === 'H') continue;
    let deficit = implicitH(mol, i);
    while (deficit > 0) {
      const dir = idealDirection(mol, i);
      const len = bondLength(typeAtom(mol, i), 'H_', 1);
      const idx = addAtom(mol, 'H', add(mol.atoms[i].pos, scale(dir, len)));
      addBond(mol, i, idx, 1);
      deficit--;
    }
  }

  // 2단계: 원자가 초과분을 뗀다. removeAtom은 인덱스를 재정렬하므로, 지울 대상을 전부
  // 모아 내림차순 한 번에 처리한다(app.js의 다중 삭제와 동일한 안전 패턴).
  const toRemove = [];
  for (let i = 0; i < mol.atoms.length; i++) {
    if (mol.atoms[i].el === 'H') continue;
    let deficit = implicitH(mol, i);
    if (deficit >= 0) continue;
    for (const h of neighbors(mol, i).filter((n) => mol.atoms[n].el === 'H')) {
      if (deficit >= 0) break;
      toRemove.push(h);
      deficit++;
    }
  }
  for (const i of [...new Set(toRemove)].sort((a, b) => b - a)) removeAtom(mol, i);
}
