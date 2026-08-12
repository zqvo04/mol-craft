// 미션 패널. 채점·진단·힌트·probe는 mission.js가 전부 처리하므로 여기서는 화면만 만든다.
import { MISSIONS } from './mission-data.js';
import { evaluate, maxHintLevel, loadStart, runProbe, validateMission } from './mission.js';

const LS_KEY = 'molcraft:progress';

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) ?? {}; }
  catch { return {}; }
}

function saveProgress(p) {
  // 저장 실패(용량 초과·프라이빗 모드)가 앱을 막으면 안 된다 — app.js의 saveLocal과 같은 정책이다.
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* 무시 */ }
}

const entryFor = (p, id) => p[id] ?? { status: 'todo', attempts: 0, hintLevel: 0 };
const STATUS_ICON = { todo: '·', failed: '✗', passed: '✓' };

export function initMissionPanel(root, hooks) {
  for (const m of MISSIONS) validateMission(m); // 저작 오류를 첫 화면에서 드러낸다
  let progress = loadProgress();
  let current = null;   // 진행 중 미션
  let answer = null;    // predict/classify/measure의 선택
  let locked = false;   // predict: 답을 확정했는가
  let probeRows = null;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  function renderList() {
    root.replaceChildren();
    root.append(el('h2', null, '미션'));

    const chapters = [...new Set(MISSIONS.map((m) => m.chapter))].sort((a, b) => a - b);
    const sel = el('select');
    sel.append(new Option('전체', 'all'));
    for (const c of chapters) sel.append(new Option(`${c}장`, String(c)));
    root.append(sel);

    const list = el('div', 'mission-list');
    root.append(list);

    const paint = () => {
      list.replaceChildren();
      const shown = MISSIONS.filter((m) => sel.value === 'all' || String(m.chapter) === sel.value)
        // 틀린 미션을 위로 올린다 — 오답 큐.
        .sort((a, b) => (entryFor(progress, b.id).status === 'failed' ? 1 : 0)
                      - (entryFor(progress, a.id).status === 'failed' ? 1 : 0));
      for (const m of shown) {
        const b = el('button', 'mission-item',
          `${STATUS_ICON[entryFor(progress, m.id).status]} ${m.chapter}장 · ${m.title}`);
        b.addEventListener('click', () => open(m));
        list.append(b);
      }
    };
    sel.addEventListener('change', paint);
    paint();
  }

  function open(m) {
    current = m;
    answer = null;
    locked = false;
    probeRows = null;
    try {
      hooks.loadMolecule(loadStart(m.start));
    } catch (e) {
      // 시작구조 해석 실패는 이 미션 카드에만 남긴다 — 다른 미션은 그대로 열린다.
      // 저장하지 않는다: 데이터 문제라 진도에 남길 실패가 아니다.
      progress[m.id] = { ...entryFor(progress, m.id), message: `시작 구조 오류: ${e.message}` };
    }
    renderCard();
  }

  function renderCard() {
    const m = current;
    const st = entryFor(progress, m.id);
    root.replaceChildren();

    const back = el('button', 'mission-back', '← 미션 목록');
    back.addEventListener('click', () => { current = null; renderList(); });
    root.append(back);

    root.append(el('h2', null, m.title));
    root.append(el('div', 'mission-meta', `${m.chapter}장 · ${m.concept}`));
    root.append(el('p', 'mission-brief', m.brief));

    if (m.choices) {
      const box = el('div', 'mission-choices');
      for (const c of m.choices) {
        const b = el('button', 'mission-choice', c.label);
        if (answer === c.id) b.classList.add('active');
        b.disabled = locked;
        b.addEventListener('click', () => { answer = c.id; renderCard(); });
        box.append(b);
      }
      root.append(box);
    }

    const submit = el('button', 'mission-submit',
      m.type === 'predict' && !locked ? '답을 확정하고 계산 실행' : '제출');
    submit.addEventListener('click', onSubmit);
    root.append(submit);

    if (probeRows) {
      const box = el('div', 'mission-probe');
      box.append(el('h3', null, '계산 결과'));
      for (const r of probeRows.rows) box.append(el('div', null, `${r.label}: ${r.text}`));
      box.append(el('div', 'mission-trust',
        `${probeRows.trust.badge} ${probeRows.trust.label} — ${probeRows.trust.note}`));
      root.append(box);
    }

    if (st.message) {
      root.append(el('div', st.status === 'passed' ? 'mission-ok' : 'mission-bad', st.message));
    }

    const cap = maxHintLevel(st.attempts);
    const hintBtn = el('button', 'mission-hint',
      st.hintLevel >= cap ? `힌트 (${st.hintLevel}/${cap} — 더 시도해야 열립니다)` : '힌트 보기');
    hintBtn.disabled = st.hintLevel >= cap;
    hintBtn.addEventListener('click', () => {
      progress[m.id] = { ...st, hintLevel: st.hintLevel + 1 };
      saveProgress(progress);
      renderCard();
    });
    root.append(hintBtn);

    for (let i = 0; i < st.hintLevel; i++) {
      root.append(el('div', 'mission-hint-text', `${i + 1}. ${m.hints[i]}`));
    }
  }

  function onSubmit() {
    const m = current;
    const st = entryFor(progress, m.id);

    // predict는 답을 확정해 잠근 뒤에야 계산을 돌린다 — 먼저 보여주면 학습 효과가 사라진다.
    if (m.type === 'predict' && !locked) {
      if (!answer) return;
      locked = true;
      try { probeRows = runProbe(m.probe); }
      catch (e) { probeRows = { rows: [{ label: '오류', text: e.message }], trust: TRUST_FALLBACK }; }
    }

    let out;
    try {
      out = evaluate(m, {
        mol: hooks.getMolecule(),
        selection: hooks.getSelection(),
        answer,
      });
    } catch (e) {
      // 채점 오류는 학생의 오답이 아니다 — 시도 횟수에 넣지 않는다.
      progress[m.id] = { ...st, message: `채점 오류: ${e.message}` };
      saveProgress(progress);
      return renderCard();
    }

    progress[m.id] = {
      ...st,
      attempts: st.attempts + 1,
      status: out.pass ? 'passed' : 'failed',
      message: out.pass ? '통과했습니다.' : out.diagnostic,
    };
    saveProgress(progress);
    renderCard();
  }

  renderList();
}

const TRUST_FALLBACK = { badge: '🔴', label: '계산 실패', note: '이 미션의 계산을 실행할 수 없습니다.' };
