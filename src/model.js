import { distance, angleDeg, dihedralDeg, rotateAround, sub } from './geom.js';

export const createMolecule = () => ({ atoms: [], bonds: [] });

export function addAtom(mol, el, pos) {
  mol.atoms.push({ el, pos: [...pos] });
  return mol.atoms.length - 1;
}

export function bondBetween(mol, i, j) {
  const [a, b] = i < j ? [i, j] : [j, i];
  return mol.bonds.find((x) => x.i === a && x.j === b);
}

export function addBond(mol, i, j, order = 1) {
  if (i === j) return;
  const existing = bondBetween(mol, i, j);
  if (existing) { existing.order = order; return; }
  const [a, b] = i < j ? [i, j] : [j, i];
  mol.bonds.push({ i: a, j: b, order });
}

export function removeAtom(mol, idx) {
  mol.atoms.splice(idx, 1);
  mol.bonds = mol.bonds
    .filter((b) => b.i !== idx && b.j !== idx)
    .map((b) => ({
      i: b.i > idx ? b.i - 1 : b.i,
      j: b.j > idx ? b.j - 1 : b.j,
      order: b.order,
    }));
}

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

// 선택 원자를 2 Å 옆에 복제한다. 두 끝 다 선택에 포함된 결합만 같이 복제한다
// (선택 밖 원자와의 결합은 복제본에서 끊긴 채로 둔다 — 부분 선택 복제 시 자연스러운 동작).
export function duplicateAtoms(mol, indices) {
  const set = new Set(indices);
  const map = new Map();
  for (const i of indices) {
    const src = mol.atoms[i];
    map.set(i, addAtom(mol, src.el, [src.pos[0] + 2, src.pos[1], src.pos[2]]));
  }
  for (const b of mol.bonds) {
    if (set.has(b.i) && set.has(b.j) && map.get(b.i) !== undefined && map.get(b.j) !== undefined) {
      addBond(mol, map.get(b.i), map.get(b.j), b.order);
    }
  }
  return indices.map((i) => map.get(i));
}

export const neighbors = (mol, i) =>
  mol.bonds.filter((b) => b.i === i || b.j === i).map((b) => (b.i === i ? b.j : b.i));

// u-v 간선을 뺀 상태에서 BFS 최단경로 -> 그 경로 + 간선(u-v)이 u-v를 지나는 최소 고리.
// ponytail: 진짜 SSSR이 아니다(순환 기저 크기만큼만 찾음). 다리고리(아다만테인류)에서
// 고리가 과대/중복 계산될 수 있음 — 업그레이드 경로는 정식 SSSR 알고리즘.
function smallestRingThroughEdge(adj, u, v) {
  const parent = new Map([[u, null]]);
  const queue = [u];
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    if (cur === v) break;
    for (const n of adj(cur)) {
      if (cur === u && n === v) continue; // 직접 간선 제외
      if (!parent.has(n)) { parent.set(n, cur); queue.push(n); }
    }
  }
  if (!parent.has(v)) return null; // 다리(bridge) — 고리 아님
  const ring = [];
  for (let cur = v; cur !== null; cur = parent.get(cur)) ring.push(cur);
  return ring; // [v, ..., u] 순환: ring[k]-ring[k+1] 결합, ring[last]-ring[0]는 u-v 직접 결합
}

// 무거운 원자 그래프의 최소 고리 목록. 각 원소(연결 성분)마다 BFS 스패닝트리를 만들고,
// 트리에 없는 간선(비트리 간선)마다 그 간선을 지나는 최소 고리를 하나씩 뽑는다.
// sketch2d.js(2D 레이아웃)와 aromatize(방향족 인식)가 공유한다.
export function findRings(mol) {
  const heavy = mol.atoms.map((a, i) => i).filter((i) => mol.atoms[i].el !== 'H');
  const edgeKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const heavyNb = (i) => neighbors(mol, i).filter((n) => mol.atoms[n].el !== 'H');
  const adjMap = new Map(heavy.map((i) => [i, heavyNb(i)]));
  const adj = (i) => adjMap.get(i) ?? [];
  const globalSeen = new Set();
  const rings = [];
  for (const root of heavy) {
    if (globalSeen.has(root)) continue;
    const parent = new Map([[root, null]]);
    const treeEdges = new Set();
    const queue = [root];
    let qi = 0;
    while (qi < queue.length) {
      const u = queue[qi++];
      for (const v of adj(u)) {
        if (!parent.has(v)) { parent.set(v, u); treeEdges.add(edgeKey(u, v)); queue.push(v); }
      }
    }
    for (const i of parent.keys()) globalSeen.add(i);
    for (const u of parent.keys()) {
      for (const v of adj(u)) {
        if (v <= u || treeEdges.has(edgeKey(u, v))) continue;
        const ring = smallestRingThroughEdge(adj, u, v);
        if (ring) rings.push(ring);
      }
    }
  }
  const seenKeys = new Set();
  return rings.filter((r) => {
    const key = [...r].sort((a, b) => a - b).join(',');
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
}

// 방향족 인식: 고리 원자별 π 전자 기여를 세는 간단한 휘켈 판정이다. 벤젠형만 통과시키던
// 이전 규칙과 달리 피리딘형 N(1e⁻), 피롤형 N(비공유쌍 2e⁻), 푸란형 O(비공유쌍 2e⁻)를
// 분리한다. 완전한 SSSR·공명 기여도 계산은 아니며, 5/6원 단일 고리의 교육용 인식기다.
function aromaticContribution(mol, ring, i) {
  const ringSet = new Set(ring);
  const ringBonds = mol.bonds.filter((bond) => ringSet.has(bond.i) && ringSet.has(bond.j)
    && (bond.i === i || bond.j === i));
  const hasRingDouble = ringBonds.some((bond) => bond.order === 2 || bond.order === 1.5);
  const el = mol.atoms[i].el;
  if (el === 'C') return hasRingDouble ? 1 : 0;
  if (el === 'N') return hasRingDouble ? 1 : 2;
  if (el === 'O') return hasRingDouble ? 0 : 2;
  return 0;
}

export function aromatize(mol) {
  for (const ring of findRings(mol)) {
    if (ring.length !== 5 && ring.length !== 6) continue;
    if (!ring.every((i) => ['C', 'N', 'O'].includes(mol.atoms[i].el))) continue;
    const ringSet = new Set(ring);
    if (!ring.every((i) => neighbors(mol, i).filter((j) => ringSet.has(j)).length === 2)) continue;
    const contributions = ring.map((i) => aromaticContribution(mol, ring, i));
    const piElectrons = contributions.reduce((sum, value) => sum + value, 0);
    if (piElectrons < 2 || (piElectrons - 2) % 4 !== 0) continue;

    ring.forEach((i, index) => {
      mol.atoms[i].type = `${mol.atoms[i].el}_R`;
      mol.atoms[i].aromaticPiContribution = contributions[index];
      mol.atoms[i].aromaticLonePair = contributions[index] === 2;
    });
    for (let k = 0; k < ring.length; k++) {
      const bond = bondBetween(mol, ring[k], ring[(k + 1) % ring.length]);
      if (bond) bond.order = 1.5;
    }
  }
}

export const bondOrderSum = (mol, i) =>
  mol.bonds.filter((b) => b.i === i || b.j === i).reduce((s, b) => s + b.order, 0);

// 방향족 비공유쌍이 π계에 공여되는 피롤형 N·푸란형 O는 1.5 결합 두 개를 그대로
// 더하면 형식 원자가가 과대 계산된다. 실제 원자가 검사에는 그 두 결합의 π 분획을 한 번만
// 빼야 한다. 일반 C_R·피리딘형 N은 이 보정 대상이 아니다.
export function valenceUsed(mol, i) {
  const raw = bondOrderSum(mol, i);
  if (!mol.atoms[i]?.aromaticLonePair) return raw;
  const aromaticCount = mol.bonds.filter((bond) => (bond.i === i || bond.j === i) && bond.order === 1.5).length;
  return raw - aromaticCount * 0.5;
}

// j-k 결합에서 k쪽에 붙은 원자 집합(k 포함). j에 도달하면 고리이므로 null.
export function branchAtoms(mol, j, k) {
  const seen = new Set([k]);
  const stack = [k];
  while (stack.length) {
    const cur = stack.pop();
    for (const n of neighbors(mol, cur)) {
      if (n === j) { if (cur !== k) return null; continue; }
      if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  return [...seen];
}

export function measure(mol, idx) {
  const p = idx.map((i) => mol.atoms[i].pos);
  if (idx.length === 2) return distance(p[0], p[1]);
  if (idx.length === 3) return angleDeg(p[0], p[1], p[2]);
  if (idx.length === 4) return dihedralDeg(p[0], p[1], p[2], p[3]);
  throw new Error(`measure: 지원하지 않는 원자 수 ${idx.length}`);
}

// i-j-k-l이 진짜 이면각인지. 세 결합이 전부 실재해야 한다.
// branchAtoms만으로는 부족하다: 메탄에서 H-C-H-H를 고르면 branchAtoms는 null이 아니어서
// 슬라이더가 활성화되는데, 정작 회전축 반대편에 원자가 없어 조작해도 아무것도 안 움직이고
// 스캔은 전부 0인 평평한 선이 나왔다(오류 메시지도 없이).
export function isTorsionChain(mol, [i, j, k, l]) {
  if (new Set([i, j, k, l]).size !== 4) return false;
  return !!(bondBetween(mol, i, j) && bondBetween(mol, j, k) && bondBetween(mol, k, l));
}

// i-j-k-l 이면각을 targetDeg로 맞춘다. j-k 결합의 k쪽 가지를 회전.
export function setDihedral(mol, [i, j, k, l], targetDeg) {
  const moving = branchAtoms(mol, j, k);
  if (moving === null) return false; // 고리 결합은 단순 회전 불가
  const delta = targetDeg - measure(mol, [i, j, k, l]);
  const origin = mol.atoms[j].pos;
  const axis = sub(mol.atoms[k].pos, origin);
  for (const a of moving) {
    if (a === k) continue; // 축 위의 원자는 불변
    mol.atoms[a].pos = rotateAround(mol.atoms[a].pos, origin, axis, delta);
  }
  return true;
}
