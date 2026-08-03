import { SUPABASE } from './config.js';

const TABLE = 'shared_structures';
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const isShareEnabled = () => Boolean(SUPABASE.url && SUPABASE.key);

// 스키마의 id_format 제약(^[a-z0-9]{10}$)과 반드시 일치해야 한다.
export function newShareId() {
  const buf = new Uint8Array(10);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

const headers = () => ({
  apikey: SUPABASE.key,
  Authorization: `Bearer ${SUPABASE.key}`,
  'Content-Type': 'application/json',
});

// 공유 계층의 모든 함수는 예외를 밖으로 던지지 않는다.
// 네트워크 없음 / 프로젝트 일시정지 / 키 미설정은 전부 정상적인 폴백 상황이다.
export async function putShared(payload, title = '', { fetchImpl = fetch } = {}) {
  if (!isShareEnabled()) return null;
  const id = newShareId();
  try {
    const res = await fetchImpl(`${SUPABASE.url}/rest/v1/${TABLE}`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ id, title: title.slice(0, 80), payload }),
    });
    return res.ok ? id : null;
  } catch { return null; }
}

export async function getShared(id, { fetchImpl = fetch } = {}) {
  if (!isShareEnabled() || !/^[a-z0-9]{10}$/.test(id)) return null;
  try {
    const res = await fetchImpl(
      `${SUPABASE.url}/rest/v1/${TABLE}?id=eq.${id}&select=payload,title&limit=1`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] ?? null;
  } catch { return null; }
}

export async function listGallery(limit = 20, { fetchImpl = fetch } = {}) {
  if (!isShareEnabled()) return [];
  try {
    const res = await fetchImpl(
      `${SUPABASE.url}/rest/v1/${TABLE}?select=id,title,created_at&order=created_at.desc&limit=${limit}`,
      { headers: headers() },
    );
    return res.ok ? await res.json() : [];
  } catch { return []; }
}
