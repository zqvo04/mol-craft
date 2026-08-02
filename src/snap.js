import { neighbors, bondOrderSum, bondBetween } from './model.js';
import { MAX_VALENCE, EXPANDED_VALENCE } from './params.js';
import { typeAtom, bondLength } from './uff.js';
import { sub, unit, scale, add, distance, angleDeg } from './geom.js';

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
