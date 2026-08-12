// 미션 채점기. 화학 판정은 전부 기존 함수에 위임하고, 여기서는 그것을 선언형으로 엮는다.
// DOM을 모른다 — mission-ui.js만 화면을 만진다.
import { formula, stability } from './snap.js';
import { measure, findRings, neighbors } from './model.js';
import { topologyKey, energy } from './uff.js';

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
