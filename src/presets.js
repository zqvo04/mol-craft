import { createMolecule, addAtom, addBond } from './model.js';
import { sub, add, scale, cross, dot, unit, rotateAround } from './geom.js';
import { typeAtom, bondLength } from './uff.js';

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
// atom0는 훗날 앵커와 결합할 자리라 수소를 하나만 갖는다(다른 탄소는 정상 개수).
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
    if (k === 0) {
      // 앵커와 결합할 자리 — 수소 하나만 고리 평면 밖(+Z)에 둔다.
      const idx = atoms.push(['H', add(p, [0, 0, chBond])]) - 1;
      bonds.push([0, idx, 1]);
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

export const RING_TEMPLATES = {
  benzene: { name: '벤젠 고리 (방향족)', ...hexRing(1.40, 1.08, false) },
  cyclohexane: { name: '사이클로헥산 고리', ...hexRing(1.54, 1.09, true) },
};

// template의 국소 +X(atom0 바깥 방향)를 slotDir로 정렬하고, atom0가 앵커에서 UFF 평형
// 결합 길이만큼 떨어지도록 평행이동한 세계 좌표를 계산한다(mol은 읽기만 함 — 앵커 타입을
// 알아야 결합 길이가 나온다). 고스트 미리보기(app.js)와 실제 삽입(insertRingTemplate)이
// 이 함수 하나를 공유해 "미리 보여준 자리 = 실제로 붙는 자리"를 보장한다.
export function computeRingPlacement(mol, anchorIdx, template, slotDir) {
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
  const shift = sub(atom0World, rotate(template.atoms[0][1]));
  return template.atoms.map(([el, pos, type]) => [el, add(rotate(pos), shift), type]);
}

// 계산된 배치를 실제로 mol에 붙인다. attachAtom처럼 앵커 쪽에는 단일결합 하나만 만든다.
// 반환값은 새로 추가된 원자 인덱스 배열(template.atoms 순서대로).
export function insertRingTemplate(mol, anchorIdx, template, slotDir) {
  const placed = computeRingPlacement(mol, anchorIdx, template, slotDir);
  const idxMap = placed.map(([el, pos, type]) => {
    const idx = addAtom(mol, el, pos);
    if (type) mol.atoms[idx].type = type;
    return idx;
  });
  for (const [i, j, order] of template.bonds) addBond(mol, idxMap[i], idxMap[j], order);
  addBond(mol, anchorIdx, idxMap[0], 1);
  return idxMap;
}
