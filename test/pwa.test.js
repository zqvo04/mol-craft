import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const source = (relative) => readFile(new URL(relative, root), 'utf8');

test('설치형 모바일 웹의 매니페스트·오프라인 화면·서비스 워커 계약이 존재한다', async () => {
  const [manifest, worker, offline, html] = await Promise.all([
    source('manifest.webmanifest'), source('service-worker.js'), source('offline.html'), source('index.html'),
  ]);
  const data = JSON.parse(manifest);
  assert.equal(data.display, 'standalone');
  assert.equal(data.lang, 'ko');
  assert.ok(data.icons.some((icon) => icon.src === 'icons/mol-craft-icon.svg'));
  assert.match(worker, /const APP_SHELL/);
  assert.match(worker, /offline\.html/);
  assert.match(worker, /self\.addEventListener\('fetch'/);
  assert.match(offline, /다시 시도/);
  assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
});
