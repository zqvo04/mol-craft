import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPreset } from '../src/presets.js';
import { toXYZ, toMolBlock, toPDB, encodeState, decodeState, encodeStateAsync, decodeStateAsync } from '../src/io.js';

test('toXYZ 포맷', () => {
  const s = toXYZ(loadPreset('water'), 'test');
  const lines = s.trim().split('\n');
  assert.equal(lines[0].trim(), '3');
  assert.equal(lines[1].trim(), 'test');
  assert.match(lines[2], /^O\s+-?\d+\.\d{4}\s+-?\d+\.\d{4}\s+-?\d+\.\d{4}$/);
});

test('toMolBlock V2000 헤더/카운트 라인', () => {
  const s = toMolBlock(loadPreset('methane'));
  const lines = s.split('\n');
  assert.equal(lines[3].slice(0, 6), '  5  4');
  assert.match(lines[3], /V2000\s*$/);
  assert.ok(s.trimEnd().endsWith('M  END'));
});

test('toMolBlock 결합 블록이 1-based 인덱스를 쓴다', () => {
  const s = toMolBlock(loadPreset('water'));
  const bondLines = s.split('\n').slice(4 + 3, 4 + 3 + 2);
  assert.match(bondLines[0], /^\s+1\s+2\s+1/);
});

test('toPDB에 CONECT가 포함된다', () => {
  const s = toPDB(loadPreset('methane'));
  assert.ok(s.includes('HETATM'));
  assert.ok(s.includes('CONECT'));
  assert.ok(s.trimEnd().endsWith('END'));
});

test('encodeState/decodeState 왕복', () => {
  const m = loadPreset('sf6');
  const back = decodeState(encodeState(m));
  assert.equal(back.atoms.length, m.atoms.length);
  assert.deepEqual(back.bonds, m.bonds);
  assert.ok(Math.abs(back.atoms[1].pos[0] - m.atoms[1].pos[0]) < 0.001);
});

test('encodeState 결과가 URL 안전 문자만 포함한다', () => {
  assert.match(encodeState(loadPreset('methane')), /^[A-Za-z0-9\-_]+$/);
});

test('압축 왕복이 원본을 복원한다', async () => {
  const m = loadPreset('cyclohexane_chair');
  const enc = await encodeStateAsync(m);
  const back = await decodeStateAsync(enc);
  assert.equal(back.atoms.length, m.atoms.length);
  assert.deepEqual(back.bonds, m.bonds);
});

test('압축본이 무압축본보다 짧다', async () => {
  const m = loadPreset('sf6');
  assert.ok((await encodeStateAsync(m)).length < encodeState(m).length);
});

test('무압축 구형 링크도 계속 열린다 (하위 호환)', async () => {
  const m = loadPreset('water');
  const back = await decodeStateAsync(encodeState(m)); // 'z' 접두사 없음
  assert.equal(back.atoms.length, 3);
});

test('압축 문자열이 URL 안전 문자만 포함한다', async () => {
  assert.match(await encodeStateAsync(loadPreset('methane')), /^z[A-Za-z0-9\-_]+$/);
});
