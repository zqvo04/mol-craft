import { toXYZ } from './io.js';
import { energy } from './uff.js';
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
    viewer.setStyle({ serial: i + 1 }, {
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
}

render();
