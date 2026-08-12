// 시드 미션. 전부 molcraft-gap.md §5의 "즉시 가능" 항목이라 현재 엔진으로 정직하게 성립한다.
// Ch5(입체)·Ch10(아마이드)·Ch12(스펙트럼)·Ch13(헤테로고리)·Ch17(단백질)은 의도적으로 뺐다 —
// 지금 엔진으로 다루면 틀리게 가르치게 된다(CIP 부재, 아마이드 비평면, 피롤 lone pair 오표시).

// 메틸사이클로헥세인 의자 두 배좌.
// 플랜 초안은 `preset: cyclohexane_chair` + `replace: [{atom: 7}]`에 `flipZ`를 얹어
// 고리 뒤집기를 흉내내려 했지만, `flipZ`는 분자 전체의 z를 뒤집는 순수 거울반사라
// 내부 기하가 그대로다 — 메틸은 여전히 axial이고 에너지도 완전히 같았다(둘 다 11.375).
// 그래서 두 배좌를 골격 리터럴로 직접 적는다. 원자 순서가 같아 위상키도 같으므로
// 총에너지 비교가 🟡로 정당하다(같은 분자의 두 배좌).
const CHAIR_RING = [
  [1.26, 0.73, 0.25], [0.00, 1.46, -0.25], [-1.26, 0.73, 0.25],
  [-1.26, -0.73, -0.25], [0.00, -1.46, 0.25], [1.26, -0.73, -0.25],
];
const METHYL_AXIAL = [1.27, 0.74, 1.78];       // C0의 고리축(+Z) 방향 — axial
const METHYL_EQUATORIAL = [2.50, 1.44, -0.28]; // C0의 고리 바깥 방향 — equatorial

// 인덱스 0–5가 고리 탄소, 6이 메틸 탄소다. 나머지 수소는 syncH가 채운다.
const chairMethyl = (methylPos) => ({
  atoms: [...CHAIR_RING, methylPos].map((pos) => ['C', pos]),
  bonds: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [0, 6]],
  syncH: true,
  relax: true,
});

export const MISSIONS = [
  {
    id: 'ch01-water-vsepr',
    chapter: 1,
    concept: '전자 도메인과 VSEPR',
    type: 'predict',
    title: '물은 왜 직선이 아닌가',
    brief: '산소에 붙은 결합은 두 개뿐입니다. 그런데도 H–O–H가 180°가 아닌 이유를 먼저 예측하세요.',
    start: { preset: 'water' },
    choices: [
      { id: 'a', label: '180° — 결합이 둘이니 직선이다' },
      { id: 'b', label: '120° — 평면 삼각형의 일부다' },
      { id: 'c', label: '약 104.5° — 비공유 전자쌍 두 개가 자리를 차지한다' },
      { id: 'd', label: '90° — 산소의 p 궤도 각도 그대로다' },
    ],
    answer: 'c',
    probe: {
      kind: 'minimize',
      states: [{ preset: 'water' }],
      report: [{ label: '최적화 후 H–O–H', value: 'angle', atoms: [1, 0, 2] }],
    },
    hints: [
      'VSEPR이 세는 것은 결합이 아니라 전자 도메인입니다.',
      '산소의 비공유 전자쌍이 몇 개인지 세어 보세요. 붙이기 도구에서 보라색 자리로 보입니다.',
      '결합 2개 + 비공유쌍 2개 = 도메인 4개. 도메인 4개의 기본 배치는 정사면체(109.5°)입니다.',
      '정답은 약 104.5°입니다. 비공유쌍이 결합쌍보다 더 넓게 퍼져 결합각을 109.5°보다 좁힙니다.',
    ],
    trust: 'geometry',
  },

  {
    id: 'ch01-structural-isomer',
    chapter: 1,
    concept: '구조 이성질체',
    type: 'classify',
    title: 'n-부탄과 아이소부탄의 관계',
    brief: '두 분자는 분자식이 같습니다. 그렇다면 어떤 관계입니까?',
    start: { preset: 'butane' },
    choices: [
      { id: 'a', label: '같은 분자 — 배좌만 다르다' },
      { id: 'b', label: '구조 이성질체 — 원자 연결 방식이 다르다' },
      { id: 'c', label: '거울상 이성질체' },
      { id: 'd', label: '분자식이 애초에 다르다' },
    ],
    answer: 'b',
    probe: {
      kind: 'measure',
      states: [
        { preset: 'butane' },
        {
          atoms: [['C', [0, 0, 0]], ['C', [1.53, 0, 0]],
                  ['C', [-0.5, 1.45, 0]], ['C', [-0.5, -0.7, 1.26]]],
          bonds: [[0, 1], [0, 2], [0, 3]],
          syncH: true, relax: true,
        },
      ],
      report: [
        { label: 'n-부탄 분자식', value: 'formula', state: 0 },
        { label: '아이소부탄 분자식', value: 'formula', state: 1 },
        { label: '연결 방식이 같은가', value: 'topologyEqual' },
      ],
    },
    hints: [
      '배좌는 결합을 끊지 않고 회전만으로 서로 바뀝니다.',
      '아이소부탄의 가운데 탄소에는 탄소가 몇 개 붙어 있는지 세어 보세요.',
      'n-부탄은 사슬(각 탄소에 탄소 최대 2개), 아이소부탄은 가지(가운데 탄소에 탄소 3개)입니다. 회전으로는 절대 바뀌지 않습니다.',
      '정답은 구조 이성질체입니다. 분자식은 같고(C4H10) 연결 방식이 다릅니다.',
    ],
    trust: 'geometry',
  },

  {
    id: 'ch02-butane-anti',
    chapter: 2,
    concept: '배좌와 스트레인',
    type: 'build',
    title: '부탄을 anti 배좌로 만들어라',
    brief: 'σ 결합은 자유롭게 회전합니다. 지금은 gauche입니다 — 가장 안정한 배치로 돌리세요.',
    start: { preset: 'butane', setDihedral: { atoms: [0, 1, 2, 3], deg: 60 } },
    check: {
      all: [
        { formula: 'C4H10' },
        { topologyMatches: 'start' },
        { dihedral: [0, 1, 2, 3], within: [150, 210] },
      ],
    },
    diagnostics: [
      {
        when: { dihedral: [0, 1, 2, 3], within: [40, 80] },
        message: 'gauche 배좌 그대로입니다. anti는 이면각 180° — 메틸 두 개가 정반대를 봐야 합니다.',
      },
      {
        when: { dihedral: [0, 1, 2, 3], within: [-20, 20] },
        message: 'syn(가려진) 배좌입니다. 가장 불안정한 배치예요. 180°까지 더 돌리세요.',
      },
      {
        when: { not: { formula: 'C4H10' } },
        message: '원자가 늘거나 줄었습니다. 이 미션은 회전만으로 풀립니다 — 실행취소(Ctrl+Z)하세요.',
      },
    ],
    hints: [
      '배좌는 σ 결합의 회전으로만 바뀝니다. 결합을 끊거나 원자를 붙일 필요가 없습니다.',
      '중심 C–C 결합(C1–C2)을 사이에 둔 이면각을 보세요.',
      '탄소 4개를 C0→C1→C2→C3 순서로 선택하면 우측 패널의 "이면각 회전" 슬라이더가 켜집니다.',
      '목표 이면각은 180°입니다.',
    ],
    trust: 'geometry',
  },

  {
    id: 'ch02-chair-axial-equatorial',
    chapter: 2,
    concept: '고리 배좌 — axial과 equatorial',
    type: 'predict',
    title: '메틸은 axial이 편한가 equatorial이 편한가',
    brief: '메틸사이클로헥세인의 의자 두 개는 같은 분자입니다. 어느 쪽이 더 안정할지 먼저 답하세요.',
    start: chairMethyl(METHYL_AXIAL),
    choices: [
      { id: 'a', label: 'axial — 고리 축 방향이라 자리를 덜 차지한다' },
      { id: 'b', label: 'equatorial — 고리 바깥으로 뻗어 반발이 적다' },
      { id: 'c', label: '완전히 같다 — 같은 분자이므로' },
    ],
    answer: 'b',
    probe: {
      kind: 'minimize',
      states: [chairMethyl(METHYL_AXIAL), chairMethyl(METHYL_EQUATORIAL)],
      report: [
        { label: 'axial', value: 'energy', state: 0 },
        { label: 'equatorial', value: 'energy', state: 1 },
      ],
    },
    hints: [
      '의자 뒤집기(ring flip)는 결합을 끊지 않습니다 — 같은 분자의 두 배좌입니다.',
      'axial 치환기는 고리 같은 면의 다른 axial 수소들과 마주 봅니다.',
      '그 마주 봄이 1,3-diaxial 반발입니다. equatorial에는 그런 상대가 없습니다.',
      'equatorial이 더 안정합니다. 메틸의 경우 실제 차이는 약 1.7 kcal/mol입니다.',
    ],
    trust: 'relative',
  },

  {
    id: 'ch03-pi-rotation',
    chapter: 3,
    concept: 'π 결합이 회전을 막는다',
    type: 'predict',
    title: '에탄과 에틸렌을 같은 각도로 비틀면',
    brief: '두 분자의 C–C 결합을 각각 끝까지 비틀어 봅니다. 회전 장벽이 어떻게 다를지 예측하세요.',
    start: { preset: 'ethylene' },
    choices: [
      { id: 'a', label: '거의 같다 — 둘 다 C–C 결합이다' },
      { id: 'b', label: '에탄이 훨씬 크다 — 수소가 더 많아서' },
      { id: 'c', label: '에틸렌이 훨씬 크다 — π 결합이 깨져야 하므로' },
    ],
    answer: 'c',
    probe: {
      kind: 'scanDihedral',
      states: [{ preset: 'ethane' }, { preset: 'ethylene' }],
      scan: { atoms: [2, 0, 1, 5], stepDeg: 30 },
      report: [
        { label: '에탄 회전 장벽', value: 'barrier', state: 0 },
        { label: '에틸렌 회전 장벽', value: 'barrier', state: 1 },
      ],
    },
    hints: [
      'σ 결합은 축 대칭이라 회전해도 겹침이 변하지 않습니다.',
      'π 결합은 축 위가 아니라 축의 위아래에서 겹칩니다.',
      '90°로 비틀면 두 p 궤도가 수직이 되어 π 겹침이 0이 됩니다 — 결합 하나를 깨는 셈입니다.',
      '에틸렌의 장벽이 압도적으로 큽니다. 에탄은 약 3 kcal/mol, 에틸렌은 그 수십 배입니다.',
    ],
    trust: 'relative',
  },
];

export const missionById = (id) => {
  const m = MISSIONS.find((x) => x.id === id);
  if (!m) throw new Error(`알 수 없는 미션: ${id}`);
  return m;
};
