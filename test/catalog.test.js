import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseRecord, parseSdf, searchCatalog, structureFallbackText, structureUrl, STRUCTURE_IMAGE_STATES } from '../src/catalog.js';

const records = [
  { id: 1, name: '2-acetyloxybenzoic acid', commonName: 'Aspirin', molecularFormula: 'C9H8O4', casNumber: '50-78-2', canonicalSmiles: 'CC(=O)OC1=CC=CC=C1C(=O)O', category: 'drug', molecularWeight: '180.16' },
  { id: 2, name: 'oxidane', commonName: 'Water', molecularFormula: 'H2O', casNumber: '7732-18-5', canonicalSmiles: 'O', category: 'inorganic', molecularWeight: '18.015' },
];

test('searchCatalog searches name, formula, CAS, and SMILES with category filtering', () => {
  assert.equal(searchCatalog(records, { query: '50-78-2' })[0].id, 1);
  assert.equal(searchCatalog(records, { query: 'H2O', category: 'inorganic' })[0].id, 2);
  assert.equal(searchCatalog(records, { query: 'CC(=O)' })[0].id, 1);
  assert.equal(searchCatalog(records, { category: 'drug' }).length, 1);
});

test('normaliseRecord converts Supabase snake case to catalogue field names', () => {
  assert.deepEqual(normaliseRecord({ id: 1, common_name: 'Water', molecular_formula: 'H2O', pubchem_cid: 962 }), { id: 1, commonName: 'Water', molecularFormula: 'H2O', pubchemCid: 962, slug: undefined, name: undefined, casNumber: undefined, molecularWeight: undefined, canonicalSmiles: undefined, isomericSmiles: undefined, category: undefined, xlogp: undefined, hBondDonorCount: undefined, hBondAcceptorCount: undefined, rotatableBondCount: undefined, exactMass: undefined, topologicalPolarSurfaceArea: undefined, complexity: undefined, charge: undefined, boilingPoint: undefined, meltingPoint: undefined, density: undefined, solubility: undefined, appearance: undefined, source: undefined, sourceUrl: undefined });
});

test('parseSdf creates the existing molecule model shape from an SDF record', () => {
  const sdf = `water\n  mol-craft\n\n  3  2  0  0  0  0            999 V2000\n    0.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0\n    0.7586    0.5043    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0\n   -0.7586    0.5043    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0\n  1  2  1  0\n  1  3  1  0\nM  END\n`;
  assert.deepEqual(parseSdf(sdf), { atoms: [{ el: 'O', pos: [0, 0, 0] }, { el: 'H', pos: [0.7586, 0.5043, 0] }, { el: 'H', pos: [-0.7586, 0.5043, 0] }], bonds: [{ i: 0, j: 1, order: 1 }, { i: 0, j: 2, order: 1 }] });
});

test('structure image helpers expose a bounded loading state model and a formula fallback', () => {
  assert.deepEqual(STRUCTURE_IMAGE_STATES, ['loading', 'ready', 'retrying', 'fallback', 'unavailable']);
  assert.match(structureUrl({ pubchemCid: 2244 }), /compound\/cid\/2244\/PNG/);
  assert.equal(structureUrl({}), '');
  assert.equal(structureFallbackText({ molecularFormula: 'C9H8O4', commonName: 'Aspirin' }), 'C9H8O4');
  assert.equal(structureFallbackText({ commonName: 'Aspirin' }), 'Aspirin');
});

const fixture = async (name) => (await import('node:fs')).readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('parseSdf는 M  CHG 형식전하를 읽어 질산을 원자가 오류 없이 불러온다', async () => {
  const { stability } = await import('../src/snap.js');
  const m = parseSdf(await fixture('nitric-acid-pubchem3d.sdf'));
  assert.deepEqual(m.atoms.map((a) => a.charge ?? 0), [0, -1, 0, 1, 0]);
  assert.deepEqual(stability(m).issues, []);
});

test('parseSdf는 M  CHG가 없을 때 원자 블록 전하 코드를 읽는다', () => {
  const sdf = ['x', '', '', '  2  1  0  0  0  0  0  0  0  0999 V2000',
    '    0.0000    0.0000    0.0000 N   0  3  0  0  0  0  0  0  0  0  0  0',
    '    1.0000    0.0000    0.0000 O   0  5  0  0  0  0  0  0  0  0  0  0',
    '  1  2  1  0  0  0  0', 'M  END'].join('\n');
  assert.deepEqual(parseSdf(sdf).atoms.map((a) => a.charge), [1, -1]);
});

test('2D SDF에서 만든 3D 구조는 쐐기의 R/S를 보존하고 미지정 입체중심은 판정하지 않는다', async () => {
  const { liftFlatStructure } = await import('../src/catalog.js');
  const { stereochemicalAssignments } = await import('../src/learning.js');
  const { stability } = await import('../src/snap.js');
  // 기대값: RDKit rdCIPLabeler가 2D 쐐기에서 읽은 라벨. 글루코스 아노머 탄소(10)는 레코드에서 미지정.
  const expected = {
    'alanine-pubchem2d.sdf': { 3: 'S' },
    'glucose-pubchem2d.sdf': { 6: 'S', 7: 'S', 8: 'R', 9: 'R' },
    'sucrose-pubchem2d.sdf': { 11: 'S', 12: 'S', 13: 'S', 14: 'R', 15: 'R', 16: 'R', 17: 'S', 18: 'S', 19: 'R' },
  };
  for (const [name, want] of Object.entries(expected)) {
    const m = liftFlatStructure(parseSdf(await fixture(name)));
    assert.ok(m.atoms.some((a) => Math.abs(a.pos[2]) > 0.3), `${name}: 평면에 남아 있다`);
    assert.deepEqual(Object.fromEntries(stereochemicalAssignments(m).rs.map((x) => [x.center, x.configuration])), want, name);
    assert.ok(stability(m).score >= 88, `${name}: 최적화 후 안정도 ${stability(m).score}`);
  }
});
