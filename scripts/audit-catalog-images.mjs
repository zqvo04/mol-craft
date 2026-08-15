import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
};
const limit = Math.max(1, Number(arg('--limit', '300')) || 300);
const output = new URL(arg('--output', '/tmp/molcraft-catalog-image-audit.json'), import.meta.url);
const concurrency = Math.min(12, Math.max(1, Number(arg('--concurrency', '8')) || 8));
const timeoutMs = Math.max(1000, Number(arg('--timeout-ms', '5000')) || 5000);
const records = JSON.parse(await readFile(new URL('./src/molecules.catalog.json', root), 'utf8')).slice(0, limit);
const structureUrl = (record) => record.pubchemCid
  ? `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${record.pubchemCid}/PNG?image_size=large`
  : '';

async function inspect(record) {
  const url = structureUrl(record);
  if (!url) return { id: record.id, cid: record.pubchemCid ?? null, status: 'unavailable', reason: 'missing-cid' };
  try {
    const request = (target, options) => fetch(target, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    let response = await request(url, { method: 'HEAD' });
    if (response.status === 405) response = await request(url, { headers: { Range: 'bytes=0-0' } });
    const contentType = response.headers.get('content-type') ?? '';
    return {
      id: record.id,
      cid: record.pubchemCid,
      status: response.ok && contentType.includes('image/') ? 'valid' : 'missing',
      httpStatus: response.status,
      contentType,
    };
  } catch (error) {
    return { id: record.id, cid: record.pubchemCid, status: 'retryable', reason: error instanceof Error ? error.message : 'network-error' };
  }
}

async function mapWithConcurrency(rows, worker, workers) {
  const results = new Array(rows.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(workers, rows.length) }, async () => {
    while (cursor < rows.length) {
      const index = cursor++;
      results[index] = await worker(rows[index]);
    }
  }));
  return results;
}

const results = await mapWithConcurrency(records, inspect, concurrency);
const summary = Object.groupBy(results, ({ status }) => status);
const report = {
  generatedAt: new Date().toISOString(),
  checked: results.length,
  counts: Object.fromEntries(Object.entries(summary).map(([status, rows]) => [status, rows.length])),
  results,
};
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ checked: report.checked, counts: report.counts, concurrency, timeoutMs, output: output.pathname }, null, 2));
