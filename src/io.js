const f4 = (x) => x.toFixed(4).padStart(10);

export function toXYZ(mol, comment = 'mol-craft') {
  const lines = [String(mol.atoms.length), comment];
  for (const a of mol.atoms) {
    lines.push(`${a.el} ${a.pos.map((v) => v.toFixed(4)).join(' ')}`);
  }
  return lines.join('\n') + '\n';
}

export function toMolBlock(mol, title = 'mol-craft') {
  const L = [title, '  mol-craft', ''];
  L.push(
    `${String(mol.atoms.length).padStart(3)}${String(mol.bonds.length).padStart(3)}` +
    '  0  0  0  0  0  0  0  0999 V2000',
  );
  for (const a of mol.atoms) {
    L.push(`${f4(a.pos[0])}${f4(a.pos[1])}${f4(a.pos[2])} ${a.el.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
  }
  for (const b of mol.bonds) {
    L.push(`${String(b.i + 1).padStart(3)}${String(b.j + 1).padStart(3)}${String(b.order).padStart(3)}  0  0  0  0`);
  }
  L.push('M  END');
  return L.join('\n') + '\n';
}

export function toPDB(mol) {
  const L = [];
  mol.atoms.forEach((a, i) => {
    L.push(
      'HETATM' + String(i + 1).padStart(5) + ' ' + (a.el + String(i + 1)).padEnd(4).slice(0, 4) +
      ' LIG A   1    ' + a.pos.map((v) => v.toFixed(3).padStart(8)).join('') +
      '  1.00  0.00          ' + a.el.padStart(2),
    );
  });
  mol.atoms.forEach((_, i) => {
    const nb = mol.bonds.filter((b) => b.i === i || b.j === i).map((b) => (b.i === i ? b.j : b.i));
    if (nb.length) {
      L.push('CONECT' + String(i + 1).padStart(5) + nb.map((n) => String(n + 1).padStart(5)).join(''));
    }
  });
  L.push('END');
  return L.join('\n') + '\n';
}

// URL 해시용 상태. base64url로 인코딩해 '#s=' 뒤에 붙인다.
const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

export function encodeState(mol) {
  const compact = {
    a: mol.atoms.map((x) => [x.el, ...x.pos.map((v) => Math.round(v * 1000) / 1000)]),
    b: mol.bonds.map((x) => [x.i, x.j, x.order]),
  };
  return b64url(JSON.stringify(compact));
}

export function decodeState(str) {
  const o = JSON.parse(unb64url(str));
  return {
    atoms: o.a.map(([el, x, y, z]) => ({ el, pos: [x, y, z] })),
    bonds: o.b.map(([i, j, order]) => ({ i, j, order })),
  };
}

// 브라우저 네이티브 CompressionStream. Node 18+에도 전역으로 있어 테스트가 그대로 돈다.
// ponytail: pako/fflate 같은 압축 라이브러리를 쓰지 않는다. 플랫폼이 이미 준다.
async function streamThrough(bytes, stream) {
  const blob = new Blob([bytes]);
  const out = blob.stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const bytesToB64url = (u8) =>
  btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlToBytes = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function encodeStateAsync(mol) {
  if (typeof CompressionStream === 'undefined') return encodeState(mol);
  const json = JSON.stringify({
    a: mol.atoms.map((x) => [x.el, ...x.pos.map((v) => Math.round(v * 1000) / 1000)]),
    b: mol.bonds.map((x) => [x.i, x.j, x.order]),
  });
  const packed = await streamThrough(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return 'z' + bytesToB64url(packed);
}

export async function decodeStateAsync(str) {
  if (!str.startsWith('z')) return decodeState(str); // 구버전 무압축 링크
  const raw = await streamThrough(b64urlToBytes(str.slice(1)), new DecompressionStream('deflate-raw'));
  const o = JSON.parse(new TextDecoder().decode(raw));
  return {
    atoms: o.a.map(([el, x, y, z]) => ({ el, pos: [x, y, z] })),
    bonds: o.b.map(([i, j, order]) => ({ i, j, order })),
  };
}

// SMILES는 정규화 알고리즘이 필요해 직접 구현하지 않는다.
// 앱에서 버튼을 누를 때만 RDKit JS(WASM, ~8MB)를 동적 로드해 한 줄로 변환한다.
export async function toSMILES(mol) {
  const initRDKitModule = window.initRDKitModule;
  if (!initRDKitModule) throw new Error('RDKit 스크립트가 로드되지 않았습니다');
  const RDKit = await initRDKitModule();
  const m = RDKit.get_mol(toMolBlock(mol));
  try { return m.get_smiles(); } finally { m.delete(); }
}
