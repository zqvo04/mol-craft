import { neighbors, bondOrderSum, bondBetween } from './model.js';
import { MAX_VALENCE, EXPANDED_VALENCE } from './params.js';
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

export function canBond(mol, i, j) {
  if (i === j) return { ok: false, reason: 'same-atom' };
  if (bondBetween(mol, i, j)) return { ok: false, reason: 'already-bonded' };
  let ti, tj;
  try { ti = typeAtom(mol, i); tj = typeAtom(mol, j); }
  catch { return { ok: false, reason: 'unsupported-element' }; }

  let expanded = false;
  for (const [idx, tag] of [[i, 'i'], [j, 'j']]) {
    const el = mol.atoms[idx].el;
    const used = bondOrderSum(mol, idx);
    const normal = MAX_VALENCE[el];
    const max = EXPANDED_VALENCE[el] ?? normal;
    if (normal === undefined) return { ok: false, reason: 'unsupported-element' };
    if (used + 1 > max) return { ok: false, reason: `valence-full-${tag}` };
    if (used + 1 > normal) expanded = true;
  }
  return {
    ok: true,
    reason: expanded ? 'ok-expanded' : 'ok',
    targetLength: bondLength(ti, tj, 1),
  };
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

export function vseprCheck(mol, centerIdx, toleranceDeg = ANGLE_TOLERANCE_DEG) {
  const nb = neighbors(mol, centerIdx);
  const ideals = IDEAL_ANGLES[nb.length];
  const angles = [];
  for (let a = 0; a < nb.length; a++) {
    for (let b = a + 1; b < nb.length; b++) {
      const actual = angleDeg(mol.atoms[nb[a]].pos, mol.atoms[centerIdx].pos, mol.atoms[nb[b]].pos);
      // 180° 대향각은 어떤 이상각 집합에서도 허용한다(팔면체/삼각쌍뿔의 축 방향).
      const candidates = ideals ? [...ideals, 180] : [180];
      const best = candidates.reduce((p, c) =>
        Math.abs(actual - c) < Math.abs(actual - p) ? c : p);
      angles.push({ atoms: [nb[a], centerIdx, nb[b]], actual, ideal: best, deviation: Math.abs(actual - best) });
    }
  }
  return {
    center: centerIdx,
    coordination: nb.length,
    ideal: ideals ? ideals[0] : null,
    angles,
    satisfied: ideals !== undefined && angles.length > 0
      && angles.every((x) => x.deviation <= toleranceDeg),
  };
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

// 앵커에 새 원자를 붙일 방향을 VSEPR 이상각에 정확히 맞춰("자석처럼") 계산한다.
// 목표 각도는 앵커 원소의 최종 배위수(MAX_VALENCE) 기준이다 — 매 스텝의 현재 배위수를
// 쓰면 2번째 치환기가 180°(선형)로 붙어버려 3·4번째가 정사면체로 수렴하지 못하고
// 평면/팔면체 조각에 갇힌다. 최종 배위수를 목표로 잡아야 순차 조립이 매번 올바른 형상으로 수렴한다.
// 배위수 0/1개: 기존 방향이 없거나 하나뿐이면 임의의 축으로 이상각만큼 회전(원뿔 위 한 점,
//   원뿔 방위각은 임의 — 부착 후 회전 미세조정으로 조절).
// 배위수 2개: 두 기존 방향이 이루는 평면에서 정확한 해석해(이등분선/법선 기저 분해)를 쓴다.
//   기존 두 결합이 정확히 이상각이 아니어도(예: 조립 중간 단계) 강건하게 작동한다.
// 배위수 3개 이상: 대칭 형상에서는 -sum이 정확한 4번째 방향과 일치한다(정사면체).
//   배위수 5 이상(초원자가)은 해석해가 없어 sumFallback으로 넘어간다.
export function idealDirection(mol, anchor) {
  const nb = neighbors(mol, anchor);
  const a = mol.atoms[anchor].pos;
  const dirs = nb.map((n) => unit(sub(mol.atoms[n].pos, a)));
  const targetCoord = MAX_VALENCE[mol.atoms[anchor].el] ?? dirs.length + 1;
  const ideal = IDEAL_ANGLES[targetCoord]?.[0];

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

// 결합 원자가·VSEPR 편차로 구조 안정도를 0~100 점수와 이슈 목록으로 요약한다.
// 게이밍 HUD용 — 정밀 물리 판정이 아니라 "어디가 위험한지" 한눈에 보여주는 용도.
export function stability(mol) {
  const issues = [];
  for (let i = 0; i < mol.atoms.length; i++) {
    const nb = neighbors(mol, i);
    if (nb.length === 0) continue;
    let type;
    try { type = typeAtom(mol, i); } catch { continue; }
    if (['P_3+5', 'S_3+6'].includes(type)) {
      issues.push({ atom: i, level: 'warn', msg: `${mol.atoms[i].el}${i} 초원자가` });
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
