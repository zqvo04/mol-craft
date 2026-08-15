import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const cdpBase = process.env.MOL_CRAFT_CDP ?? 'http://127.0.0.1:9333';
const pageUrl = process.env.MOL_CRAFT_URL ?? 'http://127.0.0.1:8000';
const targets = await (await fetch(`${cdpBase}/json/list`)).json();
const target = targets.find((item) => item.type === 'page');
if (!target) throw new Error('No inspectable browser page found. Start Chromium with --remote-debugging-port.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const resolve = pending.get(message.id);
  if (resolve) { pending.delete(message.id); resolve(message); }
});

function send(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 8000);
    pending.set(id, (message) => {
      clearTimeout(timeout);
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    });
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForApp() {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate(`Boolean(document.getElementById('structure-library-toggle'))`)) return;
    await wait(150);
  }
  throw new Error('Mol-Craft UI did not initialize in the remote browser.');
}
async function waitForCondition(expression, description) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await evaluate(expression)) return;
    await wait(150);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}
async function pressEnter() {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await wait(50);
}

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.navigate', { url: pageUrl });
  await waitForApp();
  await send('Page.bringToFront');

  const mobileFlow = await evaluate(`(() => {
    document.getElementById('structure-library-toggle').click();
    const libraryOpen = !document.getElementById('structure-library').hidden;
    document.querySelector('[data-template="benzene"]').click();
    const ringMode = document.getElementById('toolhint').textContent.includes('벤젠');
    document.querySelector('[data-inspector-tab="learning"]').click();
    const learningVisible = !document.getElementById('learning-panel').hidden;
    document.getElementById('catalog-open').click();
    const catalogOpen = document.getElementById('catalog-dialog').open;
    return { libraryOpen, ringMode, learningVisible, catalogOpen };
  })()`);
  assert.deepEqual(mobileFlow, { libraryOpen: true, ringMode: true, learningVisible: true, catalogOpen: true });
  await waitForCondition(`document.querySelectorAll('#catalog-results .catalog-card').length > 0`, 'molecule catalog records');
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile('/tmp/mol-craft-mobile-catalog.png', Buffer.from(screenshot.data, 'base64'));
  await evaluate(`document.getElementById('catalog-close').click()`);

  await send('Page.navigate', { url: pageUrl });
  await waitForApp();
  await send('Page.bringToFront');
  await evaluate(`document.getElementById('structure-library-toggle').focus()`);
  await pressEnter();
  assert.equal(await evaluate(`!document.getElementById('structure-library').hidden`), true);
  await pressEnter();
  assert.equal(await evaluate(`document.getElementById('toolhint').textContent.includes('벤젠')`), true);

  await evaluate(`document.querySelector('[data-inspector-tab="learning"]').focus()`);
  await pressEnter();
  assert.equal(await evaluate(`!document.getElementById('learning-panel').hidden`), true);

  await evaluate(`document.getElementById('catalog-open').focus()`);
  await pressEnter();
  assert.equal(await evaluate(`document.getElementById('catalog-dialog').open`), true);
  await evaluate(`document.getElementById('catalog-close').focus()`);
  await pressEnter();
  assert.equal(await evaluate(`!document.getElementById('catalog-dialog').open`), true);

  console.log(JSON.stringify({ mobileFlow, keyboardFlow: 'passed', reducedMotion: 'emulated' }));
} finally {
  await send('Emulation.clearDeviceMetricsOverride').catch(() => undefined);
  socket.close();
}
