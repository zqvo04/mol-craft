import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const source = async (relative) => readFile(new URL(relative, root), 'utf8');

test('교육형 인터페이스의 핵심 상호작용 계약이 마크업·앱 코드에 함께 존재한다', async () => {
  const [html, app, catalogCss, menuSelect, learning] = await Promise.all([
    source('index.html'), source('src/app.js'), source('src/catalog.css'), source('src/menu-select.js'), source('src/learning.js'),
  ]);
  assert.match(html, /id="structure-library-toggle"/);
  assert.match(html, /id="learning-panel"/);
  assert.match(html, /id="learning-geometry"/);
  assert.match(html, /id="learning-stereo"/);
  assert.match(html, /id="learning-spectroscopy"/);
  assert.match(html, /id="learning-bioorganic"/);
  assert.match(html, /id="torsion-scan"/);
  assert.match(app, /structureLibrary\.onclick/);
  assert.match(app, /setTool\('ring'\)/);
  assert.match(app, /function setInspectorTab/);
  assert.match(app, /scanTorsion\(state\.mol, state\.selection, 30\)/);
  assert.match(catalogCss, /catalog-slide-in/);
  assert.match(html, /id="overlay-root"/);
  assert.match(app, /signalViewer\('success'\)/);
  assert.match(app, /stereochemicalAssignments\(state\.mol\)/);
  assert.match(app, /predictedIrBands\(state\.mol\)/);
  assert.match(app, /protonNmrSignals\(state\.mol\)/);
  assert.match(app, /펩타이드 결합의 평면성/);
  assert.match(app, /5′→3′ 방향성/);
  assert.match(app, /nucleobaseLabels\(state\.mol\)/);
  assert.match(app, /formalChargeSummary\(state\.mol\)/);
  assert.match(app, /electrostaticContacts\(state\.mol\)/);
  assert.match(app, /반응성 예측의 경계/);
  assert.match(app, /educationalSketch/);
  assert.match(app, /이 구조에는 DoU·분자식 완결성·구조 이성질체 판정을 적용하지 않습니다/);
  assert.match(app, /교육용 좌표에는 정전기 쌍·UFF vdW 충돌을 적용하지 않습니다/);
  assert.match(learning, /카복실레이트 COO⁻/);
  assert.match(html, /id="charge-minus"/);
  assert.match(html, /id="charge-plus"/);
  assert.match(menuSelect, /createMenuSelect/);
  assert.match(html, /id="build-console"/);
  assert.match(html, /id="selection-context"/);
  assert.match(html, /id="recent-palette"/);
  assert.match(html, /id="redo"/);
  assert.match(html, /id="slot-ring"/);
  assert.match(html, /id="anchor-candidates"/);
  assert.match(app, /function redo\(\)/);
  assert.match(app, /function startFragment2D\(\)/);
  assert.match(app, /function directionFromSketchDrag\(/);
  assert.match(app, /function openSlotRing\(/);
  assert.match(app, /function openAnchorCandidates\(/);
  assert.match(app, /Ctrl\+Shift\+Z/);
});

test('접근성·감소된 모션 스타일 계약이 유지된다', async () => {
  const [html, catalogCss] = await Promise.all([source('index.html'), source('src/catalog.css')]);
  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(catalogCss, /prefers-reduced-motion: reduce/);
  assert.match(html, /canvas-halo/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /aria-label="가능한 결합 자리"/);
});

test('P5 조립·선택·슬롯 편집은 스크린리더와 키보드 대체 경로를 제공한다', async () => {
  const [html, app] = await Promise.all([source('index.html'), source('src/app.js')]);
  assert.match(html, /id="selection-context" aria-label="선택 편집" aria-live="polite"/);
  assert.match(html, /id="slot-ring" aria-label="가능한 결합 자리"/);
  assert.match(html, /id="toast" role="status" aria-live="polite"/);
  assert.match(app, /aria-label="\$\{label\}"/);
  assert.match(app, /ev\.key === 'Enter' && state\.tool === 'place'/);
  assert.match(app, /button:not\(\.lonepair\)/);
});
