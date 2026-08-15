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
