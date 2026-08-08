import { neighbors } from './model.js';
import { implicitH, stability, formula } from './snap.js';

// 골격식 2D 좌표 생성. 결합 길이 1(무단위 — 렌더러가 원하는 배율로 스케일).
// 원자 인덱스 -> [x, y] Map을 돌려준다(직렬화 안 함, 로드/편집 때마다 다시 계산).
// 수소는 배치하지 않는다 — 골격식은 H를 별도 꼭짓점으로 그리지 않으므로
// (탄소는 생략, 헤테로원자는 라벨에 접어 표기) 좌표 자체가 필요 없다.
const BOND_LEN = 1;

const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add2 = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scale2 = (a, s) => [a[0] * s, a[1] * s];
const norm2 = (a) => Math.hypot(a[0], a[1]);
const unit2 = (a) => { const n = norm2(a); return n < 1e-9 ? [1, 0] : [a[0] / n, a[1] / n]; };
const dist2 = (a, b) => norm2(sub2(a, b));
const rotate2 = (a, rad) => {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [a[0] * c - a[1] * s, a[0] * s + a[1] * c];
};

const heavyAtoms = (mol) => mol.atoms.map((a, i) => i).filter((i) => mol.atoms[i].el !== 'H');
const heavyNeighbors = (mol, i) => neighbors(mol, i).filter((n) => mol.atoms[n].el !== 'H');
const edgeKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

// u-v 간선을 뺀 상태에서 BFS 최단경로 -> 그 경로 + 간선(u-v)이 u-v를 지나는 최소 고리.
// ponytail: 진짜 SSSR이 아니다(순환 기저 크기만큼만 찾음). 다리고리(아다만테인류)에서
// 고리가 과대/중복 계산될 수 있음 — 업그레이드 경로는 정식 SSSR 알고리즘.
function smallestRingThroughEdge(adj, u, v) {
  const parent = new Map([[u, null]]);
  const queue = [u];
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    if (cur === v) break;
    for (const n of adj(cur)) {
      if (cur === u && n === v) continue; // 직접 간선 제외
      if (!parent.has(n)) { parent.set(n, cur); queue.push(n); }
    }
  }
  if (!parent.has(v)) return null; // 다리(bridge) — 고리 아님
  const ring = [];
  for (let cur = v; cur !== null; cur = parent.get(cur)) ring.push(cur);
  return ring; // [v, ..., u] 순환: ring[k]-ring[k+1] 결합, ring[last]-ring[0]는 u-v 직접 결합
}

// 무거운 원자 그래프의 최소 고리 목록. 각 원소(연결 성분)마다 BFS 스패닝트리를 만들고,
// 트리에 없는 간선(비트리 간선)마다 그 간선을 지나는 최소 고리를 하나씩 뽑는다.
export function findRings(mol) {
  const heavy = heavyAtoms(mol);
  const adjMap = new Map(heavy.map((i) => [i, heavyNeighbors(mol, i)]));
  const adj = (i) => adjMap.get(i) ?? [];
  const globalSeen = new Set();
  const rings = [];
  for (const root of heavy) {
    if (globalSeen.has(root)) continue;
    const parent = new Map([[root, null]]);
    const treeEdges = new Set();
    const queue = [root];
    let qi = 0;
    while (qi < queue.length) {
      const u = queue[qi++];
      for (const v of adj(u)) {
        if (!parent.has(v)) { parent.set(v, u); treeEdges.add(edgeKey(u, v)); queue.push(v); }
      }
    }
    for (const i of parent.keys()) globalSeen.add(i);
    for (const u of parent.keys()) {
      for (const v of adj(u)) {
        if (v <= u || treeEdges.has(edgeKey(u, v))) continue;
        const ring = smallestRingThroughEdge(adj, u, v);
        if (ring) rings.push(ring);
      }
    }
  }
  const seenKeys = new Set();
  return rings.filter((r) => {
    const key = [...r].sort((a, b) => a - b).join(',');
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
}

function centroid(pos) {
  let x = 0, y = 0;
  for (const p of pos.values()) { x += p[0]; y += p[1]; }
  return pos.size ? [x / pos.size, y / pos.size] : [0, 0];
}

// 이미 배치된 구조 오른쪽 빈 자리(연결 안 된 새 고리계 배치용).
function nextFreeSpot(pos) {
  if (pos.size === 0) return [0, 0];
  let maxX = -Infinity;
  for (const p of pos.values()) maxX = Math.max(maxX, p[0]);
  return [maxX + 2.5, 0];
}

// ring[k0]을 이미 정해진 각도로 두고, 나머지를 중심 기준 일정 간격으로 이어 붙인다.
// 이미 좌표가 있는 원자(융합 변의 반대쪽 끝 등)는 건드리지 않는다.
function setPolygonFromIndex(ring, k0, center, R, angle0, step, pos) {
  const n = ring.length;
  for (let s = 0; s < n; s++) {
    const k = (k0 + s) % n;
    if (pos.has(ring[k])) continue;
    const a = angle0 + step * s;
    pos.set(ring[k], [center[0] + R * Math.cos(a), center[1] + R * Math.sin(a)]);
  }
}

// 고리 하나를 배치한다: 이미 배치된 변이 있으면(융합) 그 변을 공유하는 정n각형으로 반사,
// 이미 배치된 원자가 하나면(스피로) 그 점을 한 꼭짓점으로 반대쪽에, 없으면(새 고리계) 빈 자리에.
function placeOneRing(ring, pos) {
  const n = ring.length;
  const R = 1 / (2 * Math.sin(Math.PI / n));

  let fuseEdge = -1;
  for (let k = 0; k < n; k++) {
    if (pos.has(ring[k]) && pos.has(ring[(k + 1) % n])) { fuseEdge = k; break; }
  }
  if (fuseEdge !== -1) {
    const p1 = pos.get(ring[fuseEdge]), p2 = pos.get(ring[(fuseEdge + 1) % n]);
    const mid = scale2(add2(p1, p2), 0.5);
    const perp = unit2([-(p2[1] - p1[1]), p2[0] - p1[0]]);
    const apothem = R * Math.cos(Math.PI / n);
    const c1 = add2(mid, scale2(perp, apothem));
    const c2 = sub2(mid, scale2(perp, apothem));
    const away = centroid(pos);
    const center = dist2(c1, away) > dist2(c2, away) ? c1 : c2; // 기존 구조에서 먼 쪽으로 확장
    const angleA = Math.atan2(p1[1] - center[1], p1[0] - center[0]);
    const angleB = Math.atan2(p2[1] - center[1], p2[0] - center[0]);
    let delta = angleB - angleA;
    while (delta <= -Math.PI) delta += 2 * Math.PI;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    const step = (2 * Math.PI / n) * Math.sign(delta || 1);
    setPolygonFromIndex(ring, fuseEdge, center, R, angleA, step, pos);
    return;
  }

  const spiroK = ring.findIndex((a) => pos.has(a));
  if (spiroK === -1) {
    setPolygonFromIndex(ring, 0, nextFreeSpot(pos), R, 0, 2 * Math.PI / n, pos);
    return;
  }
  const known = pos.get(ring[spiroK]);
  const dir = unit2(sub2(known, centroid(pos))); // 기존 구조 반대쪽으로 새 고리를 튕겨낸다
  const center = add2(known, scale2(dir, R));
  const angle0 = Math.atan2(known[1] - center[1], known[0] - center[0]);
  setPolygonFromIndex(ring, spiroK, center, R, angle0, 2 * Math.PI / n, pos);
}

function placeRings(rings, pos) {
  const remaining = [...rings];
  while (remaining.length) {
    let idx = remaining.findIndex((r) => r.some((a) => pos.has(a)));
    if (idx === -1) idx = 0;
    placeOneRing(remaining.splice(idx, 1)[0], pos);
  }
}

// 이미 배치된 이웃 개수로 방향을 정한다: 0개(사슬 시작)=+x, 1개(사슬 연장)=들어온 방향에서
// sign만큼 ±120°(지그재그, 나선 방지), 2개 이상(가지점)=기존 방향들의 반대(빈 공간).
// placeChainAtom(사슬 성장)과 renderSVG의 2D 고스트 미리보기가 이 함수를 함께 쓴다 —
// "다음 원자를 어디에 그릴지"가 두 곳에 따로 있으면 나중에 어긋난다.
export function nextChainDir(mol, parent, pos, sign) {
  const p = pos.get(parent);
  const placedNbrs = heavyNeighbors(mol, parent).filter((n) => pos.has(n));
  if (placedNbrs.length === 0) return [1, 0];
  if (placedNbrs.length === 1) {
    // vIn: 부모가 "들어온" 방향(부모 -> 그 이웃). 새 결합과 이루는 내각이 정확히 120°가
    // 되도록 vIn 자체를 120° 회전한다(연장선을 접었을 때 나오는 각도(60°)가 아니다).
    const vIn = unit2(sub2(pos.get(placedNbrs[0]), p));
    return rotate2(vIn, sign * (120 * Math.PI / 180));
  }
  const avg = placedNbrs.reduce((s, n) => add2(s, unit2(sub2(pos.get(n), p))), [0, 0]);
  return norm2(avg) > 1e-6 ? scale2(unit2(avg), -1) : [1, 0];
}

function placeChainAtom(mol, v, parent, parentDepth, pos) {
  const sign = parentDepth % 2 === 0 ? 1 : -1;
  const dir = nextChainDir(mol, parent, pos, sign);
  pos.set(v, add2(pos.get(parent), scale2(dir, BOND_LEN)));
}

// 이미 배치된 원자들(고리 또는 시드)에서 BFS로 나머지 사슬/가지를 뻗는다.
function growChains(mol, pos) {
  const depth = new Map([...pos.keys()].map((k) => [k, 0]));
  const queue = [...pos.keys()];
  let qi = 0;
  while (qi < queue.length) {
    const u = queue[qi++];
    for (const v of heavyNeighbors(mol, u)) {
      if (pos.has(v)) continue;
      placeChainAtom(mol, v, u, depth.get(u), pos);
      depth.set(v, depth.get(u) + 1);
      queue.push(v);
    }
  }
}

// 규칙 4.1 "주요 골격을 먼저" 중 고리 없는 경우의 근사: 말단(연결 1개) 원자를 시작점으로
// 잡는다 — 단순 사슬은 이것만으로 자연히 직선 지그재그가 나온다. 진짜 최장경로 탐색은
// 가지 많은 분자에서만 이득이 커 생략(YAGNI) — 필요해지면 트리 지름 이중 BFS로 교체.
function pickSeed(mol, heavy) {
  return heavy.find((i) => heavyNeighbors(mol, i).length <= 1) ?? heavy[0];
}

export function layout(mol) {
  const heavy = heavyAtoms(mol);
  const pos = new Map();
  if (heavy.length === 0) return pos;
  if (heavy.length === 1) { pos.set(heavy[0], [0, 0]); return pos; }

  const rings = findRings(mol);
  if (rings.length) placeRings(rings, pos);
  else pos.set(pickSeed(mol, heavy), [0, 0]);

  growChains(mol, pos);
  return pos;
}

// ---- SVG 렌더링 -------------------------------------------------------------
// 규칙 2.1: 탄소는 절대 라벨 없음(꼭짓점=선의 끝/꺾임점으로만 표현).
// 규칙 2.2: 탄소의 H는 그리지 않는다(꼭짓점 자체가 이미 그 뜻). 헤테로원자의 H는
//   반드시 표시하되 별도 결합선이 아니라 라벨에 접어서(OH, NH2) 표시한다.
//   개수는 실제 H 원자를 세지 않고 implicitH(원자가 산수)로 구한다 — 이러면
//   syncHydrogens를 아직 안 돌린 "탄소 골격만 그린" 2D 편집 중에도 항상 정확하다.
// 규칙 2.3: 단일/이중/삼중 = 평행선 1/2/3개, 결합각은 layout()이 이미 120°/109.47°로 깔아둠.
// 규칙 2.4: C·H 이외 전부 원소 기호 명시.
// 규칙 2.5: 고리는 정확한 각형(layout이 보장) + 방향족은 Kekulé로 고정
//   (원 표기는 방향족성 판정(휘켈)이 별도 필요해 범위 밖 — "일관성 유지" 규칙 충족은
//   Kekulé 단독 사용으로 만족).
const LABEL_PAD = 0.24; // 결합선을 라벨 근처에서 이만큼 당겨 잘라낸다(글자와 안 겹치게)
const DBL_OFFSET = 0.09;
const DBL_INSET = 0.14; // 두 번째/세 번째 선을 양끝에서 이만큼 짧게(평행선임을 분명히)

// 규칙 2.6(쐐기/파선): z가 거의 같으면 임계값 미만으로 보고 평범한 선을 그린다.
// 부호 규약은 이 앱 내부 정의다(3Dmol 카메라와 맞출 필요 없음 — 2D 골격식은 애초에
// 3D 투영이 아니라 그래프 기반 개략도이므로 자체 규약이면 충분하다): dz > 0(대상 원자가
// 앵커보다 화면 앞) -> 쐐기, dz < 0 -> 파선.
const WEDGE_DZ_THRESHOLD = 0.15;
const WEDGE_WIDTH = 0.16; // 쐐기/파선 넓은 쪽 폭(월드 단위, scale=42에서 약 6~7px)
const DASH_COUNT = 5;

function ringCentroid(ring, pos) {
  return scale2(ring.reduce((s, a) => add2(s, pos.get(a)), [0, 0]), 1 / ring.length);
}

// i-j 결합이 어느 고리의 변이면 그 고리 중심 쪽 단위벡터(이중결합 안쪽 선 방향), 아니면 null.
function ringInsideDir(rings, pos, i, j) {
  for (const ring of rings) {
    const n = ring.length;
    const k = ring.indexOf(i);
    if (k !== -1 && (ring[(k + 1) % n] === j || ring[(k - 1 + n) % n] === j)) {
      const mid = scale2(add2(pos.get(i), pos.get(j)), 0.5);
      return unit2(sub2(ringCentroid(ring, pos), mid));
    }
  }
  return null;
}

// order에 따라 평행선 좌표쌍(월드 단위, 아직 스케일 전) 배열을 만든다.
function bondSegments(p, q, order, insideDir) {
  if (order <= 1) return [[p, q]];
  const perp = insideDir ?? unit2([-(q[1] - p[1]), q[0] - p[0]]);
  const d = sub2(q, p);
  const inset = (t) => [add2(p, scale2(d, t)), sub2(q, scale2(d, t))];
  if (order === 2) {
    const [p2, q2] = inset(DBL_INSET);
    return [[p, q], [add2(p2, scale2(perp, DBL_OFFSET)), add2(q2, scale2(perp, DBL_OFFSET))]];
  }
  const [p3, q3] = inset(DBL_INSET);
  const off = scale2(perp, DBL_OFFSET);
  return [[p, q], [add2(p3, off), add2(q3, off)], [sub2(p3, off), sub2(q3, off)]];
}

// 쐐기(앞으로 나온 결합): 앵커(p)가 뾰족한 점, 대상(q) 쪽이 넓어지는 채운 삼각형 3점.
function wedgeTriangle(p, q) {
  const perp = unit2([-(q[1] - p[1]), q[0] - p[0]]);
  const half = WEDGE_WIDTH / 2;
  return [p, add2(q, scale2(perp, half)), sub2(q, scale2(perp, half))];
}

// 파선(뒤로 들어간 결합): 앵커에서 대상 쪽으로 갈수록 길어지는 짧은 가로선 여러 개.
function dashSegments(p, q) {
  const perp = unit2([-(q[1] - p[1]), q[0] - p[0]]);
  const d = sub2(q, p);
  const segs = [];
  for (let k = 1; k <= DASH_COUNT; k++) {
    const t = k / DASH_COUNT;
    const c = add2(p, scale2(d, t));
    const half = (WEDGE_WIDTH / 2) * t;
    segs.push([add2(c, scale2(perp, half)), sub2(c, scale2(perp, half))]);
  }
  return segs;
}

// p->q 선분을 라벨이 있는 쪽 끝에서 LABEL_PAD만큼 당긴다(양끝 다 라벨이면 둘 다).
function clipToLabels(p, q, pHasLabel, qHasLabel) {
  const d = sub2(q, p);
  const len = norm2(d);
  if (len < 1e-6) return [p, q];
  const u = scale2(d, 1 / len);
  const p2 = pHasLabel ? add2(p, scale2(u, LABEL_PAD)) : p;
  const q2 = qHasLabel ? sub2(q, scale2(u, LABEL_PAD)) : q;
  return [p2, q2];
}

// mol -> 골격식 SVG 문자열. scale: 결합 길이 1 단위 -> 픽셀. 테마 대응은 CSS 변수로.
// ghost: 아직 커밋되지 않은 붙이기 미리보기 { anchorIdx, el, ok, reason, opacity }. 4단계
// (2D 레고 조립) 전용 — 별도 오버레이 좌표계를 두지 않고 이 함수가 이미 계산한 pos/sx/sy를
// 그대로 재사용해 좌표계가 어긋날 여지를 없앤다.
// bondPreview: '결합' 도구(기존 원자끼리 잇기 = 고리 닫기) 전용 { a, b, ok }. ghost(새 원자
// 붙이기)와 구조가 다르다 — a/b 둘 다 이미 존재하는 원자 인덱스이고 새 원자는 만들지 않는다.
// b가 아직 없으면(앵커만 찍고 커서를 아직 다른 원자 위로 안 옮긴 상태) 앵커 강조 원만 그린다.
export function renderSVG(mol, { scale = 42, ghost = null, bondPreview = null, selection = [] } = {}) {
  const pos = layout(mol);
  // 무거운 원자가 0~1개면 선으로 그릴 골격 자체가 없다(메탄 같은 단일 탄소 등) —
  // 골격식은 이 경우 성립하지 않는 표기법이므로 분자식 텍스트로 대신한다.
  // 붙어있는 원자 하나는 지우개/선택이 동작하도록 히트타깃만 남겨둔다(고스트 미리보기는
  // 그릴 골격이 없어 지원하지 않음 — 문서화된 한계).
  if (pos.size <= 1) {
    const lone = [...pos.keys()][0];
    const hit = lone === undefined ? ''
      : `<circle data-atom="${lone}" cx="70" cy="25" r="16" fill="transparent" style="cursor:pointer"/>`;
    return `<svg viewBox="0 0 140 40">${hit}<text x="70" y="25" text-anchor="middle" font-size="16" `
      + `fill="var(--fg)" font-family="sans-serif">${formula(mol)}</text></svg>`;
  }

  const heavyBonds = mol.bonds.filter((b) => mol.atoms[b.i].el !== 'H' && mol.atoms[b.j].el !== 'H');
  const rings = findRings(mol);
  const st = stability(mol);
  const badAtoms = new Set(st.issues.map((x) => x.atom));

  // 고스트 위치도 nextChainDir로 구한다(placeChainAtom과 동일 로직). sign=1 고정 —
  // 아직 커밋 전이라 실제 BFS 깊이를 알 수 없다(그 깊이는 growChains가 원자를 추가하는
  // 순간에만 정해진다). 실제로 붙이면 layout()이 처음부터 다시 계산해 최종 지그재그
  // 방향이 이 미리보기와 달라질 수 있다 — 미리보기는 "대략 이 근처"까지만 보장한다.
  // bbox 계산(아래)에는 절대 포함시키지 않는다 — 포함시키면 고스트가 나타날 때마다
  // minX/maxY가 바뀌어 sx/sy가 이동하고, 이미 배치된 원자들의 화면 좌표가 전부 밀려서
  // 마우스 밑에 있던 히트타깃이 빠져나가 버린다(호버 중 고스트가 깜빡이며 사라지는
  // 원인이었다). 아래 -1/+1 패딩이 결합 길이 1과 정확히 같아, 실전에서는 고스트가
  // 대부분 이 여백 안에 들어온다.
  const ghostPos = ghost && pos.has(ghost.anchorIdx)
    ? add2(pos.get(ghost.anchorIdx), scale2(nextChainDir(mol, ghost.anchorIdx, pos, 1), BOND_LEN))
    : null;

  const pts = [...pos.values()];
  const minX = Math.min(...pts.map((p) => p[0])) - 1;
  const maxX = Math.max(...pts.map((p) => p[0])) + 1;
  const minY = Math.min(...pts.map((p) => p[1])) - 1;
  const maxY = Math.max(...pts.map((p) => p[1])) + 1;
  const W = Math.max(1, (maxX - minX)) * scale, H = Math.max(1, (maxY - minY)) * scale;
  const sx = (x) => (x - minX) * scale;
  const sy = (y) => (maxY - y) * scale; // SVG y축은 아래로 증가하므로 뒤집는다

  const hasLabel = (i) => mol.atoms[i].el !== 'C';
  const labelText = (i) => {
    const el = mol.atoms[i].el;
    // 이미 실제 H 원자로 붙어있는 것(예: 프리셋)과 아직 안 붙었지만 원자가상 있어야 하는
    // 것(2D에서 골격만 그린 경우)을 더한다. implicitH만 쓰면 이미 붙어있는 H는 원자가
    // 결손이 0이라 라벨에서 사라진다(예: 명시적 O-H가 있는데도 라벨이 그냥 "O") —
    // bondOrderSum이 그 H 결합을 이미 카운트하므로 두 항은 절대 안 겹친다.
    const explicitH = neighbors(mol, i).filter((n) => mol.atoms[n].el === 'H').length;
    const h = explicitH + Math.max(0, implicitH(mol, i));
    return h === 0 ? el : `${el}H${h > 1 ? h : ''}`;
  };

  let bondsSvg = '';
  for (const b of heavyBonds) {
    const p = pos.get(b.i), q = pos.get(b.j);
    const [cp, cq] = clipToLabels(p, q, hasLabel(b.i), hasLabel(b.j));
    const inside = ringInsideDir(rings, pos, b.i, b.j);

    // 규칙 2.6: 고리 밖 단일결합만 대상 — z 변위(실제 3D 좌표)가 임계값 이상이면 쐐기/파선.
    const dz = b.order === 1 && inside === null
      ? mol.atoms[b.j].pos[2] - mol.atoms[b.i].pos[2]
      : 0;
    if (Math.abs(dz) >= WEDGE_DZ_THRESHOLD) {
      if (dz > 0) {
        const [t1, t2, t3] = wedgeTriangle(cp, cq);
        bondsSvg += `<polygon points="${sx(t1[0]).toFixed(1)},${sy(t1[1]).toFixed(1)} `
          + `${sx(t2[0]).toFixed(1)},${sy(t2[1]).toFixed(1)} `
          + `${sx(t3[0]).toFixed(1)},${sy(t3[1]).toFixed(1)}" fill="var(--fg)"/>`;
      } else {
        for (const [a, c] of dashSegments(cp, cq)) {
          bondsSvg += `<line x1="${sx(a[0]).toFixed(1)}" y1="${sy(a[1]).toFixed(1)}" `
            + `x2="${sx(c[0]).toFixed(1)}" y2="${sy(c[1]).toFixed(1)}" stroke="var(--fg)" stroke-width="1.6"/>`;
        }
      }
      continue;
    }

    for (const [a, c] of bondSegments(cp, cq, b.order, inside)) {
      bondsSvg += `<line x1="${sx(a[0]).toFixed(1)}" y1="${sy(a[1]).toFixed(1)}" `
        + `x2="${sx(c[0]).toFixed(1)}" y2="${sy(c[1]).toFixed(1)}" stroke="var(--fg)" stroke-width="1.6"/>`;
    }
  }

  let labelsSvg = '';
  for (const i of pos.keys()) {
    if (!hasLabel(i)) continue;
    const [x, y] = [sx(pos.get(i)[0]), sy(pos.get(i)[1])];
    const warn = badAtoms.has(i);
    labelsSvg += `<rect x="${(x - 12).toFixed(1)}" y="${(y - 10).toFixed(1)}" width="24" height="20" `
      + 'fill="var(--surface)"/>'
      + `<text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="middle" font-size="15" `
      + `fill="${warn ? '#dc2626' : 'var(--fg)'}" font-family="sans-serif">${labelText(i)}</text>`;
  }
  // 원자가 위반(옥텟 규칙 5 위반)은 탄소 꼭짓점에도 표시해야 하므로 라벨 없는 경우 별도 처리.
  for (const i of badAtoms) {
    if (hasLabel(i)) continue; // 위에서 이미 붉게 표시함
    const [x, y] = [sx(pos.get(i)[0]), sy(pos.get(i)[1])];
    labelsSvg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" `
      + 'fill="none" stroke="#dc2626" stroke-width="1.6"/>';
  }

  // 4단계(2D 레고 조립): 모든 무거운 원자(탄소 포함, 라벨 없어도)에 투명 히트타깃을
  // 둔다. 히트테스트는 SVG 네이티브 이벤트에 맡긴다 — app.js는 event.target.closest
  // ('[data-atom]')로 원자 인덱스만 읽으면 된다(3D처럼 좌표 역산 최근접 탐색 불필요).
  // 선택 강조. 3D의 노란 반투명 구(app.render)와 같은 색·같은 의미다. 골격식은 수소에
  // 좌표를 주지 않으므로(H는 라벨에 접힌다) pos에 있는 원자만 그린다.
  let selSvg = '';
  for (const i of selection) {
    if (!pos.has(i)) continue;
    const [x, y] = [sx(pos.get(i)[0]), sy(pos.get(i)[1])];
    selSvg += `<circle data-sel="${i}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" `
      + 'fill="#facc15" opacity="0.35"/>';
  }

  let hitsSvg = '';
  for (const i of pos.keys()) {
    const [x, y] = [sx(pos.get(i)[0]), sy(pos.get(i)[1])];
    hitsSvg += `<circle data-atom="${i}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="12" `
      + 'fill="transparent" style="cursor:pointer"/>';
  }

  let ghostSvg = '';
  if (ghostPos) {
    const [ax, ay] = [sx(pos.get(ghost.anchorIdx)[0]), sy(pos.get(ghost.anchorIdx)[1])];
    const [gx, gy] = [sx(ghostPos[0]), sy(ghostPos[1])];
    const color = !ghost.ok ? '#dc2626' : ghost.reason === 'ok' ? '#22c55e' : '#f59e0b';
    ghostSvg = `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${gx.toFixed(1)}" y2="${gy.toFixed(1)}" `
      + `stroke="${color}" stroke-width="1.6" stroke-dasharray="4 3" opacity="0.7"/>`
      + `<circle cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="12" fill="${color}" opacity="${ghost.opacity ?? 0.5}"/>`
      + `<text x="${gx.toFixed(1)}" y="${(gy + 5).toFixed(1)}" text-anchor="middle" font-size="13" `
      + `fill="var(--fg)" font-family="sans-serif">${ghost.el}</text>`;
  }

  let bondPreviewSvg = '';
  if (bondPreview && pos.has(bondPreview.a)) {
    const [ax, ay] = [sx(pos.get(bondPreview.a)[0]), sy(pos.get(bondPreview.a)[1])];
    bondPreviewSvg = `<circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="14" fill="none" stroke="#38bdf8" stroke-width="2.5"/>`;
    if (bondPreview.b != null && pos.has(bondPreview.b)) {
      const [bx, by] = [sx(pos.get(bondPreview.b)[0]), sy(pos.get(bondPreview.b)[1])];
      const color = bondPreview.ok ? '#22c55e' : '#dc2626';
      bondPreviewSvg += `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" `
        + `stroke="${color}" stroke-width="1.6" stroke-dasharray="4 3" opacity="0.8"/>`
        + `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="14" fill="none" stroke="${color}" stroke-width="2.5"/>`;
    }
  }

  return `<svg viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" width="100%" height="100%">`
    + `${selSvg}${bondsSvg}${labelsSvg}${hitsSvg}${ghostSvg}${bondPreviewSvg}</svg>`;
}
