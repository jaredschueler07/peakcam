import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const sourceDir = path.join(root, 'PeakCam_Commercialization_2026-27', 'Execution');
const expectedCounts = {
  actions: 43,
  prospects: 100,
  cameras: 306,
  resorts: 148,
  experiments: 15,
  risks: 28,
  costs: 11,
  events: 29,
  issues: 39,
  chapters: 21,
  scenarios: 5,
  gates: 7,
};

let createTrackerServer;
let stateDir;
let server;
let baseUrl;
let initialSourceHash;
let initialRevision;

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) },
  });
  const type = response.headers.get('content-type') ?? '';
  const body = type.includes('json') ? await response.json() : await response.text();
  return { response, body };
}

function rawRequest(route, headers = {}) {
  const target = new URL(`${baseUrl}${route}`);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: target.port, path: target.pathname, method: 'GET', headers }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ response, body: text }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function startTracker() {
  const created = await createTrackerServer({ stateDir, sourceDir });
  const candidate = created?.server ?? created?.app ?? created;
  if (!candidate?.listen) throw new Error('createTrackerServer must return an HTTP server or app');
  server = candidate.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function stopTracker() {
  if (!server) return;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  server = undefined;
}

async function data() {
  const result = await request('/api/data');
  assert.equal(result.response.status, 200);
  return result.body;
}

before(async () => {
  stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'peakcam-tracker-'));
  initialSourceHash = crypto.createHash('sha256').update(await fs.readFile(path.join(sourceDir, 'Action_Register.csv'))).digest('hex');
  ({ createTrackerServer } = await import('./server.mjs'));
  await startTracker();
});

after(async () => {
  await stopTracker();
  await fs.rm(stateDir, { recursive: true, force: true });
});

test('GET /api/data exposes every register with stable rows and tracking fields', async () => {
  const snapshot = await data();
  assert.ok(Array.isArray(snapshot.datasets));
  assert.equal(snapshot.datasets.length, Object.keys(expectedCounts).length);
  for (const [key, count] of Object.entries(expectedCounts)) {
    const dataset = snapshot.datasets.find((entry) => entry.key === key);
    assert.ok(dataset, `missing dataset ${key}`);
    assert.equal(dataset.rows.length, count, dataset.key);
    assert.ok(dataset.idField && dataset.titleField);
    assert.ok(Array.isArray(dataset.columns));
    assert.ok(Array.isArray(dataset.editableFields));
    assert.ok(dataset.rows[0].id);
    assert.equal(typeof dataset.rows[0].source, 'object');
    assert.ok(Object.hasOwn(dataset.rows[0].source, dataset.titleField));
    assert.equal(Object.hasOwn(dataset.rows[0].source, 'original'), false);
    assert.deepEqual(Object.keys(dataset.rows[0].tracking).sort(), ['due', 'evidence', 'fields', 'notes', 'owner', 'status']);
  }
  assert.equal(typeof snapshot.revision, 'number');
  assert.ok(snapshot.updatedAt === null || typeof snapshot.updatedAt === 'string');
  initialRevision = snapshot.revision;
});

test('PATCH merges tracking overrides and persists them across a restart', async () => {
  const patch = { revision: initialRevision, tracking: { status: 'In progress', owner: 'Jared', due: '2026-10-01', notes: 'first outreach', evidence: 'https://example.test/evidence', fields: { Priority: 'Critical' } } };
  const changed = await request('/api/records/actions/R01', { method: 'PATCH', body: JSON.stringify(patch) });
  assert.equal(changed.response.status, 200);
  assert.equal(changed.body.revision, initialRevision + 1);
  assert.ok(changed.body.updatedAt);
  const afterPatch = await data();
  const row = afterPatch.datasets.find((d) => d.key === 'actions').rows.find((r) => r.id === 'R01');
  assert.deepEqual(row.tracking, patch.tracking);
  await stopTracker();
  await startTracker();
  const afterRestart = await data();
  assert.deepEqual(afterRestart.datasets.find((d) => d.key === 'actions').rows.find((r) => r.id === 'R01').tracking, patch.tracking);
});

test('stale revisions are rejected and concurrent writes cannot overwrite the winner', async () => {
  const snapshot = await data();
  const revision = snapshot.revision;
  const [one, two] = await Promise.all([
    request('/api/records/prospects/PC-001', { method: 'PATCH', body: JSON.stringify({ revision, tracking: { notes: 'writer one' } }) }),
    request('/api/records/prospects/PC-001', { method: 'PATCH', body: JSON.stringify({ revision, tracking: { notes: 'writer two' } }) }),
  ]);
  assert.deepEqual([one.response.status, two.response.status].sort(), [200, 409]);
  const winner = one.response.status === 200 ? 'writer one' : 'writer two';
  assert.equal((await data()).datasets.find((d) => d.key === 'prospects').rows.find((r) => r.id === 'PC-001').tracking.notes, winner);
});

test('validation rejects bad status, dates, negative costs, and Done without evidence', async () => {
  const revision = (await data()).revision;
  const cases = [
    { id: 'R03', tracking: { status: 'Maybe' } },
    { id: 'R04', tracking: { due: 'October someday' } },
    { id: 'Vercel', key: 'costs', tracking: { fields: { Actual_paid_USD: '-1' } } },
    { id: 'R06', tracking: { due: '2026-02-31' } },
    { id: 'R05', tracking: { status: 'Done', evidence: '' } },
  ];
  for (const item of cases) {
    const result = await request(`/api/records/${item.key ?? 'actions'}/${item.id}`, { method: 'PATCH', body: JSON.stringify({ revision, tracking: item.tracking }) });
    assert.equal(result.response.status, 400, `expected validation failure for ${JSON.stringify(item)}`);
  }
});

test('unknown tracking fields and unknown records are rejected', async () => {
  const revision = (await data()).revision;
  const unknownField = await request('/api/records/actions/R03', { method: 'PATCH', body: JSON.stringify({ revision, tracking: { nope: 'x' } }) });
  const unknownRecord = await request('/api/records/actions/NOPE', { method: 'PATCH', body: JSON.stringify({ revision, tracking: { notes: 'x' } }) });
  assert.equal(unknownField.response.status, 400);
  assert.equal(unknownRecord.response.status, 404);
});

test('host allowlist blocks non-loopback Host headers', async () => {
  const result = await rawRequest('/api/data', { Host: 'evil.example' });
  assert.ok([400, 403].includes(result.response.statusCode), `unexpected status ${result.response.statusCode}`);
});

test('cross-origin requests from another port are rejected', async () => {
  const port = Number(new URL(baseUrl).port);
  const result = await request('/api/data', { headers: { origin: `http://127.0.0.1:${port + 1}` } });
  assert.ok([400, 403].includes(result.response.status));
});

test('document routes expose only the explicit source allowlist', async () => {
  const allowed = await request('/documents/Action_Register.csv');
  const blocked = await request('/documents/.env.local');
  assert.equal(allowed.response.status, 200);
  assert.equal(blocked.response.status, 404);
});

test('PATCH leaves source CSV bytes unchanged', async () => {
  const hash = crypto.createHash('sha256').update(await fs.readFile(path.join(sourceDir, 'Action_Register.csv'))).digest('hex');
  assert.equal(hash, initialSourceHash);
});

test('CSV export escapes formula-like tracking notes', async () => {
  const snapshot = await data();
  const edited = await request('/api/records/actions/R03', { method: 'PATCH', body: JSON.stringify({ revision: snapshot.revision, tracking: { notes: 'formula test', evidence: 'proof', fields: { Evidence_link: '=SUM(A1)' } } }) });
  assert.equal(edited.response.status, 200);
  const exported = await request('/api/export/actions');
  assert.equal(exported.response.status, 200);
  assert.match(exported.body.split('\r\n', 1)[0], /Tracker_status/);
  assert.match(exported.body, /'=SUM\(A1\)/);
});

test('JSON export contains the full snapshot and tracking overrides', async () => {
  const exported = await request('/api/export');
  assert.equal(exported.response.status, 200);
  assert.ok(exported.body.datasets.length >= 12);
  assert.equal(exported.body.datasets.find((d) => d.key === 'actions').rows.find((r) => r.id === 'R03').tracking.notes, 'formula test');
});

test('a Done record cannot have its evidence cleared', async () => {
  const beforeDone = await data();
  const done = await request('/api/records/actions/R07', { method: 'PATCH', body: JSON.stringify({ revision: beforeDone.revision, tracking: { status: 'Done', evidence: 'proof' } }) });
  assert.equal(done.response.status, 200);
  const cleared = await request('/api/records/actions/R07', { method: 'PATCH', body: JSON.stringify({ revision: done.body.revision, tracking: { status: 'Done', evidence: '' } }) });
  assert.equal(cleared.response.status, 400);
});

test('configured tailnet origin supports saves and rejects other origins', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'peakcam-tailnet-'));
  const origin = 'https://tracker.example-tailnet.ts.net';
  const instance = createTrackerServer({ stateDir: dir, sourceDir, tailnetOrigin: origin });
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  const send = (headers, method = 'GET', payload) => new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: instance.address().port, path: method === 'PATCH' ? '/api/records/actions/R01' : '/api/data', method, headers: { Host: new URL(origin).host, 'content-type': 'application/json', ...headers } }, response => {
      let body = ''; response.on('data', chunk => body += chunk); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    });
    request.on('error', reject); request.end(payload ? JSON.stringify(payload) : undefined);
  });
  try {
    assert.equal((await send({ Origin: origin })).status, 200);
    assert.equal((await send({ Origin: origin }, 'PATCH', { revision: 0, tracking: { notes: 'Tailnet update' } })).status, 200);
    assert.equal((await send({ Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await send({ Host: 'other.example-tailnet.ts.net' })).status, 403);
  } finally {
    await new Promise(resolve => instance.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
