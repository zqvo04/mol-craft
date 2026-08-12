// 미션 채점기. 화학 판정은 전부 기존 함수에 위임하고, 여기서는 그것을 선언형으로 엮는다.
// DOM을 모른다 — mission-ui.js만 화면을 만진다.
import { formula, stability, syncHydrogens } from './snap.js';
import { measure, findRings, neighbors, createMolecule, addAtom, addBond, setDihedral } from './model.js';
import { topologyKey, energy, minimize, scanDihedral } from './uff.js';
import { loadPreset, RING_TEMPLATES } from './presets.js';
import { trustFor, sameTopology, assertComparable } from './trust.js';

// 각도 구간 판정. 이면각만 순환(cyclic)이다 — measure()가 -180~180을 돌려주므로
// anti 배좌를 [150, 210]으로 적으면 -170°가 걸러진다. 360 법으로 정규화해야 한다.
function inWindow(value, [lo, hi], cyclic) {
  if (!cyclic) return value >= lo && value <= hi;
  const n = (x) => ((x % 360) + 360) % 360;
  const v = n(value), a = n(lo), b = n(hi);
  return a <= b ? (v >= a && v <= b) : (v >= a || v <= b);
}

const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

function bondOrderBetween(mol, i, j) {
  const b = mol.bonds.find((x) => (x.i === i && x.j === j) || (x.i === j && x.j === i));
  return b ? b.order : 0;
}

// { el, bonded: [{el, order}, ...] } 를 만족하는 원자가 하나라도 있는가.
// 이웃을 다중집합으로 소진시켜 매칭한다 — 같은 (원소, 차수) 쌍이 두 번 요구되면
// 실제로도 두 개가 있어야 한다.
function matchGroup(mol, spec) {
  for (let i = 0; i < mol.atoms.length; i++) {
    if (mol.atoms[i].el !== spec.el) continue;
    const pool = neighbors(mol, i).map((j) => ({
      el: mol.atoms[j].el,
      order: bondOrderBetween(mol, i, j),
    }));
    let ok = true;
    for (const want of spec.bonded) {
      const k = pool.findIndex((x) => x.el === want.el && x.order === want.order);
      if (k < 0) { ok = false; break; }
      pool.splice(k, 1);
    }
    if (ok) return true;
  }
  return false;
}

// 각 술어는 (arg, pred, ctx)를 받는다. arg는 술어 이름이 가리키는 값(pred[name])이다.
const PREDICATES = {
  formula: (arg, p, ctx) => formula(ctx.mol) === arg,
  topologyMatches: (arg, p, ctx) => topologyKey(ctx.mol) === ctx.startTopology,
  distance: (arg, p, ctx) => inWindow(measure(ctx.mol, arg), p.within, false),
  angle: (arg, p, ctx) => inWindow(measure(ctx.mol, arg), p.within, false),
  dihedral: (arg, p, ctx) => inWindow(measure(ctx.mol, arg), p.within, true),
  energyDelta: (arg, p, ctx) => inWindow(energy(ctx.mol).total - ctx.startEnergy, p.within, false),
  strainByType: (arg, p, ctx) => inWindow(energy(ctx.mol).byType[arg], p.within, false),
  noSevere: (arg, p, ctx) => !stability(ctx.mol).issues.some((x) => x.level === 'danger'),
  ringCount: (arg, p, ctx) => findRings(ctx.mol).length === arg,
  ringSize: (arg, p, ctx) => {
    const got = findRings(ctx.mol).map((r) => r.length).sort((x, y) => x - y);
    return sameSet(got, [...arg]);
  },
  hasGroup: (arg, p, ctx) => matchGroup(ctx.mol, arg),
  selectionEquals: (arg, p, ctx) => sameSet(ctx.selection, arg),
  answerEquals: (arg, p, ctx) => ctx.answer === arg,
};

export const PREDICATE_NAMES = Object.keys(PREDICATES);

export function evaluatePredicate(pred, ctx) {
  if (pred.all) return pred.all.every((p) => evaluatePredicate(p, ctx));
  if (pred.any) return pred.any.some((p) => evaluatePredicate(p, ctx));
  if (pred.not) return !evaluatePredicate(pred.not, ctx);
  const name = PREDICATE_NAMES.find((k) => k in pred);
  if (!name) throw new Error(`알 수 없는 술어: ${JSON.stringify(pred)}`);
  return PREDICATES[name](pred[name], pred, ctx);
}

// ---- 시작구조 로더 --------------------------------------------------------
// 미션 데이터를 사람이 읽고 diff할 수 있게, base64 상태 문자열이 아니라 선언형으로 적는다.
// 무거운 원자 골격만 쓰고 syncH가 수소를 채우므로 리터럴이 짧다.
//
// 불변식: 이 함수는 원자를 삭제하지 않는다. addAtom과 syncHydrogens의 채우기는 항상
// 뒤에 붙으므로 골격 인덱스와 replace 인덱스는 변환 뒤에도 그대로다 —
// 미션의 check·probe가 인덱스를 쓸 수 있는 근거다.
function materialize(start) {
  if (start.preset) return loadPreset(start.preset);
  if (start.ringTemplate) {
    const t = RING_TEMPLATES[start.ringTemplate];
    if (!t) throw new Error(`알 수 없는 고리 템플릿: ${start.ringTemplate}`);
    const m = createMolecule();
    for (const [el, pos, type] of t.atoms) {
      const idx = addAtom(m, el, pos);
      if (type) m.atoms[idx].type = type;
    }
    for (const [i, j, order] of t.bonds) addBond(m, i, j, order ?? 1);
    return m;
  }
  if (start.atoms) {
    const m = createMolecule();
    for (const [el, pos] of start.atoms) addAtom(m, el, pos);
    for (const [i, j, order] of start.bonds ?? []) addBond(m, i, j, order ?? 1);
    return m;
  }
  throw new Error('시작구조를 만들 수 없습니다: preset·ringTemplate·atoms 중 하나가 필요합니다');
}

export function loadStart(start) {
  const mol = materialize(start);
  for (const r of start.replace ?? []) mol.atoms[r.atom].el = r.el;
  if (start.setDihedral) setDihedral(mol, start.setDihedral.atoms, start.setDihedral.deg);
  if (start.flipZ) for (const a of mol.atoms) a.pos = [a.pos[0], a.pos[1], -a.pos[2]];
  if (start.syncH) syncHydrogens(mol);
  if (start.relax) minimize(mol, { maxSteps: 400 });
  return mol;
}

// ---- probe: predict 미션이 답 확정 후 돌리는 스크립트 계산 ----------------
// 학생이 직접 조작할 필요가 없다. 잠그기 전에는 이 결과를 어떤 형태로도 노출하지 않는다.
const FIXED = 2;

function probeValue(kind, mols, r, scan) {
  const mol = mols[r.state ?? 0];
  if (kind === 'scanDihedral' && r.value === 'barrier') {
    const profile = scanDihedral(mol, scan.atoms, { stepDeg: scan.stepDeg ?? 30 });
    return `${Math.max(...profile.map((p) => p.relative)).toFixed(FIXED)} kcal/mol`;
  }
  switch (r.value) {
    case 'energy': return `${energy(mol).total.toFixed(FIXED)} kcal/mol`;
    case 'angle':
    case 'dihedral': return `${measure(mol, r.atoms).toFixed(1)}°`;
    case 'distance': return `${measure(mol, r.atoms).toFixed(3)} Å`;
    case 'formula': return formula(mol);
    case 'topologyEqual': return sameTopology(mols[0], mols[1]) ? '같습니다' : '다릅니다';
    default: throw new Error(`probe: 알 수 없는 값 종류 "${r.value}"`);
  }
}

export function runProbe(probe) {
  const mols = probe.states.map((s) => loadStart(s));
  if (probe.kind === 'minimize') for (const m of mols) minimize(m, { maxSteps: 400 });

  const cross = mols.length === 2 && !sameTopology(mols[0], mols[1]);
  if (cross && probe.report.some((r) => r.value === 'energy')) {
    assertComparable(mols[0], mols[1], 'probe');
  }
  if (probe.report.some((r) => r.value === 'topologyEqual') && mols.length !== 2) {
    throw new Error('probe: topologyEqual 리포트는 상태 두 개가 필요합니다');
  }

  const rows = probe.report.map((r) => ({
    label: r.label,
    text: probeValue(probe.kind, mols, r, probe.scan),
  }));
  // 화면에는 가장 약한 등급 하나를 붙인다 — 강한 등급이 약한 것을 가리면 안 된다.
  const rank = { geometry: 0, relative: 1, blocked: 2 };
  const trust = probe.report
    .map((r) => trustFor(r.value, cross))
    .reduce((a, b) => (rank[b.key] > rank[a.key] ? b : a));
  return { rows, trust };
}
