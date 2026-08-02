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
