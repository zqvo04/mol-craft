import { SUPABASE } from './config.js';

const FAVORITES_KEY = 'mol-craft:catalog-favorites';
const COMPARE_KEY = 'mol-craft:catalog-compare';
const SUPPORTED_ELEMENTS = new Set(['H', 'C', 'N', 'O', 'F', 'S', 'P', 'Cl', 'Si', 'B', 'Br', 'I']);

export const CATEGORY_LABEL = {
  inorganic: '무기', organic: '유기', solvent: '용매', biochemical: '생화학', drug: '약물', polymer: '고분자 전구체',
};

export function normaliseRecord(row) {
  if ('commonName' in row) return row;
  return {
    id: row.id, slug: row.slug, name: row.name, commonName: row.common_name, pubchemCid: row.pubchem_cid,
    casNumber: row.cas_number, molecularFormula: row.molecular_formula, molecularWeight: row.molecular_weight,
    canonicalSmiles: row.canonical_smiles, isomericSmiles: row.isomeric_smiles, category: row.category,
    xlogp: row.xlogp, hBondDonorCount: row.h_bond_donor_count, hBondAcceptorCount: row.h_bond_acceptor_count,
    rotatableBondCount: row.rotatable_bond_count, exactMass: row.exact_mass,
    topologicalPolarSurfaceArea: row.topological_polar_surface_area, complexity: row.complexity, charge: row.charge,
    boilingPoint: row.boiling_point, meltingPoint: row.melting_point, density: row.density, solubility: row.solubility,
    appearance: row.appearance, source: row.source, sourceUrl: row.source_url,
  };
}

export function searchCatalog(records, { query = '', category = 'all', sort = 'relevance' } = {}) {
  const needle = query.trim().toLowerCase();
  const match = (record) => !needle || [record.name, record.commonName, record.molecularFormula, record.casNumber, record.canonicalSmiles]
    .filter(Boolean).some((value) => String(value).toLowerCase().includes(needle));
  const result = records.filter((record) => (category === 'all' || record.category === category) && match(record));
  return result.sort((a, b) => {
    if (sort === 'mass-asc') return Number(a.molecularWeight ?? Infinity) - Number(b.molecularWeight ?? Infinity);
    if (sort === 'mass-desc') return Number(b.molecularWeight ?? -Infinity) - Number(a.molecularWeight ?? -Infinity);
    if (sort === 'name') return (a.commonName ?? a.name).localeCompare(b.commonName ?? b.name);
    if (!needle) return (a.commonName ?? a.name).localeCompare(b.commonName ?? b.name);
    const score = (record) => {
      const values = [record.name, record.commonName, record.casNumber, record.molecularFormula].filter(Boolean).map((value) => String(value).toLowerCase());
      if (values.includes(needle)) return 0;
      if (values.some((value) => value.startsWith(needle))) return 1;
      return 2;
    };
    return score(a) - score(b) || (a.commonName ?? a.name).localeCompare(b.commonName ?? b.name);
  });
}

export function parseSdf(sdf) {
  const lines = String(sdf).replace(/\r/g, '').split('\n');
  if (lines.length < 5) return null;
  const counts = lines[3] ?? '';
  const atomCount = Number.parseInt(counts.slice(0, 3), 10);
  const bondCount = Number.parseInt(counts.slice(3, 6), 10);
  if (!Number.isInteger(atomCount) || !Number.isInteger(bondCount) || atomCount < 1) return null;
  const atoms = [];
  for (let index = 0; index < atomCount; index++) {
    const line = lines[4 + index] ?? '';
    const x = Number(line.slice(0, 10)); const y = Number(line.slice(10, 20)); const z = Number(line.slice(20, 30));
    const el = line.slice(31, 34).trim();
    if (![x, y, z].every(Number.isFinite) || !el) return null;
    atoms.push({ el, pos: [x, y, z] });
  }
  const bonds = [];
  for (let index = 0; index < bondCount; index++) {
    const line = lines[4 + atomCount + index] ?? '';
    const i = Number.parseInt(line.slice(0, 3), 10) - 1;
    const j = Number.parseInt(line.slice(3, 6), 10) - 1;
    const rawOrder = Number.parseInt(line.slice(6, 9), 10);
    if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < 0 || i >= atomCount || j >= atomCount) return null;
    bonds.push({ i: Math.min(i, j), j: Math.max(i, j), order: rawOrder === 4 ? 1.5 : Math.max(1, Math.min(3, rawOrder || 1)) });
  }
  return { atoms, bonds };
}

const getStoredIds = (key) => {
  try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]')); } catch { return new Set(); }
};
const persistIds = (key, ids) => localStorage.setItem(key, JSON.stringify([...ids]));
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const label = (record) => record.commonName || record.name;
const mass = (record) => record.molecularWeight ? `${Number(record.molecularWeight).toLocaleString('en-US', { maximumFractionDigits: 3 })} g/mol` : '—';
const structureUrl = (record, format = 'PNG') => record.pubchemCid ? `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${record.pubchemCid}/${format}?image_size=large` : '';
const sourceHeaders = () => ({ apikey: SUPABASE.key, Authorization: `Bearer ${SUPABASE.key}` });

async function loadCatalogData() {
  if (SUPABASE.url && SUPABASE.key) {
    try {
      const response = await fetch(`${SUPABASE.url}/rest/v1/molecule_catalog?select=*&order=name.asc`, { headers: sourceHeaders() });
      if (response.ok) {
        const rows = await response.json();
        if (rows.length >= 300) return { records: rows.map(normaliseRecord), source: 'Supabase' };
      }
    } catch { /* 배포 초기화·오프라인에서는 저장소 동봉 카탈로그로 폴백한다. */ }
  }
  const response = await fetch(new URL('./molecules.catalog.json', import.meta.url));
  if (!response.ok) throw new Error('catalogue unavailable');
  return { records: await response.json(), source: 'local catalogue' };
}

async function getSdfMolecule(record) {
  if (!record.pubchemCid) return null;
  for (const type of ['3d', '2d']) {
    try {
      const response = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${record.pubchemCid}/record/SDF/?record_type=${type}`);
      const molecule = response.ok ? parseSdf(await response.text()) : null;
      if (molecule) return molecule;
    } catch { /* 다음 형식을 시도한다. */ }
  }
  return null;
}

export function initCatalog() {
  const openButton = document.getElementById('catalog-open');
  const dialog = document.getElementById('catalog-dialog');
  if (!openButton || !dialog) return;
  const closeButton = document.getElementById('catalog-close');
  const results = document.getElementById('catalog-results');
  const detail = document.getElementById('catalog-detail');
  const status = document.getElementById('catalog-status');
  const count = document.getElementById('catalog-count');
  const query = document.getElementById('catalog-query');
  const category = document.getElementById('catalog-category');
  const sort = document.getElementById('catalog-sort');
  const compareButton = document.getElementById('catalog-compare');
  const compareBadge = document.getElementById('catalog-compare-count');
  let records = [];
  let favourites = getStoredIds(FAVORITES_KEY);
  let compare = getStoredIds(COMPARE_KEY);
  let selected = null;
  let loaded = false;
  let page = 1;
  const pageSize = 24;

  const updateCompare = () => {
    compareBadge.textContent = String(compare.size);
    compareButton.disabled = compare.size < 2;
    compareButton.textContent = `비교 (${compare.size}/3)`;
  };
  const toggleFavourite = (id) => { favourites.has(id) ? favourites.delete(id) : favourites.add(id); persistIds(FAVORITES_KEY, favourites); render(); };
  const toggleCompare = (id) => {
    if (compare.has(id)) compare.delete(id);
    else if (compare.size >= 3) { window.alert('분자 비교는 최대 3개까지 선택할 수 있습니다.'); return; }
    else compare.add(id);
    persistIds(COMPARE_KEY, compare); updateCompare(); render();
  };
  const filtered = () => searchCatalog(records, { query: query.value, category: category.value, sort: sort.value });
  const renderCards = () => {
    const all = filtered();
    const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
    page = Math.min(page, totalPages);
    const list = all.slice((page - 1) * pageSize, page * pageSize);
    count.textContent = `${all.length}개 · ${page}/${totalPages}쪽`;
    results.innerHTML = all.length ? `${list.map((record) => `<article class="catalog-card" data-id="${record.id}">
      <button class="catalog-favourite ${favourites.has(record.id) ? 'saved' : ''}" data-favourite="${record.id}" aria-label="${escapeHtml(label(record))} 즐겨찾기">♥</button>
      <button class="catalog-card-main" data-detail="${record.id}"><img src="${structureUrl(record)}" alt="${escapeHtml(label(record))} 구조식" loading="lazy"><span class="catalog-category ${record.category}">${CATEGORY_LABEL[record.category] ?? record.category}</span><strong>${escapeHtml(label(record))}</strong><code>${escapeHtml(record.molecularFormula ?? '—')}</code><small>${mass(record)}</small></button>
      <button class="catalog-compare ${compare.has(record.id) ? 'selected' : ''}" data-compare="${record.id}">${compare.has(record.id) ? '비교 선택됨' : '+ 비교'}</button>
    </article>`).join('')}<nav class="catalog-pagination" aria-label="분자 검색 결과 페이지"><button data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>이전</button><span>${page} / ${totalPages}</span><button data-page="${page + 1}" ${page === totalPages ? 'disabled' : ''}>다음</button></nav>` : '<p class="catalog-empty">검색 조건에 맞는 분자가 없습니다.</p>';
  };
  const renderDetail = () => {
    const currentResults = filtered();
    const record = currentResults.find((item) => item.id === selected) ?? currentResults[0];
    if (!record) { selected = null; detail.innerHTML = '<p class="catalog-empty">현재 검색 결과에서 분자를 선택하세요.</p>'; return; }
    selected = record.id;
    detail.innerHTML = `<div class="catalog-detail-head"><span class="catalog-category ${record.category}">${CATEGORY_LABEL[record.category] ?? record.category}</span><button class="catalog-favourite ${favourites.has(record.id) ? 'saved' : ''}" data-favourite="${record.id}">♥ 저장</button></div><h2>${escapeHtml(label(record))}</h2><p class="catalog-iupac">${escapeHtml(record.name)}</p><img class="catalog-structure" src="${structureUrl(record)}" alt="${escapeHtml(label(record))} 2D 구조식"><div class="catalog-formula">${escapeHtml(record.molecularFormula ?? '—')}</div><dl class="catalog-properties"><div><dt>분자량</dt><dd>${mass(record)}</dd></div><div><dt>CAS</dt><dd>${escapeHtml(record.casNumber ?? '—')}</dd></div><div><dt>XlogP</dt><dd>${escapeHtml(record.xlogp ?? '—')}</dd></div><div><dt>극성 표면적</dt><dd>${record.topologicalPolarSurfaceArea ? `${escapeHtml(record.topologicalPolarSurfaceArea)} Å²` : '—'}</dd></div><div><dt>끓는점</dt><dd>${escapeHtml(record.boilingPoint ?? '—')}</dd></div><div><dt>녹는점</dt><dd>${escapeHtml(record.meltingPoint ?? '—')}</dd></div><div><dt>밀도</dt><dd>${escapeHtml(record.density ?? '—')}</dd></div><div><dt>용해도</dt><dd>${escapeHtml(record.solubility ?? '—')}</dd></div></dl><p class="catalog-smiles-label">Connectivity SMILES</p><code class="catalog-smiles">${escapeHtml(record.canonicalSmiles ?? '—')}</code><div class="catalog-detail-actions"><button data-compare="${record.id}" class="${compare.has(record.id) ? 'selected' : ''}">${compare.has(record.id) ? '비교에서 제거' : '비교에 추가'}</button><button data-load="${record.id}">조립 도구로 불러오기</button></div><a href="${escapeHtml(record.sourceUrl)}" target="_blank" rel="noreferrer">PubChem 원본 레코드 ↗</a>`;
  };
  const render = () => { renderCards(); renderDetail(); updateCompare(); };
  const load = async () => {
    if (loaded) return;
    status.textContent = '카탈로그를 불러오는 중…';
    try { const data = await loadCatalogData(); records = data.records; status.textContent = `${data.source} · ${records.length}종`; loaded = true; render(); }
    catch { status.textContent = '카탈로그를 불러오지 못했습니다.'; }
  };
  const showCompare = () => {
    const picked = records.filter((record) => compare.has(record.id));
    detail.innerHTML = `<div class="catalog-detail-head"><span class="catalog-category">비교</span><button data-clear-compare>선택 해제</button></div><h2>분자 비교</h2><div class="catalog-comparison">${['분자식', '분자량', 'XlogP', '끓는점', '녹는점', '밀도', '용해도'].map((property) => `<div class="catalog-comparison-row"><strong>${property}</strong>${picked.map((record) => `<span><b>${escapeHtml(label(record))}</b>${escapeHtml(property === '분자식' ? record.molecularFormula : property === '분자량' ? mass(record) : property === 'XlogP' ? record.xlogp : property === '끓는점' ? record.boilingPoint : property === '녹는점' ? record.meltingPoint : property === '밀도' ? record.density : record.solubility) || '—'}</span>`).join('')}</div>`).join('')}</div>`;
  };
  openButton.addEventListener('click', async () => { dialog.showModal(); await load(); });
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  [query, category, sort].forEach((input) => input.addEventListener(input === query ? 'input' : 'change', () => { page = 1; render(); }));
  results.addEventListener('click', (event) => {
    const pageButton = event.target.closest('[data-page]');
    if (pageButton) { page = Number(pageButton.dataset.page); render(); return; }
    const id = Number(event.target.closest('[data-id], [data-detail], [data-favourite], [data-compare]')?.dataset.id ?? event.target.closest('[data-detail]')?.dataset.detail ?? event.target.closest('[data-favourite]')?.dataset.favourite ?? event.target.closest('[data-compare]')?.dataset.compare);
    if (!id) return;
    if (event.target.closest('[data-favourite]')) toggleFavourite(id); else if (event.target.closest('[data-compare]')) toggleCompare(id); else { selected = id; renderDetail(); }
  });
  detail.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-favourite], [data-compare], [data-load], [data-clear-compare]');
    if (!target) return;
    if (target.dataset.clearCompare !== undefined) { compare.clear(); persistIds(COMPARE_KEY, compare); render(); return; }
    const id = Number(target.dataset.favourite ?? target.dataset.compare ?? target.dataset.load);
    if (target.dataset.favourite !== undefined) toggleFavourite(id);
    else if (target.dataset.compare !== undefined) toggleCompare(id);
    else if (target.dataset.load !== undefined) {
      target.disabled = true; target.textContent = '구조 불러오는 중…';
      const molecule = await getSdfMolecule(records.find((record) => record.id === id));
      if (!molecule) { window.alert('PubChem 구조 데이터를 불러오지 못했습니다.'); }
      else if (!molecule.atoms.every((atom) => SUPPORTED_ELEMENTS.has(atom.el))) { window.alert('이 분자는 현재 조립 도구가 지원하지 않는 원소를 포함합니다. 카탈로그 상세·비교는 계속 이용할 수 있습니다.'); }
      else { document.dispatchEvent(new CustomEvent('mol-craft-catalog-load', { detail: { molecule, name: label(records.find((record) => record.id === id)) } })); dialog.close(); }
      target.disabled = false; target.textContent = '조립 도구로 불러오기';
    }
  });
  compareButton.addEventListener('click', showCompare);
  updateCompare();
}
