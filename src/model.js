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

export const bondOrderSum = (mol, i) =>
  mol.bonds.filter((b) => b.i === i || b.j === i).reduce((s, b) => s + b.order, 0);

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
