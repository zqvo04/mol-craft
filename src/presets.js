import { createMolecule, addAtom, addBond, bondOrderSum } from './model.js';
import { sub, add, scale, cross, dot, unit, rotateAround } from './geom.js';
import { typeAtom, bondLength } from './uff.js';
import { MAX_VALENCE } from './params.js';

const T = 0.63; // 정사면체 시작 좌표용 상수

export const PRESETS = {
  methane: {
    name: '메탄 CH₄',
    atoms: [['C', [0, 0, 0]], ['H', [T, T, T]], ['H', [-T, -T, T]], ['H', [-T, T, -T]], ['H', [T, -T, -T]]],
    bonds: [[0, 1], [0, 2], [0, 3], [0, 4]],
    note: 'VSEPR: 정사면체 109.5°',
  },
  water: {
    name: '물 H₂O',
    atoms: [['O', [0, 0, 0]], ['H', [0.96, 0, 0]], ['H', [-0.24, 0.93, 0]]],
    bonds: [[0, 1], [0, 2]],
    note: 'VSEPR: 굽은형 (비공유 전자쌍 2)',
  },
  ammonia: {
    name: '암모니아 NH₃',
    atoms: [['N', [0, 0, 0]], ['H', [0.94, 0, 0.33]], ['H', [-0.47, 0.81, 0.33]], ['H', [-0.47, -0.81, 0.33]]],
    bonds: [[0, 1], [0, 2], [0, 3]],
    note: 'VSEPR: 삼각뿔 (비공유 전자쌍 1)',
  },
  ethylene: {
    name: '에틸렌 C₂H₄',
    atoms: [['C', [0, 0, 0]], ['C', [1.33, 0, 0]], ['H', [-0.55, 0.94, 0]], ['H', [-0.55, -0.94, 0]],
            ['H', [1.88, 0.94, 0]], ['H', [1.88, -0.94, 0]]],
    bonds: [[0, 1, 2], [0, 2], [0, 3], [1, 4], [1, 5]],
    note: '평면 sp², 회전장벽이 큼',
  },
  ethane: {
    name: '에탄 C₂H₆',
    atoms: [['C', [0, 0, 0]], ['C', [1.53, 0, 0]],
            ['H', [-0.36, 1.02, 0]], ['H', [-0.36, -0.51, 0.88]], ['H', [-0.36, -0.51, -0.88]],
            ['H', [1.89, -1.02, 0]], ['H', [1.89, 0.51, 0.88]], ['H', [1.89, 0.51, -0.88]]],
    bonds: [[0, 1], [0, 2], [0, 3], [0, 4], [1, 5], [1, 6], [1, 7]],
    note: '엇갈린형/가려진형 회전장벽 ~3 kcal/mol',
  },
  // 수소를 반드시 명시해야 한다. 골격만 두면 사슬 탄소의 이웃이 2개라
  // typeAtom이 C_1(sp, theta0=180°)을 배정하고 비틀림 항이 0개가 되어
  // 배좌 비교 자체가 성립하지 않는다. 사이클로헥산도 같은 이유로 수소를 갖는다.
  butane: {
    name: 'n-부탄 C₄H₁₀ (anti)',
    atoms: [
      ['C', [-1.83, 0.62, -0.09]], ['C', [-0.65, -0.34, -0.22]],
      ['C', [0.65, 0.34, 0.22]], ['C', [1.83, -0.62, 0.09]],
      ['H', [-1.65, 1.53, -0.71]], ['H', [-2.76, 0.13, -0.43]], ['H', [-1.95, 0.92, 0.97]],
      ['H', [-0.84, -1.24, 0.41]], ['H', [-0.56, -0.66, -1.28]],
      ['H', [0.84, 1.24, -0.41]], ['H', [0.56, 0.66, 1.28]],
      ['H', [1.65, -1.53, 0.71]], ['H', [1.95, -0.92, -0.97]], ['H', [2.76, -0.13, 0.43]],
    ],
    bonds: [[0, 1], [1, 2], [2, 3], [0, 4], [0, 5], [0, 6], [1, 7], [1, 8],
            [2, 9], [2, 10], [3, 11], [3, 12], [3, 13]],
    note: 'C0-C1-C2-C3 이면각을 스캔하면 anti(180°)/gauche(±60°) 극소가 보인다',
  },
  sf6: {
    name: '육플루오린화 황 SF₆',
    atoms: [['S', [0, 0, 0]], ['F', [1.56, 0, 0]], ['F', [-1.56, 0, 0]], ['F', [0, 1.56, 0]],
            ['F', [0, -1.56, 0]], ['F', [0, 0, 1.56]], ['F', [0, 0, -1.56]]],
    bonds: [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]],
    note: '초원자가 · 정팔면체 90° — UFF 정확도 제한 있음',
  },
  pcl5: {
    name: '오염화 인 PCl₅',
    atoms: [['P', [0, 0, 0]], ['Cl', [2.02, 0, 0]], ['Cl', [-1.01, 1.75, 0]], ['Cl', [-1.01, -1.75, 0]],
            ['Cl', [0, 0, 2.14]], ['Cl', [0, 0, -2.14]]],
    bonds: [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5]],
    note: '삼각쌍뿔 — UFF는 축/적도 구분을 재현하지 못한다(경고 표시 필요)',
  },
  // 사이클로헥산은 의자/보트 시작 좌표를 분리해 국소 최소점을 각각 잡는다.
  // 수소가 없으면 고리 탄소가 이웃 2개짜리 C_1(선형, theta0 180°)로 타이핑되어
  // 비틀림 항이 아예 생기지 않고 의자/보트가 구분되지 않는다. 그래서 H를 명시한다.
  cyclohexane_chair: {
    name: '사이클로헥산 (의자)',
    atoms: [
      ['C', [1.26, 0.73, 0.25]], ['C', [0.00, 1.46, -0.25]], ['C', [-1.26, 0.73, 0.25]],
      ['C', [-1.26, -0.73, -0.25]], ['C', [0.00, -1.46, 0.25]], ['C', [1.26, -0.73, -0.25]],
      ['H', [2.15, 1.24, -0.13]], ['H', [1.27, 0.74, 1.34]], ['H', [0.00, 1.48, -1.34]],
      ['H', [0.00, 2.48, 0.13]], ['H', [-2.15, 1.24, -0.13]], ['H', [-1.27, 0.74, 1.34]],
      ['H', [-1.27, -0.74, -1.34]], ['H', [-2.15, -1.24, 0.13]], ['H', [0.00, -2.48, -0.13]],
      ['H', [0.00, -1.48, 1.34]], ['H', [1.27, -0.74, -1.34]], ['H', [2.15, -1.24, 0.13]],
    ],
    bonds: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0],
            [0, 6], [0, 7], [1, 8], [1, 9], [2, 10], [2, 11],
            [3, 12], [3, 13], [4, 14], [4, 15], [5, 16], [5, 17]],
    note: '전역 최소 배좌',
  },
  cyclohexane_boat: {
    name: '사이클로헥산 (보트)',
    atoms: [
      ['C', [1.26, 0.73, 0.25]], ['C', [0.00, 1.46, -0.25]], ['C', [-1.26, 0.73, 0.25]],
      ['C', [-1.26, -0.73, 0.25]], ['C', [0.00, -1.46, -0.25]], ['C', [1.26, -0.73, 0.25]],
      ['H', [2.09, 1.05, -0.38]], ['H', [1.43, 1.05, 1.28]], ['H', [0.00, 1.48, -1.34]],
      ['H', [0.00, 2.48, 0.13]], ['H', [-2.09, 1.05, -0.38]], ['H', [-1.43, 1.05, 1.28]],
      ['H', [-2.09, -1.05, -0.38]], ['H', [-1.43, -1.05, 1.28]], ['H', [0.00, -1.48, -1.34]],
      ['H', [0.00, -2.48, 0.13]], ['H', [2.09, -1.05, -0.38]], ['H', [1.43, -1.05, 1.28]],
    ],
    bonds: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0],
            [0, 6], [0, 7], [1, 8], [1, 9], [2, 10], [2, 11],
            [3, 12], [3, 13], [4, 14], [4, 15], [5, 16], [5, 17]],
    note: '의자보다 높은 에너지',
  },
};

export function loadPreset(key) {
  const p = PRESETS[key];
  if (!p) throw new Error(`알 수 없는 프리셋: ${key}`);
  const m = createMolecule();
  for (const [el, pos] of p.atoms) addAtom(m, el, pos);
  for (const [i, j, order] of p.bonds) addBond(m, i, j, order ?? 1);
  return m;
}

// ---- 고리 템플릿 ----------------------------------------------------------
// 국소 좌표계(원점 = 고리 중심, 탄소 0 = +X축 위)에서 미리 계산해둔 정육각형 고리.
// 방향족 atom0는 앵커와 새 단일결합을 만들 자리를 비워둔다. 여기에 수소까지 두면
// 방향족 결합차수 합(3) + C-H + 새 C-C가 되어 5가처럼 보이는 과잉 구조가 됐다.
// 방향족은 결합 order를 1.5·타입을 C_R로 직접 박아 넣는다 — 만들면서 이미 벤젠인 걸
// 아는 템플릿이라 aromatize(고리 인식)를 따로 돌릴 필요가 없다.
function hexRing(bondLen, chBond, sp3) {
  const R = bondLen; // 정육각형: 외접반지름 = 변 길이
  const atoms = [];
  const bonds = [];
  const cType = sp3 ? 'C_3' : 'C_R';
  for (let k = 0; k < 6; k++) {
    const t = (k * 60 * Math.PI) / 180;
    atoms.push(['C', [R * Math.cos(t), R * Math.sin(t), 0], cType]);
  }
  for (let k = 0; k < 6; k++) bonds.push([k, (k + 1) % 6, sp3 ? 1 : 1.5]);
  for (let k = 0; k < 6; k++) {
    const p = atoms[k][1];
    const out = unit(p); // 원점이 중심이므로 반지름 방향 = p 방향
    if (k === 0 && sp3) {
      // 포화 고리의 첨부 탄소는 고리 결합 2개와 새 앵커 결합 1개를 가지므로 H 하나가 남는다.
      const idx = atoms.push(['H', add(p, [0, 0, chBond])]) - 1;
      bonds.push([0, idx, 1]);
    } else if (k === 0) {
      // 방향족 첨부 탄소는 외부 결합이 이미 네 번째 원자가를 채우므로 H를 넣지 않는다.
      continue;
    } else if (sp3) {
      // 정사면체 절반각(~54.7°)만큼 평면 밖 위/아래로 벌어진 H 두 개.
      const inPlane = scale(out, chBond * 0.577);
      const idxUp = atoms.push(['H', add(add(p, inPlane), [0, 0, chBond * 0.816])]) - 1;
      const idxDown = atoms.push(['H', add(add(p, inPlane), [0, 0, -chBond * 0.816])]) - 1;
      bonds.push([k, idxUp, 1], [k, idxDown, 1]);
    } else {
      const idx = atoms.push(['H', add(p, scale(out, chBond))]) - 1;
      bonds.push([k, idx, 1]);
    }
  }
  return { atoms, bonds, attachType: cType };
}

function saturatedRing(size, bondLen = 1.53) {
  const radius = bondLen / (2 * Math.sin(Math.PI / size));
  const atoms = [];
  const bonds = [];
  for (let k = 0; k < size; k++) {
    const theta = (k * 2 * Math.PI) / size;
    const z = size === 5 ? (k % 2 ? 0.24 : -0.12) : (k % 2 ? -0.20 : 0.20);
    atoms.push(['C', [radius * Math.cos(theta), radius * Math.sin(theta), z], 'C_3']);
  }
  for (let k = 0; k < size; k++) bonds.push([k, (k + 1) % size, 1]);
  for (let k = 0; k < size; k++) {
    const p = atoms[k][1];
    const outward = unit([p[0], p[1], 0]);
    const hydrogens = k === 0 ? 1 : 2;
    for (let h = 0; h < hydrogens; h++) {
      const z = h === 0 ? 0.84 : -0.84;
      const pos = add(add(p, scale(outward, 0.63)), [0, 0, z]);
      const idx = atoms.push(['H', pos, 'H_']) - 1;
      bonds.push([k, idx, 1]);
    }
  }
  return { atoms, bonds, attachType: 'C_3' };
}

function aromaticPyridine() {
  const template = hexRing(1.40, 1.08, false);
  template.atoms[3][0] = 'N';
  template.atoms[3][2] = 'N_R';
  const hBond = template.bonds.find(([i, j]) => (i === 3 && template.atoms[j][0] === 'H') || (j === 3 && template.atoms[i][0] === 'H'));
  const hIndex = hBond?.[0] === 3 ? hBond[1] : hBond?.[0];
  if (Number.isInteger(hIndex)) {
    template.atoms.splice(hIndex, 1);
    template.bonds = template.bonds
      .filter(([i, j]) => i !== hIndex && j !== hIndex)
      .map(([i, j, order]) => [i > hIndex ? i - 1 : i, j > hIndex ? j - 1 : j, order]);
  }
  return template;
}

function aromaticFuran() {
  const size = 5;
  const radius = 1.40 / (2 * Math.sin(Math.PI / size));
  const atoms = [];
  const bonds = [];
  for (let k = 0; k < size; k++) {
    const theta = (k * 2 * Math.PI) / size;
    const isOxygen = k === 3;
    atoms.push([isOxygen ? 'O' : 'C', [radius * Math.cos(theta), radius * Math.sin(theta), 0], isOxygen ? 'O_R' : 'C_R']);
  }
  for (let k = 0; k < size; k++) bonds.push([k, (k + 1) % size, 1.5]);
  for (let k = 1; k < size; k++) {
    if (k === 3) continue;
    const p = atoms[k][1];
    const idx = atoms.push(['H', add(p, scale(unit(p), 1.08)), 'H_']) - 1;
    bonds.push([k, idx, 1]);
  }
  return { atoms, bonds, attachType: 'C_R', aromaticLonePairs: [3] };
}

function aromaticPyrrole() {
  const size = 5;
  const radius = 1.40 / (2 * Math.sin(Math.PI / size));
  const atoms = [];
  const bonds = [];
  for (let k = 0; k < size; k++) {
    const theta = (k * 2 * Math.PI) / size;
    const isNitrogen = k === 3;
    atoms.push([isNitrogen ? 'N' : 'C', [radius * Math.cos(theta), radius * Math.sin(theta), 0], isNitrogen ? 'N_R' : 'C_R']);
  }
  for (let k = 0; k < size; k++) bonds.push([k, (k + 1) % size, 1.5]);
  for (let k = 1; k < size; k++) {
    const p = atoms[k][1];
    const outward = unit(p);
    const idx = atoms.push(['H', add(p, scale(outward, 1.08)), 'H_']) - 1;
    bonds.push([k, idx, 1]);
  }
  return { atoms, bonds, attachType: 'C_R', aromaticLonePairs: [3] };
}

export const RING_TEMPLATES = {
  benzene: { name: '벤젠', group: 'ring', detail: '방향족 6원 고리', ...hexRing(1.40, 1.08, false) },
  cyclohexane: { name: '사이클로헥산', group: 'ring', detail: '포화 6원 고리', ...hexRing(1.54, 1.09, true) },
  cyclopentane: { name: '사이클로펜탄', group: 'ring', detail: '포화 5원 고리', ...saturatedRing(5) },
  pyridine: { name: '피리딘', group: 'heteroring', detail: '질소 포함 방향족 고리', ...aromaticPyridine() },
  furan: { name: '푸란', group: 'heteroring', detail: '산소 포함 방향족 고리', ...aromaticFuran() },
  pyrrole: { name: '피롤', group: 'heteroring', detail: '비공유쌍 공여 방향족 고리', ...aromaticPyrrole() },
  carbonyl: {
    name: '카보닐', group: 'functional', detail: 'C=O 기능기', attachType: 'C_2',
    atoms: [['C', [0, 0, 0], 'C_2'], ['O', [1.23, 0, 0], 'O_2'], ['H', [-0.48, 0.93, 0], 'H_']],
    bonds: [[0, 1, 2], [0, 2, 1]],
  },
  hydroxyl: {
    name: '하이드록실', group: 'functional', detail: 'O–H 기능기', attachType: 'O_3',
    atoms: [['O', [0, 0, 0], 'O_3'], ['H', [0.96, 0, 0], 'H_']], bonds: [[0, 1, 1]],
  },
  alkene: {
    name: '알켄', group: 'functional', detail: 'C=C 불포화 결합', attachType: 'C_2',
    atoms: [['C', [0, 0, 0], 'C_2'], ['C', [1.34, 0, 0], 'C_2'], ['H', [-0.48, 0.92, 0], 'H_'], ['H', [1.82, 0.92, 0], 'H_'], ['H', [1.82, -0.92, 0], 'H_']],
    bonds: [[0, 1, 2], [0, 2, 1], [1, 3, 1], [1, 4, 1]],
  },
};

export const STRUCTURE_LIBRARY = [
  { key: 'benzene', symbol: '⌬', title: '벤젠', group: 'ring' },
  { key: 'cyclohexane', symbol: '⬡', title: '사이클로헥산', group: 'ring' },
  { key: 'cyclopentane', symbol: '⬠', title: '사이클로펜탄', group: 'ring' },
  { key: 'pyridine', symbol: 'N⌬', title: '피리딘', group: 'heteroring' },
  { key: 'furan', symbol: 'O⬠', title: '푸란', group: 'heteroring' },
  { key: 'pyrrole', symbol: 'NH⬠', title: '피롤', group: 'heteroring' },
  { key: 'carbonyl', symbol: 'C=O', title: '카보닐', group: 'functional' },
  { key: 'hydroxyl', symbol: '–OH', title: '하이드록실', group: 'functional' },
  { key: 'alkene', symbol: 'C=C', title: '알켄', group: 'functional' },
];

// 라이브러리의 모든 구조 단위가 앵커/첨부 원자의 정상 원자가를 넘지 않는지 먼저 검사한다.
// app.js의 canBond는 실제 좌표와 UFF 목표 결합 길이까지 검증하므로, 이 함수는 그보다 앞선
// 빠른 구조적 방어선이다. 두 검사를 함께 써야 “유효한 단위이지만 현재 앵커엔 못 붙임”을
// 학생에게 구분해 설명할 수 있다.
export function validateStructureAttachment(mol, anchorIdx, template) {
  const anchor = mol.atoms[anchorIdx];
  if (!anchor || !template?.atoms?.length) return { ok: false, reason: 'invalid-template' };
  const anchorLimit = MAX_VALENCE[anchor.el] ?? 0;
  if (bondOrderSum(mol, anchorIdx) + 1 > anchorLimit) return { ok: false, reason: 'anchor-valence' };
  const [attachEl] = template.atoms[0];
  const attachLimit = MAX_VALENCE[attachEl] ?? 0;
  const internalOrder = template.bonds
    .filter(([i, j]) => i === 0 || j === 0)
    .reduce((sum, [, , order]) => sum + (order ?? 1), 0);
  if (internalOrder + 1 > attachLimit) return { ok: false, reason: 'template-valence' };
  return { ok: true, reason: 'ok' };
}

// template의 국소 +X(atom0 바깥 방향)를 slotDir로 정렬하고, atom0가 앵커에서 UFF 평형
// 결합 길이만큼 떨어지도록 평행이동한 세계 좌표를 계산한다(mol은 읽기만 함 — 앵커 타입을
// 알아야 결합 길이가 나온다). 고스트 미리보기(app.js)와 실제 삽입(insertRingTemplate)이
// 이 함수 하나를 공유해 "미리 보여준 자리 = 실제로 붙는 자리"를 보장한다.
export function computeRingPlacement(mol, anchorIdx, template, slotDir, twistDeg = 0) {
  const dir = unit(slotDir);
  const axis = cross([1, 0, 0], dir);
  const cosT = Math.max(-1, Math.min(1, dot([1, 0, 0], dir)));
  const angle = (Math.acos(cosT) * 180) / Math.PI;
  const rotate = (p) => {
    if (Math.hypot(...axis) > 1e-8) return rotateAround(p, [0, 0, 0], axis, angle);
    return cosT > 0 ? p : [-p[0], -p[1], p[2]]; // 평행/역평행 — 역평행이면 Z축 180° 회전
  };

  const anchorPos = mol.atoms[anchorIdx].pos;
  const bondLen = bondLength(typeAtom(mol, anchorIdx), template.attachType, 1);
  const atom0World = add(anchorPos, scale(dir, bondLen));
  const twist = (p) => (twistDeg ? rotateAround(p, [0, 0, 0], [1, 0, 0], twistDeg) : p);
  const shift = sub(atom0World, rotate(twist(template.atoms[0][1])));
  return template.atoms.map(([el, pos, type]) => [el, add(rotate(twist(pos)), shift), type]);
}

// 계산된 배치를 실제로 mol에 붙인다. attachAtom처럼 앵커 쪽에는 단일결합 하나만 만든다.
// 반환값은 새로 추가된 원자 인덱스 배열(template.atoms 순서대로).
export function insertRingTemplate(mol, anchorIdx, template, slotDir, twistDeg = 0) {
  const placed = computeRingPlacement(mol, anchorIdx, template, slotDir, twistDeg);
  const idxMap = placed.map(([el, pos, type], templateIndex) => {
    const idx = addAtom(mol, el, pos);
    if (type) mol.atoms[idx].type = type;
    if (template.aromaticLonePairs?.includes(templateIndex)) {
      mol.atoms[idx].aromaticLonePair = true;
      mol.atoms[idx].aromaticPiContribution = 2;
    }
    return idx;
  });
  for (const [i, j, order] of template.bonds) addBond(mol, idxMap[i], idxMap[j], order);
  addBond(mol, anchorIdx, idxMap[0], 1);
  return idxMap;
}
