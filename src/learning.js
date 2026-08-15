import { bondBetween, bondOrderSum, branchAtoms, findRings, isTorsionChain, neighbors, setDihedral } from './model.js';
import { cross, dihedralDeg, distance, dot, norm, sub, unit } from './geom.js';
import { energy, topologyKey, typeAtom } from './uff.js';
import { UFF_PARAMS } from './params.js';
import { formula } from './snap.js';
import { atomCharge, totalCharge } from './model.js';

const hybridizationFromType = (type) => {
  if (type?.endsWith('_1')) return 'sp';
  if (type?.endsWith('_2') || type?.endsWith('_R')) return 'sp²';
  if (type?.includes('_3')) return 'sp³';
  return '—';
};

const ATOMIC_NUMBER = { H: 1, B: 5, C: 6, N: 7, O: 8, F: 9, Si: 14, P: 15, S: 16, Cl: 17, Br: 35, I: 53 };
const atomicNumber = (atom) => ATOMIC_NUMBER[atom?.el] ?? 0;

function incidentBonds(mol, index) {
  return mol.bonds.filter((bond) => bond.i === index || bond.j === index);
}

function otherEnd(bond, index) {
  return bond.i === index ? bond.j : bond.i;
}

// CIP 비교의 교육용 그래프 전개다. 각 껍질에서 원자번호를 내림차순으로 비교하고,
// 이중·삼중 결합은 복제 원자(각각 2·3개)로 처리한다. 고리·동위원소·전하의 완전한
// IUPAC 구현은 아니므로 결과가 동률이면 "판정 보류"로 남긴다.
function cipLayers(mol, center, root, maxDepth = 8) {
  const layers = [[atomicNumber(mol.atoms[root])]];
  let frontier = [{ atom: root, previous: center, visited: new Set([center, root]) }];
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next = [];
    const layer = [];
    for (const node of frontier) {
      for (const bond of incidentBonds(mol, node.atom)) {
        const neighbour = otherEnd(bond, node.atom);
        if (neighbour === node.previous) continue;
        const copies = Math.max(1, Math.round(bond.order));
        for (let copy = 0; copy < copies; copy++) layer.push(atomicNumber(mol.atoms[neighbour]));
        if (!node.visited.has(neighbour)) {
          const visited = new Set(node.visited);
          visited.add(neighbour);
          next.push({ atom: neighbour, previous: node.atom, visited });
        }
      }
    }
    layers.push(layer.sort((a, b) => b - a));
    frontier = next;
  }
  return layers;
}

function compareCipBranches(mol, center, left, right) {
  const a = cipLayers(mol, center, left);
  const b = cipLayers(mol, center, right);
  const depth = Math.max(a.length, b.length);
  for (let d = 0; d < depth; d++) {
    const layerA = a[d] ?? [];
    const layerB = b[d] ?? [];
    const length = Math.max(layerA.length, layerB.length);
    for (let k = 0; k < length; k++) {
      const delta = (layerA[k] ?? 0) - (layerB[k] ?? 0);
      if (delta !== 0) return delta > 0 ? -1 : 1;
    }
  }
  return 0;
}

function rankCipBranches(mol, center, branches) {
  const ranked = [...branches].sort((a, b) => compareCipBranches(mol, center, a, b));
  const distinct = ranked.every((atom, index) => index === 0 || compareCipBranches(mol, center, ranked[index - 1], atom) !== 0);
  return { ranked, distinct };
}

export function cipPriorities(mol, center, branches = neighbors(mol, center)) {
  const { ranked, distinct } = rankCipBranches(mol, center, branches);
  return { center, distinct, priorities: ranked.map((atom, index) => ({ atom, priority: index + 1, element: mol.atoms[atom]?.el })) };
}

export function assignRS(mol, center) {
  const branches = neighbors(mol, center);
  if (mol.atoms[center]?.el !== 'C' || branches.length !== 4) return null;
  const { ranked, distinct } = rankCipBranches(mol, center, branches);
  if (!distinct) return null;
  const [a, b, c, d] = ranked.map((index) => sub(mol.atoms[index].pos, mol.atoms[center].pos));
  const determinant = dot(sub(a, d), cross(sub(b, d), sub(c, d)));
  if (Math.abs(determinant) < 1e-7) return null;
  return {
    center,
    configuration: determinant < 0 ? 'R' : 'S',
    determinant,
    priorities: ranked.map((atom, index) => ({ atom, priority: index + 1, element: mol.atoms[atom].el })),
  };
}

function perpendicularTo(axis, vector) {
  const projection = dot(vector, axis);
  const projected = vector.map((value, index) => value - axis[index] * projection);
  return norm(projected) > 1e-7 ? unit(projected) : null;
}

export function assignEZ(mol, bond) {
  if (!bond || bond.order !== 2 || mol.atoms[bond.i]?.el !== 'C' || mol.atoms[bond.j]?.el !== 'C') return null;
  const leftBranches = neighbors(mol, bond.i).filter((index) => index !== bond.j);
  const rightBranches = neighbors(mol, bond.j).filter((index) => index !== bond.i);
  if (!leftBranches.length || !rightBranches.length) return null;
  const left = rankCipBranches(mol, bond.i, leftBranches);
  const right = rankCipBranches(mol, bond.j, rightBranches);
  if (!left.distinct || !right.distinct) return null;
  const leftHigh = left.ranked[0];
  const rightHigh = right.ranked[0];
  const axis = unit(sub(mol.atoms[bond.j].pos, mol.atoms[bond.i].pos));
  const leftVector = perpendicularTo(axis, sub(mol.atoms[leftHigh].pos, mol.atoms[bond.i].pos));
  const rightVector = perpendicularTo(axis, sub(mol.atoms[rightHigh].pos, mol.atoms[bond.j].pos));
  if (!leftVector || !rightVector) return null;
  return {
    bond: [bond.i, bond.j],
    configuration: dot(leftVector, rightVector) >= 0 ? 'Z' : 'E',
    leftHigh,
    rightHigh,
  };
}

export function stereochemicalAssignments(mol) {
  return {
    rs: mol.atoms.map((_, index) => assignRS(mol, index)).filter(Boolean),
    ez: mol.bonds.map((bond) => assignEZ(mol, bond)).filter(Boolean),
  };
}

function carbonylOxygen(mol, carbon) {
  return incidentBonds(mol, carbon).find((bond) => bond.order === 2 && mol.atoms[otherEnd(bond, carbon)]?.el === 'O');
}

export function amideSites(mol) {
  const sites = [];
  for (const bond of mol.bonds) {
    if (bond.order !== 1) continue;
    const carbon = mol.atoms[bond.i]?.el === 'C' ? bond.i : mol.atoms[bond.j]?.el === 'C' ? bond.j : null;
    const nitrogen = mol.atoms[bond.i]?.el === 'N' ? bond.i : mol.atoms[bond.j]?.el === 'N' ? bond.j : null;
    if (carbon === null || nitrogen === null) continue;
    const carbonyl = carbonylOxygen(mol, carbon);
    if (!carbonyl) continue;
    sites.push({
      carbon,
      nitrogen,
      oxygen: otherEnd(carbonyl, carbon),
      planeAtoms: [otherEnd(carbonyl, carbon), carbon, nitrogen],
      nitrogenType: typeAtom(mol, nitrogen),
      planarModel: typeAtom(mol, nitrogen) === 'N_R',
    });
  }
  return sites;
}

export function ramachandranRegion(phi, psi) {
  if (!Number.isFinite(phi) || !Number.isFinite(psi)) return { key: 'incomplete', label: 'φ/ψ가 모두 필요', note: '양쪽 펩타이드 결합이 있는 내부 잔기에서 φ와 ψ를 함께 측정합니다.' };
  const regions = [
    { key: 'alpha', label: 'α-나선 유사', phi: -57, psi: -47, note: '교재의 α-나선 중심 부근입니다. 실제 나선 안정화에는 i→i+4 수소결합이 필요합니다.' },
    { key: 'beta', label: 'β-병풍 유사', phi: -120, psi: 120, note: '교재의 β-병풍 중심 부근입니다. 실제 병풍 안정화에는 가닥 간 수소결합이 필요합니다.' },
    { key: 'left-alpha', label: '좌손 α-나선 유사', phi: 57, psi: 47, note: '드물게 관찰되는 좌손 α 영역 부근입니다.' },
  ];
  const nearest = regions.map((region) => ({ ...region, distance: Math.hypot(phi - region.phi, psi - region.psi) }))
    .sort((a, b) => a.distance - b.distance)[0];
  return nearest.distance <= 70 ? nearest : { key: 'other', label: '기타/입체반발 점검', note: '대표 α·β 중심에서 멉니다. 허용성은 곁사슬·용매·전체 구조에 따라 달라집니다.', distance: nearest.distance };
}

// C(=O)–N–Cα–C(=O)와 N–Cα–C(=O)–N 골격을 찾아 내부 잔기의 φ/ψ를 읽는다.
// 말단 잔기는 둘 중 하나만 존재할 수 있으므로 φ/ψ 쌍과 라마찬드란 분류를 보류한다.
export function peptideBackboneTorsions(mol) {
  const entries = [];
  for (const amide of amideSites(mol)) {
    const alpha = neighbors(mol, amide.nitrogen).find((index) => index !== amide.carbon && mol.atoms[index]?.el === 'C');
    if (alpha === undefined) continue;
    const nextCarbonyl = neighbors(mol, alpha).find((index) => index !== amide.nitrogen
      && mol.atoms[index]?.el === 'C' && carbonylOxygen(mol, index));
    if (nextCarbonyl === undefined) continue;
    const nextNitrogen = neighbors(mol, nextCarbonyl).find((index) => index !== alpha && mol.atoms[index]?.el === 'N');
    const phi = dihedralDeg(mol.atoms[amide.carbon].pos, mol.atoms[amide.nitrogen].pos, mol.atoms[alpha].pos, mol.atoms[nextCarbonyl].pos);
    const psi = nextNitrogen === undefined ? null : dihedralDeg(mol.atoms[amide.nitrogen].pos, mol.atoms[alpha].pos, mol.atoms[nextCarbonyl].pos, mol.atoms[nextNitrogen].pos);
    entries.push({
      alpha,
      previousCarbonyl: amide.carbon,
      nextCarbonyl,
      nextNitrogen: nextNitrogen ?? null,
      phi,
      psi,
      region: ramachandranRegion(phi, psi),
    });
  }
  return entries;
}

export function nucleobaseLabels(mol) {
  return [...new Set(mol.atoms.map((atom) => atom.nucleobase).filter(Boolean))];
}

const ELECTRONEGATIVITY = { H: 2.20, B: 2.04, C: 2.55, N: 3.04, O: 3.44, F: 3.98, P: 2.19, S: 2.58, Cl: 3.16, Br: 2.96, I: 2.66 };

// 여기서의 전하는 사용자가 명시한 형식전하다. 전자 구조를 풀어 새로 '계산'하지 않으며,
// 공명 기여체나 용액에서의 실제 전하 분포와 혼동하지 않도록 학습 카드가 경계를 표시한다.
export function formalChargeSummary(mol) {
  const ions = mol.atoms.map((atom, index) => ({ index, el: atom.el, charge: atomCharge(atom) }))
    .filter(({ charge }) => charge !== 0);
  return { total: totalCharge(mol), ions };
}

export function qualitativePartialCharges(mol) {
  const values = mol.atoms.map((atom) => atomCharge(atom));
  for (const bond of mol.bonds) {
    const left = ELECTRONEGATIVITY[mol.atoms[bond.i]?.el] ?? 0;
    const right = ELECTRONEGATIVITY[mol.atoms[bond.j]?.el] ?? 0;
    const shift = (right - left) * 0.12 * bond.order;
    values[bond.i] += shift;
    values[bond.j] -= shift;
  }
  return values.map((charge, index) => ({ index, el: mol.atoms[index].el, charge: Math.round(charge * 100) / 100 }));
}

export function electrostaticContacts(mol, cutoff = 4.5) {
  const charges = qualitativePartialCharges(mol);
  const contacts = [];
  for (let i = 0; i < mol.atoms.length; i++) {
    const oneBond = new Set(neighbors(mol, i));
    const twoBond = new Set([...oneBond].flatMap((middle) => neighbors(mol, middle)));
    for (let j = i + 1; j < mol.atoms.length; j++) {
      if (oneBond.has(j) || twoBond.has(j)) continue;
      const d = distance(mol.atoms[i].pos, mol.atoms[j].pos);
      if (d > cutoff) continue;
      const qProduct = charges[i].charge * charges[j].charge;
      if (Math.abs(qProduct) < 0.015) continue;
      contacts.push({ i, j, distance: d, qProduct, kind: qProduct < 0 ? 'attraction' : 'repulsion' });
    }
  }
  return contacts.sort((a, b) => Math.abs(b.qProduct / b.distance) - Math.abs(a.qProduct / a.distance));
}

export function predictedIrBands(mol) {
  const bands = [];
  const amides = amideSites(mol);
  const amideCarbons = new Set(amides.map((site) => site.carbon));
  const carbonyls = mol.atoms.map((atom, index) => atom.el === 'C' && carbonylOxygen(mol, index) ? index : -1).filter((index) => index >= 0);
  for (const carbon of carbonyls) {
    const singleBondOxygens = incidentBonds(mol, carbon)
      .filter((bond) => bond.order === 1 && mol.atoms[otherEnd(bond, carbon)]?.el === 'O')
      .map((bond) => otherEnd(bond, carbon));
    const hasOH = singleBondOxygens.some((index) => neighbors(mol, index).some((next) => mol.atoms[next]?.el === 'H'));
    const hasOminus = singleBondOxygens.some((index) => atomCharge(mol.atoms[index]) < 0);
    const hasOR = singleBondOxygens.some((index) => !neighbors(mol, index).some((next) => mol.atoms[next]?.el === 'H'));
    if (amideCarbons.has(carbon)) bands.push({ label: '아마이드 C=O', range: '1630–1690 cm⁻¹', character: '강하고 뾰족', note: 'N 비공유전자쌍의 공명 공여가 C=O 파수를 낮춥니다.' });
    else if (hasOminus) bands.push({ label: '카복실레이트 COO⁻', range: '1550–1650 / 1300–1420 cm⁻¹', character: '두 개의 강한 밴드', note: '비대칭·대칭 신축을 함께 봅니다. 한 개의 에스터 C=O 밴드로 해석하지 않습니다.' });
    else if (hasOH) bands.push({ label: '카복실산 C=O', range: '1700–1725 cm⁻¹', character: '강하고 뾰족', note: '매우 넓은 산 O–H 밴드와 함께 확인하세요.' });
    else if (hasOR) bands.push({ label: '에스터 C=O', range: '1730–1750 cm⁻¹', character: '강하고 뾰족', note: '공명 정도와 치환기에 따라 위치가 달라집니다.' });
    else bands.push({ label: '카보닐 C=O', range: '1670–1780 cm⁻¹', character: '강하고 뾰족', note: '유도체·콘주게이션에 따라 범위를 좁혀야 합니다.' });
  }
  const alcoholOH = mol.atoms.some((atom, index) => atom.el === 'O'
    && neighbors(mol, index).some((next) => mol.atoms[next]?.el === 'H')
    && neighbors(mol, index).some((next) => mol.atoms[next]?.el === 'C'
      && !carbonylOxygen(mol, next)));
  if (alcoholOH) bands.push({ label: '알코올 O–H', range: '3200–3600 cm⁻¹', character: '넓음', note: '수소결합 때문에 폭이 넓어질 수 있습니다.' });
  if (mol.atoms.some((atom, index) => atom.el === 'N' && neighbors(mol, index).some((next) => mol.atoms[next]?.el === 'H'))) bands.push({ label: 'N–H', range: '3300–3500 cm⁻¹', character: '중간', note: '1°/2° 아민·아마이드는 봉우리 수와 위치가 달라질 수 있습니다.' });
  if (mol.bonds.some((bond) => bond.order === 3 && new Set([mol.atoms[bond.i]?.el, mol.atoms[bond.j]?.el]).has('N'))) bands.push({ label: '니트릴 C≡N', range: '2210–2260 cm⁻¹', character: '날카로움', note: '조용한 영역에 나타나는 진단 밴드입니다.' });
  if (mol.bonds.some((bond) => bond.order === 2 && mol.atoms[bond.i]?.el === 'C' && mol.atoms[bond.j]?.el === 'C')) bands.push({ label: '알켄 C=C', range: '1620–1680 cm⁻¹', character: '약함', note: 'C=O보다 약해 단독으로는 결론을 내리기 어렵습니다.' });
  return bands;
}

function morganLabels(mol, rounds = 5) {
  let labels = mol.atoms.map((atom, index) => `${atomicNumber(atom)}:${neighbors(mol, index).length}:${bondOrderSum(mol, index)}`);
  for (let round = 0; round < rounds; round++) {
    labels = mol.atoms.map((_, index) => {
      const neighbourLabels = incidentBonds(mol, index)
        .map((bond) => `${Math.round(bond.order)}×${labels[otherEnd(bond, index)]}`).sort();
      return `${labels[index]}[${neighbourLabels.join('|')}]`;
    });
  }
  return labels;
}

const multiplicityName = (count) => ({ 0: 's', 1: 'd', 2: 't', 3: 'q', 4: 'quint', 5: 'sext', 6: 'sept' }[count] ?? `${count + 1}중선`);

export function protonNmrSignals(mol) {
  const hydrogens = mol.atoms.map((atom, index) => atom.el === 'H' ? index : -1).filter((index) => index >= 0);
  if (!hydrogens.length) return { supported: false, signals: [], note: '명시적 수소가 있는 구조에서만 적분비와 이웃 수를 계산합니다.' };
  const labels = morganLabels(mol);
  const groups = new Map();
  for (const hydrogen of hydrogens) {
    const key = labels[hydrogen];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(hydrogen);
  }
  const signals = [...groups.values()].map((members, index) => {
    const carrier = neighbors(mol, members[0])[0];
    const carrierElement = mol.atoms[carrier]?.el;
    if (carrierElement === 'O' || carrierElement === 'N') return { id: index + 1, hydrogens: members, integral: members.length, multiplicity: '넓은 s(교환)', reason: 'O–H/N–H는 빠른 교환으로 보통 갈라짐을 보이지 않습니다.' };
    const couplingSets = new Map();
    for (const neighbour of neighbors(mol, carrier).filter((atom) => mol.atoms[atom]?.el === 'C')) {
      for (const hydrogen of neighbors(mol, neighbour).filter((atom) => mol.atoms[atom]?.el === 'H')) {
        const key = labels[hydrogen];
        couplingSets.set(key, (couplingSets.get(key) ?? 0) + 1);
      }
    }
    const counts = [...couplingSets.values()].sort((a, b) => a - b);
    const multiplicity = !counts.length ? 's' : counts.length === 1 ? multiplicityName(counts[0]) : `복합 (${counts.map(multiplicityName).join(' × ')}; dd/ddd 가능)`;
    return { id: index + 1, hydrogens: members, integral: members.length, multiplicity, reason: counts.length <= 1 ? 'n+1 규칙은 화학적으로 등가인 이웃 H에만 적용합니다.' : '서로 비등가인 이웃 H 집합이 있어 단순 n+1로 축약하지 않습니다.' };
  });
  return { supported: true, signals, note: '신호군은 Morgan 대칭성 근사입니다. 실제 화학적 이동·J값·2차 효과는 계산하지 않습니다.' };
}

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
