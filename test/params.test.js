import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CPK_COLOR, COVALENT_RADIUS, MAX_VALENCE } from '../src/params.js';

// app.js의 팔레트와 같은 목록. 여기 없는 원소를 팔레트에 넣으면 색이 없어 검게 그려진다.
const ELEMENTS = ['H', 'C', 'N', 'O', 'F', 'S', 'P', 'Cl', 'Si', 'B', 'Br', 'I'];

test('CPK_COLOR가 팔레트의 모든 원소를 덮는다', () => {
  for (const el of ELEMENTS) {
    assert.match(CPK_COLOR[el] ?? '', /^#[0-9a-f]{6}$/i, `${el} 색 누락`);
  }
});

test('CPK_COLOR와 COVALENT_RADIUS가 같은 원소 집합을 다룬다', () => {
  assert.deepEqual(Object.keys(CPK_COLOR).sort(), Object.keys(COVALENT_RADIUS).sort());
  assert.deepEqual(Object.keys(CPK_COLOR).sort(), Object.keys(MAX_VALENCE).sort());
});

test('수소가 탄소보다 작게 그려진다', () => {
  assert.ok(COVALENT_RADIUS.H < COVALENT_RADIUS.C);
});
