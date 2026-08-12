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

// ---- 채점 ----------------------------------------------------------------
export const MISSION_TYPES = ['build', 'measure', 'predict', 'classify'];

// 술어별 일반 실패 메시지. 지정 진단이 없을 때만 쓴다.
const GENERIC = {
  formula: '분자식이 목표와 다릅니다.',
  topologyMatches: '연결 방식이 시작 구조와 달라졌습니다. 배좌만 바꾸면 되는 미션입니다.',
  distance: '지정한 두 원자 사이의 거리가 목표 범위 밖입니다.',
  angle: '지정한 결합각이 목표 범위 밖입니다.',
  dihedral: '이면각이 목표 범위 밖입니다.',
  energyDelta: '에너지 변화가 목표 범위 밖입니다.',
  strainByType: '해당 스트레인 항이 목표 범위 밖입니다.',
  noSevere: '심각한 문제가 있는 원자가 남아 있습니다. 빨간 글로우를 확인하세요.',
  ringCount: '고리 개수가 목표와 다릅니다.',
  ringSize: '고리 크기가 목표와 다릅니다.',
  hasGroup: '목표 작용기가 보이지 않습니다.',
  selectionEquals: '요청한 원자를 선택하지 않았습니다. 측정 대상을 다시 고르세요.',
  answerEquals: '선택한 답이 맞지 않습니다.',
};

// 실패한 술어 중 첫 번째를 찾아 일반 메시지를 만든다. all 트리를 깊이 우선으로 훑는다.
function firstFailure(pred, ctx) {
  if (pred.all) {
    for (const p of pred.all) { const f = firstFailure(p, ctx); if (f) return f; }
    return null;
  }
  if (pred.any) return pred.any.some((p) => evaluatePredicate(p, ctx)) ? null : pred.any[0];
  if (pred.not) return evaluatePredicate(pred, ctx) ? null : pred;
  return evaluatePredicate(pred, ctx) ? null : pred;
}

export function makeContext(mission, { mol, selection, answer }) {
  const start = loadStart(mission.start);
  return {
    mol,
    selection: selection ?? [],
    answer: answer ?? null,
    startTopology: topologyKey(start),
    startEnergy: energy(start).total,
  };
}

export function evaluate(mission, input) {
  const ctx = makeContext(mission, input);
  const check = mission.check ?? { answerEquals: mission.answer };
  if (evaluatePredicate(check, ctx)) return { pass: true, diagnostic: null };

  for (const d of mission.diagnostics ?? []) {
    if (evaluatePredicate(d.when, ctx)) return { pass: false, diagnostic: d.message };
  }
  const failed = firstFailure(check, ctx);
  const name = failed && PREDICATE_NAMES.find((k) => k in failed);
  return { pass: false, diagnostic: GENERIC[name] ?? '아직 목표에 도달하지 않았습니다.' };
}

// 힌트는 한 번에 한 단계씩만 열린다. 정답(4단)은 3회 시도 후에만 —
// 즉시 열면 미션이 무의미해지고, 끝까지 막으면 학생이 이탈한다.
export const maxHintLevel = (attempts) => (attempts >= 3 ? 4 : 3);

// ---- 스키마 검증 ---------------------------------------------------------
// 저작 오류는 학생에게 보이기 전에 테스트에서 죽어야 한다.
function walkPredicate(pred, id) {
  if (pred.all) return pred.all.forEach((p) => walkPredicate(p, id));
  if (pred.any) return pred.any.forEach((p) => walkPredicate(p, id));
  if (pred.not) return walkPredicate(pred.not, id);
  if (!PREDICATE_NAMES.some((k) => k in pred)) {
    throw new Error(`${id}: 알 수 없는 술어 ${JSON.stringify(pred)}`);
  }
}

export function validateMission(m) {
  const id = m.id ?? '(id 없음)';
  for (const f of ['id', 'chapter', 'concept', 'type', 'title', 'brief', 'start']) {
    if (m[f] === undefined) throw new Error(`${id}: 필수 필드 누락 — ${f}`);
  }
  if (!MISSION_TYPES.includes(m.type)) throw new Error(`${id}: 알 수 없는 type "${m.type}"`);
  if (!Array.isArray(m.hints) || m.hints.length < 4) {
    throw new Error(`${id}: 힌트는 4단계여야 합니다`);
  }
  if (!['geometry', 'relative'].includes(m.trust)) {
    throw new Error(`${id}: trust는 geometry 또는 relative여야 합니다`);
  }
  if (m.type === 'build' && !m.check) throw new Error(`${id}: build 미션에는 check가 필요합니다`);
  if (m.type !== 'build') {
    // 선택지는 비어 있지만 않으면 된다 — 개수 하한은 미션 데이터 쪽에서 볼 문제다.
    if (!Array.isArray(m.choices) || m.choices.length === 0) {
      throw new Error(`${id}: ${m.type} 미션에는 선택지가 필요합니다`);
    }
    if (!m.choices.some((c) => c.id === m.answer)) {
      throw new Error(`${id}: answer "${m.answer}"가 choices에 없습니다`);
    }
  }
  if (m.check) walkPredicate(m.check, id);
  for (const d of m.diagnostics ?? []) {
    if (!d.when || !d.message) throw new Error(`${id}: diagnostics 항목에 when·message가 필요합니다`);
    walkPredicate(d.when, id);
  }
  loadStart(m.start);                 // 시작구조가 실제로 만들어지는지
  if (m.probe) runProbe(m.probe);     // 신뢰등급 가드가 여기서 throw한다
}
