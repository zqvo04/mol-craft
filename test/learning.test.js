import test from 'node:test';
import assert from 'node:assert/strict';
import { addAtom, addBond, aromatize, createMolecule, valenceUsed } from '../src/model.js';
import { loadPreset } from '../src/presets.js';
import { canBond, slotKinds } from '../src/snap.js';
import { typeAtom } from '../src/uff.js';
import { amideSites, aromaticRingSummary, assignEZ, assignRS, axialEquatorialLabels, cipPriorities, compareStructuralIsomerCandidate, degreeOfUnsaturation, findCloseNonbondedContacts, identifyFunctionalGroups, predictedIrBands, protonNmrSignals, scanTorsion, torsionInterpretation } from '../src/learning.js';

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

test('CIP uses atomic number ordering and signed 3D geometry for R/S assignment', () => {
  const m = createMolecule();
  const center = addAtom(m, 'C', [0, 0, 0]);
  const br = addAtom(m, 'Br', [1, 0, 0]);
  const cl = addAtom(m, 'Cl', [0, 1, 0]);
  const f = addAtom(m, 'F', [-1, 0, 0]);
  const h = addAtom(m, 'H', [0, 0, -1]);
  [br, cl, f, h].forEach((index) => addBond(m, center, index));
  assert.deepEqual(cipPriorities(m, center).priorities.map(({ element }) => element), ['Br', 'Cl', 'F', 'H']);
  assert.equal(assignRS(m, center).configuration, 'S');
  m.atoms[cl].pos[1] = -1;
  assert.equal(assignRS(m, center).configuration, 'R');
});

test('E/Z compares CIP-high substituents on each alkene carbon instead of cis/trans labels', () => {
  const m = createMolecule();
  const left = addAtom(m, 'C', [-0.6, 0, 0]);
  const right = addAtom(m, 'C', [0.6, 0, 0]);
  const cl = addAtom(m, 'Cl', [-1.4, 1, 0]);
  const hLeft = addAtom(m, 'H', [-1.4, -1, 0]);
  const br = addAtom(m, 'Br', [1.4, 1, 0]);
  const hRight = addAtom(m, 'H', [1.4, -1, 0]);
  addBond(m, left, right, 2); addBond(m, left, cl); addBond(m, left, hLeft); addBond(m, right, br); addBond(m, right, hRight);
  assert.equal(assignEZ(m, m.bonds[0]).configuration, 'Z');
  m.atoms[br].pos[1] = -1;
  m.atoms[hRight].pos[1] = 1;
  assert.equal(assignEZ(m, m.bonds[0]).configuration, 'E');
});

test('amide nitrogen is promoted to an sp2 resonance type and gives an amide IR teaching band', () => {
  const m = createMolecule();
  const methyl = addAtom(m, 'C', [-1.5, 0, 0]);
  const carbonyl = addAtom(m, 'C', [0, 0, 0]);
  const oxygen = addAtom(m, 'O', [1.2, 0, 0]);
  const nitrogen = addAtom(m, 'N', [0, 1.2, 0]);
  const hN = addAtom(m, 'H', [0, 2.1, 0]);
  addBond(m, methyl, carbonyl); addBond(m, carbonyl, oxygen, 2); addBond(m, carbonyl, nitrogen); addBond(m, nitrogen, hN);
  assert.equal(typeAtom(m, nitrogen), 'N_R');
  assert.deepEqual(amideSites(m).map(({ planarModel }) => planarModel), [true]);
  assert.deepEqual(amideSites(m)[0].planeAtoms, [oxygen, carbonyl, nitrogen]);
  assert.ok(predictedIrBands(m).some((band) => band.label === '아마이드 C=O' && band.range === '1630–1690 cm⁻¹'));
});

test('ethanol-style explicit hydrogens yield a 3:2:1 integral pattern and preserve the OH exchange exception', () => {
  const m = createMolecule();
  const c0 = addAtom(m, 'C', [0, 0, 0]); const c1 = addAtom(m, 'C', [1.5, 0, 0]); const o = addAtom(m, 'O', [2.7, 0, 0]);
  addBond(m, c0, c1); addBond(m, c1, o);
  [[-0.5, 0.8, 0], [-0.5, -0.8, 0], [0, 0, 1]].forEach((pos) => addBond(m, c0, addAtom(m, 'H', pos)));
  [[1.5, 0.8, 0], [1.5, -0.8, 0]].forEach((pos) => addBond(m, c1, addAtom(m, 'H', pos)));
  addBond(m, o, addAtom(m, 'H', [3.4, 0, 0]));
  const nmr = protonNmrSignals(m);
  assert.deepEqual(nmr.signals.map((signal) => signal.integral), [3, 2, 1]);
  assert.equal(nmr.signals.find((signal) => signal.integral === 3).multiplicity, 't');
  assert.equal(nmr.signals.find((signal) => signal.integral === 2).multiplicity, 'q');
  assert.equal(nmr.signals.find((signal) => signal.integral === 1).multiplicity, '넓은 s(교환)');
});
