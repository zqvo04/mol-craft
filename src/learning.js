import { bondBetween, branchAtoms, findRings, isTorsionChain, neighbors, setDihedral } from './model.js';
import { cross, distance, dot, norm, sub, unit } from './geom.js';
import { energy, topologyKey, typeAtom } from './uff.js';
import { UFF_PARAMS } from './params.js';
import { formula } from './snap.js';

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
  if (aromaticCount >= 5) found.push({ key: 'aromatic', label: '방향족 고리', note: '현재 모델은 π 전자 기여 규칙으로 고리를 표시하지만 전자 비편재화를 양자역학적으로 계산하지는 않습니다.' });
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

export function degreeOfUnsaturation(mol) {
  const counts = mol.atoms.reduce((all, atom) => ({ ...all, [atom.el]: (all[atom.el] ?? 0) + 1 }), {});
  const c = counts.C ?? 0;
  const h = counts.H ?? 0;
  const n = counts.N ?? 0;
  const x = (counts.F ?? 0) + (counts.Cl ?? 0) + (counts.Br ?? 0) + (counts.I ?? 0);
  const value = (2 * c + 2 + n - h - x) / 2;
  return { formula: formula(mol), value, valid: Number.isInteger(value) && value >= 0, counts };
}

// 현재 편집 세션에서 저장한 구조와 비교하는 연결성 지문이다. topologyKey는 원자 인덱스를
// 포함하므로, 서로 독립적으로 만든 두 구조의 완전한 그래프 동형 판정은 아니다. 따라서 UI는
// '구조 이성질체 후보'로만 표현하며, 교재의 구조 분석 단계에서 학생이 결합 연결을 다시
// 확인하도록 안내한다.
export function compareStructuralIsomerCandidate(reference, candidate) {
  const referenceFormula = formula(reference);
  const candidateFormula = formula(candidate);
  if (referenceFormula !== candidateFormula) {
    return { kind: 'different-formula', referenceFormula, candidateFormula, sameFormula: false, sameTopology: false };
  }
  const sameTopology = topologyKey(reference) === topologyKey(candidate);
  return {
    kind: sameTopology ? 'same-connectivity' : 'constitutional-isomer-candidate',
    referenceFormula,
    candidateFormula,
    sameFormula: true,
    sameTopology,
  };
}

function ringPlaneNormal(mol, ring) {
  const center = ring.reduce((sum, index) => sum.map((value, axis) => value + mol.atoms[index].pos[axis]), [0, 0, 0]).map((value) => value / ring.length);
  let normal = [0, 0, 0];
  for (let i = 0; i < ring.length; i++) {
    const a = sub(mol.atoms[ring[i]].pos, center);
    const b = sub(mol.atoms[ring[(i + 1) % ring.length]].pos, center);
    const area = cross(a, b);
    normal = normal.map((value, axis) => value + area[axis]);
  }
  return norm(normal) > 1e-8 ? unit(normal) : null;
}

export function axialEquatorialLabels(mol) {
  const labels = [];
  for (const ring of findRings(mol)) {
    if (ring.length !== 6 || !ring.every((index) => mol.atoms[index].el === 'C')) continue;
    const normal = ringPlaneNormal(mol, ring);
    if (!normal) continue;
    const ringSet = new Set(ring);
    for (const carbon of ring) {
      for (const substituent of neighbors(mol, carbon).filter((index) => !ringSet.has(index))) {
        const direction = unit(sub(mol.atoms[substituent].pos, mol.atoms[carbon].pos));
        const alignment = Math.abs(dot(direction, normal));
        labels.push({ ring, carbon, substituent, kind: alignment >= 0.66 ? 'axial' : 'equatorial', alignment });
      }
    }
  }
  return labels;
}

export function aromaticRingSummary(mol) {
  return findRings(mol).filter((ring) => ring.every((index) => /_R$/.test(typeAtom(mol, index)))).map((ring) => ({
    ring,
    piElectrons: ring.reduce((sum, index) => sum + (mol.atoms[index].aromaticPiContribution ?? (mol.atoms[index].el === 'O' ? 2 : 1)), 0),
    heteroatoms: ring.filter((index) => mol.atoms[index].el !== 'C'),
  }));
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
    degreeOfUnsaturation: degreeOfUnsaturation(mol),
    axialEquatorial: axialEquatorialLabels(mol),
    aromaticRings: aromaticRingSummary(mol),
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
