import { neighbors } from './model.js';

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
// depth 홀짝 교대로 ±120°(지그재그, 나선 방지), 2개 이상(가지점)=기존 방향들의 반대(빈 공간).
function placeChainAtom(mol, v, parent, parentDepth, pos) {
  const p = pos.get(parent);
  const placedNbrs = heavyNeighbors(mol, parent).filter((n) => pos.has(n));
  let dir;
  if (placedNbrs.length === 0) {
    dir = [1, 0];
  } else if (placedNbrs.length === 1) {
    // vIn: 부모가 "들어온" 방향(부모 -> 그 이웃). 새 결합과 이루는 내각이 정확히 120°가
    // 되도록 vIn 자체를 120° 회전한다(연장선을 접었을 때 나오는 각도(60°)가 아니다).
    const vIn = unit2(sub2(pos.get(placedNbrs[0]), p));
    dir = rotate2(vIn, (parentDepth % 2 === 0 ? 1 : -1) * (120 * Math.PI / 180));
  } else {
    const avg = placedNbrs.reduce((s, n) => add2(s, unit2(sub2(pos.get(n), p))), [0, 0]);
    dir = norm2(avg) > 1e-6 ? scale2(unit2(avg), -1) : [1, 0];
  }
  pos.set(v, add2(p, scale2(dir, BOND_LEN)));
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
