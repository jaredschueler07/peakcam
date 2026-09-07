import assert from 'node:assert/strict';
import test from 'node:test';
import { queryProducts, discoveryBounds } from './discover-terrain-sources';
const item = (id: string) => ({ sourceId: id, title: `Tile ${id}`, downloadURL: `https://example.test/${id}.tif`, metaUrl: `https://example.test/${id}.xml`, boundingBox: { minX: -107, minY: 39, maxX: -106, maxY: 40 } });
const page = (total: number, items: unknown[]) => new Response(JSON.stringify({ total, items, errors: [] }), { headers: { date: 'Mon, 07 Sep 2026 12:00:00 GMT' } });
function mock(pages: Response[], offsets: number[] = []): typeof fetch {
  return (async (input, init) => { offsets.push(Number(new URL(String(input)).searchParams.get('offset'))); assert.ok(init?.signal); const response = pages.shift(); assert.ok(response, 'unexpected request'); return response; }) as typeof fetch;
}
test('TNM retains every page, metadata identifiers and dated hashes without coverage claims', async () => {
  const offsets: number[] = [];
  const report = await queryProducts('breckenridge', mock([page(3, [item('a'), item('b')]), page(3, [item('c')])], offsets), { pageSize: 2 });
  assert.deepEqual(offsets, [0, 2]); assert.deepEqual(report.products.map(p => p.sourceId), ['a', 'b', 'c']);
  assert.equal(report.validRasterCoverage, null); assert.equal(report.products[0].status, 'catalog-candidate-not-coverage');
  assert.equal(report.products[0].metadataUrl, 'https://example.test/a.xml');
  assert.ok(report.pages.every(p => /^[a-f0-9]{64}$/.test(p.responseSha256) && Number.isFinite(Date.parse(p.fetchedAt))));
});
test('TNM deduplicates identical IDs across pages but rejects conflicting records', async () => {
  const report = await queryProducts('heavenly', mock([page(4, [item('a'), item('b')]), page(4, [item('b'), item('c')])]), { pageSize: 2 });
  assert.equal(report.uniqueCount, 3); assert.equal(report.duplicateCount, 1);
  await assert.rejects(queryProducts('heavenly', mock([page(3, [item('a'), item('b')]), page(3, [{ ...item('b'), title: 'Changed' }])]), { pageSize: 2 }), /Conflicting duplicate/);
});
test('TNM rejects repeated, empty, changing-total and unbounded pagination', async () => {
  await assert.rejects(queryProducts('heavenly', mock([page(4, [item('a'), item('b')]), page(4, [item('b'), item('a')])]), { pageSize: 2 }), /repeated pagination/);
  await assert.rejects(queryProducts('heavenly', mock([page(2, [])])), /empty page/);
  await assert.rejects(queryProducts('heavenly', mock([page(3, [item('a')]), page(4, [item('b')])])), /total changed/);
  await assert.rejects(queryProducts('heavenly', mock([page(2, [item('a')])]), { maxPages: 1 }), /page limit/);
});
test('TNM rejects HTTP/catalog/malformed failures and invalid options', async () => {
  await assert.rejects(queryProducts('heavenly', mock([new Response('down', { status: 503 })])), /HTTP 503/);
  await assert.rejects(queryProducts('heavenly', mock([new Response(JSON.stringify({ total: 0, items: [], errors: ['bad query'] }))])), /reported errors/);
  await assert.rejects(queryProducts('heavenly', mock([page(1, [{ ...item('a'), boundingBox: {} }])])), /bounds/);
  await assert.rejects(queryProducts('heavenly', mock([]), { maxPages: 0 }), /options/);
  await assert.rejects(queryProducts('heavenly', mock([]), { timeoutMs: Infinity }), /options/);
  assert.throws(() => discoveryBounds('ski-portillo' as 'heavenly'), /supports/);
});
test('TNM zero results remain an explicit empty candidate inventory', async () => {
  const result = await queryProducts('heavenly', mock([page(0, [])]));
  assert.equal(result.catalogTotal, 0); assert.equal(result.validRasterCoverage, null);
});
