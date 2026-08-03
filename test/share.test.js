import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newShareId, putShared, getShared, listGallery } from '../src/share.js';

const okFetch = (body, status = 200) => async () => ({
  ok: status < 400, status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

test('newShareId가 스키마 제약과 같은 형식을 만든다', () => {
  for (let i = 0; i < 50; i++) assert.match(newShareId(), /^[a-z0-9]{10}$/);
});

test('putShared가 성공 시 id를 반환한다', async () => {
  const id = await putShared('zABC', '테스트', { fetchImpl: okFetch(null, 201) });
  assert.match(id, /^[a-z0-9]{10}$/);
});

test('putShared가 서버 오류에서 null을 반환한다 (예외를 던지지 않는다)', async () => {
  assert.equal(await putShared('zABC', '', { fetchImpl: okFetch({ message: 'boom' }, 500) }), null);
});

test('putShared가 네트워크 실패에서 null을 반환한다', async () => {
  const boom = async () => { throw new Error('offline'); };
  assert.equal(await putShared('zABC', '', { fetchImpl: boom }), null);
});

test('getShared가 행을 반환하고, 없으면 null', async () => {
  assert.deepEqual(
    await getShared('abcdefghij', { fetchImpl: okFetch([{ payload: 'zX', title: 't' }]) }),
    { payload: 'zX', title: 't' },
  );
  assert.equal(await getShared('abcdefghij', { fetchImpl: okFetch([]) }), null);
});

test('listGallery가 실패 시 빈 배열을 반환한다', async () => {
  const boom = async () => { throw new Error('offline'); };
  assert.deepEqual(await listGallery(20, { fetchImpl: boom }), []);
});
