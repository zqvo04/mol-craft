import { toXYZ, toMolBlock, toPDB, encodeState, decodeState } from './io.js';
import { energy, minimize, scanDihedral, typeAtom } from './uff.js';
import { neighbors, measure, addAtom, addBond } from './model.js';
import { canBond, vseprCheck, newSnapEvents } from './snap.js';
import { MAX_VALENCE } from './params.js';
import { loadPreset, PRESETS } from './presets.js';
import { sub, unit, add, scale, norm, cross, dot } from './geom.js';

const state = {
  mol: loadPreset('methane'),
  mode: 'learn',
  selection: [],
  snapState: {},
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

// 앵커 원자 주위에서 새 원자를 붙일 방향("가장 빈 공간")을 계산한다.
// 기본은 기존 결합 방향들의 합의 반대. 다만 그 합이 상쇄되거나(선형 2배위, 평면 삼각형
// 3배위의 정확한 대칭) 잔차가 우연히 기존 결합 한쪽과 거의 같은 방향을 가리키면(예: 3배위가
// 완벽한 120°에 근접했지만 정확히는 아닐 때) 새 원자가 기존 원자와 겹쳐 버린다(겹친 원자는
// UFF 기울기가 대칭으로 0이라 minimize()로도 안 풀린다). 그런 경우 기존 결합 중 평행하지
// 않은 두 벡터의 평면 법선(그 평면을 벗어나는 방향)을 쓴다. 결합이 없거나 전부 한 직선
// 위(법선을 정의할 평면이 없음)면 임의의 수직 방향.
function emptyDirection(mol, anchor) {
  const nb = neighbors(mol, anchor);
  const a = mol.atoms[anchor].pos;
  const vecs = nb.map((n) => unit(sub(mol.atoms[n].pos, a)));
  if (vecs.length === 0) return [1, 0, 0];

  const sum = vecs.reduce((s, v) => sub(s, v), [0, 0, 0]);
  if (norm(sum) >= 1e-3) {
    const candidate = unit(sum);
    if (!vecs.some((v) => dot(candidate, v) > 0.9)) return candidate;
  }
  for (let i = 0; i < vecs.length; i++) {
    for (let j = i + 1; j < vecs.length; j++) {
      const n = cross(vecs[i], vecs[j]);
      if (norm(n) > 1e-3) return unit(n);
    }
  }
  const ref = Math.abs(vecs[0][0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(vecs[0], ref));
}

// 앵커 원자에 선택된 원소를 붙인다. 결합이 성립하면 UFF 평형 길이로 '자석처럼' 스냅시킨다.
// 실패 시 방금 추가한 원자를 되돌린다.
function attachAtom(anchor) {
  const el = $('element').value;
  const a = state.mol.atoms[anchor].pos;
  const dir = emptyDirection(state.mol, anchor);

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
    drawScan(scanDihedral(state.mol, state.selection, { stepDeg: 10, relax: state.mode === 'research' }));
  } catch (err) {
    toast(err.message, 'err');
  }
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
  const url = `${location.origin}${location.pathname}#s=${encodeState(state.mol)}`;
  await navigator.clipboard.writeText(url);
  toast('링크 복사됨');
};

// 클릭 배선: 학습 모드는 원자 부착, 연구 모드는 측정 선택.
// atom.serial은 XYZ 모델에서 0-based로 배열 인덱스와 그대로 일치한다(위 onAtomClick 주석 참고).
viewer.setClickable({}, true, (atom) => {
  const i = atom.serial;
  if (state.mode === 'learn') attachAtom(i);
  else onAtomClick(i);
});

$('mode').onchange = (ev) => { state.mode = ev.target.value; state.selection = []; render(); };

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
if (location.hash.startsWith('#s=')) {
  try { state.mol = decodeState(location.hash.slice(3)); } catch { /* 손상된 링크는 무시 */ }
} else {
  state.mol = restoreLocal() ?? state.mol;
}

// 초기 로드 시점의 VSEPR 만족 상태를 baseline으로 기록해, 이후 첫 실제 클릭에서
// 이미 완성돼 있던 중심이 오탐(false positive)으로 재발화하지 않게 한다.
checkSnaps();
render();
