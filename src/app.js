import { toXYZ, toMolBlock, toPDB, encodeState, decodeState, encodeStateAsync, decodeStateAsync } from './io.js';
import { energy, minimize, scanDihedral, typeAtom, cachedTerms } from './uff.js';
import {
  neighbors, measure, addAtom, addBond, removeAtom, branchAtoms, setDihedral, duplicateAtoms, isTorsionChain,
} from './model.js';
import {
  canBond, vseprCheck, newSnapEvents, idealDirection, openSlots, stability, hudSummary, syncHydrogens,
  geometryName, bondDistanceOk, cycleBondOrder,
} from './snap.js';
import { MAX_VALENCE } from './params.js';
import { loadPreset, PRESETS } from './presets.js';
import { add, scale } from './geom.js';
import { isShareEnabled, putShared, getShared, listGallery } from './share.js';
import { renderSVG, layout, nextChainDir } from './sketch2d.js';

const ELEMENTS = ['H', 'C', 'N', 'O', 'F', 'S', 'P', 'Cl', 'Si', 'B', 'Br', 'I'];

const state = {
  mol: loadPreset('methane'),
  mode: 'learn',
  tool: 'select', // 'select' | 'place' | 'erase' | 'bond' — 클릭 동작. mode(학습/연구)는 패널 노출만 결정한다.
  element: 'C',
  selection: [],
  snapState: {},
  flat: false,
  ghost: null, // { anchor, slots, slot, pos, ok, reason, el } — slots는 남은 빈 자리 전부
  slot: 0,     // 활성 빈 자리 인덱스. R 키/휠로 순환한다(마인크래프트의 배치 방향 선택에 해당)
  pendingBond: null, // 'bond' 도구에서 첫 번째로 찍은 원자 인덱스(대기 중인 앵커) — 고리 닫기용
  undoStack: [],
};

const LS_KEY = 'molcraft:last';

// render()가 불릴 때마다 동기로 쓰면(마우스 이동·슬라이더 한 칸마다) 문자열 직렬화 +
// localStorage 쓰기가 프레임을 막는다. 마지막 조작에서 400 ms 뒤 한 번만 쓴다.
let saveTimer;
function saveLocal() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, encodeState(state.mol)); }
    catch { /* 용량 초과·프라이빗 모드 등은 무시한다. 저장 실패가 앱을 막으면 안 된다. */ }
  }, 400);
}

function restoreLocal() {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return null;
  try { return decodeState(raw); } catch { return null; }
}

// 파괴적 조작(붙이기/삭제/복제) 직전에만 스냅샷을 남긴다. 구조 전체를 문자열로
// 찍어 쌓는 방식이라 별도 명령 스택이 필요 없다 — io.encodeState가 이미 갖고 있다.
const UNDO_LIMIT = 20;
function pushUndo() {
  state.undoStack.push(encodeState(state.mol));
  if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
}

function undo() {
  const snap = state.undoStack.pop();
  if (!snap) { toast('되돌릴 것이 없습니다', 'err'); return; }
  try { state.mol = decodeState(snap); }
  catch { toast('복원 실패', 'err'); return; }
  state.selection = [];
  state.snapState = {};
  checkSnaps();
  render();
}

const viewer = $3Dmol.createViewer(document.getElementById('viewer'), {
  backgroundColor: getComputedStyle(document.body).backgroundColor,
});

// 휠 방향 보정. 3Dmol이 뷰어 요소 자체(target 단계)에 이미 휠 리스너를 붙여놓았으므로
// 같은 요소에 나중에 리스너를 달아도 순서를 못 이긴다. document에 캡처 단계로 걸면
// 이벤트가 target에 닿기 전에 먼저 잡혀 3Dmol 기본 동작을 완전히 대체할 수 있다.
document.addEventListener('wheel', (ev) => {
  if (!document.getElementById('viewer').contains(ev.target)) return;
  ev.preventDefault();
  ev.stopPropagation();
  // 붙이기로 원자를 조준 중이면 휠은 확대가 아니라 "붙일 자리 바꾸기"다(마인크래프트 핫바 감각).
  if (state.tool === 'place' && state.ghost && state.ghost.slots.length > 1) {
    cycleSlot(ev.deltaY < 0 ? -1 : 1);
    return;
  }
  viewer.zoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15);
  viewer.render();
}, { capture: true, passive: false });

// atom.serial과 동일한 규칙(XYZ 모델 0-based 배열 인덱스)으로 페이지 좌표(pageX/Y)에
// 가장 가까운 원자를 찾는다. modelToScreen이 canvasOffset(rect+scroll)을 더해 반환하므로
// clientX/Y가 아니라 pageX/Y와 비교해야 스크롤된 페이지에서도 어긋나지 않는다.
function pickAtom(px, py, thresholdPx = 24) {
  let best = -1, bestD = thresholdPx;
  for (let i = 0; i < state.mol.atoms.length; i++) {
    const p = state.mol.atoms[i].pos;
    const s = viewer.modelToScreen({ x: p[0], y: p[1], z: p[2] });
    const d = Math.hypot(s.x - px, s.y - py);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// 결합 중점을 화면에 투영해 가장 가까운 결합을 찾는다(pickAtom과 같은 좌표 규칙).
// 임계값을 원자보다 작게 잡아, 원자 근처에서는 원자 클릭이 이기게 한다.
function pickBond(px, py, thresholdPx = 16) {
  let best = null, bestD = thresholdPx;
  for (const b of state.mol.bonds) {
    const p = state.mol.atoms[b.i].pos, q = state.mol.atoms[b.j].pos;
    const s = viewer.modelToScreen({ x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2, z: (p[2] + q[2]) / 2 });
    const d = Math.hypot(s.x - px, s.y - py);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

// 응력 색상: 낮음(파랑) -> 중간(회백색) -> 높음(빨강).
// ColorBrewer RdBu 3-스톱 발산 팔레트 — 색맹(적록색맹 포함) 사용자도
// 밝기·색상 축 둘 다로 구분 가능해 히트맵 표준으로 권장된다.
// '0 근처'가 중립 회백색이어야 응력이 실제로 있는 부위만 눈에 띈다.
export function strainColor(v, vmax) {
  const t = vmax <= 0 ? 0 : Math.min(1, Math.max(0, v / vmax));
  const lerp = (a, b, x) => Math.round(a + (b - a) * x);
  const [r, g, b] = t < 0.5
    ? [lerp(0x21, 0xf7, t * 2), lerp(0x66, 0xf7, t * 2), lerp(0xac, 0xf7, t * 2)]
    : [lerp(0xf7, 0xb2, (t - 0.5) * 2), lerp(0xf7, 0x18, (t - 0.5) * 2), lerp(0xf7, 0x2b, (t - 0.5) * 2)];
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

let firstRender = true;
let selectionShapes = []; // render()가 만드는 노란 강조 구 — 이 배열만 지웠다 다시 그린다.
let warnShapes = [];      // 문제 원자 위의 경고 표식 — 같은 생명주기로 관리한다.
let bondHover2d = null; // 'bond' 도구 + 2D: pendingBond 찍은 뒤 커서가 올라간 두 번째 원자(고리 닫기 미리보기용)

function render() {
  const e = energy(state.mol, cachedTerms(state.mol));
  state.lastEnergy = e;
  viewer.removeAllModels();
  // removeAllShapes()는 쓰지 않는다 — 붙이기 고스트까지 함께 지워버리기 때문이다.
  // 이 함수가 만든 선택 강조 구와 경고 표식만 추적해서 그것만 지운다.
  for (const s of selectionShapes) viewer.removeShape(s);
  selectionShapes = [];
  for (const s of warnShapes) viewer.removeShape(s);
  warnShapes = [];
  viewer.addModel(toXYZ(state.mol), 'xyz');

  const vmax = Math.max(0.5, ...e.perAtom); // 0.5 kcal/mol 미만 차이는 노이즈로 본다
  // 원자마다 setStyle을 부르면 3Dmol이 호출마다 전체 원자를 훑어서 O(n²)가 된다 —
  // 원자 수십 개만 돼도 클릭·드래그가 눈에 띄게 끊겼다. 색만 원자별로 다르므로
  // colorfunc 하나로 넘겨 setStyle은 딱 한 번만 부른다(serial = XYZ 모델의 0-based 인덱스).
  const colors = state.mol.atoms.map((_, i) => strainColor(e.perAtom[i], vmax));
  viewer.setStyle({}, {
    sphere: { radius: 0.30, colorfunc: (atom) => colors[atom.serial] },
    stick: { radius: 0.14, colorfunc: (atom) => colors[atom.serial] },
  });

  // 선택된 원자는 반투명 노란 구로 강조
  for (const i of state.selection) {
    selectionShapes.push(viewer.addSphere({
      center: { x: state.mol.atoms[i].pos[0], y: state.mol.atoms[i].pos[1], z: state.mol.atoms[i].pos[2] },
      radius: 0.5, color: 'yellow', opacity: 0.35,
    }));
  }
  // '결합' 도구로 찍어둔 대기 중인 앵커는 하늘색 구로 강조(선택 강조와 같은 패턴, 다른 색).
  if (state.pendingBond !== null) {
    const p = state.mol.atoms[state.pendingBond].pos;
    selectionShapes.push(viewer.addSphere({
      center: { x: p[0], y: p[1], z: p[2] }, radius: 0.5, color: '#38bdf8', opacity: 0.4,
    }));
  }
  // 경고를 문제 원자 위에 직접 그린다. 지금까지는 좌상단 텍스트 칩뿐이라, 원자 색이 전부
  // 응력 색(파랑~빨강)인 3D 화면에서 어느 원자가 문제인지 알 방법이 없었다.
  // 빨강 와이어프레임 = 심각(원자가 초과 등), 주황 = 경고(VSEPR 편차·초원자가).
  const st = stability(state.mol);
  state.lastStability = st;
  const worst = new Map();
  for (const x of st.issues) {
    if (worst.get(x.atom) !== 'danger') worst.set(x.atom, x.level);
  }
  for (const [i, level] of worst) {
    const p = state.mol.atoms[i].pos;
    warnShapes.push(viewer.addSphere({
      center: { x: p[0], y: p[1], z: p[2] },
      radius: level === 'danger' ? 0.52 : 0.46,
      color: level === 'danger' ? '#dc2626' : '#f59e0b',
      opacity: 0.85, wireframe: true,
    }));
  }
  if (firstRender) { viewer.zoomTo(); firstRender = false; }
  viewer.render();
  updatePanels(e);
  // 골격식(2D) 보기가 켜져 있으면 3D 뷰어 위에 SVG를 계속 최신 상태로 덮어 그린다.
  // 3Dmol 스타일을 흉내내는 대신 sketch2d.renderSVG(진짜 골격식 규칙)를 그대로 쓴다.
  if (state.flat) {
    const bondPreview = state.tool === 'bond' && state.pendingBond !== null
      ? { a: state.pendingBond, b: bondHover2d, ok: bondHover2d == null ? undefined : canBond(state.mol, state.pendingBond, bondHover2d).ok }
      : null;
    $('sketch2d').innerHTML = renderSVG(state.mol, { bondPreview, selection: state.selection });
  }
  saveLocal();
}

const $ = (id) => document.getElementById(id);

const TERM_LABEL = { bond: '결합 신축', angle: '결합각 굽힘', torsion: '비틀림', vdw: '반데르발스' };

// 총에너지 · 항별 막대 · 선택 측정값 · VSEPR 이상각 만족 여부를 패널에 반영한다.
function updatePanels(e) {
  $('total').textContent = `${e.total.toFixed(2)} kcal/mol`;

  const max = Math.max(...Object.values(e.byType).map(Math.abs), 0.01);
  $('breakdown').innerHTML = '<table>' + Object.entries(e.byType).map(([k, v]) =>
    `<tr><td>${TERM_LABEL[k]}</td><td style="width:45%">` +
    `<div class="bar" style="width:${(Math.abs(v) / max * 100).toFixed(0)}%"></div></td>` +
    `<td>${v.toFixed(2)}</td></tr>`).join('') + '</table>';

  // 초원자가 중심 경고. UFF는 축/적도 자리를 구분하지 않으므로 정량 해석은 위험하다.
  const hyper = state.mol.atoms.some((_, i) => ['P_3+5', 'S_3+6'].includes(typeAtom(state.mol, i)));
  $('warn').textContent = hyper
    ? '주의: 초원자가 중심 포함 — UFF는 축/적도 위치를 구분하지 못합니다. 정량 해석 금지.' : '';

  // 측정은 2~4개일 때만 의미가 있다(거리/각도/이면각). 그 이상은 다중 선택 상태만 표시.
  const s = state.selection;
  $('measure').textContent = s.length < 2 ? '원자를 2~4개 클릭'
    : s.length === 2 ? `거리 ${measure(state.mol, s).toFixed(3)} Å`
    : s.length === 3 ? `결합각 ${measure(state.mol, s).toFixed(2)}°`
    : s.length === 4 ? `이면각 ${measure(state.mol, s).toFixed(2)}°`
    : `${s.length}개 선택됨`;

  // VSEPR: 배위수 2 이상인 모든 중심 원자의 이상각 만족 여부.
  const rows = state.mol.atoms.map((_, i) => i)
    .filter((i) => neighbors(state.mol, i).length >= 2)
    .map((i) => {
      const v = vseprCheck(state.mol, i);
      const worst = Math.max(...v.angles.map((a) => a.deviation));
      const status = v.satisfied
        ? '<span style="color:var(--success)">이상각 만족</span>'
        : `<span style="color:var(--accent)">Δ${worst.toFixed(1)}°</span>`;
      return `<tr><td>${state.mol.atoms[i].el}${i} (배위 ${v.coordination})</td><td>${status}</td></tr>`;
    });
  $('vsepr').innerHTML = rows.length ? `<table>${rows.join('')}</table>` : '—';

  // 안정도 HUD: 점수 + 심각한 것 몇 개만. 나머지는 개수로 접고, 어느 원자인지는
  // 3D 표식(render의 warnShapes)이 직접 가리킨다.
  const s2 = hudSummary(state.lastStability ?? stability(state.mol));
  const scoreColor = s2.score >= 80 ? 'var(--success)' : s2.score >= 50 ? 'var(--accent)' : '#dc2626';
  $('stability').innerHTML = `<span style="color:${scoreColor};font-weight:700">${s2.score}</span>`
    + s2.shown.map((x) => `<span class="chip ${x.level}">${x.level === 'danger' ? '✕' : '▲'} ${x.msg}</span>`).join('')
    + (s2.more ? `<span class="chip">+${s2.more}개</span>` : '');

  updateDihedralPanel();
}

// 선택 4개 + 고리 결합이 아니면 이면각 슬라이더를 활성화해 setDihedral로 직접 회전시킨다.
function updateDihedralPanel() {
  const s = state.selection;
  const slider = $('dihedral');
  if (s.length !== 4) {
    slider.disabled = true;
    $('dihedral-info').textContent = '원자 4개를 순서대로 선택하면 활성화됩니다';
    return;
  }
  if (!isTorsionChain(state.mol, s)) {
    slider.disabled = true;
    $('dihedral-info').textContent = '이어진 원자 4개(i-j-k-l)를 순서대로 선택하세요';
    return;
  }
  if (branchAtoms(state.mol, s[1], s[2]) === null) {
    slider.disabled = true;
    $('dihedral-info').textContent = '고리 결합 — 직접 회전 불가';
    return;
  }
  slider.disabled = false;
  const deg = Math.round(measure(state.mol, s));
  slider.value = deg;
  $('dihedral-info').textContent = `${deg}°`;
}

// 라이브러리 없이 인라인 SVG 꺾은선. 최소/최대는 색상뿐 아니라 모양(원/다이아몬드)으로도
// 구분한다(색맹 사용자 대응). 곡선 아래 텍스트 요약이 접근성 폴백 데이터 테이블 역할을 한다.
function drawScan(points) {
  const W = 290, H = 160, PAD_L = 30, PAD_B = 22, PAD_T = 12, PAD_R = 8;
  const ys = points.map((p) => p.relative);
  const ymax = Math.max(...ys, 0.5);
  const x = (a) => PAD_L + ((a + 180) / 360) * (W - PAD_L - PAD_R);
  const y = (v) => H - PAD_B - (v / ymax) * (H - PAD_B - PAD_T);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.angle).toFixed(1)},${y(p.relative).toFixed(1)}`).join('');
  const min = points.reduce((a, b) => (a.relative < b.relative ? a : b));
  const max = points.reduce((a, b) => (a.relative > b.relative ? a : b));

  $('chart').innerHTML = `
  <svg viewBox="0 0 ${W} ${H}" width="100%" role="img"
       aria-label="이면각에 따른 상대 에너지 곡선. 회전장벽 ${max.relative.toFixed(2)} kcal/mol, 최소 ${min.angle}도, 최대 ${max.angle}도">
    <line x1="${PAD_L}" y1="${H - PAD_B}" x2="${W - PAD_R}" y2="${H - PAD_B}" style="stroke:var(--border)"/>
    <line x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${H - PAD_B}" style="stroke:var(--border)"/>
    <path d="${path}" fill="none" style="stroke:var(--primary)" stroke-width="2"/>
    <circle cx="${x(min.angle)}" cy="${y(min.relative)}" r="3.5" style="fill:var(--success)"/>
    <rect x="${x(max.angle) - 3}" y="${y(max.relative) - 3}" width="6" height="6"
          style="fill:var(--accent)" transform="rotate(45 ${x(max.angle).toFixed(1)} ${y(max.relative).toFixed(1)})"/>
    <text x="${PAD_L}" y="${H - 8}" font-size="9" style="fill:var(--muted-fg)">-180°</text>
    <text x="${x(0).toFixed(1)}" y="${H - 8}" font-size="9" text-anchor="middle" style="fill:var(--muted-fg)">0°</text>
    <text x="${W - PAD_R}" y="${H - 8}" font-size="9" text-anchor="end" style="fill:var(--muted-fg)">180°</text>
    <text x="2" y="${PAD_T + 6}" font-size="9" style="fill:var(--muted-fg)">${ymax.toFixed(1)}</text>
    <text x="2" y="${H - PAD_B}" font-size="9" style="fill:var(--muted-fg)">0</text>
  </svg>
  <div style="font-size:12px">회전장벽 <b>${max.relative.toFixed(2)}</b> kcal/mol
  · 최소 ${min.angle}° · 최대 ${max.angle}°</div>`;
}

function toggleSelect(i) {
  const idx = state.selection.indexOf(i);
  if (idx === -1) state.selection.push(i); else state.selection.splice(idx, 1);
  render();
}

// 하단 알약형 알림.
let toastTimer;
function toast(msg, kind = 'ok') {
  const el = $('toast');
  el.textContent = msg;
  el.style.background = kind === 'ok' ? 'var(--success)' : 'var(--accent)';
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// 오디오 파일 없이 짧은 클릭음. AudioContext는 하나만 만들어 재사용한다(자동재생 정책 대응).
let audio;
function playClick(freq = 880) {
  audio ??= new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = 'triangle';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.15, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.09);
  o.connect(g).connect(audio.destination);
  o.start();
  o.stop(audio.currentTime + 0.1);
}

// canBond가 원자가 상한 초과를 직접 차단하므로(snap.js 참고) 여기 남은 사유는
// 데이터 모델상 불가능한 경우와 원자가 포화뿐이다.
const REASON_MSG = {
  'already-bonded': '이미 결합되어 있습니다',
  'unsupported-element': '지원하지 않는 원소입니다',
  'same-atom': '같은 원자입니다',
  'valence-full': '원자가가 가득 찼습니다 — 더 붙일 수 없습니다',
  'too-far': '너무 멀리 떨어진 원자입니다 — 가까운 원자끼리 이으세요',
};

// anchor에 현재 팔레트 원소를 붙인다. 방향은 snap.idealDirection이 VSEPR 이상각에 맞춰
// 계산한다(레고처럼 정해진 각도에만 물림) — 붙이기 도구의 고스트 미리보기와 정확히 같은
// 함수를 써서 "보여준 자리 = 실제로 붙는 자리"가 항상 일치하게 한다.
// 결합이 성립하면 UFF 평형 길이로 스냅시킨다. 실패 시 방금 추가한 원자를 되돌린다.
// pos2d: 2D 골격식 화면에서 붙일 때 sketch2d.layout()이 계산한 좌표를 [x, y, 0]으로
// 그대로 써서 z=0 평면에 둔다(4단계). 3D 경로(pos2d 없음)는 기존 그대로다.
function attachAtom(anchor, { pos2d, dir } = {}) {
  const el = state.element;
  const a = state.mol.atoms[anchor].pos;
  const placeDir = dir ?? idealDirection(state.mol, anchor);

  const idx = addAtom(state.mol, el, add(a, scale(placeDir, 2.5)));
  // canBond(mol, i, j)의 reason 태그는 i=중심/j=신규로 고정된 관례다(snap.test.js 참고).
  // 인자를 (idx, anchor) 순으로 넣으면 태그가 뒤집혀 REASON_MSG가 반대로 안내한다.
  const check = canBond(state.mol, anchor, idx);
  if (!check.ok) {
    state.mol.atoms.pop();
    toast(REASON_MSG[check.reason] ?? '결합할 수 없습니다', 'err');
    playClick(180); // 실패는 낮은 음
    return;
  }

  state.mol.atoms.pop(); // 시험 삽입 되돌리기 — 되돌린 깨끗한 상태를 undo 스냅샷으로 남긴다
  pushUndo();
  const targetPos = pos2d ? [pos2d[0], pos2d[1], 0] : add(a, scale(placeDir, check.targetLength));
  const idx2 = addAtom(state.mol, el, targetPos);
  addBond(state.mol, idx2, anchor, 1);
  if (check.reason === 'ok-expanded') { playClick(880); toast('초원자가 결합 — UFF 정확도 주의', 'err'); }
  else playClick(880);

  // pos2d로 붙인 경우는 z=0 평면 배치를 그대로 유지한다 — 여기서 바로 최적화하면
  // 2D 레이아웃이 흐트러진다. 3D 형태로 풀어주는 건 view2d 핸들러가 2D->3D 전환 시 담당한다.
  if (state.mode === 'learn' && !pos2d) minimize(state.mol, { maxSteps: 120 }); // 붙자마자 자리 잡게
  checkSnaps();
  render();
}

// 원자 하나를 뗀다(지우개 도구). 원자가 하나뿐이면 남길 것이 없으니 막는다.
function deleteAtom(i) {
  if (state.mol.atoms.length <= 1) { toast('마지막 원자는 삭제할 수 없습니다', 'err'); return; }
  pushUndo();
  removeAtom(state.mol, i);
  state.selection = state.selection.filter((s) => s !== i).map((s) => (s > i ? s - 1 : s));
  state.snapState = {};
  playClick(220);
  checkSnaps();
  render();
}

// 선택된 여러 원자를 한 번에 뗀다(Del 키). 인덱스가 삭제 때마다 밀리므로 내림차순으로 지운다.
function deleteSelection() {
  if (state.selection.length === 0) return;
  if (state.mol.atoms.length - state.selection.length < 1) {
    toast('전부 지울 수는 없습니다', 'err');
    return;
  }
  pushUndo();
  for (const i of [...state.selection].sort((a, b) => b - a)) removeAtom(state.mol, i);
  state.selection = [];
  state.snapState = {};
  playClick(220);
  checkSnaps();
  render();
}

// 선택 원자를 복제한다(Ctrl+D). model.duplicateAtoms가 위치·내부 결합을 그대로 복사한다.
function duplicateSelection() {
  if (state.selection.length === 0) { toast('복제할 원자를 선택하세요', 'err'); return; }
  pushUndo();
  state.selection = duplicateAtoms(state.mol, state.selection);
  checkSnaps();
  render();
  toast('복제됨');
}

// 조작 후 VSEPR 만족 상태가 false -> true로 바뀐 중심에만 완성 연출을 낸다.
// 원소의 정상 원자가(MAX_VALENCE)에 도달한 중심만 평가한다 — 그 전 단계의 중간 배위수는
// typeAtom이 임시로 sp/sp2(C_1/C_2 등)로 분류해 UFF 이상각과 우연히 일치하며, 메탄을
// 한 개씩 조립하는 도중 "직선형/평면 삼각형 완성"이 매번 오탐으로 울리는 원인이었다.
function checkSnaps() {
  const next = {};
  for (let i = 0; i < state.mol.atoms.length; i++) {
    const n = neighbors(state.mol, i).length;
    const max = MAX_VALENCE[state.mol.atoms[i].el];
    if (n >= 2 && max !== undefined && n >= max) next[i] = vseprCheck(state.mol, i).satisfied;
  }
  for (const idx of newSnapEvents(state.snapState, next)) {
    const v = vseprCheck(state.mol, Number(idx));
    playClick(1320); // 성공은 높은 음
    toast(`${state.mol.atoms[idx].el}${idx}: ${geometryName(state.mol, Number(idx))} 완성 (${v.ideal}°)`);
  }
  state.snapState = next;
}

$('scan').onclick = () => {
  if (state.selection.length !== 4) { toast('원자 4개를 순서대로 선택하세요', 'err'); return; }
  if (!isTorsionChain(state.mol, state.selection)) {
    toast('이어진 원자 4개(i-j-k-l)를 선택하세요', 'err');
    return;
  }
  try {
    drawScan(scanDihedral(state.mol, state.selection, {
      stepDeg: Number($('scan-step').value),
      relax: $('scan-relax').checked,
    }));
  } catch (err) {
    toast(err.message, 'err');
  }
};

$('dihedral').oninput = (ev) => {
  if (state.selection.length !== 4) return;
  if (!setDihedral(state.mol, state.selection, Number(ev.target.value))) {
    toast('고리 결합은 회전할 수 없습니다', 'err');
    return;
  }
  render();
};

$('minimize').onclick = () => {
  const r = minimize(state.mol, { recordTrajectory: true });
  state.trajectory = r.trajectory;
  const slider = $('replay');
  slider.max = Math.max(0, r.trajectory.length - 1);
  slider.value = slider.max;
  slider.disabled = r.trajectory.length === 0;
  $('replay-info').textContent =
    `${r.steps} 스텝 · ${r.energyBefore.toFixed(2)} → ${r.energyAfter.toFixed(2)} kcal/mol`;
  toast(`최적화 완료: ${r.energyBefore.toFixed(2)} → ${r.energyAfter.toFixed(2)} kcal/mol`);
  checkSnaps();
  render();
};

$('replay').oninput = (ev) => {
  const frame = state.trajectory?.[Number(ev.target.value)];
  if (!frame) return;
  frame.positions.forEach((p, i) => { state.mol.atoms[i].pos = [...p]; });
  $('replay-info').textContent = `프레임 ${ev.target.value} · ${frame.energy.toFixed(2)} kcal/mol`;
  render();
};

function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

for (const [id, fn, ext] of [
  ['export-xyz', toXYZ, 'xyz'], ['export-mol', toMolBlock, 'mol'], ['export-pdb', toPDB, 'pdb'],
]) {
  $(id).onclick = () => download(fn(state.mol), `mol-craft.${ext}`);
}

$('share').onclick = async () => {
  const url = `${location.origin}${location.pathname}#s=${await encodeStateAsync(state.mol)}`;
  await navigator.clipboard.writeText(url);
  toast('링크 복사됨');
};

// 갤러리 제목은 익명 사용자 입력이다. innerHTML에 넣기 전 반드시 이스케이프한다.
const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 단축 링크: 실패하면 해시 링크로 조용히 폴백한다. 사용자는 어쨌든 링크를 얻는다.
$('share-short').onclick = async () => {
  const payload = await encodeStateAsync(state.mol);
  const title = PRESETS[$('preset').value]?.name ?? '';
  const id = await putShared(payload, title);
  const url = id
    ? `${location.origin}${location.pathname}#g=${id}`
    : `${location.origin}${location.pathname}#s=${payload}`;
  await navigator.clipboard.writeText(url);
  toast(id ? '단축 링크 복사됨' : '서버 응답 없음 — 전체 링크로 복사됨', id ? 'ok' : 'err');
};

// 갤러리는 공유가 켜져 있을 때만 노출한다.
if (isShareEnabled()) {
  $('gallery-section').hidden = false;
  listGallery(20).then((rows) => {
    $('gallery').innerHTML = rows.length
      ? rows.map((r) => `<div><a href="#g=${r.id}">${escapeHtml(r.title) || r.id}</a></div>`).join('')
      : '아직 공유된 구조가 없습니다';
  });
}

// ---- 도구 배선 -----------------------------------------------------------
// 클릭 동작은 이제 모드(학습/연구)가 아니라 도구(선택/붙이기/지우개)가 결정한다.
// 3Dmol의 setClickable은 버리고 pickAtom(pageX/Y 기반)으로 직접 히트테스트한다 —
// 붙이기 도구의 실시간 고스트 미리보기와 박스 선택이 같은 좌표계를 써야 어긋나지 않는다.

const viewerEl = $('viewer');

function setTool(tool) {
  state.tool = tool;
  clearGhost();
  ghost2d = null;
  state.pendingBond = null;
  bondHover2d = null;
  document.querySelectorAll('#tools button').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  document.querySelectorAll('#palette button').forEach((b) => b.classList.toggle('active', tool === 'place' && b.dataset.el === state.element));
}

$('tool-select').onclick = () => setTool('select');
$('tool-erase').onclick = () => setTool('erase');
$('tool-bond').onclick = () => setTool('bond');

$('palette').innerHTML = ELEMENTS.map((el, k) =>
  `<button data-el="${el}" title="${k < 9 ? `단축키 ${k + 1}` : ''}">${el}</button>`).join('');
$('palette').onclick = (ev) => {
  const btn = ev.target.closest('button[data-el]');
  if (!btn) return;
  state.element = btn.dataset.el;
  state.slot = 0;
  setTool('place');
};

// ---- 붙이기 고스트 미리보기 -----------------------------------------------
// idealDirection/canBond를 attachAtom과 똑같이 호출해 "미리 보여준 자리 = 실제로 붙는 자리"를
// 보장한다. render()는 energy()(O(n²) vdW 포함)를 부르므로 pointermove(고빈도)에서는 절대
// 쓰지 않고, addSphere/addLine/removeShape만으로 가볍게 갱신한다.
let ghostShapes = [];
let blinkOn = true;
setInterval(() => { blinkOn = !blinkOn; if (state.ghost) drawGhost(); }, 400);

// 초록: 정상. 주황: 붙지만 초원자가 경고. 빨강: 못 붙음(원자가 포화 등).
// 마인크래프트가 조준한 블록에 검은 외곽선을 그리듯, 조준 중인 원자에 하늘색 와이어프레임
// 구를 씌우고 남은 빈 자리를 전부 흐리게 띄운다 — 활성 자리 하나만 깜빡인다.
function drawGhost() {
  for (const s of ghostShapes) viewer.removeShape(s);
  const g = state.ghost;
  const a = state.mol.atoms[g.anchor].pos;
  const color = !g.ok ? '#dc2626' : g.reason === 'ok' ? '#22c55e' : '#f59e0b';
  const opacity = blinkOn ? 0.6 : 0.22;
  ghostShapes = [
    viewer.addSphere({
      center: { x: a[0], y: a[1], z: a[2] }, radius: 0.44,
      color: '#38bdf8', opacity: 0.9, wireframe: true,
    }),
  ];
  // 활성이 아닌 빈 자리들 — 여기로도 붙일 수 있다는 것을 보여준다(R 키/휠로 전환).
  if (g.ok && g.slots.length > 1) {
    const len = Math.hypot(g.pos[0] - a[0], g.pos[1] - a[1], g.pos[2] - a[2]);
    g.slots.forEach((d, k) => {
      if (k === g.slot) return;
      const p = add(a, scale(d, len));
      ghostShapes.push(viewer.addSphere({
        center: { x: p[0], y: p[1], z: p[2] }, radius: 0.18, color, opacity: 0.16,
      }));
    });
  }
  ghostShapes.push(
    viewer.addSphere({ center: { x: g.pos[0], y: g.pos[1], z: g.pos[2] }, radius: 0.32, color, opacity }),
    viewer.addLine({ start: { x: a[0], y: a[1], z: a[2] }, end: { x: g.pos[0], y: g.pos[1], z: g.pos[2] }, color, dashed: true }),
  );
  viewer.render();
}

// 활성 빈 자리를 step만큼 돌린다. state.ghost를 다시 계산해야 pos/색이 함께 갱신된다.
function cycleSlot(step) {
  if (!state.ghost) return;
  state.slot = state.ghost.slot + step;
  state.ghost = previewAttach(state.ghost.anchor, state.element);
  state.slot = state.ghost.slot;
  blinkOn = true;
  drawGhost();
}

function clearGhost() {
  if (!state.ghost && ghostShapes.length === 0) return;
  state.ghost = null;
  for (const s of ghostShapes) viewer.removeShape(s);
  ghostShapes = [];
  viewer.render();
}

// canBond는 실존 원자 쌍만 받으므로, attachAtom과 같은 시험 삽입/되돌리기 패턴으로
// "지금 이 앵커에 이 원소를 붙이면 어떻게 되는지"를 부작용 없이 미리 계산한다.
// openSlots가 남은 자리를 전부 주므로 state.slot으로 그중 하나를 활성으로 고른다 —
// 미리 보여준 자리가 곧 실제로 붙는 자리라는 보장은 그대로 유지된다(같은 배열을 쓴다).
function previewAttach(anchor, el) {
  const a = state.mol.atoms[anchor].pos;
  const slots = openSlots(state.mol, anchor);
  const slot = ((state.slot % slots.length) + slots.length) % slots.length;
  const idx = addAtom(state.mol, el, add(a, scale(slots[slot], 2.5)));
  const check = canBond(state.mol, anchor, idx);
  state.mol.atoms.pop();
  const len = check.ok ? check.targetLength : 1.6;
  return { anchor, slots, slot, pos: add(a, scale(slots[slot], len)), ok: check.ok, reason: check.reason, el };
}

viewerEl.addEventListener('pointermove', (ev) => {
  if (state.tool !== 'place') return;
  const anchor = pickAtom(ev.pageX, ev.pageY, 40);
  if (anchor === -1) { clearGhost(); return; }
  // 다른 원자를 조준하면 슬롯 선택을 처음으로 되돌린다 — 앵커마다 자리 개수가 다르다.
  if (state.ghost?.anchor !== anchor) state.slot = 0;
  state.ghost = previewAttach(anchor, state.element);
  blinkOn = true;
  drawGhost();
});
viewerEl.addEventListener('pointerleave', () => clearGhost());

// ---- 박스 선택 -------------------------------------------------------------
// 빈 공간에서 드래그 시작 시 캡처 단계에서 3Dmol의 궤도회전을 가로챈다(휠 보정과 같은 트릭).
const boxEl = $('boxselect');
let boxStart = null;

document.addEventListener('pointerdown', (ev) => {
  if (!viewerEl.contains(ev.target) || state.tool !== 'select') return;
  if (pickAtom(ev.pageX, ev.pageY, 24) !== -1) return; // 원자 위는 일반 클릭으로 처리
  ev.preventDefault();
  ev.stopPropagation();
  boxStart = { x: ev.pageX, y: ev.pageY, shift: ev.shiftKey };
  document.addEventListener('pointermove', onBoxMove);
  document.addEventListener('pointerup', onBoxUp);
}, { capture: true });

function onBoxMove(ev) {
  const rect = viewerEl.getBoundingClientRect();
  const x = Math.min(boxStart.x, ev.pageX) - rect.left - window.scrollX;
  const y = Math.min(boxStart.y, ev.pageY) - rect.top - window.scrollY;
  Object.assign(boxEl.style, {
    display: 'block', left: `${x}px`, top: `${y}px`,
    width: `${Math.abs(ev.pageX - boxStart.x)}px`, height: `${Math.abs(ev.pageY - boxStart.y)}px`,
  });
}

function onBoxUp(ev) {
  document.removeEventListener('pointermove', onBoxMove);
  document.removeEventListener('pointerup', onBoxUp);
  boxEl.style.display = 'none';
  const dragged = Math.abs(ev.pageX - boxStart.x) > 3 || Math.abs(ev.pageY - boxStart.y) > 3;
  if (dragged) {
    const [x0, x1] = [Math.min(boxStart.x, ev.pageX), Math.max(boxStart.x, ev.pageX)];
    const [y0, y1] = [Math.min(boxStart.y, ev.pageY), Math.max(boxStart.y, ev.pageY)];
    const hits = [];
    state.mol.atoms.forEach((atom, i) => {
      const s = viewer.modelToScreen({ x: atom.pos[0], y: atom.pos[1], z: atom.pos[2] });
      if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) hits.push(i);
    });
    state.selection = boxStart.shift ? [...new Set([...state.selection, ...hits])] : hits;
    render();
  }
  boxStart = null;
}

// 지우개/선택 도구의 클릭 동작. 3D 뷰어와 2D SVG 클릭 핸들러가 이 함수를 공유한다
// (붙이기는 앵커를 찾는 방식이 서로 달라 각자 처리하지만, 이 분기만은 절대 두 군데
// 따로 두지 않는다 — 나중에 어긋나는 원인이 된다).
function handleAtomClick(hit, shiftKey) {
  if (state.tool === 'erase') { deleteAtom(hit); return; }
  if (state.tool === 'bond') { handleBondClick(hit); return; }
  if (shiftKey) toggleSelect(hit);
  else { state.selection = [hit]; render(); }
}

// 결합 도구로 결합선을 클릭하면 차수를 1 -> 2 -> 3 -> 1로 돌린다(원자를 클릭하면
// 기존대로 두 원자를 잇는다 — 같은 도구 안에서 클릭 대상으로만 갈린다).
function handleBondOrderClick(bond) {
  const r = cycleBondOrder(state.mol, bond);
  if (!r.ok) {
    toast(REASON_MSG[r.reason] ?? '차수를 바꿀 수 없습니다', 'err');
    playClick(180);
    return;
  }
  // cycleBondOrder가 이미 제자리에서 바꿔버렸으므로, 되돌리기 스냅샷은 되돌린 뒤에 찍는다.
  bond.order = r.order === 1 ? 3 : r.order - 1;
  pushUndo();
  bond.order = r.order;
  playClick(660 + r.order * 220);
  toast(`결합 차수 ${r.order}`);
  checkSnaps();
  render();
}

// '결합' 도구: 첫 클릭은 앵커를 대기시키고, 두 번째 클릭이 그 앵커를 실제로 잇는다
// (같은 원자를 다시 클릭하면 대기 취소). 기존 원자 두 개를 잇는 유일한 경로 — 이게
// 있어야 사슬을 고리로 닫을 수 있다(findRings/layout은 이미 임의 고리 위상을 다룬다).
function handleBondClick(hit) {
  if (state.pendingBond === hit) { state.pendingBond = null; bondHover2d = null; render(); return; }
  if (state.pendingBond === null) { state.pendingBond = hit; render(); return; }
  const anchor = state.pendingBond;
  state.pendingBond = null;
  bondHover2d = null;
  const check = canBond(state.mol, anchor, hit);
  if (!check.ok) {
    toast(REASON_MSG[check.reason] ?? '결합할 수 없습니다', 'err');
    playClick(180);
    render();
    return;
  }
  if (!bondDistanceOk(state.mol, anchor, hit)) {
    toast(REASON_MSG['too-far'], 'err');
    playClick(180);
    render();
    return;
  }
  pushUndo();
  addBond(state.mol, anchor, hit, 1);
  // 고리를 닫으면 두 끝이 아직 제 결합 길이가 아니다 — 붙이기와 달리 위치를 새로 정하는
  // 조작이 아니므로, 여기서만 완화를 돌려 실제 구조로 만든다(붙이기는 "본 자리에 그대로
  // 박힌다"를 지켜야 하므로 자동 완화하지 않는다).
  minimize(state.mol, { maxSteps: 200 });
  playClick(880);
  checkSnaps();
  render();
}

// ---- 일반 클릭(드래그 없는 pointerup) -------------------------------------
viewerEl.addEventListener('click', (ev) => {
  if (state.tool === 'place') {
    if (!state.ghost) return;
    if (state.ghost.ok) attachAtom(state.ghost.anchor, { dir: state.ghost.slots[state.ghost.slot] });
    else toast(REASON_MSG[state.ghost.reason] ?? '결합할 수 없습니다', 'err');
    return;
  }
  const hit = pickAtom(ev.pageX, ev.pageY, 24);
  if (hit === -1) {
    if (state.tool === 'bond') {
      const b = pickBond(ev.pageX, ev.pageY);
      if (b) handleBondOrderClick(b);
    }
    return;
  }
  handleAtomClick(hit, ev.shiftKey);
});

// 마인크래프트 규약: 좌클릭 배치, 우클릭 제거. 도구를 바꾸지 않고도 즉시 지울 수 있다.
// 3D와 2D가 히트테스트 방식만 다르고 동작은 같으므로 deleteAtom 하나를 공유한다.
viewerEl.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  if (state.flat) return; // 2D가 위에 덮여 있으면 아래 핸들러가 처리한다
  const hit = pickAtom(ev.pageX, ev.pageY, 24);
  if (hit !== -1) deleteAtom(hit);
});

// ---- 2D 골격식 화면에서의 레고 조립(4단계) ---------------------------------
// state.tool/state.element/state.selection/undo 스택을 3D와 완전히 재사용한다 — 새
// 상호작용 모델을 만들지 않는다. 히트테스트는 SVG가 그린 data-atom 히트타깃에 위임한다
// (3D의 pickAtom 좌표 역산은 3Dmol이 hit-test API를 안 줘서 어쩔 수 없이 쓴 우회로다).
const sketch2dEl = $('sketch2d');
let ghost2d = null; // 3D의 state.ghost와 분리된 2D 전용 상태.
let blink2dOn = true;
setInterval(() => { blink2dOn = !blink2dOn; if (state.flat && ghost2d) renderFlat(); }, 400);

// canBond는 위치가 아니라 원자가·타입만 보므로(snap.js 참고) 좌표 없는 시험 삽입으로 충분하다.
function previewAttach2D(anchor, el) {
  const idx = addAtom(state.mol, el, [0, 0, 0]);
  const check = canBond(state.mol, anchor, idx);
  state.mol.atoms.pop();
  return { anchorIdx: anchor, el, ok: check.ok, reason: check.reason };
}

// render()(energy() 포함, O(n²))를 부르지 않는 경량 갱신 — pointermove/깜빡임 전용.
function renderFlat() {
  if (!state.flat) return;
  const ghost = ghost2d && { ...ghost2d, opacity: blink2dOn ? 0.6 : 0.22 };
  const bondPreview = state.tool === 'bond' && state.pendingBond !== null
    ? { a: state.pendingBond, b: bondHover2d, ok: bondHover2d == null ? undefined : canBond(state.mol, state.pendingBond, bondHover2d).ok }
    : null;
  sketch2dEl.innerHTML = renderSVG(state.mol, { ghost, bondPreview, selection: state.selection });
}

// sketch2d.layout()의 nextChainDir로 새 원자의 2D 좌표를 구해 그대로 pos([x,y,0])로 쓴다
// (attachAtom 주석 참고). 방향 계산 자체는 layout()/고스트 미리보기와 동일 함수를 쓴다.
function attachAtom2D(anchor) {
  const pos = layout(state.mol);
  if (!pos.has(anchor)) return;
  const dir = nextChainDir(state.mol, anchor, pos, 1);
  const p = pos.get(anchor);
  attachAtom(anchor, { pos2d: [p[0] + dir[0], p[1] + dir[1]] });
}

sketch2dEl.addEventListener('pointermove', (ev) => {
  if (!state.flat || state.tool !== 'place') return;
  const hit = ev.target.closest('[data-atom]');
  if (!hit) { if (ghost2d) { ghost2d = null; renderFlat(); } return; }
  ghost2d = previewAttach2D(Number(hit.dataset.atom), state.element);
  blink2dOn = true;
  renderFlat();
});
sketch2dEl.addEventListener('pointerleave', () => {
  if (!state.flat || !ghost2d) return;
  ghost2d = null;
  renderFlat();
});

// '결합' 도구: 앵커를 찍은 뒤 커서가 올라간 원자를 bondHover2d에 담아 점선 미리보기를
// 그린다(renderSVG의 bondPreview 옵션 — ghost와는 별개 구조, "새 원자 붙이기"가 아니라
// "기존 원자끼리 잇기"라 의미가 다르다).
sketch2dEl.addEventListener('pointermove', (ev) => {
  if (!state.flat || state.tool !== 'bond' || state.pendingBond === null) return;
  const hit = ev.target.closest('[data-atom]');
  const idx = hit ? Number(hit.dataset.atom) : null;
  if (idx === bondHover2d) return;
  bondHover2d = idx;
  renderFlat();
});
sketch2dEl.addEventListener('pointerleave', () => {
  if (!state.flat || bondHover2d === null) return;
  bondHover2d = null;
  renderFlat();
});

sketch2dEl.addEventListener('click', (ev) => {
  if (!state.flat) return;
  const hit = ev.target.closest('[data-atom]');
  if (!hit) {
    const bh = ev.target.closest('[data-bond]');
    if (bh && state.tool === 'bond') {
      const [i, j] = bh.dataset.bond.split('-').map(Number);
      const bond = state.mol.bonds.find((b) => b.i === i && b.j === j);
      if (bond) handleBondOrderClick(bond);
    }
    return;
  }
  const idx = Number(hit.dataset.atom);
  if (state.tool === 'place') {
    if (!ghost2d) return;
    if (ghost2d.ok) attachAtom2D(idx);
    else toast(REASON_MSG[ghost2d.reason] ?? '결합할 수 없습니다', 'err');
    ghost2d = null;
    return;
  }
  handleAtomClick(idx, ev.shiftKey);
});

sketch2dEl.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  const hit = ev.target.closest('[data-atom]');
  if (hit) deleteAtom(Number(hit.dataset.atom));
});

// ---- 키보드: Esc 해제, Ctrl+A 전체선택, Del 삭제, Ctrl+D 복제, Ctrl+Z 실행취소 ----
document.addEventListener('keydown', (ev) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  if (ev.key === 'Escape') { state.selection = []; state.pendingBond = null; bondHover2d = null; render(); return; }
  if (ev.key === 'r' || ev.key === 'R') { cycleSlot(1); return; }
  // 원소 핫바: 숫자키 1~9가 팔레트 앞 9개 원소에 대응한다(마인크래프트 핫바).
  if (/^[1-9]$/.test(ev.key) && !ev.ctrlKey && !ev.metaKey) {
    const el = ELEMENTS[Number(ev.key) - 1];
    if (el) { state.element = el; state.slot = 0; setTool('place'); toast(`${el} 선택`); }
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'a') { ev.preventDefault(); state.selection = state.mol.atoms.map((_, i) => i); render(); return; }
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z') { ev.preventDefault(); undo(); return; }
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'd') { ev.preventDefault(); duplicateSelection(); return; }
  if (ev.key === 'Delete' || ev.key === 'Backspace') deleteSelection();
});

$('undo').onclick = undo;
$('duplicate').onclick = duplicateSelection;

// 2D 보기: sketch2d.renderSVG가 그리는 진짜 골격 구조식으로 3D 뷰어를 덮는다(3Dmol
// 스타일 흉내가 아니라 완전히 별도 SVG 렌더러 — layout()이 만든 좌표를 그대로 그린다).
// 3D -> 2D는 좌표만 안 그릴 뿐 데이터는 그대로라 변환이 필요 없다. 2D -> 3D로 돌아갈 때는
// syncHydrogens()를 한 번 불러 완전한 분자로 만든다(골격식 규칙 3: 해석 = 부족한 원자가를
// 채우는 것) — 지금은 항상 이미 포화 상태라 사실상 무연산이지만, 나중에 2D에서 탄소
// 골격만 그리고 3D로 넘어오는 편집 흐름이 생기면 이 한 줄이 그 완성을 담당한다.
$('view2d').onclick = () => {
  state.flat = !state.flat;
  document.body.dataset.flat = String(state.flat);
  $('sketch2d').hidden = !state.flat;
  $('view2d').textContent = state.flat ? '3D 보기' : '2D 보기(골격식)';
  $('view2d').setAttribute('aria-pressed', String(state.flat));
  if (!state.flat) { syncHydrogens(state.mol); minimize(state.mol, { maxSteps: 120 }); }
  render();
};

$('mode').onchange = (ev) => {
  state.mode = ev.target.value;
  document.body.dataset.mode = state.mode;
  render();
};

document.body.dataset.mode = state.mode;
setTool('select');

$('preset').innerHTML = Object.entries(PRESETS)
  .map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
$('preset').onchange = (ev) => {
  state.mol = loadPreset(ev.target.value);
  state.selection = [];
  state.snapState = {};
  checkSnaps();
  render();
  const note = PRESETS[ev.target.value].note;
  if (note) toast(note);
};

// 진입 시 우선순위: URL 해시 > localStorage > 기본 프리셋. 손상된 링크/저장값은
// 조용히 무시하고 다음 우선순위로 넘어간다.
// decodeStateAsync는 압축 해시일 때만 실제로 await하며(비압축·해시 없음 경로는
// 동기로 즉시 완료), 두 분기 모두 checkSnaps()/render()를 정확히 한 번만 호출해
// 잘못된 분자가 먼저 그려지는 플래시를 막는다.
async function restoreOnLoad() {
  if (location.hash.startsWith('#g=')) {
    const row = await getShared(location.hash.slice(3));
    if (row) {
      try { state.mol = await decodeStateAsync(row.payload); } catch { /* 손상된 데이터는 무시 */ }
    } else {
      toast('공유 구조를 찾을 수 없습니다', 'err');
    }
  } else if (location.hash.startsWith('#s=')) {
    try { state.mol = await decodeStateAsync(location.hash.slice(3)); } catch { /* 손상된 링크는 무시 */ }
  } else {
    state.mol = restoreLocal() ?? state.mol;
  }
  // 초기 로드 시점의 VSEPR 만족 상태를 baseline으로 기록해, 이후 첫 실제 클릭에서
  // 이미 완성돼 있던 중심이 오탐(false positive)으로 재발화하지 않게 한다.
  checkSnaps();
  render();
}
restoreOnLoad();
