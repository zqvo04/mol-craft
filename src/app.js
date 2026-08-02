import { toXYZ, toMolBlock, toPDB, encodeState, decodeState } from './io.js';
import { energy, minimize, scanDihedral, typeAtom } from './uff.js';
import { neighbors, measure } from './model.js';
import { vseprCheck } from './snap.js';
import { loadPreset } from './presets.js';

const state = {
  mol: loadPreset('methane'),
  mode: 'learn',
  selection: [],
  snapState: {},
};

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

// 하단 알약형 알림. Task 11이 성공/실패 음(playClick)을 추가로 연결할 예정이지만
// 시그니처(msg, kind)는 이미 그 형태에 맞춰 두었다.
let toastTimer;
function toast(msg, kind = 'ok') {
  const el = $('toast');
  el.textContent = msg;
  el.style.background = kind === 'ok' ? 'var(--success)' : 'var(--accent)';
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
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
  const r = minimize(state.mol);
  toast(`최적화 완료: ${r.energyBefore.toFixed(2)} → ${r.energyAfter.toFixed(2)} kcal/mol`);
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

// 진입 시 URL 해시 복원. 손상된 링크는 조용히 무시하고 기본 프리셋을 유지한다.
if (location.hash.startsWith('#s=')) {
  try { state.mol = decodeState(location.hash.slice(3)); } catch { /* 손상된 링크는 무시 */ }
}

render();
