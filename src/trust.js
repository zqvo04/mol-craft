// 학습 플랫폼의 신뢰는 "무엇을 모르는지 말하는 것"에서 나온다.
// 화면에 나가는 모든 수치에 등급을 붙이고, 🔴는 아예 표시하지 않는다.
import { topologyKey } from './uff.js';

export const TRUST = {
  geometry: {
    key: 'geometry',
    badge: '🟢',
    label: '기하 — 신뢰',
    note: '결합각·결합길이·이면각은 UFF 평형값에서 직접 나옵니다.',
  },
  relative: {
    key: 'relative',
    badge: '🟡',
    label: '상대에너지 — 정성 비교용',
    note: 'UFF는 배좌 장벽을 과대평가합니다(부탄 syn: UFF 6–14, 문헌 4.5–6.1 kcal/mol). '
        + '순서만 참고하고 절대 수치는 신뢰하지 마십시오.',
  },
  blocked: {
    key: 'blocked',
    badge: '🔴',
    label: '비교 불가',
    note: '위상이 다른 두 구조의 총에너지, pKa, 반응 에너지, 전이상태는 이 모델의 범위 밖입니다.',
  },
};

// 좌표에서만 나오는 값 — 위상이 달라도 비교해도 된다.
const GEOMETRIC = new Set(['angle', 'dihedral', 'distance', 'formula', 'topologyEqual']);

export const sameTopology = (a, b) => topologyKey(a) === topologyKey(b);

// 배좌 장벽(barrier)은 각 분자 "내부"의 상대값이므로, 두 분자의 장벽을 나란히 놓는 것은
// 서로 다른 위상 사이에서도 성립한다. 총에너지(energy)만 위상 동일성을 요구한다.
export function trustFor(valueKind, crossTopology) {
  if (GEOMETRIC.has(valueKind)) return TRUST.geometry;
  if (valueKind === 'barrier') return TRUST.relative;
  if (valueKind === 'energy') return crossTopology ? TRUST.blocked : TRUST.relative;
  throw new Error(`trustFor: 알 수 없는 값 종류 "${valueKind}"`);
}

export function assertComparable(molA, molB, context) {
  if (!sameTopology(molA, molB)) {
    throw new Error(`${context}: 위상이 다른 두 구조의 총에너지는 비교할 수 없습니다`);
  }
}
