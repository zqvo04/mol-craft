import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMolecule, addAtom, addBond } from '../src/model.js';
import { layout, findRings, renderSVG, nextChainDir } from '../src/sketch2d.js';
import { loadPreset } from '../src/presets.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const angleDeg = (a, b, c) => {
  const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
  const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2));
  return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
};

function ring(n) {
  const m = createMolecule();
  for (let i = 0; i < n; i++) addAtom(m, 'C', [0, 0, 0]);
  for (let i = 0; i < n; i++) addBond(m, i, (i + 1) % n);
  return m;
}

test('findRings: 벤젠은 6원 고리 1개', () => {
  assert.deepEqual(findRings(ring(6)).map((r) => r.length), [6]);
});

test('findRings: 사슬(고리 없음)은 빈 배열', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'C', [0, 0, 0]);
  addBond(m, 0, 1);
  assert.deepEqual(findRings(m), []);
});

test('layout: 벤젠 — 모든 결합 길이 1, 정육각형', () => {
  const pos = layout(ring(6));
  for (let i = 0; i < 6; i++) {
    assert.ok(Math.abs(dist(pos.get(i), pos.get((i + 1) % 6)) - 1) < 1e-6);
  }
  // 정육각형 내각은 120도
  for (let i = 0; i < 6; i++) {
    const a = angleDeg(pos.get((i + 5) % 6), pos.get(i), pos.get((i + 1) % 6));
    assert.ok(Math.abs(a - 120) < 1e-6);
  }
});

test('layout: 사슬 — 120도 지그재그, 결합 길이 1', () => {
  const m = createMolecule();
  for (let i = 0; i < 6; i++) addAtom(m, 'C', [0, 0, 0]);
  for (let i = 0; i < 5; i++) addBond(m, i, i + 1);
  const pos = layout(m);
  for (let i = 0; i < 5; i++) assert.ok(Math.abs(dist(pos.get(i), pos.get(i + 1)) - 1) < 1e-9);
  for (let i = 1; i < 5; i++) {
    assert.ok(Math.abs(angleDeg(pos.get(i - 1), pos.get(i), pos.get(i + 1)) - 120) < 1e-9);
  }
});

test('layout: 융합 이환계(나프탈렌류) — 공유 변 포함 모든 결합이 길이 1', () => {
  const m = createMolecule();
  for (let i = 0; i < 10; i++) addAtom(m, 'C', [0, 0, 0]);
  const bonds = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [5, 6], [6, 7], [7, 8], [8, 9], [9, 4]];
  for (const [a, b] of bonds) addBond(m, a, b);
  assert.equal(findRings(m).length, 2);
  const pos = layout(m);
  for (const [a, b] of bonds) assert.ok(Math.abs(dist(pos.get(a), pos.get(b)) - 1) < 1e-6);
});

test('layout: 고리 치환기(톨루엔류) — 가지 결합도 길이 1이고 고리 원자와 안 겹친다', () => {
  const m = ring(6);
  addAtom(m, 'C', [0, 0, 0]); // idx6: 메틸
  addBond(m, 0, 6);
  const pos = layout(m);
  assert.ok(Math.abs(dist(pos.get(0), pos.get(6)) - 1) < 1e-9);
  for (let i = 0; i < 6; i++) assert.ok(dist(pos.get(6), pos.get(i)) > 0.1);
});

test('layout: 수소는 배치하지 않는다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'H', [0, 0, 0]);
  addBond(m, 0, 1);
  const pos = layout(m);
  assert.ok(pos.has(0));
  assert.ok(!pos.has(1));
});

test('layout: 원자 하나짜리 분자도 처리한다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [5, 5, 5]);
  const pos = layout(m);
  assert.deepEqual(pos.get(0), [0, 0]);
});

test('layout: 분리된 새 조각도 각 무거운 원자에 2D 좌표를 부여한다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  addAtom(m, 'C', [1, 0, 0]);
  addBond(m, 0, 1);
  addAtom(m, 'O', [5, 0, 0]); // 빈 캔버스에서 새 조각으로 시작한 산소
  const pos = layout(m);
  assert.equal(pos.size, 3);
  assert.ok(pos.has(2));
  assert.ok(pos.get(2)[0] > pos.get(1)[0]);
});

test('renderSVG 규칙 2.1/2.4: 탄소는 라벨 없고, 헤테로원자는 있다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'O', [0, 0, 0]);
  addBond(m, 0, 1); addBond(m, 1, 2);
  const svg = renderSVG(m);
  assert.equal((svg.match(/<text/g) || []).length, 1); // O만
  assert.ok(svg.includes('>OH<') || svg.includes('>O<'));
});

test('renderSVG 규칙 2.2: 헤테로원자 H 개수는 implicitH로 접어 표기(에탄올 골격 -> OH)', () => {
  const m = createMolecule(); // C-C-O, H 하나도 안 그림(골격만)
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'O', [0, 0, 0]);
  addBond(m, 0, 1); addBond(m, 1, 2);
  assert.ok(renderSVG(m).includes('>OH<')); // O는 결합 1개뿐 -> 나머지 1개는 H
});

test('renderSVG: 이미 실제 H 원자로 붙어있어도 라벨에서 사라지지 않는다(회귀)', () => {
  // implicitH만 쓰면 이미 붙은 H는 원자가 결손이 0이라 라벨이 그냥 "O"가 돼버렸다.
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'O', [0, 0, 0]);
  addBond(m, 0, 1); addBond(m, 1, 2);
  const h = addAtom(m, 'H', [0, 0, 0]);
  addBond(m, 2, h);
  assert.ok(renderSVG(m).includes('>OH<'));
});

test('renderSVG 규칙 2.3: 결합 차수만큼 평행선(단일1/이중2/삼중3)', () => {
  const single = createMolecule();
  addAtom(single, 'C', [0, 0, 0]); addAtom(single, 'C', [0, 0, 0]); addBond(single, 0, 1, 1);
  assert.equal((renderSVG(single).match(/<line/g) || []).length, 1);

  const dbl = createMolecule();
  addAtom(dbl, 'C', [0, 0, 0]); addAtom(dbl, 'C', [0, 0, 0]); addBond(dbl, 0, 1, 2);
  assert.equal((renderSVG(dbl).match(/<line/g) || []).length, 2);

  const triple = createMolecule();
  addAtom(triple, 'C', [0, 0, 0]); addAtom(triple, 'C', [0, 0, 0]); addBond(triple, 0, 1, 3);
  assert.equal((renderSVG(triple).match(/<line/g) || []).length, 3);
});

test('renderSVG: 원자가 초과 원자는 붉은 경고 표식', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'C', [1, 0, 0]);
  for (let k = 0; k < 4; k++) { const h = addAtom(m, 'H', [k, 1, 0]); addBond(m, 0, h); }
  addBond(m, 0, 1); // C0: 결합 5개 -> 원자가 초과
  assert.ok(renderSVG(m).includes('#dc2626'));
});

test('renderSVG: 무거운 원자 1개인 메탄은 중심 + 명시적 H 구조식을 그린다', () => {
  const svg = renderSVG(loadPreset('methane'));
  assert.ok(svg.includes('>C<'));
  assert.equal((svg.match(/>H</g) ?? []).length, 4);
  assert.equal((svg.match(/<line/g) || []).length, 4);
});

// ---- 4단계(2D 레고 조립): nextChainDir/renderSVG 히트타깃·고스트 --------------------

test('nextChainDir: 배치된 이웃이 없으면 +x축', () => {
  const pos = new Map([[0, [3, 4]]]);
  assert.deepEqual(nextChainDir(createMolecule(), 0, pos, 1), [1, 0]);
});

test('nextChainDir: 배치된 이웃이 하나면 들어온 방향에서 sign*120도', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'C', [0, 0, 0]);
  addBond(m, 0, 1); addBond(m, 1, 2);
  const pos = new Map([[0, [0, 0]], [1, [1, 0]]]);
  const dPlus = nextChainDir(m, 1, pos, 1);
  const dMinus = nextChainDir(m, 1, pos, -1);
  assert.ok(Math.abs(dist([0, 0], dPlus) - 1) < 1e-9); // 단위벡터
  assert.ok(Math.abs(dPlus[1] + dMinus[1]) < 1e-9); // 부호만 반대(y 성분 대칭)
});

test('nextChainDir: 배치된 이웃이 둘 이상이면 기존 방향 평균의 반대', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'C', [0, 0, 0]);
  addBond(m, 0, 1); addBond(m, 0, 2); addBond(m, 0, 3);
  const pos = new Map([[0, [0, 0]], [1, [1, 0]], [2, [-0.5, 1]]]);
  const dir = nextChainDir(m, 0, pos, 1);
  assert.ok(dir[0] < 0); // 두 이웃 모두 +x/+y쪽에 있으니 빈 공간은 -x/-y쪽
});

test('renderSVG: 모든 무거운 원자에 data-atom 히트타깃이 있다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'O', [0, 0, 0]);
  addBond(m, 0, 1); addBond(m, 1, 2);
  const svg = renderSVG(m);
  for (let i = 0; i < 3; i++) assert.ok(svg.includes(`data-atom="${i}"`));
});

test('renderSVG: ghost 옵션을 주면 미리보기 원과 라벨이 포함된다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'C', [0, 0, 0]);
  addBond(m, 0, 1);
  const withoutGhost = renderSVG(m);
  const withGhost = renderSVG(m, { ghost: { anchorIdx: 0, el: 'N', ok: true, reason: 'ok' } });
  assert.ok(!withoutGhost.includes('>N<'));
  assert.ok(withGhost.includes('>N<'));
  assert.ok(withGhost.includes('#22c55e')); // ok:true -> 초록
});

test('renderSVG: ghost.ok가 false면 빨간색으로 표시된다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'C', [0, 0, 0]);
  addBond(m, 0, 1);
  const svg = renderSVG(m, { ghost: { anchorIdx: 0, el: 'N', ok: false, reason: 'already-bonded' } });
  assert.ok(svg.includes('#dc2626'));
});

// ---- 5단계: 쐐기/파선 (규칙 2.6) --------------------------------------------------

test('renderSVG 규칙 2.6: z가 거의 같은 결합은 평범한 <line> 그대로', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'C', [1, 0, 0.05]);
  addBond(m, 0, 1);
  const svg = renderSVG(m);
  assert.equal((svg.match(/<line/g) || []).length, 1);
  assert.ok(!svg.includes('<polygon'));
});

function chiral(zSign = 1) {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]);
  const v = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
  for (const [el, k] of [['H', 0], ['Br', 1], ['Cl', 2], ['F', 3]]) {
    addAtom(m, el, [v[k][0], v[k][1], v[k][2] * zSign]);
    addBond(m, 0, m.atoms.length - 1);
  }
  return m;
}
const stereoMarks = (svg) => ({ wedge: (svg.match(/<polygon/g) || []).length, dashes: (svg.match(/<line/g) || []).length - 2 });

test('renderSVG 규칙 2.6: n-부탄(입체중심 없음)은 쐐기/파선이 없다', () => {
  const svg = renderSVG(loadPreset('butane'));
  assert.ok(!svg.includes('<polygon'));
  assert.equal((svg.match(/<line/g) || []).length, 3);
});

test('renderSVG 규칙 2.6: 입체중심 CHBrClF는 결합 하나만 쐐기/파선, 거울상이면 뒤집힌다', () => {
  const a = stereoMarks(renderSVG(chiral(1))), b = stereoMarks(renderSVG(chiral(-1)));
  // 쐐기면 polygon 1개(+평범한 선 2), 파선이면 polygon 0개(+평범한 선 2 + 파선 5줄)
  for (const x of [a, b]) assert.ok((x.wedge === 1 && x.dashes === 0) || (x.wedge === 0 && x.dashes === 5), JSON.stringify(x));
  assert.equal(a.wedge + b.wedge, 1); // 거울상 -> 종류가 뒤집힌다
});

test('layout: n-부탄 사슬은 120° 지그재그(결합각 120°, 방향 교대)', () => {
  const pos = layout(loadPreset('butane'));
  const p = [0, 1, 2, 3].map((i) => pos.get(i));
  const ang = (a, c, d) => {
    const u = [a[0] - c[0], a[1] - c[1]], w = [d[0] - c[0], d[1] - c[1]];
    return Math.acos((u[0] * w[0] + u[1] * w[1]) / (Math.hypot(...u) * Math.hypot(...w))) * 180 / Math.PI;
  };
  assert.ok(Math.abs(ang(p[0], p[1], p[2]) - 120) < 1e-6);
  assert.ok(Math.abs(ang(p[1], p[2], p[3]) - 120) < 1e-6);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  assert.ok(cross(p[0], p[1], p[2]) * cross(p[1], p[2], p[3]) < 0);
});

test('renderSVG 규칙 2.6: 고리에 속한 결합은 dz가 커도 항상 평범한 선', () => {
  const m = ring(6);
  for (let i = 0; i < 6; i++) m.atoms[i].pos = [Math.cos(i), Math.sin(i), i % 2 === 0 ? 1 : -1];
  const svg = renderSVG(m);
  assert.ok(!svg.includes('<polygon'));
  assert.equal((svg.match(/<line/g) || []).length, 6);
});

test('renderSVG 규칙 2.6: 이중/삼중결합은 dz가 커도 쐐기/파선 안 나온다(평행선 유지)', () => {
  const dbl = createMolecule();
  addAtom(dbl, 'C', [0, 0, 0]); addAtom(dbl, 'C', [1, 0, 1]); addBond(dbl, 0, 1, 2);
  const svg = renderSVG(dbl);
  assert.ok(!svg.includes('<polygon'));
  assert.equal((svg.match(/<line/g) || []).length, 2);
});

// ---- 7단계: 선택 상태 표시 --------------------------------------------------------

test('renderSVG: 선택된 무거운 원자를 노란 원으로 표시한다', () => {
  const m = loadPreset('ethane');
  assert.ok(!renderSVG(m).includes('data-sel'), '선택이 없으면 표시하지 않는다');
  const svg = renderSVG(m, { selection: [0] });
  assert.equal((svg.match(/data-sel/g) ?? []).length, 1);
});

test('renderSVG: 2D 좌표가 없는 수소를 선택해도 터지지 않는다', () => {
  const m = loadPreset('ethane');
  const svg = renderSVG(m, { selection: [2] }); // 원자 2는 H — layout()이 배치하지 않는다
  assert.ok(!svg.includes('data-sel'));
});

test('renderSVG: 결합마다 data-bond 히트타깃을 낸다', () => {
  const m = loadPreset('ethane');
  const svg = renderSVG(m);
  // 에탄의 무거운 원자 결합은 C-C 하나뿐이다(C-H는 골격식에 안 그린다).
  assert.equal((svg.match(/data-bond="0-1"/g) ?? []).length, 1);
});

test('renderSVG: 무거운 원자가 1개면 중심 + 명시적 H 구조식을 그린다', () => {
  const m = loadPreset('ammonia');
  const svg = renderSVG(m);
  assert.ok(svg.includes('>N<'), '중심 원소 기호가 있어야 한다');
  assert.equal((svg.match(/>H</g) ?? []).length, 3, 'H 3개가 각각 그려져야 한다');
  assert.equal((svg.match(/<line/g) ?? []).length, 3, 'N-H 결합선 3개');
  // 중심 1개 + H 3개 전부 클릭 가능해야 도구가 동작한다.
  assert.equal((svg.match(/data-atom=/g) ?? []).length, 4);
});

test('renderSVG: 물도 같은 방식으로 그린다', () => {
  const svg = renderSVG(loadPreset('water'));
  assert.ok(svg.includes('>O<'));
  assert.equal((svg.match(/>H</g) ?? []).length, 2);
  assert.equal((svg.match(/<line/g) ?? []).length, 2);
});

test('renderSVG: 무거운 원자가 2개 이상이면 종전 골격식 그대로다 (회귀 방지)', () => {
  const svg = renderSVG(loadPreset('ethane'));
  assert.ok(!svg.includes('>H<'), '골격식은 탄소의 H를 그리지 않는다');
  assert.equal((svg.match(/<line/g) ?? []).length, 1);
});

// ---- 교재식 방향 + 고리 입체중심 ----------------------------------------------------

test('layout: 부탄·헥세인은 수평 지그재그(모든 결합이 수평과 ±30°)', () => {
  const hexane = createMolecule();
  for (let i = 0; i < 6; i++) addAtom(hexane, 'C', [i, 0, 0]);
  for (let i = 0; i < 5; i++) addBond(hexane, i, i + 1);
  for (const [key, m] of [['butane', loadPreset('butane')], ['hexane', hexane]]) {
    const pos = layout(m);
    const heavy = m.bonds.filter((b) => pos.has(b.i) && pos.has(b.j));
    assert.ok(heavy.length >= 3, key);
    for (const b of heavy) {
      const [p, q] = [pos.get(b.i), pos.get(b.j)];
      const a = Math.abs(Math.atan2(q[1] - p[1], q[0] - p[0]) * 180 / Math.PI) % 180;
      assert.ok(Math.abs(a - 30) < 1e-6 || Math.abs(a - 150) < 1e-6, `${key} ${a}`);
    }
  }
});

// 6원 고리 + 고리 탄소(0)에 CH3·H, 이웃 1번에 OH를 단 입체중심. z를 뒤집으면 거울상.
function ringStereo(zSign, { methyl = true } = {}) {
  const m = createMolecule();
  const hex = (i) => [Math.cos(i * Math.PI / 3), Math.sin(i * Math.PI / 3), 0];
  for (let i = 0; i < 6; i++) addAtom(m, 'C', hex(i));
  for (let i = 0; i < 6; i++) addBond(m, i, (i + 1) % 6);
  const add = (el, pos, to) => { addAtom(m, el, pos); addBond(m, to, m.atoms.length - 1); };
  add('O', [0.5, 1.5, 0], 1);
  if (methyl) add('C', [1.8, 0, 0.8 * zSign], 0);
  add('H', [1.8, 0, -0.8 * zSign], 0);
  return m;
}
const hasH = (svg) => svg.includes('>H</text>');

test('renderSVG 고리 입체중심: 고리 밖 CH3가 있으면 그 결합에 쐐기/파선(H는 안 그림), 거울상이면 뒤집힌다', () => {
  const [a, b] = [renderSVG(ringStereo(1)), renderSVG(ringStereo(-1))];
  assert.ok(!hasH(a) && !hasH(b));
  assert.equal((a.match(/<polygon/g) || []).length + (b.match(/<polygon/g) || []).length, 1);
});

// 데칼린 골격(고리 0-1-2-3-4-5, 0-5-6-7-8-9) + C1에 OH + 다리머리 C0에 H(위/아래 = z).
function decalin(zSign) {
  const m = createMolecule();
  const P = [[0, 0.5], [0, -0.5], [0.87, -1], [1.73, -0.5], [1.73, 0.5], [0.87, 1],
    [-0.87, 1], [-1.73, 0.5], [-1.73, -0.5], [-0.87, -1]]; // 0=(0,.5) 5 는 다리머리쌍 아님: 아래서 결합으로 정의
  P.forEach(([x, y]) => addAtom(m, 'C', [x, y, 0]));
  for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [0, 6], [6, 7], [7, 8], [8, 9], [9, 1]]) addBond(m, i, j);
  const add = (el, pos, to) => { addAtom(m, el, pos); addBond(m, to, m.atoms.length - 1); };
  add('O', [0.9, -2, 0], 2);
  add('H', [0, 0.5, zSign], 0);
  add('H', [0, -0.5, -zSign], 1);
  return m;
}

test('renderSVG 고리 입체중심: 결합이 전부 고리 안이면 명시적 H를 쐐기/파선으로 그린다, 거울상이면 뒤집힌다', () => {
  const [a, b] = [renderSVG(decalin(1)), renderSVG(decalin(-1))];
  // 다리머리 두 곳(C0, C1)의 H가 그려진다. 쐐기(polygon) 수가 거울상에서 정확히 반대가 된다.
  for (const svg of [a, b]) assert.equal((svg.match(/>H<\/text>/g) || []).length, 2);
  const w = (svg) => (svg.match(/<polygon/g) || []).length;
  assert.equal(w(a) + w(b), 2); // 두 중심 x 두 거울상 = 쐐기 2개, 파선 2개
  assert.notEqual(a, b);
});
