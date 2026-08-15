import test from 'node:test';
import assert from 'node:assert/strict';
import { addAtom, addBond, createMolecule } from '../src/model.js';
import { loadPreset } from '../src/presets.js';
import { findCloseNonbondedContacts, identifyFunctionalGroups, scanTorsion, torsionInterpretation } from '../src/learning.js';

test('identifyFunctionalGroups identifies a carbonyl and hydroxyl in acetic acid topology', () => {
  const m = createMolecule();
  const c0 = addAtom(m, 'C', [0, 0, 0]);
  const c1 = addAtom(m, 'C', [1.5, 0, 0]);
  const o1 = addAtom(m, 'O', [2.7, 0, 0]);
  const o2 = addAtom(m, 'O', [1.5, 1.2, 0]);
  const h = addAtom(m, 'H', [1.5, 2.1, 0]);
  addBond(m, c0, c1); addBond(m, c1, o1, 2); addBond(m, c1, o2); addBond(m, o2, h);
  const keys = identifyFunctionalGroups(m).map((group) => group.key);
  assert.deepEqual(keys, ['carbonyl', 'alcohol']);
});

test('torsionInterpretation provides student-facing anti, gauche, and eclipsed labels', () => {
  assert.equal(torsionInterpretation(180).title, 'anti 유사 배치');
  assert.equal(torsionInterpretation(60).title, 'gauche 유사 배치');
  assert.equal(torsionInterpretation(0).title, 'eclipsed 유사 배치');
});

test('findCloseNonbondedContacts does not mistake 1–3 hydrogen pairs in methane for steric strain', () => {
  assert.deepEqual(findCloseNonbondedContacts(loadPreset('methane')), []);
});

test('scanTorsion samples a rotatable butane dihedral and restores the original geometry', () => {
  const m = loadPreset('butane');
  const before = m.atoms.map((atom) => [...atom.pos]);
  const samples = scanTorsion(m, [0, 1, 2, 3], 60);
  assert.equal(samples.length, 7);
  assert.ok(samples.every((sample) => Number.isFinite(sample.energy)));
  assert.deepEqual(m.atoms.map((atom) => atom.pos), before);
});
