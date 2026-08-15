import { bondBetween, branchAtoms, isTorsionChain, neighbors, setDihedral } from './model.js';
import { distance } from './geom.js';
import { energy, typeAtom } from './uff.js';
import { UFF_PARAMS } from './params.js';

const hybridizationFromType = (type) => {
  if (type?.endsWith('_1')) return 'sp';
  if (type?.endsWith('_2') || type?.endsWith('_R')) return 'sp²';
  if (type?.includes('_3')) return 'sp³';
  return '—';
};

function connectedWithinTwoBonds(mol, start, target) {
  const visited = new Set([start]);
  let frontier = [start];
  for (let depth = 0; depth < 2; depth++) {
    const next = [];
    for (const atom of frontier) {
      for (const neighbour of neighbors(mol, atom)) {
        if (neighbour === target) return true;
        if (!visited.has(neighbour)) { visited.add(neighbour); next.push(neighbour); }
      }
    }
    frontier = next;
  }
  return false;
}

export function identifyFunctionalGroups(mol) {
  const found = [];
  const hasCarbonyl = mol.bonds.some((bond) => bond.order === 2 && new Set([mol.atoms[bond.i]?.el, mol.atoms[bond.j]?.el]).has('C') && new Set([mol.atoms[bond.i]?.el, mol.atoms[bond.j]?.el]).has('O'));
  if (hasCarbonyl) found.push({ key: 'carbonyl', label: '카보닐(C=O)', note: '산소의 π 결합은 결합각과 친전자성 논의의 출발점입니다.' });
  const hasAlkene = mol.bonds.some((bond) => bond.order === 2 && mol.atoms[bond.i]?.el === 'C' && mol.atoms[bond.j]?.el === 'C');
  if (hasAlkene) found.push({ key: 'alkene', label: '알켄(C=C)', note: '이중결합은 회전이 제한된 평면 sp² 중심을 만듭니다.' });
  const aromaticCount = mol.atoms.filter((atom) => /_R$/.test(atom.type ?? '')).length;
  if (aromaticCount >= 5) found.push({ key: 'aromatic', label: '방향족 고리', note: '현재 모델은 방향족 토폴로지를 표시하지만 전자 비편재화를 양자역학적으로 계산하지는 않습니다.' });
  const hasHydroxyl = mol.atoms.some((atom, i) => atom.el === 'O' && neighbors(mol, i).some((j) => mol.atoms[j].el === 'H') && neighbors(mol, i).some((j) => mol.atoms[j].el === 'C'));
  if (hasHydroxyl) found.push({ key: 'alcohol', label: '하이드록실(–OH)', note: '수소결합 공여·수용 및 산염기성 토론에 활용할 수 있습니다.' });
  const hasAmine = mol.atoms.some((atom, i) => atom.el === 'N' && neighbors(mol, i).some((j) => mol.atoms[j].el === 'C'));
  if (hasAmine) found.push({ key: 'amine', label: '아민성 질소', note: '고립전자쌍과 염기성의 관계를 관찰할 수 있습니다.' });
  return found;
}

export function findCloseNonbondedContacts(mol, limit = 3) {
  const contacts = [];
  for (let i = 0; i < mol.atoms.length; i++) {
    for (let j = i + 1; j < mol.atoms.length; j++) {
      if (bondBetween(mol, i, j) || connectedWithinTwoBonds(mol, i, j)) continue;
      const typeI = typeAtom(mol, i); const typeJ = typeAtom(mol, j);
      const xI = UFF_PARAMS[typeI]?.x1; const xJ = UFF_PARAMS[typeJ]?.x1;
      if (!xI || !xJ) continue;
      const d = distance(mol.atoms[i].pos, mol.atoms[j].pos);
      const reference = (xI + xJ) / 2;
      if (d < reference * 0.88) contacts.push({ i, j, distance: d, reference, ratio: d / reference });
    }
  }
  return contacts.sort((a, b) => a.ratio - b.ratio).slice(0, limit);
}

export function summarizeStructure(mol) {
  const hybridization = {};
  mol.atoms.forEach((_, i) => {
    const key = hybridizationFromType(typeAtom(mol, i));
    hybridization[key] = (hybridization[key] ?? 0) + 1;
  });
  return {
    atomCount: mol.atoms.length,
    bondCount: mol.bonds.length,
    hybridization,
    groups: identifyFunctionalGroups(mol),
    contacts: findCloseNonbondedContacts(mol),
  };
}

export function torsionInterpretation(deg) {
  const absolute = Math.abs(Number(deg));
  const signed = ((Number(deg) % 360) + 360) % 360;
  const distanceTo = (target) => Math.min(Math.abs(signed - target), 360 - Math.abs(signed - target));
  if (distanceTo(180) <= 20) return { title: 'anti 유사 배치', note: '큰 치환기가 반대쪽에 가까운 배치입니다. 단순 알케인에서는 입체반발이 작은 경향을 비교할 수 있습니다.' };
  if (distanceTo(60) <= 20 || distanceTo(300) <= 20) return { title: 'gauche 유사 배치', note: '치환기가 60° 부근에 놓입니다. anti와 상대 에너지·입체반발을 비교해 보세요.' };
  if (distanceTo(0) <= 20) return { title: 'eclipsed 유사 배치', note: '결합이 겹쳐 보이는 배치입니다. 단순 알케인에서는 비틀림 항이 커질 수 있습니다.' };
  return { title: '중간 비틀림 배치', note: `현재 이면각은 ${absolute.toFixed(1)}°입니다. 슬라이더로 anti·gauche·eclipsed 부근을 비교해 보세요.` };
}

export function scanTorsion(mol, selection, step = 30) {
  if (selection.length !== 4 || !isTorsionChain(mol, selection) || branchAtoms(mol, selection[1], selection[2]) === null) return [];
  const original = mol.atoms.map((atom) => [...atom.pos]);
  const samples = [];
  try {
    for (let deg = -180; deg <= 180; deg += step) {
      mol.atoms.forEach((atom, i) => { atom.pos = [...original[i]]; });
      if (!setDihedral(mol, selection, deg)) return [];
      samples.push({ deg, energy: energy(mol).total });
    }
  } finally {
    mol.atoms.forEach((atom, i) => { atom.pos = [...original[i]]; });
  }
  return samples;
}
