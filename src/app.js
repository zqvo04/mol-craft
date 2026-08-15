import { toXYZ, toMolBlock, toPDB, encodeState, decodeState, encodeStateAsync, decodeStateAsync } from './io.js';
import { energy, minimize, typeAtom, cachedTerms } from './uff.js';
import {
  neighbors, bondOrderSum, measure, addAtom, addBond, removeAtom, branchAtoms, setDihedral, duplicateAtoms, isTorsionChain, pruneAtom, aromatize,
} from './model.js';
import {
  canBond, vseprCheck, newSnapEvents, idealDirection, openSlots, stability, hudSummary, syncHydrogens,
  geometryName, bondDistanceOk, cycleBondOrder, slotKinds,
} from './snap.js';
import { MAX_VALENCE, CPK_COLOR } from './params.js';
import { loadPreset, PRESETS, RING_TEMPLATES, STRUCTURE_LIBRARY, computeRingPlacement, insertRingTemplate, validateStructureAttachment } from './presets.js';
import { add, scale, sub, rotateAround } from './geom.js';
import { isShareEnabled, putShared, getShared, listGallery } from './share.js';
import { renderSVG, layout, nextChainDir } from './sketch2d.js';
import { initCatalog } from './catalog.js';
import { amideSites, compareStructuralIsomerCandidate, predictedIrBands, protonNmrSignals, scanTorsion, stereochemicalAssignments, summarizeStructure, torsionInterpretation } from './learning.js';
import { createMenuSelect } from './menu-select.js';

const ELEMENTS = ['H', 'C', 'N', 'O', 'F', 'S', 'P', 'Cl', 'Si', 'B', 'Br', 'I'];

const state = {
  mol: loadPreset('methane'),
  colorBy: 'element', // 'element' | 'strain' — 조립 중에는 원소 구분이 우선이라 원소 색이 기본이다
  tool: 'view', // 'view' | 'select' | 'place' | 'erase' | 'bond' — 클릭 동작.
  element: 'C',
  selection: [],
  snapState: {},
  flat: false,
  ghost: null, // { anchor, slots, slot, pos, ok, reason, el } — slots는 남은 빈 자리 전부
  slot: 0,     // 활성 빈 자리 인덱스. R 키/휠로 순환한다(마인크래프트의 배치 방향 선택에 해당)
  azimuth: 0,  // 앵커에 이웃이 하나뿐일 때(자리가 사실상 하나) R 키/휠로 돌리는 방위각(도).
               // 자리가 여러 개면 대신 slot을 순환한다 — 두 조작은 서로 배타적이다.
  pendingBond: null, // 'bond' 도구에서 첫 번째로 찍은 원자 인덱스(대기 중인 앵커) — 고리 닫기용
  ringTemplate: 'benzene', // 내부 삽입 도구가 사용할 구조 단위 — RING_TEMPLATES의 키
  ringTwist: 0, // 구조 단위의 앵커 결합축 회전 각도. R 키로 30°씩 회전한다.
  ringGhost: null, // { anchor, placed, ok } — 구조 단위 고스트 미리보기
  undoStack: [],
  isomerReference: null,
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

// 다크모드 토글(비-모듈 인라인 스크립트, index.html)이 테마를 바꾸면 쏘는 이벤트.
// setStyle의 colorfunc와 달리 배경색은 생성 시 옵션이라 직접 갱신해줘야 한다.
document.addEventListener('mol-craft-theme-change', () => {
  viewer.setBackgroundColor(getComputedStyle(document.body).backgroundColor);
  viewer.render();
});

// 휠 방향 보정. 3Dmol이 뷰어 요소 자체(target 단계)에 이미 휠 리스너를 붙여놓았으므로
// 같은 요소에 나중에 리스너를 달아도 순서를 못 이긴다. document에 캡처 단계로 걸면
// 이벤트가 target에 닿기 전에 먼저 잡혀 3Dmol 기본 동작을 완전히 대체할 수 있다.
document.addEventListener('wheel', (ev) => {
  if (!document.getElementById('viewer').contains(ev.target)) return;
  ev.preventDefault();
  ev.stopPropagation();
  // 붙이기로 원자를 조준 중이면 휠은 확대가 아니라 "붙일 자리 바꾸기"다(마인크래프트 핫바 감각).
  // 앵커의 이웃이 하나뿐이면(-OH의 H처럼 자리가 사실상 하나) 순환할 다른 자리가 없으므로
  // 대신 그 자리를 결합축 둘레로 돌린다(방위각).
  if (state.tool === 'place' && state.ghost && neighbors(state.mol, state.ghost.anchor).length === 1) {
    rotateAzimuth(ev.deltaY < 0 ? -AZIMUTH_STEP : AZIMUTH_STEP);
    return;
  }
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

// 볼-스틱 모형의 구 반지름(Å). 가장 짧은 결합(O-H 0.96 Å)에서도 구 두 개가 막대를
// 완전히 덮지 않도록 잡은 값이다 — 0.30 × 2 = 0.60 < 0.96.
const ATOM_RADIUS = 0.30;

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
let selectionShapes = []; // '결합' 도구의 대기 앵커 강조 구 — 이 배열만 지웠다 다시 그린다.
let overlayLabels = [];   // 선택 순서 배지 + 경고 배지. 셰이프와 수명주기가 달라 따로 관리한다.
let bondHover2d = null; // 'bond' 도구 + 2D: pendingBond 찍은 뒤 커서가 올라간 두 번째 원자(고리 닫기 미리보기용)
let warnAtoms = [];      // [{ i, level }] — 경고 글로우를 띄울 원자. render()가 채운다.
let warnGlowEls = [];    // 재사용하는 .warnglow div들. 개수가 바뀔 때만 다시 만든다.

function render() {
  const e = energy(state.mol, cachedTerms(state.mol));
  state.lastEnergy = e;
  viewer.removeAllModels();
  // removeAllShapes()는 쓰지 않는다 — 붙이기 고스트까지 함께 지워버리기 때문이다.
  // 이 함수가 만든 대기 앵커 강조 구와 오버레이 배지만 추적해서 그것만 지운다.
  for (const s of selectionShapes) viewer.removeShape(s);
  selectionShapes = [];
  for (const l of overlayLabels) viewer.removeLabel(l);
  overlayLabels = [];
  viewer.addModel(toXYZ(state.mol), 'xyz');

  const vmax = Math.max(0.5, ...e.perAtom); // 0.5 kcal/mol 미만 차이는 노이즈로 본다
  // 원자마다 setStyle을 부르면 3Dmol이 호출마다 전체 원자를 훑어서 O(n²)가 된다 —
  // 원자 수십 개만 돼도 클릭·드래그가 눈에 띄게 끊겼다. 색만 원자별로 다르므로
  // colorfunc 하나로 넘겨 setStyle은 딱 한 번만 부른다(serial = XYZ 모델의 0-based 인덱스).
  // 예전엔 색이 응력 히트맵뿐이고 반지름도 전부 0.30이라 H·C·O가 화면에서 완전히 똑같이
  // 보였다. 조립 중에는 원소 구분이 우선이므로 CPK 색이 기본이고, 응력 히트맵은 헤더
  // 셀렉트로 전환한다. 반지름은 이미 있는 공유결합 반지름을 그대로 쓴다(H가 눈에 띄게 작다).
  const colors = state.mol.atoms.map((a, i) =>
    (state.colorBy === 'strain' ? strainColor(e.perAtom[i], vmax) : CPK_COLOR[a.el] ?? '#909090'));
  // 반지름은 원소와 무관한 고정값이다. 3Dmol의 sphere 스타일에는 원자별 반지름을 넘길
  // 방법이 없고(radiusfunc 같은 속성은 존재하지 않는다 — 예전에 그걸 넘겼다가 조용히
  // 무시당했고, radius가 없으면 반데르발스 반지름으로 떨어져 구가 결합 막대를 통째로
  // 삼킨 공간채움 모형이 됐다), 원자별로 setStyle을 나눠 부르면 O(n²)로 되돌아간다.
  // 원소 구분은 CPK 색이 맡고, 여기서는 결합이 보이는 볼-스틱 비율만 지킨다.
  viewer.setStyle({}, {
    sphere: { radius: ATOM_RADIUS, colorfunc: (atom) => colors[atom.serial] },
    stick: { radius: 0.14, colorfunc: (atom) => colors[atom.serial] },
  });

  // 선택 표시는 원자를 덮는 반투명 구가 아니라 원자 위에 뜨는 순서 배지다 — 구는 원소 색과
  // 모양을 가렸고, 무엇보다 "몇 번째로 고른 원자인지"를 보여주지 못했다(이면각은 순서가
  // 의미를 갖는다: i-j-k-l).
  state.selection.forEach((i, order) => {
    const p = state.mol.atoms[i].pos;
    overlayLabels.push(viewer.addLabel(String(order + 1), {
      position: { x: p[0], y: p[1] + ATOM_RADIUS + 0.30, z: p[2] },
      backgroundColor: '#eab308', backgroundOpacity: 0.95,
      fontColor: '#1c1917', fontSize: 12, borderThickness: 0,
      alignment: 'center', inFront: true,
    }));
  });
  // '결합' 도구로 찍어둔 대기 중인 앵커는 하늘색 구로 강조(선택 강조와 같은 패턴, 다른 색).
  if (state.pendingBond !== null) {
    const p = state.mol.atoms[state.pendingBond].pos;
    selectionShapes.push(viewer.addSphere({
      center: { x: p[0], y: p[1], z: p[2] }, radius: 0.5, color: '#38bdf8', opacity: 0.4,
    }));
  }
  const st = stability(state.mol);
  state.lastStability = st;
  const worst = new Map();
  for (const x of st.issues) {
    if (worst.get(x.atom) !== 'danger') worst.set(x.atom, x.level);
  }
  // 경고는 3D 셰이프가 아니라 화면 위 CSS 글로우로 낸다(syncWarnGlows). 반투명 구는
  // 3Dmol 조명에 색이 씻겨 회백색 얼룩이 됐고, P(#ff8000)·S(#e6c53d)처럼 CPK 색이
  // 주황·노랑인 원소에서는 신호와 원소색이 아예 구분되지 않았다.
  warnAtoms = [...worst].map(([i, level]) => ({ i, level }));
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
  syncWarnGlows();
  updateToolHint();
  saveLocal();
}

// 문제 원자의 3D 좌표를 화면 좌표로 옮겨 글로우 div를 얹는다. modelToScreen은 페이지
// 좌표(rect+scroll 포함)를 돌려주므로 뷰어 rect와 스크롤을 빼야 한다(pickAtom과 같은 규칙).
// div 개수가 바뀔 때만 DOM을 다시 만들고, 그 외에는 left/top만 갱신한다.
function syncWarnGlows() {
  const layer = $('warnlayer');
  if (warnGlowEls.length !== warnAtoms.length) {
    layer.innerHTML = '';
    warnGlowEls = warnAtoms.map(() => layer.appendChild(document.createElement('div')));
  }
  if (warnAtoms.length === 0) return;
  const rect = viewerEl.getBoundingClientRect();
  warnAtoms.forEach((w, k) => {
    const p = state.mol.atoms[w.i]?.pos;
    const el = warnGlowEls[k];
    if (!p) { el.style.display = 'none'; return; }
    const s = viewer.modelToScreen({ x: p[0], y: p[1], z: p[2] });
    el.className = `warnglow ${w.level}`;
    el.style.display = 'block';
    el.style.left = `${s.x - rect.left - window.scrollX}px`;
    el.style.top = `${s.y - rect.top - window.scrollY}px`;
  });
}

// 카메라가 움직여도 글로우가 따라붙어야 하는데 3Dmol에는 카메라 변경 이벤트가 없다.
// 글로우가 있을 때만 도는 rAF 루프로 매 프레임 위치를 다시 잡는다(div 몇 개짜리 작업이라
// WebGL 렌더에 비하면 비용이 없다시피 하다).
function warnGlowLoop() {
  if (warnAtoms.length) syncWarnGlows();
  requestAnimationFrame(warnGlowLoop);
}
requestAnimationFrame(warnGlowLoop);

const $ = (id) => document.getElementById(id);

function setInspectorTab(tab) {
  document.querySelectorAll('[data-inspector-tab]').forEach((button) => {
    const active = button.dataset.inspectorTab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $('analysis-panel').hidden = tab !== 'analysis';
  $('learning-panel').hidden = tab !== 'learning';
}

document.querySelector('[data-inspector-tabs]').addEventListener('click', (ev) => {
  const button = ev.target.closest('[data-inspector-tab]');
  if (button) setInspectorTab(button.dataset.inspectorTab);
});

function updateLearningPanel() {
  const summary = summarizeStructure(state.mol);
  const hybridization = Object.entries(summary.hybridization)
    .filter(([key]) => key !== '—')
    .map(([key, count]) => `<span class="learning-chip"><b>${key}</b> ${count}개</span>`).join('') || '<span class="learning-muted">현재 원자 타입을 해석할 수 없습니다.</span>';
  const aromatic = summary.aromaticRings.length
    ? `<span class="learning-chip"><b>방향족</b> ${summary.aromaticRings.map((ring) => `${ring.piElectrons}π`).join(' · ')}</span>` : '';
  $('learning-overview').innerHTML = `<p><b>${summary.atomCount}</b>개 원자 · <b>${summary.bondCount}</b>개 결합 · <b>${summary.degreeOfUnsaturation.formula}</b></p><div class="learning-chip-row">${hybridization}${aromatic}</div>`;
  const dou = summary.degreeOfUnsaturation;
  const douText = dou.valid
    ? `<b>DoU ${dou.value}</b> · 고리와 π 결합의 총수입니다. 현재 구조의 결합차수·고리 수와 맞는지 확인하세요.`
    : `<b>DoU ${dou.value}</b> · 수소 수가 완결되지 않았거나 현재 구조가 중성 닫힌껍질 규칙과 맞지 않습니다. 수소 채우기 후 다시 확인하세요.`;
  const aromaticCards = summary.aromaticRings.map((ring) => {
    const hetero = ring.heteroatoms.map((index) => state.mol.atoms[index].el).join(', ');
    return `<article class="learning-card concept"><b>${ring.piElectrons}π 방향족 고리${hetero ? ` · 헤테로원자 ${hetero}` : ''}</b><p>원자별 π 기여 합이 4n+2인지 확인합니다. 피롤형 N·푸란형 O의 비공유쌍은 π계에 2전자를 공여합니다.</p></article>`;
  }).join('');
  const isomer = state.isomerReference ? compareStructuralIsomerCandidate(state.isomerReference, state.mol) : null;
  const isomerStatus = !isomer
    ? '<p>현재 구조를 기준으로 지정한 뒤, 결합 연결을 바꾸어 비교하세요.</p>'
    : isomer.kind === 'same-connectivity'
      ? `<p><b>같은 연결성</b> · 기준 구조와 분자식 ${isomer.referenceFormula}, 연결성 지문이 같습니다.</p>`
      : isomer.kind === 'constitutional-isomer-candidate'
        ? `<p><b>구조 이성질체 후보</b> · 두 구조 모두 ${isomer.referenceFormula}이지만 연결성 지문이 다릅니다. 실제 구조 이성질체 판단 전 결합 연결을 다시 확인하세요.</p>`
        : `<p><b>분자식이 다름</b> · 기준 ${isomer.referenceFormula} / 현재 ${isomer.candidateFormula}. 구조 이성질체 비교 대상이 아닙니다.</p>`;
  $('learning-validation').innerHTML = `<article class="learning-card concept"><p>${douText}</p></article><article class="learning-card"><b>구조 이성질체 점검</b>${isomerStatus}<button class="learning-action" data-isomer-reference>현재 구조를 기준으로 지정</button><p>같은 분자식과 다른 연결성은 구조 이성질체의 단서입니다. 이 판정은 연결성 지문 기반의 학습 보조이며, 그래프 동형 판정이나 입체이성질체 판정은 아닙니다.</p></article>${aromaticCards}`;
  const stereo = stereochemicalAssignments(state.mol);
  const rsCards = stereo.rs.map((assignment) => `<article class="learning-card concept"><b>C${assignment.center}: ${assignment.configuration}</b><p>CIP 우선순위 ${assignment.priorities.map(({ priority, element }) => `${priority}.${element}`).join(' → ')}. 최하위 우선순위를 뒤로 둔 3D 부호 계산 결과입니다.</p></article>`).join('');
  const ezCards = stereo.ez.map((assignment) => `<article class="learning-card concept"><b>C${assignment.bond[0]}=C${assignment.bond[1]}: ${assignment.configuration}</b><p>양쪽 탄소에서 CIP 최우선 치환기(C${assignment.leftHigh}, C${assignment.rightHigh})의 상대 위치를 비교했습니다. cis/trans 대신 E/Z를 사용합니다.</p></article>`).join('');
  $('learning-stereo').innerHTML = `${rsCards || ''}${ezCards || ''}<article class="learning-card limit"><b>판정 경계</b><p>${stereo.rs.length || stereo.ez.length ? 'CIP 동점·고리·동위원소·전하를 완전하게 다루지 못하면 판정을 보류합니다.' : '서로 다른 4개 가지를 갖는 sp³ 탄소 또는 양쪽에 다른 치환기가 있는 C=C를 만들면 판정합니다.'} 광학 회전 (+/−)과 UFF 에너지로 R/S를 예측하지 않습니다.</p></article>`;
  const candidateCenters = (state.selection.length ? state.selection : state.mol.atoms.map((_, i) => i))
    .filter((index) => neighbors(state.mol, index).length >= 2)
    .slice(0, 3);
  const geometryCards = candidateCenters.length
    ? candidateCenters.map((index) => {
      const atom = state.mol.atoms[index];
      const v = vseprCheck(state.mol, index);
      const type = typeAtom(state.mol, index);
      const hybrid = /_1$/.test(type) ? 'sp' : /_2$|_R$/.test(type) ? 'sp²' : /_3/.test(type) ? 'sp³' : '—';
      const status = v.satisfied ? '현재 결합각이 이상각에 가깝습니다.' : `가장 큰 각도 편차는 ${Math.max(...v.angles.map((angle) => angle.deviation)).toFixed(1)}°입니다.`;
      return `<article class="learning-card"><b>${atom.el}${index} · ${hybrid} · ${geometryName(state.mol, index)}</b><p>이상 결합각 ${v.ideal}° · ${status} 결합각은 고립전자쌍·입체장애·다중결합의 영향을 함께 받습니다.</p></article>`;
    }).join('')
    : '<p class="learning-muted">결합이 2개 이상인 원자를 선택하면 혼성화와 결합 기하를 설명합니다.</p>';
  const amides = amideSites(state.mol);
  const amideCards = amides.map((site) => `<article class="learning-card concept"><b>펩타이드 결합의 평면성 · C${site.carbon}–N${site.nitrogen}</b><p>아마이드 N 비공유전자쌍의 공명 공여로 C–N 결합은 부분 이중결합 성격을 가집니다. 단백질에서 같은 아마이드 연결이 펩타이드 결합이며, O${site.oxygen}–C${site.carbon}–N${site.nitrogen} 평면성이 φ/ψ 회전의 출발점입니다.</p><p>모델은 N_R·평면 기하를 적용하지만, 15–20 kcal/mol 장벽의 정량값·수소결합·2차 구조 안정성은 예측하지 않습니다.</p></article>`).join('');
  $('learning-geometry').innerHTML = `${geometryCards}${amideCards}`;
  $('learning-groups').innerHTML = summary.groups.length
    ? summary.groups.map((group) => `<article class="learning-card"><b>${group.label}</b><p>${group.note}</p></article>`).join('')
    : '<p class="learning-muted">인식한 주요 기능기가 없습니다. 구조 단위 라이브러리에서 카보닐·하이드록실·알켄을 붙여 보세요.</p>';
  const ir = predictedIrBands(state.mol);
  const nmr = protonNmrSignals(state.mol);
  const irCard = ir.length
    ? `<article class="learning-card"><b>예상 IR 작용기 밴드</b><p>${ir.map((band) => `${band.label} <b>${band.range}</b> (${band.character})`).join('<br>')}</p><p>규칙 기반 판독 연습이며, 실제 진동수·스펙트럼 세기는 계산하지 않습니다.</p></article>`
    : '<article class="learning-card"><b>예상 IR 작용기 밴드</b><p>현재 구조에서 C=O, O–H, N–H, C≡N, C=C 진단 밴드를 찾지 못했습니다.</p></article>';
  const nmrCard = nmr.supported
    ? `<article class="learning-card"><b>¹H NMR 신호군 · 적분비</b><p>${nmr.signals.map((signal) => `신호 ${signal.id}: ${signal.integral}H · <b>${signal.multiplicity}</b>`).join('<br>')}</p><p>${nmr.note} n+1은 등가 이웃 H에만 적용하며, 비등가 집합은 dd·ddd처럼 복합으로 표시합니다.</p></article>`
    : `<article class="learning-card"><b>¹H NMR 신호군</b><p>${nmr.note}</p></article>`;
  $('learning-spectroscopy').innerHTML = `${irCard}${nmrCard}`;
  $('learning-contacts').innerHTML = summary.contacts.length
    ? summary.contacts.map((contact) => `<article class="learning-card contact"><b>${state.mol.atoms[contact.i].el}${contact.i} · ${state.mol.atoms[contact.j].el}${contact.j}</b><p>${contact.distance.toFixed(2)} Å — UFF vdW 기준의 ${(contact.ratio * 100).toFixed(0)}%입니다. 가까운 비결합 접촉은 입체장애의 단서가 될 수 있습니다.</p></article>`).join('')
    : '<p class="learning-muted">강한 근접 비결합 접촉이 없습니다. 이는 반응성이나 안정성을 완전히 예측하는 결과는 아닙니다.</p>';
  const selection = state.selection;
  const strainRows = Object.entries(state.lastEnergy?.byType ?? {})
    .filter(([key]) => ['angle', 'torsion', 'vdw'].includes(key))
    .map(([key, value]) => `<span>${key === 'angle' ? '각 스트레인' : key === 'torsion' ? '비틀림 스트레인' : '입체 반발(vdW)'}</span><b>${value.toFixed(2)}</b>`).join('');
  const axial = summary.axialEquatorial.slice(0, 8).map((entry) => `${state.mol.atoms[entry.carbon].el}${entry.carbon}–${state.mol.atoms[entry.substituent].el}${entry.substituent}: ${entry.kind === 'axial' ? '축(axial)' : '평면(equatorial)'}`).join('<br>');
  $('learning-conformation').innerHTML = `<article class="learning-card concept"><b>UFF 상대 항 분해</b><div class="learning-energy">${strainRows || '<span>스트레인 항</span><b>—</b>'}</div><p>같은 분자의 배좌를 비교할 때만 정성적으로 해석하세요. 문헌 장벽과 UFF 수치는 다를 수 있습니다.</p></article>${axial ? `<article class="learning-card"><b>6원 고리 치환기</b><p>${axial}</p><p>의자형 뒤집기에서는 axial과 equatorial이 서로 교환됩니다.</p></article>` : '<p class="learning-muted">6원 탄소 고리에서 고리 밖 결합을 찾으면 axial/equatorial 라벨을 표시합니다.</p>'}`;
  const torsion = selection.length === 4 && isTorsionChain(state.mol, selection) && branchAtoms(state.mol, selection[1], selection[2]) !== null
    ? torsionInterpretation(measure(state.mol, selection))
    : null;
  $('torsion-study').innerHTML = torsion
    ? `<article class="learning-card"><b>${torsion.title}</b><p>${torsion.note}</p></article>`
    : '<p class="learning-muted">이어진 원자 4개를 순서대로 선택하면 이면각 배치의 교육용 해석이 나타납니다.</p>';
}

document.addEventListener('click', (event) => {
  if (!event.target.closest('[data-isomer-reference]')) return;
  state.isomerReference = {
    atoms: state.mol.atoms.map((atom) => ({ ...atom, pos: [...atom.pos] })),
    bonds: state.mol.bonds.map((bond) => ({ ...bond })),
  };
  toast('현재 구조를 이성질체 비교 기준으로 저장했습니다');
  render();
});

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
  // 3D 표식(render의 overlayLabels)이 직접 가리킨다.
  const s2 = hudSummary(state.lastStability ?? stability(state.mol));
  const scoreColor = s2.score >= 80 ? 'var(--success)' : s2.score >= 50 ? 'var(--accent)' : '#dc2626';
  $('stability').innerHTML = `<span style="color:${scoreColor};font-weight:700">${s2.score}</span>`
    + s2.shown.map((x) => `<span class="chip ${x.level}">${x.level === 'danger' ? '✕' : '▲'} ${x.msg}</span>`).join('')
    + (s2.more ? `<span class="chip">+${s2.more}개</span>` : '');

  updateDihedralPanel();
  updateLearningPanel();
}

// 선택 4개 + 고리 결합이 아니면 이면각 슬라이더를 활성화해 setDihedral로 직접 회전시킨다.
function updateDihedralPanel() {
  const s = state.selection;
  const slider = $('dihedral');
  const scanButton = $('torsion-scan');
  const scanResult = $('torsion-scan-result');
  if (s.length !== 4) {
    slider.disabled = true;
    scanButton.disabled = true;
    $('dihedral-info').textContent = '원자 4개를 순서대로 선택하면 활성화됩니다';
    scanResult.innerHTML = '<span class="learning-muted">회전 가능한 결합을 고르면 에너지 표본을 비교할 수 있습니다.</span>';
    return;
  }
  if (!isTorsionChain(state.mol, s)) {
    slider.disabled = true;
    scanButton.disabled = true;
    $('dihedral-info').textContent = '이어진 원자 4개(i-j-k-l)를 순서대로 선택하세요';
    return;
  }
  if (branchAtoms(state.mol, s[1], s[2]) === null) {
    slider.disabled = true;
    scanButton.disabled = true;
    $('dihedral-info').textContent = '고리 결합 — 직접 회전 불가';
    return;
  }
  slider.disabled = false;
  scanButton.disabled = false;
  const deg = Math.round(measure(state.mol, s));
  slider.value = deg;
  $('dihedral-info').textContent = `${deg}°`;
  const scan = state.torsionScan;
  if (scan?.selection.join(',') === s.join(',') && scan.samples.length) {
    const min = scan.samples.reduce((best, sample) => sample.energy < best.energy ? sample : best);
    const max = Math.max(...scan.samples.map((sample) => sample.energy));
    const span = Math.max(max - min.energy, 0.001);
    scanResult.innerHTML = `<div class="torsion-spark" aria-label="이면각 에너지 표본">${scan.samples.map((sample) => `<span title="${sample.deg}° · ${sample.energy.toFixed(2)} kcal/mol" style="height:${Math.max(8, ((sample.energy - min.energy) / span) * 100)}%"></span>`).join('')}</div><p><b>최저 표본 ${min.deg}°</b> · ${min.energy.toFixed(2)} kcal/mol. 표본점 사이의 정확한 장벽·용매 효과는 이 모델로 단정할 수 없습니다.</p>`;
  } else scanResult.innerHTML = '<span class="learning-muted">30° 간격으로 현재 이면각의 상대 에너지를 계산합니다.</span>';
}

$('torsion-scan').onclick = () => {
  const samples = scanTorsion(state.mol, state.selection, 30);
  if (!samples.length) { toast('회전 가능한 이어진 원자 4개를 선택하세요', 'err'); return; }
  state.torsionScan = { selection: [...state.selection], samples };
  render();
  const min = samples.reduce((best, sample) => sample.energy < best.energy ? sample : best);
  toast(`비틀림 스캔 완료 · 최저 표본 ${min.deg}°`);
};

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
  'anchor-valence': '이 앵커의 원자가가 가득 찼습니다 — 다른 원자나 결합 위치를 선택하세요',
  'template-valence': '선택한 구조 단위의 첨부 위치가 유효하지 않습니다',
  'invalid-template': '구조 단위를 해석할 수 없습니다',
};

// anchor에 현재 팔레트 원소를 붙인다. 방향은 snap.idealDirection이 VSEPR 이상각에 맞춰
// 계산한다(레고처럼 정해진 각도에만 물림) — 붙이기 도구의 고스트 미리보기와 정확히 같은
// 함수를 써서 "보여준 자리 = 실제로 붙는 자리"가 항상 일치하게 한다.
// 결합이 성립하면 UFF 평형 길이로 스냅시킨다. 실패 시 방금 추가한 원자를 되돌린다.
function attachAtom(anchor, { dir } = {}) {
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
    signalViewer('error');
    return;
  }

  state.mol.atoms.pop(); // 시험 삽입 되돌리기 — 되돌린 깨끗한 상태를 undo 스냅샷으로 남긴다
  pushUndo();
  const targetPos = add(a, scale(placeDir, check.targetLength));
  const idx2 = addAtom(state.mol, el, targetPos);
  addBond(state.mol, idx2, anchor, 1);
  if (check.reason === 'ok-expanded') { playClick(880); toast('초원자가 결합 — UFF 정확도 주의', 'err'); }
  else playClick(880);

  // 붙인 원자는 미리보기로 보여준 자리에 그대로 남는다 — openSlots가 이미 정확한 VSEPR
  // 방향과 UFF 평형 길이로 놓으므로 국소적으로는 이미 최적에 가깝다. 전체 완화가 필요하면
  // 사용자가 '구조 최적화'를 누른다(예전 학습 모드의 자동 최적화는 붙일 때마다 구조 전체를
  // 움직여서 "본 자리에 박힌다"는 감각을 깨뜨렸다).
  checkSnaps();
  render();
  signalViewer('success');
}

// 원자 하나를 뗀다(지우개 도구). 원자가 하나뿐이면 남길 것이 없으니 막는다.
// 원자 하나를 뗀다(지우개 도구·우클릭). 떨어져 나가는 작은 조각은 함께 지운다
// (model.pruneAtom) — 사슬 중간을 자를 때마다 남은 파편을 하나씩 다시 지우던 불편을 없앤다.
// 선택 삭제(Del)는 지금처럼 "고른 것만 정확히" 지운다 — 두 동작을 도구로 구분한다.
function deleteAtom(i) {
  if (state.mol.atoms.length <= 1) { toast('마지막 원자는 삭제할 수 없습니다', 'err'); return; }
  pushUndo();
  const removed = pruneAtom(state.mol, i);
  if (removed.length === 0) { state.undoStack.pop(); return; }
  state.selection = [];
  state.snapState = {};
  playClick(220);
  if (removed.length > 1) toast(`${removed.length}개 원자 제거(가지치기)`);
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
    const nb = neighbors(state.mol, i).length;
    const max = MAX_VALENCE[state.mol.atoms[i].el];
    // 이웃 수가 아니라 결합차수 합으로 "원자가를 다 썼는지"를 본다 — 이웃 수로 세면
    // 에틸렌 탄소(이웃 3개, 원자가 4)가 영원히 미완성으로 남아 완성 연출이 안 떴다.
    if (nb >= 2 && max !== undefined && bondOrderSum(state.mol, i) >= max) next[i] = vseprCheck(state.mol, i).satisfied;
  }
  for (const idx of newSnapEvents(state.snapState, next)) {
    const v = vseprCheck(state.mol, Number(idx));
    playClick(1320); // 성공은 높은 음
    toast(`${state.mol.atoms[idx].el}${idx}: ${geometryName(state.mol, Number(idx))} 완성 (${v.ideal}°)`);
  }
  state.snapState = next;
}

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

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function pulseControl(control) {
  if (!control || prefersReducedMotion()) return;
  control.classList.remove('motion-confirm');
  requestAnimationFrame(() => control.classList.add('motion-confirm'));
  window.setTimeout(() => control.classList.remove('motion-confirm'), 260);
}

function signalViewer(kind) {
  const className = kind === 'error' ? 'interaction-error' : kind === 'select' ? 'selection-pulse' : 'interaction-success';
  viewerEl.classList.remove('interaction-error', 'selection-pulse', 'interaction-success');
  requestAnimationFrame(() => viewerEl.classList.add(className));
  window.setTimeout(() => viewerEl.classList.remove(className), prefersReducedMotion() ? 120 : 480);
}

function setTool(tool) {
  state.tool = tool;
  clearGhost();
  clearRingGhost();
  ghost2d = null;
  state.pendingBond = null;
  bondHover2d = null;
  document.querySelectorAll('#tools button').forEach((b) => {
    const matches = b.dataset.tool === tool && (!b.dataset.ring || b.dataset.ring === state.ringTemplate);
    b.classList.toggle('active', matches);
  });
  document.querySelectorAll('#palette button').forEach((b) => b.classList.toggle('active', tool === 'place' && b.dataset.el === state.element));
  document.querySelectorAll('#palette button').forEach((b) => b.classList.toggle('element-picked', tool === 'place' && b.dataset.el === state.element));
  document.querySelectorAll('#structure-library [data-template]').forEach((b) => b.classList.toggle('active', tool === 'ring' && b.dataset.template === state.ringTemplate));
  $('structure-library-toggle').classList.toggle('active', tool === 'ring');
  pulseControl(document.querySelector(`#tools button[data-tool="${tool}"]`) ?? (tool === 'place' ? document.querySelector(`#palette button[data-el="${state.element}"]`) : $('structure-library-toggle')));
  updateToolHint();
}

// 현재 도구의 사용법과 진행 상태를 한 줄로 보여준다. 도구가 무엇을 하는지 화면에 늘
// 떠 있어야 한다 — 특히 '결합·차수'는 원자 잇기와 차수 바꾸기를 겸하는데 그 사실이
// 툴팁에만 있어서 아무도 몰랐다.
const TOOL_HINT = {
  view: '<b>보기</b> — 클릭·드래그해도 분자가 바뀌지 않습니다. 마우스로 편하게 돌려보세요(휠 확대, 드래그 회전).',
  select: '<b>선택</b> — 원자 클릭. Shift+클릭으로 여러 개, 빈 곳 드래그로 박스 선택. 2~4개를 고르면 거리·각도·이면각이 우측에 나옵니다.',
  erase: '<b>지우개</b> — 원자를 클릭하면 그 원자와, 그 때문에 본체에서 떨어져 나가는 조각까지 함께 지웁니다. 우클릭으로도 됩니다.',
  bond: '<b>결합·차수</b> — 원자 <u>두 개</u>를 차례로 클릭하면 새 결합을 만듭니다(고리 닫기). 이미 있는 <u>결합선</u>을 클릭하면 차수가 1 → 2 → 3 → 1로 바뀝니다(C=O·C≡N을 이걸로 만듭니다).',
  place: '<b>붙이기</b> — 원자를 조준하면 빈 자리가 보입니다. <b>R</b> 키나 휠로 자리를 바꾸고 클릭해 붙입니다. 보라색 자리는 비공유 전자쌍이라 붙일 수 없습니다.',
  ring: '<b>구조 단위 삽입</b> — 원자를 조준하면 선택한 고리 또는 기능기가 미리 보입니다. 클릭해 붙이고, <b>R</b> 키로 배치를 회전할 수 있습니다.',
};

function updateToolHint() {
  let msg = TOOL_HINT[state.tool] ?? '';
  if (state.tool === 'place') msg += ` 현재 원소: <b>${state.element}</b>`;
  if (state.tool === 'ring') msg += ` 현재 단위: <b>${RING_TEMPLATES[state.ringTemplate].name}</b> · 회전 <b>${state.ringTwist}°</b>`;
  if (state.tool === 'place' && state.ghost && neighbors(state.mol, state.ghost.anchor).length === 1) {
    msg += ` · 방위각 <b>${state.azimuth}°</b>`;
  }
  if (state.tool === 'bond' && state.pendingBond !== null) {
    const i = state.pendingBond;
    msg = `<b>결합·차수</b> — <b>${state.mol.atoms[i].el}${i}</b> 선택됨. 이을 원자를 클릭하세요 (Esc 취소).`;
  }
  if (state.tool === 'select' && state.selection.length >= 2) {
    msg += ` · <b>${state.selection.length}개</b> 선택됨`;
  }
  msg += ' <span style="opacity:.7">· 카메라: WASD 회전 · QE 확대축소 · Shift+WASD 이동</span>';
  $('toolhint').innerHTML = msg;
}

$('tool-view').onclick = () => setTool('view');
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
  pulseControl(btn);
};

// ---- 구조 단위 라이브러리 --------------------------------------------------
// 고리와 기능기를 편집 도구와 분리한다. 학생은 원소 팔레트의 확장으로 인식하고,
// 선택 뒤에는 기존의 안정적인 고스트/원자가 검사 경로로 들어간다.
const structureLibrary = $('structure-library');
const structureLibraryToggle = $('structure-library-toggle');
const overlayRoot = $('overlay-root');
const LIBRARY_GROUPS = [
  ['ring', '탄소 고리'], ['heteroring', '헤테로고리'], ['functional', '기능기'],
];

function renderStructureLibrary() {
  const sections = LIBRARY_GROUPS.map(([group, label]) => {
    const units = STRUCTURE_LIBRARY.filter((unit) => unit.group === group);
    if (!units.length) return '';
    return `<div class="structure-library-group"><h3>${label}</h3><div class="structure-grid">${units.map((unit) => {
      const template = RING_TEMPLATES[unit.key];
      return `<button class="structure-card" data-template="${unit.key}" title="${template.detail} 삽입"><span class="structure-symbol">${unit.symbol}</span><strong>${unit.title}</strong><small>${template.detail}</small></button>`;
    }).join('')}</div></div>`;
  }).join('');
  structureLibrary.innerHTML = `<div class="structure-library-head"><div><strong>구조 단위</strong><p>앵커 원자를 조준해 미리본 뒤 클릭하세요.</p></div><button data-library-close aria-label="구조 단위 라이브러리 닫기">닫기</button></div>${sections}`;
}

function positionStructureLibrary() {
  if (structureLibrary.hidden) return;
  const mobile = window.matchMedia('(max-width: 720px)').matches;
  structureLibrary.classList.toggle('structure-library-sheet', mobile);
  if (mobile) {
    structureLibrary.style.removeProperty('left');
    structureLibrary.style.removeProperty('top');
    return;
  }
  const rect = structureLibraryToggle.getBoundingClientRect();
  const gap = 9;
  const width = Math.min(420, window.innerWidth - 30);
  const maxHeight = Math.min(510, window.innerHeight - 180);
  const left = Math.max(15, Math.min(rect.left, window.innerWidth - width - 15));
  const preferBelow = rect.bottom + gap + Math.min(maxHeight, 360) <= window.innerHeight - 12;
  const top = preferBelow
    ? Math.min(rect.bottom + gap, window.innerHeight - 12)
    : Math.max(12, rect.top - gap - Math.min(maxHeight, 360));
  structureLibrary.style.left = `${Math.round(left)}px`;
  structureLibrary.style.top = `${Math.round(top)}px`;
}

function setStructureLibraryOpen(open, { returnFocus = false } = {}) {
  if (open && overlayRoot && structureLibrary.parentElement !== overlayRoot) overlayRoot.appendChild(structureLibrary);
  structureLibrary.hidden = !open;
  structureLibraryToggle.setAttribute('aria-expanded', String(open));
  if (open) {
    positionStructureLibrary();
    requestAnimationFrame(() => structureLibrary.querySelector('button[data-template]')?.focus());
  } else if (returnFocus) structureLibraryToggle.focus();
}

renderStructureLibrary();
structureLibraryToggle.onclick = () => setStructureLibraryOpen(structureLibrary.hidden);
structureLibrary.onclick = (ev) => {
  if (ev.target.closest('[data-library-close]')) { setStructureLibraryOpen(false, { returnFocus: true }); return; }
  const card = ev.target.closest('[data-template]');
  if (!card) return;
  state.ringTemplate = card.dataset.template;
  state.ringTwist = 0;
  card.classList.add('selected-confirm');
  window.setTimeout(() => setStructureLibraryOpen(false), prefersReducedMotion() ? 0 : 110);
  setTool('ring');
  toast(`${RING_TEMPLATES[state.ringTemplate].name} 삽입: 원자를 조준하세요`);
};
document.addEventListener('click', (ev) => {
  if (!structureLibraryToggle.contains(ev.target) && !structureLibrary.contains(ev.target)) setStructureLibraryOpen(false);
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !structureLibrary.hidden) { setStructureLibraryOpen(false, { returnFocus: true }); }
});
window.addEventListener('resize', positionStructureLibrary);
window.addEventListener('scroll', positionStructureLibrary, { capture: true, passive: true });

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
  const color = g.kinds[g.slot] === 'lonepair' ? '#a855f7'
    : !g.ok ? '#dc2626' : g.reason === 'ok' ? '#22c55e' : '#f59e0b';
  const opacity = blinkOn ? 0.6 : 0.22;
  ghostShapes = [
    viewer.addSphere({
      center: { x: a[0], y: a[1], z: a[2] }, radius: 0.44,
      color: '#38bdf8', opacity: 0.9, wireframe: true,
    }),
  ];
  // 활성이 아닌 빈 자리들. 비공유 전자쌍 자리는 보라로 구분한다 — 거기엔 원자를 붙일 수
  // 없고, 붙일 수 없다는 사실 자체가 화학 정보다(물의 산소가 왜 두 자리를 남기는지).
  if (g.slots.length > 1) {
    const len = Math.hypot(g.pos[0] - a[0], g.pos[1] - a[1], g.pos[2] - a[2]);
    g.slots.forEach((d, k) => {
      if (k === g.slot) return;
      const p = add(a, scale(d, len));
      ghostShapes.push(viewer.addSphere({
        center: { x: p[0], y: p[1], z: p[2] }, radius: 0.18,
        color: g.kinds[k] === 'lonepair' ? '#a855f7' : color,
        opacity: g.kinds[k] === 'lonepair' ? 0.30 : 0.16,
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

const AZIMUTH_STEP = 15; // 도. 자리가 하나뿐인 앵커에서 휠/R 한 칸당 회전량.

function rotateAzimuth(deltaDeg) {
  if (!state.ghost) return;
  state.azimuth = (state.azimuth + deltaDeg) % 360;
  state.ghost = previewAttach(state.ghost.anchor, state.element);
  blinkOn = true;
  drawGhost();
  updateToolHint();
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
  const kinds = slotKinds(state.mol, anchor);
  const anchorNb = neighbors(state.mol, anchor);
  // 이웃이 하나뿐이면 자리 전체를 그 결합축(anchor->이웃) 둘레로 state.azimuth만큼 돌린다 —
  // openSlots가 준 자리들은 서로 상대 각도가 고정된 하나의 뼈대라, 축 둘레 회전으로
  // 통째로 돌려도 자리끼리의 이상각은 그대로 유지된다.
  const axis = anchorNb.length === 1 ? sub(state.mol.atoms[anchorNb[0]].pos, a) : null;
  const slots = kinds.map((k) => (axis && state.azimuth
    ? rotateAround(k.dir, [0, 0, 0], axis, state.azimuth) : k.dir));
  const slot = ((state.slot % slots.length) + slots.length) % slots.length;
  const idx = addAtom(state.mol, el, add(a, scale(slots[slot], 2.5)));
  const check = canBond(state.mol, anchor, idx);
  state.mol.atoms.pop();
  const len = check.ok ? check.targetLength : 1.6;
  return {
    anchor, slots, slot, kinds: kinds.map((k) => k.kind),
    pos: add(a, scale(slots[slot], len)),
    ok: check.ok, reason: check.reason, el,
  };
}

viewerEl.addEventListener('pointermove', (ev) => {
  if (state.tool !== 'place') return;
  const anchor = pickAtom(ev.pageX, ev.pageY, 40);
  if (anchor === -1) { clearGhost(); return; }
  // 다른 원자를 조준하면 슬롯 선택/방위각을 처음으로 되돌린다 — 앵커마다 자리 개수가 다르다.
  if (state.ghost?.anchor !== anchor) { state.slot = 0; state.azimuth = 0; }
  state.ghost = previewAttach(anchor, state.element);
  blinkOn = true;
  drawGhost();
});
viewerEl.addEventListener('pointerleave', () => clearGhost());

// ---- 고리 도구 고스트 미리보기 --------------------------------------------
// place 도구의 previewAttach/drawGhost/clearGhost와 같은 패턴: computeRingPlacement로
// 부작용 없이 세계 좌표를 계산하고, canBond로 앵커에 자리가 있는지만 시험 삽입/되돌리기로 본다.
let ringGhostShapes = [];

function previewRing(anchor) {
  const template = RING_TEMPLATES[state.ringTemplate];
  const structuralCheck = validateStructureAttachment(state.mol, anchor, template);
  if (!structuralCheck.ok) return { anchor, placed: [], ok: false, reason: structuralCheck.reason };
  const dir = idealDirection(state.mol, anchor);
  const placed = computeRingPlacement(state.mol, anchor, template, dir, state.ringTwist);
  const idx = addAtom(state.mol, placed[0][0], placed[0][1]);
  const check = canBond(state.mol, anchor, idx);
  state.mol.atoms.pop();
  return { anchor, placed, ok: check.ok, reason: check.reason };
}

function drawRingGhost() {
  for (const s of ringGhostShapes) viewer.removeShape(s);
  ringGhostShapes = [];
  const g = state.ringGhost;
  if (!g) return;
  const color = g.ok ? '#22c55e' : '#dc2626';
  const anchorPos = state.mol.atoms[g.anchor].pos;
  const worldPos = g.placed.map(([, pos]) => pos);
  const toXYZ = (p) => ({ x: p[0], y: p[1], z: p[2] });
  if (!worldPos.length) {
    ringGhostShapes.push(viewer.addSphere({ center: toXYZ(anchorPos), radius: 0.44, color, opacity: 0.55, wireframe: true }));
    viewer.render();
    return;
  }
  ringGhostShapes.push(viewer.addLine({ start: toXYZ(anchorPos), end: toXYZ(worldPos[0]), color, dashed: true }));
  for (const [i, j] of RING_TEMPLATES[state.ringTemplate].bonds) {
    ringGhostShapes.push(viewer.addLine({ start: toXYZ(worldPos[i]), end: toXYZ(worldPos[j]), color }));
  }
  for (const p of worldPos) {
    ringGhostShapes.push(viewer.addSphere({ center: toXYZ(p), radius: 0.28, color, opacity: 0.5 }));
  }
  viewer.render();
}

function clearRingGhost() {
  if (!state.ringGhost && ringGhostShapes.length === 0) return;
  state.ringGhost = null;
  for (const s of ringGhostShapes) viewer.removeShape(s);
  ringGhostShapes = [];
  viewer.render();
}

// 미리 보여준 배치를 그대로 커밋한다(previewRing과 같은 computeRingPlacement를 쓰는
// insertRingTemplate). 고리를 닫아 붙인 직후는 handleBondClick과 같은 이유로 짧게 완화한다.
function attachRing(anchor) {
  const template = RING_TEMPLATES[state.ringTemplate];
  const dir = idealDirection(state.mol, anchor);
  pushUndo();
  insertRingTemplate(state.mol, anchor, template, dir, state.ringTwist);
  minimize(state.mol, { maxSteps: 80 });
  playClick(880);
  clearRingGhost();
  checkSnaps();
  render();
  signalViewer('success');
}

viewerEl.addEventListener('pointermove', (ev) => {
  if (state.tool !== 'ring') return;
  const anchor = pickAtom(ev.pageX, ev.pageY, 40);
  if (anchor === -1) { clearRingGhost(); return; }
  state.ringGhost = previewRing(anchor);
  drawRingGhost();
});
viewerEl.addEventListener('pointerleave', () => clearRingGhost());

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
  if (state.tool === 'view') return; // 보기 도구는 클릭해도 아무 일도 일어나지 않는다.
  if (state.tool === 'erase') { deleteAtom(hit); return; }
  if (state.tool === 'bond') { handleBondClick(hit); return; }
  if (shiftKey) toggleSelect(hit);
  else { state.selection = [hit]; render(); }
  signalViewer('select');
}

// 결합 도구로 결합선을 클릭하면 차수를 1 -> 2 -> 3 -> 1로 돌린다(원자를 클릭하면
// 기존대로 두 원자를 잇는다 — 같은 도구 안에서 클릭 대상으로만 갈린다).
function handleBondOrderClick(bond) {
  const r = cycleBondOrder(state.mol, bond);
  if (!r.ok) {
    toast(REASON_MSG[r.reason] ?? '차수를 바꿀 수 없습니다', 'err');
    playClick(180);
    signalViewer('error');
    return;
  }
  // cycleBondOrder가 이미 제자리에서 바꿔버렸으므로, 되돌리기 스냅샷은 되돌린 뒤에 찍는다.
  bond.order = r.order === 1 ? 3 : r.order - 1;
  pushUndo();
  bond.order = r.order;
  aromatize(state.mol); // 케쿨레 고리가 완성됐으면 C_R/order 1.5로 승격(그 외엔 무동작)
  playClick(660 + r.order * 220);
  toast(`결합 차수 ${r.order}`);
  checkSnaps();
  render();
  signalViewer('success');
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
    signalViewer('error');
    return;
  }
  if (!bondDistanceOk(state.mol, anchor, hit)) {
    toast(REASON_MSG['too-far'], 'err');
    playClick(180);
    render();
    signalViewer('error');
    return;
  }
  pushUndo();
  addBond(state.mol, anchor, hit, 1);
  aromatize(state.mol); // 고리를 닫아 케쿨레 구조가 완성됐으면 승격(그 외엔 무동작)
  // 고리를 닫은 경우(branchAtoms가 null — 고리 결합)만 완화를 돌려 실제 구조로 만든다.
  // 붙이기는 "본 자리에 그대로 박힌다"를 지켜야 하므로 자동 완화하지 않지만, 고리 닫기는
  // 두 끝이 아직 제 결합 길이가 아닌 게 정상이라 여기서만 예외로 완화한다.
  if (branchAtoms(state.mol, anchor, hit) === null) minimize(state.mol, { maxSteps: 80 });
  playClick(880);
  checkSnaps();
  render();
  signalViewer('success');
}

// ---- 일반 클릭(드래그 없는 pointerup) -------------------------------------
viewerEl.addEventListener('click', (ev) => {
  if (state.tool === 'place') {
    if (!state.ghost) return;
    if (state.ghost.ok) attachAtom(state.ghost.anchor, { dir: state.ghost.slots[state.ghost.slot] });
    else if (state.ghost.kinds[state.ghost.slot] === 'lonepair') {
      toast('비공유 전자쌍 자리입니다 — 원자가 들어갈 수 없습니다', 'err');
      signalViewer('error');
    } else { toast(REASON_MSG[state.ghost.reason] ?? '결합할 수 없습니다', 'err'); signalViewer('error'); }
    return;
  }
  if (state.tool === 'ring') {
    if (!state.ringGhost) return;
    if (state.ringGhost.ok) attachRing(state.ringGhost.anchor);
    else { toast(REASON_MSG[state.ringGhost.reason] ?? '고리를 붙일 수 없습니다', 'err'); signalViewer('error'); }
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
  if (state.flat || state.tool === 'view') return; // 2D가 위에 덮여 있으면 아래 핸들러가 처리한다. 보기 도구는 우클릭도 무시한다.
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

// 2D 화면에서 붙일 방향은 골격식 레이아웃이 정하고, 길이는 3D와 똑같이 attachAtom이
// UFF 평형 길이로 정한다. 예전엔 layout()의 무단위 좌표(BOND_LEN=1)를 3D 절대좌표(Å)로
// 그대로 넘겨서, 결합 길이가 34% 틀리고 앵커의 실제 3D 위치까지 무시됐다(사이클로헥산에
// 원자 하나를 붙이면 2.5 Å 떨어진 곳에 생겨 신축 에너지가 333 kcal/mol이 됐고, 3D로
// 돌아갈 때 최적화가 수렴하지 못했다). layout()은 3D 좌표를 읽지 않으므로 이렇게 바꿔도
// 2D 그림은 달라지지 않는다.
function attachAtom2D(anchor) {
  const pos = layout(state.mol);
  if (!pos.has(anchor)) return;
  const d = nextChainDir(state.mol, anchor, pos, 1);
  attachAtom(anchor, { dir: [d[0], d[1], 0] });
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
  if (state.tool === 'view') return;
  const hit = ev.target.closest('[data-atom]');
  if (hit) deleteAtom(Number(hit.dataset.atom));
});

// ---- 키보드 카메라 -----------------------------------------------------------
// 마인크래프트식 조작감의 핵심은 "누르고 있으면 계속 움직인다"이다. keydown 한 번에 한 칸씩
// 돌리면 뚝뚝 끊겨서 오히려 마우스 드래그보다 못하다. 눌린 키를 집합으로 들고 있다가
// 매 프레임 적용한다.
// W/S 상하 회전 · A/D 좌우 회전 · Q/E 확대·축소 · Shift와 함께면 평행이동(패닝).
// 아래 keydown 핸들러가 이 두 Set을 참조하므로, TDZ를 피하려면 핸들러보다 위에 선언해야 한다.
const CAMERA_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e']);
const heldKeys = new Set();
const ROT_STEP = 2.0;   // 프레임당 도(度)
const PAN_STEP = 2.5;   // 프레임당 픽셀
const ZOOM_STEP = 1.02; // 프레임당 배율

function cameraLoop() {
  if (heldKeys.size) {
    const pan = heldKeys.has('shift');
    if (pan) {
      let dx = 0, dy = 0;
      if (heldKeys.has('a')) dx -= PAN_STEP;
      if (heldKeys.has('d')) dx += PAN_STEP;
      if (heldKeys.has('w')) dy -= PAN_STEP;
      if (heldKeys.has('s')) dy += PAN_STEP;
      if (dx || dy) viewer.translate(dx, dy);
    } else {
      if (heldKeys.has('a')) viewer.rotate(-ROT_STEP, 'y');
      if (heldKeys.has('d')) viewer.rotate(ROT_STEP, 'y');
      if (heldKeys.has('w')) viewer.rotate(-ROT_STEP, 'x');
      if (heldKeys.has('s')) viewer.rotate(ROT_STEP, 'x');
    }
    if (heldKeys.has('q')) viewer.zoom(1 / ZOOM_STEP);
    if (heldKeys.has('e')) viewer.zoom(ZOOM_STEP);
    viewer.render();
  }
  requestAnimationFrame(cameraLoop);
}
requestAnimationFrame(cameraLoop);

document.addEventListener('keyup', (ev) => {
  heldKeys.delete(ev.key.toLowerCase());
  if (!ev.shiftKey) heldKeys.delete('shift');
});
// 창을 벗어나면 키가 눌린 채로 남아 카메라가 계속 도는 것을 막는다.
window.addEventListener('blur', () => heldKeys.clear());

// ---- 키보드: Esc 해제, Ctrl+A 전체선택, Del 삭제, Ctrl+D 복제, Ctrl+Z 실행취소 ----
document.addEventListener('keydown', (ev) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  // 카메라 키는 수식키가 없을 때만 잡는다(Ctrl+A 전체선택, Ctrl+D 복제와 겹치지 않게).
  const k = ev.key.toLowerCase();
  if (CAMERA_KEYS.has(k) && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    ev.preventDefault();
    heldKeys.add(k);
    if (ev.shiftKey) heldKeys.add('shift'); else heldKeys.delete('shift');
    return;
  }
  if (ev.key === 'Escape') { state.selection = []; state.pendingBond = null; bondHover2d = null; render(); return; }
  if (ev.key === 'r' || ev.key === 'R') {
    if (state.tool === 'ring') {
      state.ringTwist = (state.ringTwist + 30) % 360;
      if (state.ringGhost) {
        state.ringGhost = previewRing(state.ringGhost.anchor);
        drawRingGhost();
      }
      updateToolHint();
    } else if (state.ghost && neighbors(state.mol, state.ghost.anchor).length === 1) rotateAzimuth(AZIMUTH_STEP);
    else cycleSlot(1);
    return;
  }
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
// 3D -> 2D는 좌표만 안 그릴 뿐 데이터는 그대로라 변환이 필요 없다.
$('view2d').onclick = () => {
  state.flat = !state.flat;
  document.body.dataset.flat = String(state.flat);
  $('sketch2d').hidden = !state.flat;
  $('view2d').textContent = state.flat ? '3D 보기' : '2D 보기(골격식)';
  $('view2d').setAttribute('aria-pressed', String(state.flat));
  // 화면 전환은 보기만 바꾼다 — 분자는 손대지 않는다. 예전엔 3D로 돌아올 때마다
  // syncHydrogens가 빈 원자가를 전부 H로 채웠는데, 되돌리기 스냅샷도 없어서
  // "탄소 골격만 그려두고 나중에 O를 붙이려던" 계획이 C4H10으로 굳어버렸고
  // 카보닐을 만들려고 남겨둔 C-O가 메탄올이 됐다. 수소 채움은 이제 명시적 버튼이다.
  render();
};

// 빈 원자가를 수소로 채운다. 예전엔 2D->3D 전환이 이걸 몰래 했는데, 화면을 보려고
// 누른 버튼이 분자를 영구히 바꾸는 건(되돌리기 스냅샷도 없었다) 사용자가 예상할 수 없다.
// 이제는 이 버튼을 눌러야만 채워지고, Ctrl+Z로 되돌릴 수 있다.
$('fill-h').onclick = () => {
  const before = state.mol.atoms.length;
  pushUndo();
  syncHydrogens(state.mol);
  const added = state.mol.atoms.length - before;
  if (added === 0) { state.undoStack.pop(); toast('채울 빈 자리가 없습니다'); return; }
  minimize(state.mol, { maxSteps: 120 });
  checkSnaps();
  render();
  toast(`수소 ${added}개 추가`);
};

// 네이티브 <select>의 열린 목록은 OS가 그려서 유리 패널 스타일을 입힐 수 없다
// (appearance: base-select는 이 글을 쓰는 시점 기준 CSS.supports만 통과하고
// 실제 런타임 동작은 아직 못 믿을 브라우저가 많았다). <select>는 숨겨서
// 상태값(.value, change 이벤트)으로만 쓰고, 버튼+목록을 직접 그려 그 위에서
// 클릭·키보드를 처리한 뒤 select.value를 갱신하고 진짜 change 이벤트를
// 쏴서 기존 onchange 배선을 그대로 재사용한다 — 선택 로직 자체는 손대지 않는다.
$('colorby').onchange = (ev) => {
  state.colorBy = ev.target.value;
  document.body.dataset.colorby = state.colorBy;
  render();
};
document.body.dataset.colorby = state.colorBy;
createMenuSelect($('colorby'));

setTool('view');

$('preset').innerHTML = Object.entries(PRESETS)
  .map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
$('preset').onchange = (ev) => {
  state.mol = loadPreset(ev.target.value);
  state.selection = [];
  state.snapState = {};
  checkSnaps();
  // 분자가 통째로 바뀌면 화면에 맞춰 다시 잡아준다 — zoomTo는 최초 렌더에서 한 번만
  // 불리기 때문에, 작은 분자에서 큰 분자로 바꾸면 화면 밖으로 나가도 되돌릴 방법이
  // 수동 줌뿐이었다.
  firstRender = true;
  render();
  const note = PRESETS[ev.target.value].note;
  if (note) toast(note);
};
createMenuSelect($('preset'));

// 카탈로그에서 PubChem SDF 구조를 불러오면 기존 조립·분석 상태로 교체한다.
// 현재 UFF 지원 원소만 catalog.js에서 이 이벤트를 보낼 수 있어 분석 경로는 그대로 안전하다.
document.addEventListener('mol-craft-catalog-load', (event) => {
  const { molecule, name } = event.detail ?? {};
  if (!molecule?.atoms?.length) return;
  pushUndo();
  state.mol = molecule;
  state.selection = [];
  state.snapState = {};
  state.flat = false;
  $('sketch2d').hidden = true;
  $('view2d').textContent = '2D 보기(골격식)';
  $('view2d').setAttribute('aria-pressed', 'false');
  firstRender = true;
  checkSnaps();
  render();
  toast(`${name} 구조를 불러왔습니다`);
});

initCatalog();

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
