import { neighbors, bondOrderSum } from './model.js';
import { UFF_PARAMS } from './params.js';

// 원자 타입 결정: 원소 + 이웃 수 + 결합차수 합.
// 방향족(C_R/N_R/O_R)은 별도 고리 인식이 필요하므로 여기서 자동 배정하지 않는다.
// atom.type을 직접 지정하면 그 값이 우선한다(사용자 오버라이드 및 방향족 지정 경로).
export function typeAtom(mol, i) {
  const a = mol.atoms[i];
  if (a.type) return a.type;
  const el = a.el;
  const n = neighbors(mol, i).length;
  const bo = bondOrderSum(mol, i);
  switch (el) {
    case 'H': return 'H_';
    case 'F': return 'F_';
    case 'Cl': return 'Cl';
    case 'Br': return 'Br';
    case 'I': return 'I_';
    case 'B': return n >= 4 ? 'B_3' : 'B_2';
    case 'C': return n === 4 ? 'C_3' : n === 3 ? 'C_2' : n === 2 ? 'C_1' : 'C_3';
    case 'N': return n >= 3 ? 'N_3' : n === 2 ? 'N_2' : bo >= 3 ? 'N_1' : 'N_3';
    case 'O': return n >= 2 ? 'O_3' : bo >= 2 ? 'O_2' : 'O_3';
    case 'S': return n >= 3 ? 'S_3+6' : n === 1 && bo >= 2 ? 'S_2' : 'S_3+2';
    case 'P': return n >= 5 ? 'P_3+5' : 'P_3+3';
    case 'Si': return 'Si3';
    default: throw new Error(`지원하지 않는 원소: ${el}`);
  }
}

// 비틀림 항 분기용. theta0로 판정하면 표와 항상 일관된다.
export function hybridization(type) {
  const p = UFF_PARAMS[type];
  if (!p) throw new Error(`알 수 없는 UFF 타입: ${type}`);
  if (p.theta0 > 179) return 'sp';
  if (Math.abs(p.theta0 - 120) < 0.01) return 'sp2';
  if (p.theta0 < 115) return 'sp3';
  return 'other';
}
