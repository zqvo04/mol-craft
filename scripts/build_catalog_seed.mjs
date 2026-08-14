import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const inputPath = resolve('src/molecules.catalog.json');
const outputDir = resolve('/home/ubuntu/supabase_catalog_seed_batches');
const projectId = 'erqvcpdpvrecjdfmtsue';
const records = JSON.parse(await readFile(inputPath, 'utf8'));

const columns = [
  ['slug', 'slug'], ['name', 'name'], ['commonName', 'common_name'], ['pubchemCid', 'pubchem_cid'],
  ['casNumber', 'cas_number'], ['molecularFormula', 'molecular_formula'], ['molecularWeight', 'molecular_weight'],
  ['canonicalSmiles', 'canonical_smiles'], ['isomericSmiles', 'isomeric_smiles'], ['category', 'category'],
  ['xlogp', 'xlogp'], ['hBondDonorCount', 'h_bond_donor_count'], ['hBondAcceptorCount', 'h_bond_acceptor_count'],
  ['rotatableBondCount', 'rotatable_bond_count'], ['exactMass', 'exact_mass'],
  ['topologicalPolarSurfaceArea', 'topological_polar_surface_area'], ['complexity', 'complexity'], ['charge', 'charge'],
  ['boilingPoint', 'boiling_point'], ['meltingPoint', 'melting_point'], ['density', 'density'], ['solubility', 'solubility'],
  ['appearance', 'appearance'], ['source', 'source'], ['sourceUrl', 'source_url'],
];
const numeric = new Set(['pubchemCid', 'molecularWeight', 'xlogp', 'hBondDonorCount', 'hBondAcceptorCount', 'rotatableBondCount', 'exactMass', 'topologicalPolarSurfaceArea', 'complexity', 'charge']);
const dbColumns = columns.map(([, databaseColumn]) => databaseColumn);
const escapeSql = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sqlValue = (record, [sourceColumn]) => {
  const value = record[sourceColumn];
  if (value === null || value === undefined || value === '') return 'NULL';
  return numeric.has(sourceColumn) ? String(value) : escapeSql(value);
};
const updateSet = dbColumns.filter((column) => column !== 'slug').map((column) => `${column} = EXCLUDED.${column}`).join(', ');
const chunkSize = 50;
await mkdir(outputDir, { recursive: true });

for (let index = 0; index < records.length; index += chunkSize) {
  const batch = records.slice(index, index + chunkSize);
  const rows = batch.map((record) => `(${columns.map((column) => sqlValue(record, column)).join(', ')})`).join(',\n');
  const query = `INSERT INTO public.molecule_catalog (${dbColumns.join(', ')}) VALUES\n${rows}\nON CONFLICT (slug) DO UPDATE SET ${updateSet};`;
  await writeFile(resolve(outputDir, `batch-${String(index / chunkSize + 1).padStart(2, '0')}.json`), JSON.stringify({ project_id: projectId, query }));
}

console.log(`Created ${Math.ceil(records.length / chunkSize)} seed batches for ${records.length} molecules.`);
