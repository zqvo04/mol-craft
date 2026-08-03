import { toXYZ, toMolBlock, toPDB, encodeState, decodeState, encodeStateAsync, decodeStateAsync } from './io.js';
import { energy, minimize, scanDihedral, typeAtom } from './uff.js';
import { neighbors, measure, addAtom, addBond, removeAtom, branchAtoms, setDihedral } from './model.js';
import { canBond, vseprCheck, newSnapEvents, idealDirection, stability } from './snap.js';
import { MAX_VALENCE } from './params.js';
import { loadPreset, PRESETS } from './presets.js';
import { add, scale } from './geom.js';
import { isShareEnabled, putShared, getShared, listGallery } from './share.js';

const state = {
  mol: loadPreset('methane'),
  mode: 'learn',
  selection: [],
  snapState: {},
  showGrid: true,
};

const LS_KEY = 'molcraft:last';

function saveLocal() {
  try { localStorage.setItem(LS_KEY, encodeState(state.mol)); }
  catch { /* 용량 초과·프라이빗 모드 등은 무시한다. 저장 실패가 앱을 막으면 안 된다. */ }
}

function restoreLocal() {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return null;
  try { return decodeState(raw); } catch { return null; }
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
  viewer.zoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15);
  viewer.render();
}, { capture: true, passive: false });

// 배경 3D 참조 그리드(XZ 평면, 1 Å 간격). 깊이감 보조용 — 5칸마다 굵은 선.
function drawGrid() {
  if (!state.showGrid) return;
  const N = 8, Y = -4;
  for (let i = -N; i <= N; i++) {
    const color = i % 5 === 0 ? '#94a3b8' : '#cbd5e1';
    viewer.addLine({ start: { x: -N, y: Y, z: i }, end: { x: N, y: Y, z: i }, color });
    viewer.addLine({ start: { x: i, y: Y, z: -N }, end: { x: i, y: Y, z: N }, color });
  }
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

function render() {
  const e = energy(state.mol);
  state.lastEnergy = e;
  viewer.removeAllModels();
  viewer.removeAllShapes();
  viewer.addModel(toXYZ(state.mol), 'xyz');
  drawGrid();

  const vmax = Math.max(0.5, ...e.perAtom); // 0.5 kcal/mol 미만 차이는 노이즈로 본다
  state.mol.atoms.forEach((a, i) => {
    viewer.setStyle({ serial: i }, {
      sphere: { radius: 0.30, color: strainColor(e.perAtom[i], vmax) },
      stick: { radius: 0.14, color: strainColor(e.perAtom[i], vmax) },
    });
  });
  // 선택된 원자는 반투명 노란 구로 강조
  for (const i of state.selection) {
    viewer.addSphere({
      center: { x: state.mol.atoms[i].pos[0], y: state.mol.atoms[i].pos[1], z: state.mol.atoms[i].pos[2] },
      radius: 0.5, color: 'yellow', opacity: 0.35,
    });
  }
  if (firstRender) { viewer.zoomTo(); firstRender = false; }
  viewer.render();
  updatePanels(e);
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

  const s = state.selection;
  $('measure').textContent = s.length < 2 ? '원자를 2~4개 클릭'
    : s.length === 2 ? `거리 ${measure(state.mol, s).toFixed(3)} Å`
    : s.length === 3 ? `결합각 ${measure(state.mol, s).toFixed(2)}°`
    : `이면각 ${measure(state.mol, s).toFixed(2)}°`;

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

  // 안정도 HUD: 옥텟/원자가·VSEPR 편차를 점수+칩으로 요약(게이밍 스타일 즉시 피드백).
  const st = stability(state.mol);
  const scoreColor = st.score >= 80 ? 'var(--success)' : st.score >= 50 ? 'var(--accent)' : '#dc2626';
  $('stability').innerHTML = `<span style="color:${scoreColor};font-weight:700">${st.score}</span>` +
    st.issues.map((x) => `<span class="chip ${x.level}">${x.level === 'danger' ? '✕' : '▲'} ${x.msg}</span>`).join('');

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

// 선택 배열 관리(최대 4개, 5번째 클릭 시 초기화). 3Dmol의 atom.serial은 XYZ 모델에서
// 0-based로 배열 인덱스와 그대로 일치하므로 그대로 넘긴다(별도 -1/+1 보정 금지).
// 클릭 리스너 배선(viewer.setClickable)은 학습/연구 모드 분기가 필요해 Task 11에서 담당한다.
function onAtomClick(i) {
  if (state.selection.length >= 4) state.selection = [];
  if (!state.selection.includes(i)) state.selection.push(i);
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

const REASON_MSG = {
  'already-bonded': '이미 결합되어 있습니다',
  'valence-full-i': '중심 원자의 결합 자리가 가득 찼습니다',
  'valence-full-j': '붙이려는 원자의 결합 자리가 가득 찼습니다',
  'unsupported-element': '지원하지 않는 원소입니다',
  'same-atom': '같은 원자입니다',
};

// 앵커 원자에 선택된 원소를 붙인다. 방향은 snap.idealDirection이 VSEPR 이상각에 맞춰
// 계산한다(레고처럼 정해진 각도에만 물림). 결합이 성립하면 UFF 평형 길이로 스냅시킨다.
// 실패 시 방금 추가한 원자를 되돌린다.
function attachAtom(anchor) {
  const el = $('element').value;
  const a = state.mol.atoms[anchor].pos;
  const dir = idealDirection(state.mol, anchor);

  const idx = addAtom(state.mol, el, add(a, scale(dir, 2.5)));
  // canBond(mol, i, j)의 reason 태그는 i=중심/j=신규로 고정된 관례다(snap.test.js 참고).
  // 인자를 (idx, anchor) 순으로 넣으면 태그가 뒤집혀 REASON_MSG가 반대로 안내한다.
  const check = canBond(state.mol, anchor, idx);
  if (!check.ok) {
    state.mol.atoms.pop();
    toast(REASON_MSG[check.reason] ?? '결합할 수 없습니다', 'err');
    playClick(180); // 실패는 낮은 음
    return;
  }

  state.mol.atoms[idx].pos = add(a, scale(dir, check.targetLength));
  addBond(state.mol, idx, anchor, 1);
  playClick(880);
  if (check.reason === 'ok-expanded') toast('초원자가 결합 — UFF 정확도 주의', 'err');

  if (state.mode === 'learn') minimize(state.mol, { maxSteps: 120 }); // 붙자마자 자리 잡게
  checkSnaps();
  render();
}

// Shift+클릭으로 원자를 뗀다(레고 분해). 원자가 하나뿐이면 남길 것이 없으니 막는다.
function deleteAtom(i) {
  if (state.mol.atoms.length <= 1) { toast('마지막 원자는 삭제할 수 없습니다', 'err'); return; }
  removeAtom(state.mol, i);
  state.selection = state.selection.filter((s) => s !== i).map((s) => (s > i ? s - 1 : s));
  state.snapState = {};
  playClick(220);
  checkSnaps();
  render();
}

const GEOMETRY_NAME = {
  2: '직선형', 3: '평면 삼각형', 4: '정사면체', 5: '삼각쌍뿔', 6: '정팔면체',
};

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
    toast(`${state.mol.atoms[idx].el}${idx}: ${GEOMETRY_NAME[v.coordination]} 완성 (${v.ideal}°)`);
  }
  state.snapState = next;
}

$('scan').onclick = () => {
  if (state.selection.length !== 4) { toast('원자 4개를 순서대로 선택하세요', 'err'); return; }
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

// 클릭 배선: 학습 모드는 원자 부착(Shift+클릭은 삭제), 연구 모드는 측정 선택.
// atom.serial은 XYZ 모델에서 0-based로 배열 인덱스와 그대로 일치한다(위 onAtomClick 주석 참고).
viewer.setClickable({}, true, (atom, _v, ev) => {
  const i = atom.serial;
  if (state.mode === 'learn') {
    if (ev?.shiftKey) deleteAtom(i);
    else attachAtom(i);
  } else onAtomClick(i);
});

$('mode').onchange = (ev) => {
  state.mode = ev.target.value;
  state.selection = [];
  document.body.dataset.mode = state.mode;
  render();
};

$('grid').onchange = (ev) => { state.showGrid = ev.target.checked; render(); };
document.body.dataset.mode = state.mode;

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
