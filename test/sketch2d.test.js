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

test('renderSVG: 단원자 분자는 빈 캔버스 대신 분자식 텍스트로 대신한다(메탄 -> CH4)', () => {
  const svg = renderSVG(loadPreset('methane'));
  assert.ok(svg.includes('>CH4<'));
  assert.equal((svg.match(/<line/g) || []).length, 0);
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

test('renderSVG 규칙 2.6: dz가 크게 양수인 결합은 쐐기(<polygon>)로 그려진다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'C', [1, 0, 1]);
  addBond(m, 0, 1);
  const svg = renderSVG(m);
  assert.ok(svg.includes('<polygon'));
  assert.equal((svg.match(/<line/g) || []).length, 0);
});

test('renderSVG 규칙 2.6: dz가 크게 음수인 결합은 파선(여러 <line>)으로 그려진다', () => {
  const m = createMolecule();
  addAtom(m, 'C', [0, 0, 0]); addAtom(m, 'C', [1, 0, -1]);
  addBond(m, 0, 1);
  const svg = renderSVG(m);
  assert.ok(!svg.includes('<polygon'));
  assert.equal((svg.match(/<line/g) || []).length, 5);
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
