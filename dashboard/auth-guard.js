const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function parseHostHeader(rawHost) {
  if (typeof rawHost !== 'string' || !rawHost.trim()) return null;
  try {
    const parsed = new URL(`http://${rawHost.trim()}`);
    if (!LOOPBACK_HOSTS.has(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isAllowedHost(rawHost, port) {
  const parsed = parseHostHeader(rawHost);
  if (!parsed) return false;
  if (port !== undefined && port !== null) {
    const expectedPort = String(port);
    if (parsed.port && parsed.port !== expectedPort) return false;
  }
  return true;
}

function safeTokenEqual(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !provided || !expected) return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function parseCookieValue(cookieHeader, name) {
  if (typeof cookieHeader !== 'string') return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return part.slice(idx + 1).trim();
  }
  return null;
}

function isAllowedCwd(cwdParam, allowedRoots) {
  if (typeof cwdParam !== 'string' || !cwdParam.trim()) return null;
  const resolved = path.resolve(cwdParam.trim());
  const inRoot = allowedRoots.some((root) => {
    const base = path.resolve(root);
    return resolved === base || resolved.startsWith(`${base}${path.sep}`);
  });
  if (!inRoot) return null;
  try {
    if (!fs.statSync(resolved).isDirectory()) return null;
  } catch {
    return null;
  }
  return resolved;
}

function checkDashboardRequest({ method = 'GET', path: reqPath = '/', headers = {}, token, port, cookieName = 'peakcam_dash' }) {
  const rawHost = headers.host || '';
  const parsedHost = parseHostHeader(rawHost);
  if (!parsedHost || !isAllowedHost(rawHost, port)) {
    return { ok: false, status: 403, error: 'loopback Host required' };
  }

  const fetchSite = String(headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') {
    return { ok: false, status: 403, error: 'cross-site request rejected' };
  }

  const expectedOrigin = `http://${rawHost.trim()}`;
  const origin = headers.origin;
  if (origin !== undefined && origin !== expectedOrigin) {
    return { ok: false, status: 403, error: 'invalid Origin' };
  }

  if (reqPath.startsWith('/api/')) {
    if (MUTATING_METHODS.has(String(method).toUpperCase())) {
      if (!origin && fetchSite !== 'same-origin') {
        // Browsers send Origin or Sec-Fetch-Site: same-origin on mutating fetch/form requests;
        // CLI callers authenticate with Authorization: Bearer below.
      }
      const ct = String(headers['content-type'] || '').toLowerCase();
      const hasBodyPayload = Number(headers['content-length'] || 0) > 0 || Boolean(ct);
      if (hasBodyPayload && !ct.startsWith('application/json')) {
        return { ok: false, status: 415, error: 'Content-Type must be application/json' };
      }
    }

    const authHeader = String(headers.authorization || '');
    const bearerMatch = /^Bearer\s+(\S+)$/i.exec(authHeader);
    const bearerOk = bearerMatch ? safeTokenEqual(bearerMatch[1], token) : false;
    const cookieToken = parseCookieValue(headers.cookie, cookieName);
    const cookieOk = Boolean(cookieToken && safeTokenEqual(cookieToken, token));

    if (!bearerOk) {
      if (!cookieOk) {
        return { ok: false, status: 401, error: 'dashboard token required' };
      }
      if (MUTATING_METHODS.has(String(method).toUpperCase()) && origin !== expectedOrigin) {
        return { ok: false, status: 403, error: 'same-origin required for cookie-authenticated mutations' };
      }
    }
  }

  return { ok: true, expectedOrigin };
}

module.exports = {
  checkDashboardRequest,
  isAllowedCwd,
  isAllowedHost,
  parseCookieValue,
  safeTokenEqual,
};
