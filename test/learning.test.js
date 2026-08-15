import test from 'node:test';
import assert from 'node:assert/strict';
import { addAtom, addBond, aromatize, createMolecule, valenceUsed } from '../src/model.js';
import { loadPreset } from '../src/presets.js';
import { canBond, slotKinds } from '../src/snap.js';
import { aromaticRingSummary, axialEquatorialLabels, compareStructuralIsomerCandidate, degreeOfUnsaturation, findCloseNonbondedContacts, identifyFunctionalGroups, scanTorsion, torsionInterpretation } from '../src/learning.js';

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

test('degreeOfUnsaturation follows the neutral molecular-formula rule for core teaching presets', () => {
  assert.deepEqual(degreeOfUnsaturation(loadPreset('methane')), { formula: 'CH4', value: 0, valid: true, counts: { C: 1, H: 4 } });
  assert.equal(degreeOfUnsaturation(loadPreset('ethylene')).value, 1);
  assert.equal(degreeOfUnsaturation(loadPreset('butane')).value, 0);
});

test('axialEquatorialLabels classifies external cyclohexane chair bonds by ring-plane alignment', () => {
  const labels = axialEquatorialLabels(loadPreset('cyclohexane_chair'));
  assert.equal(labels.length, 12);
  assert.ok(labels.some((label) => label.kind === 'axial'));
  assert.ok(labels.some((label) => label.kind === 'equatorial'));
});

test('aromatize recognises a furan-style lone-pair contribution without treating it as a valence overflow', () => {
  const m = createMolecule();
  const positions = [[1, 0, 0], [0.3, 0.95, 0], [-0.8, 0.6, 0], [-0.8, -0.6, 0], [0.3, -0.95, 0]];
  positions.forEach((pos, index) => addAtom(m, index === 3 ? 'O' : 'C', pos));
  addBond(m, 0, 1, 2); addBond(m, 1, 2, 1); addBond(m, 2, 4, 2); addBond(m, 4, 3, 1); addBond(m, 3, 0, 1);
  aromatize(m);
  assert.equal(m.atoms[3].type, 'O_R');
  assert.equal(m.atoms[3].aromaticLonePair, true);
  assert.deepEqual(aromaticRingSummary(m).map((ring) => ring.piElectrons), [6]);
});

test('pyrrole-style nitrogen contributes its lone pair without a false valence or lone-pair-slot signal', () => {
  const m = createMolecule();
  const positions = [[1, 0, 0], [0.3, 0.95, 0], [-0.8, 0.6, 0], [-0.8, -0.6, 0], [0.3, -0.95, 0]];
  positions.forEach((pos, index) => addAtom(m, index === 3 ? 'N' : 'C', pos));
  addBond(m, 0, 1, 2); addBond(m, 1, 2, 1); addBond(m, 2, 4, 2); addBond(m, 4, 3, 1); addBond(m, 3, 0, 1);
  const h = addAtom(m, 'H', [-1.8, -0.6, 0]);
  addBond(m, 3, h);
  aromatize(m);
  assert.equal(m.atoms[3].type, 'N_R');
  assert.equal(m.atoms[3].aromaticLonePair, true);
  assert.equal(valenceUsed(m, 3), 3);
  assert.ok(slotKinds(m, 3).every((slot) => slot.kind === 'bond'));
  const trial = addAtom(m, 'H', [-1.8, -1.3, 0]);
  assert.equal(canBond(m, 3, trial).reason, 'valence-full');
});

test('compareStructuralIsomerCandidate distinguishes same connectivity, changed connectivity, and changed formula', () => {
  const reference = loadPreset('ethylene');
  const same = loadPreset('ethylene');
  const connectivityChanged = loadPreset('ethylene');
  connectivityChanged.bonds[0].order = 1;
  const formulaChanged = loadPreset('methane');
  assert.equal(compareStructuralIsomerCandidate(reference, same).kind, 'same-connectivity');
  assert.equal(compareStructuralIsomerCandidate(reference, connectivityChanged).kind, 'constitutional-isomer-candidate');
  assert.equal(compareStructuralIsomerCandidate(reference, formulaChanged).kind, 'different-formula');
});
