import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import guard from './auth-guard.js';

const TOKEN = 'test-boot-token-123456';

test('dashboard auth guard blocks DNS rebinding Host headers', () => {
  const res = guard.checkDashboardRequest({
    method: 'POST',
    path: '/api/claude/start',
    headers: { host: 'evil.example:3333', authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    token: TOKEN,
    port: 3333,
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 403);
});

test('dashboard auth guard blocks cross-site CSRF and bad Origin', () => {
  const csrf = guard.checkDashboardRequest({
    method: 'POST',
    path: '/api/permissions/1/approve',
    headers: {
      host: '127.0.0.1:3333',
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
      cookie: `peakcam_dash=${TOKEN}`,
    },
    token: TOKEN,
    port: 3333,
  });
  assert.equal(csrf.ok, false);
  assert.equal(csrf.status, 403);

  const missingBearer = guard.checkDashboardRequest({
    method: 'GET',
    path: '/api/events',
    headers: { host: '127.0.0.1:3333' },
    token: TOKEN,
    port: 3333,
  });
  assert.equal(missingBearer.ok, false);
  assert.equal(missingBearer.status, 401);

  const wrongCt = guard.checkDashboardRequest({
    method: 'POST',
    path: '/api/claude/start',
    headers: {
      host: '127.0.0.1:3333',
      origin: 'http://127.0.0.1:3333',
      'content-type': 'application/x-www-form-urlencoded',
      'content-length': '12',
      authorization: `Bearer ${TOKEN}`,
    },
    token: TOKEN,
    port: 3333,
  });
  assert.equal(wrongCt.ok, false);
  assert.equal(wrongCt.status, 415);
});

test('dashboard auth guard allows valid loopback Bearer and SameSite cookie same-origin calls', () => {
  const cli = guard.checkDashboardRequest({
    method: 'POST',
    path: '/api/claude/start',
    headers: {
      host: 'localhost:3333',
      'content-type': 'application/json',
      'content-length': '20',
      authorization: `Bearer ${TOKEN}`,
    },
    token: TOKEN,
    port: 3333,
  });
  assert.equal(cli.ok, true);

  const browser = guard.checkDashboardRequest({
    method: 'POST',
    path: '/api/permissions/1/approve',
    headers: {
      host: '127.0.0.1:3333',
      origin: 'http://127.0.0.1:3333',
      'sec-fetch-site': 'same-origin',
      cookie: `peakcam_dash=${TOKEN}`,
    },
    token: TOKEN,
    port: 3333,
  });
  assert.equal(browser.ok, true);
});

test('isAllowedCwd rejects outside paths and non-directories', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-cwd-'));
  try {
    const inside = path.join(tmp, 'sub');
    fs.mkdirSync(inside);
    assert.equal(guard.isAllowedCwd(inside, [tmp]), inside);
    assert.equal(guard.isAllowedCwd(`${inside}/../../etc`, [tmp]), null);
    assert.equal(guard.isAllowedCwd('/etc', [tmp]), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
