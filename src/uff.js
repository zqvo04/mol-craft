import { neighbors, bondOrderSum, bondBetween, setDihedral, isTorsionChain } from './model.js';
import { UFF_PARAMS } from './params.js';
import { distance, angleDeg, dihedralDeg } from './geom.js';

// 원자 타입 결정: 원소 + 최대 결합 차수 + 이웃 수.
// 혼성은 결합 개수가 아니라 최대 결합 차수가 정한다 — 단일결합만 있으면 sp3, 이중이
// 하나라도 있으면 sp2, 삼중이면 sp. 예전엔 이웃 개수로 판정해서 단일결합 2개짜리 탄소가
// C_1(sp, theta0=180°)이 됐고, 사슬을 한 개씩 조립하는 도중이나 2D에서 골격만 그린
// 상태에서 결합각이 실제 화학과 어긋났다.
// 방향족(C_R/N_R/O_R)은 별도 고리 인식이 필요하므로 여기서 자동 배정하지 않는다.
// atom.type을 직접 지정하면 그 값이 우선한다(사용자 오버라이드 및 방향족 지정 경로).
export function typeAtom(mol, i) {
  const a = mol.atoms[i];
  if (a.type) return a.type;
  const el = a.el;
  const n = neighbors(mol, i).length;
  const bo = bondOrderSum(mol, i);
  const maxOrder = mol.bonds
    .filter((b) => b.i === i || b.j === i)
    .reduce((mx, b) => Math.max(mx, b.order), 0);
  switch (el) {
    case 'H': return 'H_';
    case 'F': return 'F_';
    case 'Cl': return 'Cl';
    case 'Br': return 'Br';
    case 'I': return 'I_';
    case 'B': return n >= 4 ? 'B_3' : 'B_2';
    case 'C': return maxOrder >= 3 ? 'C_1' : maxOrder === 2 ? 'C_2' : 'C_3';
    case 'N': return maxOrder >= 3 ? 'N_1' : maxOrder === 2 ? 'N_2' : 'N_3';
    case 'O': return maxOrder >= 2 ? 'O_2' : 'O_3';
    // S/P도 C/N/O와 같은 원칙: 실제 결합차수 합(bo)이 원자가·혼성을 정하지, 이웃 개수(n)가
    // 정하지 않는다. 예전엔 n>=3이면 무조건 S_3+6(SF6급 육배위, theta0=90°)이라, 메틸 두 개
    // (단일결합)에 O 하나를 붙이고 이중결합으로 올려 술폭사이드(DMSO류, 흔한 작용기)를 만들면
    // 이웃 수는 여전히 3인데 결합차수 합만 4로 늘었을 뿐인데도 육배위 취급을 받아 최적화가
    // C-S-C·C-S=O 둘 다 정확히 90°로 수렴했다(문헌 ~97°/~106°) — theta0=90°가 결합각항에
    // n=4 주기 퍼텐셜을 만들어 전혀 다른 모양으로 갇힌 것. bo로 보면 술폭사이드(bo=4)는
    // S_3+2(92.1°) 쪽에 남아 훨씬 근접한 값이 나온다. P도 동일 원리(포스핀옥사이드류).
    // UFF 원 논문 표 자체에 S(IV)·P(중간가) 전용 타입이 없어 정성적 근사는 여전히 남지만,
    // 적어도 "이웃 개수"라는 잘못된 지표로 실제 육배위와 혼동하는 일은 없앤다.
    case 'S': return n === 1 && bo >= 2 ? 'S_2' : bo >= 6 ? 'S_3+6' : 'S_3+2';
    case 'P': return bo >= 5 ? 'P_3+5' : 'P_3+3';
    case 'Si': return 'Si3';
    default: throw new Error(`지원하지 않는 원소: ${el}`);
  }
}

const HYB_BY_SUFFIX = { 1: 'sp', 2: 'sp2', R: 'sp2', 3: 'sp3' };

// 비틀림 항 분기용. UFF 타입 이름의 3번째 글자가 혼성을 직접 인코딩한다.
// theta0로 판정하면 안 된다: N_2는 111.2°, O_R은 110°라서 sp3로 오분류되고
// 비틀림 항이 n=3 주기로 잘못 생성된다.
// 'C_3'->'3', 'C_R'->'R', 'S_3+6'->'3', 'Si3'->'3'.
// 말단 타입(H_/F_/Cl/Br/I_)은 접미사가 없어 'sp'로 떨어지는데,
// 이웃이 하나뿐이라 애초에 비틀림 중심이 될 수 없으므로 무해하다.
export function hybridization(type) {
  if (!UFF_PARAMS[type]) throw new Error(`알 수 없는 UFF 타입: ${type}`);
  return HYB_BY_SUFFIX[type[2]] ?? 'sp';
}

const RAD = Math.PI / 180;
const BETA = 664.12; // UFF 힘상수 스케일 (kcal/mol·Å)
const LAMBDA = 0.1332; // 결합차수 보정 계수

export function bondLength(ti, tj, order = 1) {
  const a = UFF_PARAMS[ti], b = UFF_PARAMS[tj];
  const rSum = a.r1 + b.r1;
  const rBO = -LAMBDA * rSum * Math.log(order);
  // 전기음성도 보정. 원 논문 부호 오타는 OpenBabel 관례대로 뺄셈으로 적용한다.
  const dchi = Math.sqrt(a.chi) - Math.sqrt(b.chi);
  const rEN = (a.r1 * b.r1 * dchi * dchi) / (a.chi * a.r1 + b.chi * b.r1);
  return rSum + rBO - rEN;
}

function bondForceConstant(ti, tj, rij) {
  return BETA * (UFF_PARAMS[ti].Z * UFF_PARAMS[tj].Z) / (rij ** 3);
}

function angleForceConstant(ti, tj, tk, rij, rjk, theta0) {
  const t = theta0 * RAD;
  const rik2 = rij * rij + rjk * rjk - 2 * rij * rjk * Math.cos(t);
  const rik = Math.sqrt(rik2);
  const c = Math.cos(t);
  return BETA * (UFF_PARAMS[ti].Z * UFF_PARAMS[tk].Z) / (rik ** 5)
       * rij * rjk * (3 * rij * rjk * (1 - c * c) - rik2 * c);
}

// 1-2, 1-3 쌍은 vdW에서 제외한다(결합/결합각 항이 이미 담당).
function excludedPairs(mol) {
  const ex = new Set();
  const key = (i, j) => (i < j ? `${i}-${j}` : `${j}-${i}`);
  for (const b of mol.bonds) ex.add(key(b.i, b.j));
  for (let j = 0; j < mol.atoms.length; j++) {
    const nb = neighbors(mol, j);
    for (let a = 0; a < nb.length; a++)
      for (let b = a + 1; b < nb.length; b++) ex.add(key(nb[a], nb[b]));
  }
  return ex;
}

export function buildTerms(mol) {
  const types = mol.atoms.map((_, i) => typeAtom(mol, i));
  const terms = [];

  // --- 결합 신축: E = 0.5 k (r - r0)^2
  for (const b of mol.bonds) {
    const r0 = bondLength(types[b.i], types[b.j], b.order);
    const k = bondForceConstant(types[b.i], types[b.j], r0);
    terms.push({
      type: 'bond', atoms: [b.i, b.j], r0, k,
      eval(m) {
        const d = distance(m.atoms[b.i].pos, m.atoms[b.j].pos) - r0;
        return 0.5 * k * d * d;
      },
    });
  }

  // --- 결합각
  for (let j = 0; j < mol.atoms.length; j++) {
    const nb = neighbors(mol, j);
    if (nb.length < 2) continue;
    const theta0 = UFF_PARAMS[types[j]].theta0;
    for (let a = 0; a < nb.length; a++) {
      for (let c = a + 1; c < nb.length; c++) {
        const i = nb[a], k2 = nb[c];
        const rij = bondLength(types[i], types[j], bondBetween(mol, i, j).order);
        const rjk = bondLength(types[j], types[k2], bondBetween(mol, j, k2).order);
        const K = angleForceConstant(types[i], types[j], types[k2], rij, rjk, theta0);

        // 특수 각도는 주기형, 그 외는 2차 푸리에 전개
        let n = 0;
        if (Math.abs(theta0 - 180) < 0.01) n = 1;
        else if (Math.abs(theta0 - 120) < 0.01) n = 3;
        else if (Math.abs(theta0 - 90) < 0.01) n = 4;

        let evalFn;
        if (n === 1) {
          evalFn = (m) => K * (1 + Math.cos(angleDeg(m.atoms[i].pos, m.atoms[j].pos, m.atoms[k2].pos) * RAD));
        } else if (n > 1) {
          evalFn = (m) => (K / (n * n))
            * (1 - Math.cos(n * angleDeg(m.atoms[i].pos, m.atoms[j].pos, m.atoms[k2].pos) * RAD));
        } else {
          const t = theta0 * RAD;
          const C2 = 1 / (4 * Math.sin(t) ** 2);
          const C1 = -4 * C2 * Math.cos(t);
          const C0 = C2 * (2 * Math.cos(t) ** 2 + 1);
          evalFn = (m) => {
            const th = angleDeg(m.atoms[i].pos, m.atoms[j].pos, m.atoms[k2].pos) * RAD;
            return K * (C0 + C1 * Math.cos(th) + C2 * Math.cos(2 * th));
          };
        }
        terms.push({ type: 'angle', atoms: [i, j, k2], theta0, eval: evalFn });
      }
    }
  }

  // --- 비틀림: E = 0.5 * (V/nTors) * [1 - cos(n*phi0) * cos(n*phi)]
  for (const b of mol.bonds) {
    const [j, k] = [b.i, b.j];
    const nbJ = neighbors(mol, j).filter((x) => x !== k);
    const nbK = neighbors(mol, k).filter((x) => x !== j);
    if (!nbJ.length || !nbK.length) continue;
    const hj = hybridization(types[j]), hk = hybridization(types[k]);
    if (hj === 'sp' || hk === 'sp') continue; // 선형 중심은 비틀림 없음

    const pj = UFF_PARAMS[types[j]], pk = UFF_PARAMS[types[k]];
    const group16 = (t) => t.startsWith('O_') || t.startsWith('S_');
    let V, n, phi0;
    if (hj === 'sp3' && hk === 'sp3') {
      if (group16(types[j]) && group16(types[k])) {
        // 16족 sp3-sp3 (과산화물/이황화물) 특수 규칙
        const vj = types[j].startsWith('O_') ? 2.0 : 6.8;
        const vk = types[k].startsWith('O_') ? 2.0 : 6.8;
        V = Math.sqrt(vj * vk); n = 2; phi0 = 90;
      } else { V = Math.sqrt(pj.V * pk.V); n = 3; phi0 = 60; }
    } else if (hj === 'sp2' && hk === 'sp2') {
      V = 5 * Math.sqrt(pj.U * pk.U) * (1 + 4.18 * Math.log(b.order));
      n = 2; phi0 = 180;
    } else {
      V = 1.0; n = 6; phi0 = 0; // sp2-sp3
    }
    const scaleN = nbJ.length * nbK.length; // 중심 결합당 비틀림 항 수로 장벽을 분배
    const amp = 0.5 * V / scaleN;
    const cos0 = Math.cos(n * phi0 * RAD);
    for (const i of nbJ) {
      for (const l of nbK) {
        terms.push({
          type: 'torsion', atoms: [i, j, k, l], n, phi0, V,
          eval(m) {
            const phi = dihedralDeg(m.atoms[i].pos, m.atoms[j].pos, m.atoms[k].pos, m.atoms[l].pos);
            return amp * (1 - cos0 * Math.cos(n * phi * RAD));
          },
        });
      }
    }
  }

  // --- vdW (LJ 12-6): E = D [ (x0/r)^12 - 2 (x0/r)^6 ]
  const ex = excludedPairs(mol);
  for (let i = 0; i < mol.atoms.length; i++) {
    for (let j = i + 1; j < mol.atoms.length; j++) {
      if (ex.has(`${i}-${j}`)) continue;
      const x0 = Math.sqrt(UFF_PARAMS[types[i]].x1 * UFF_PARAMS[types[j]].x1);
      const D = Math.sqrt(UFF_PARAMS[types[i]].D1 * UFF_PARAMS[types[j]].D1);
      terms.push({
        type: 'vdw', atoms: [i, j], x0, D,
        eval(m) {
          const r = Math.max(distance(m.atoms[i].pos, m.atoms[j].pos), 0.3); // 특이점 방지
          const s = (x0 / r) ** 6;
          return D * (s * s - 2 * s);
        },
      });
    }
  }

  return terms;
}

// 항(term)은 좌표가 아니라 위상(원소 + 결합 목록)에만 의존한다 — bondLength·힘상수는
// 원자 타입에서 나오고, vdW 제외쌍도 결합 그래프에서 나온다. eval은 매번 넘겨받은 mol의
// 현재 좌표를 읽으므로, 위상이 그대로면 좌표가 아무리 움직여도 같은 항을 계속 쓸 수 있다.
export function topologyKey(mol) {
  return mol.atoms.map((a) => a.el + (a.type ?? '')).join(',')
    + '|' + mol.bonds.map((b) => `${b.i}-${b.j}:${b.order}`).join(',');
}

// render()가 클릭·슬라이더·마우스 이동마다 buildTerms를 새로 돌리던 것을 없앤다
// (vdW 항만 O(n²)개, 항마다 클로저 할당). 캐시 슬롯은 하나로 충분하다 — 앱은 한 번에
// 분자 하나만 다룬다.
// ponytail: 슬롯 1개 캐시. 여러 분자를 동시에 다루게 되면 Map으로 바꾼다.
let termCache = { key: null, terms: null };
export function cachedTerms(mol) {
  const key = topologyKey(mol);
  if (termCache.key !== key) termCache = { key, terms: buildTerms(mol) };
  return termCache.terms;
}

export function energy(mol, terms = buildTerms(mol)) {
  const byType = { bond: 0, angle: 0, torsion: 0, vdw: 0 };
  const perAtom = new Array(mol.atoms.length).fill(0);
  const perBond = new Map();
  const detail = [];
  for (const t of terms) {
    const e = t.eval(mol);
    byType[t.type] += e;
    const share = e / t.atoms.length;
    for (const a of t.atoms) perAtom[a] += share;
    if (t.type === 'bond') {
      const [i, j] = t.atoms;
      perBond.set(`${Math.min(i, j)}-${Math.max(i, j)}`, e);
    }
    detail.push({ type: t.type, atoms: t.atoms, e });
  }
  const total = byType.bond + byType.angle + byType.torsion + byType.vdw;
  return { total, byType, perAtom, perBond, terms: detail };
}

// 해석적 미분 대신 항별 국소 중심차분을 쓴다.
// 각 항은 원자 2~4개만 참조하므로 항당 비용이 상수이고, 전체는 항 수에 선형이다.
// 토션 해석 미분보다 코드가 훨씬 짧고 오차는 1e-6 수준. 수천 원자 규모로 키우려면 해석 미분으로 교체.
const H_STEP = 1e-5;

export function gradient(mol, terms = buildTerms(mol)) {
  const g = new Float64Array(mol.atoms.length * 3);
  for (const t of terms) {
    for (const a of t.atoms) {
      const p = mol.atoms[a].pos;
      for (let d = 0; d < 3; d++) {
        const o = p[d];
        p[d] = o + H_STEP; const ep = t.eval(mol);
        p[d] = o - H_STEP; const em = t.eval(mol);
        p[d] = o;
        g[3 * a + d] += (ep - em) / (2 * H_STEP);
      }
    }
  }
  return g;
}

// 백트래킹 선탐색을 붙인 최급강하법.
export function minimize(mol, opts = {}) {
  const {
    maxSteps = 400, gradTol = 0.05, recordTrajectory = false, frozen = new Set(),
  } = opts;
  const terms = buildTerms(mol);
  const energyBefore = energy(mol, terms).total;
  let e = energyBefore;
  let step = 0.05; // Å
  const trajectory = [];
  let converged = false;
  let s = 0;

  for (; s < maxSteps; s++) {
    const g = gradient(mol, terms);
    for (const f of frozen) { g[3 * f] = g[3 * f + 1] = g[3 * f + 2] = 0; }
    let gmax = 0;
    for (let i = 0; i < g.length; i++) gmax = Math.max(gmax, Math.abs(g[i]));
    if (gmax < gradTol) { converged = true; break; }

    let gnorm = 0;
    for (let i = 0; i < g.length; i++) gnorm += g[i] * g[i];
    gnorm = Math.sqrt(gnorm);
    const saved = mol.atoms.map((a) => [...a.pos]);
    let accepted = false;
    for (let trial = 0; trial < 12; trial++) {
      for (let i = 0; i < mol.atoms.length; i++) {
        for (let d = 0; d < 3; d++) {
          mol.atoms[i].pos[d] = saved[i][d] - (step * g[3 * i + d]) / gnorm;
        }
      }
      const eNew = energy(mol, terms).total;
      if (eNew < e) { e = eNew; step *= 1.2; accepted = true; break; }
      for (let i = 0; i < mol.atoms.length; i++) mol.atoms[i].pos = [...saved[i]];
      step *= 0.5;
    }
    if (!accepted) { converged = true; break; } // 더 내려갈 곳이 없음
    if (recordTrajectory) {
      trajectory.push({ energy: e, positions: mol.atoms.map((a) => [...a.pos]) });
    }
  }

  return { steps: s, energyBefore, energyAfter: e, converged, trajectory };
}

// 이면각 스캔. relax=false면 강체 회전(빠름), true면 스캔 좌표를 고정한 제약 최소화(느림).
export function scanDihedral(mol, idx, { stepDeg = 10, relax = false } = {}) {
  if (!isTorsionChain(mol, idx)) {
    throw new Error('선택한 원자 4개가 이어진 이면각이 아닙니다 (i-j-k-l이 전부 결합돼 있어야 합니다)');
  }
  const snapshot = mol.atoms.map((a) => [...a.pos]);
  const out = [];
  for (let angle = -180; angle <= 180; angle += stepDeg) {
    for (let i = 0; i < mol.atoms.length; i++) mol.atoms[i].pos = [...snapshot[i]];
    if (!setDihedral(mol, idx, angle)) throw new Error('고리 결합은 스캔할 수 없습니다');
    if (relax) {
      // 이면각만 구속한 완화를 투영법으로 구현한다: 자유 최소화와 이면각 재설정을 번갈아 적용.
      // idx의 원자 4개를 frozen으로 얼리면 안 된다 — 가려진 배좌에서 C-C-C 각이 벌어지며
      // 응력을 푸는 실제 완화 경로가 막혀 부탄 syn 장벽이 10.5 -> 20.5 kcal/mol로 부풀었다.
      for (let k = 0; k < 12; k++) {
        minimize(mol, { maxSteps: 40 });
        setDihedral(mol, idx, angle);
      }
    }
    out.push({ angle, energy: energy(mol).total });
  }
  for (let i = 0; i < mol.atoms.length; i++) mol.atoms[i].pos = [...snapshot[i]];
  const min = Math.min(...out.map((p) => p.energy));
  return out.map((p) => ({ ...p, relative: p.energy - min }));
}
