import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const source = async (relative) => readFile(new URL(relative, root), 'utf8');

test('교육형 인터페이스의 핵심 상호작용 계약이 마크업·앱 코드에 함께 존재한다', async () => {
  const [html, app, catalogCss, menuSelect] = await Promise.all([
    source('index.html'), source('src/app.js'), source('src/catalog.css'), source('src/menu-select.js'),
  ]);
  assert.match(html, /id="structure-library-toggle"/);
  assert.match(html, /id="learning-panel"/);
  assert.match(html, /id="learning-geometry"/);
  assert.match(html, /id="torsion-scan"/);
  assert.match(app, /structureLibrary\.onclick/);
  assert.match(app, /setTool\('ring'\)/);
  assert.match(app, /function setInspectorTab/);
  assert.match(app, /scanTorsion\(state\.mol, state\.selection, 30\)/);
  assert.match(catalogCss, /catalog-slide-in/);
  assert.match(html, /id="overlay-root"/);
  assert.match(app, /signalViewer\('success'\)/);
  assert.match(menuSelect, /createMenuSelect/);
});

test('접근성·감소된 모션 스타일 계약이 유지된다', async () => {
  const [html, catalogCss] = await Promise.all([source('index.html'), source('src/catalog.css')]);
  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(catalogCss, /prefers-reduced-motion: reduce/);
  assert.match(html, /canvas-halo/);
});
