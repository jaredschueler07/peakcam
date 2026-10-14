import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDatasets, mergedSource, SPECS, STATUSES, DATE_FIELDS, NUM_FIELDS } from './data.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE = path.resolve(ROOT, '../../PeakCam_Commercialization_2026-27/Execution');
const PUBLIC = path.join(ROOT, 'public');
const ASSETS = new Set(['index.html', 'app.js', 'styles.css']);
const DOCS = new Set(['README.md', 'Financial_Review.md', 'Outreach_First_Wave.md', 'Launch_Playbook.md', 'Action_Register.csv', 'Camera_Source_Register.csv', 'Chapter_Coverage.csv', 'Event_Mapping.csv', 'Experiment_Plan.csv', 'Financial_Stress_Scenarios.csv', 'Issue_Triage.csv', 'Operating_Cost_Inputs.csv', 'Prospect_Queue.csv', 'Resort_Coverage.csv', 'Risk_Review.csv', 'Season_Gates.csv']);

function json(res, status, value, headers = {}) { const body = JSON.stringify(value); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body), ...headers }); res.end(body); }
function csvCell(value) { let s = String(value ?? ''); if (/^[\s]*[=+\-@]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"', '""')}"`; }
function csv(rows, columns) { return [columns.map(csvCell).join(','), ...rows.map(r => columns.map(c => csvCell(r[c])).join(','))].join('\r\n') + '\r\n'; }
function validIsoDate(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const d = new Date(`${value}T00:00:00Z`); return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value; }
function localRequest(req, tailnetOrigin = '') {
  const rawHost = String(req.headers.host || '');
  let requested;
  try { requested = new URL(`http://${rawHost}`); } catch { return false; }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(requested.hostname);
  const external = tailnetOrigin && rawHost === new URL(tailnetOrigin).host;
  if (!local && !external) return false;
  const expectedOrigin = external ? tailnetOrigin : `http://${rawHost}`;
  return !req.headers.origin || req.headers.origin === expectedOrigin;
}
async function body(req) { let s = ''; for await (const c of req) { s += c; if (s.length > 1_000_000) throw Error('body too large'); } return JSON.parse(s || '{}'); }
function validateTracking(t, editable, source) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) throw Error('tracking must be an object');
  for (const k of Object.keys(t)) if (!['status', 'owner', 'due', 'notes', 'evidence', 'fields'].includes(k)) throw Error(`unknown tracking field: ${k}`);
  if (t.status !== undefined && !STATUSES.has(t.status)) throw Error('invalid status');
  for (const k of ['owner', 'due', 'notes', 'evidence']) if (t[k] !== undefined && (typeof t[k] !== 'string' || t[k].length > 10000)) throw Error(`invalid ${k}`);
  if (t.due && !validIsoDate(t.due)) throw Error('invalid due date');
  
  if (t.fields !== undefined) {
    if (!t.fields || typeof t.fields !== 'object' || Array.isArray(t.fields)) throw Error('fields must be an object');
    for (const [k, v] of Object.entries(t.fields)) {
      if (!editable.includes(k) || k === SPECS[source][1]) throw Error(`field not editable: ${k}`);
      if (typeof v !== 'string' || v.length > 10000) throw Error(`invalid field: ${k}`);
      if (DATE_FIELDS.test(k) && v && !validIsoDate(v) && !(/^\d{4}-\d{2}-\d{2}T/.test(v) && validIsoDate(v.slice(0, 10)) && !Number.isNaN(Date.parse(v)))) throw Error(`invalid date: ${k}`);
      if (NUM_FIELDS.test(k) && v && (!Number.isFinite(Number(v)) || Number(v) < 0)) throw Error(`invalid number: ${k}`);
    }
  }
}

export function createTrackerServer({ stateDir = path.join(ROOT, '.local'), sourceDir = DEFAULT_SOURCE, tailnetOrigin = '' } = {}) {
  if (tailnetOrigin) {
    const origin = new URL(tailnetOrigin);
    if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.ts.net') || origin.origin !== tailnetOrigin) throw Error('tailnetOrigin must be an exact HTTPS ts.net origin');
  }
  fs.mkdirSync(stateDir, { recursive: true }); const stateFile = path.join(stateDir, 'state.json');
  let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { revision: 0, updatedAt: null, records: {} };
  const current = () => ({ datasets: loadDatasets(sourceDir, state), revision: state.revision || 0, updatedAt: state.updatedAt || null });
  const save = (nextState) => { const tmp = `${stateFile}.tmp`; if (fs.existsSync(stateFile)) fs.copyFileSync(stateFile, path.join(stateDir, 'state.backup.json')); fs.writeFileSync(tmp, JSON.stringify(nextState, null, 2)); fs.renameSync(tmp, stateFile); };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    try {
      if (!localRequest(req, tailnetOrigin)) return json(res, 403, { error: 'loopback requests only' });
      const url = new URL(req.url, 'http://localhost'); const pathname = decodeURIComponent(url.pathname);
      if (req.method === 'GET' && pathname === '/api/data') return json(res, 200, current());
      if (req.method === 'GET' && pathname === '/api/export') return json(res, 200, current(), { 'content-disposition': 'attachment; filename="peakcam-tracker.json"' });
      const exportCsv = (d) => { const tracker = ['Tracker_status', 'Tracker_owner', 'Tracker_due', 'Tracker_notes', 'Tracker_evidence']; const rows = d.rows.map(r => ({ ...mergedSource(r), Tracker_status: r.tracking.status, Tracker_owner: r.tracking.owner, Tracker_due: r.tracking.due, Tracker_notes: r.tracking.notes, Tracker_evidence: r.tracking.evidence })); return res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${d.key}.csv"` }) && res.end(csv(rows, [...d.columns, ...tracker])); };
      const em = pathname.match(/^\/api\/export\/([^/]+)$/); if (req.method === 'GET' && em) { const d = current().datasets.find(x => x.key === em[1]); if (!d) return json(res, 404, { error: 'unknown dataset' }); return exportCsv(d); }
      const csvAlias = pathname.match(/^\/api\/export\/([^/]+)\.csv$/); if (req.method === 'GET' && csvAlias) { const d = current().datasets.find(x => x.key === csvAlias[1]); if (!d) return json(res, 404, { error: 'unknown dataset' }); return exportCsv(d); }
      if (req.method === 'GET' && pathname === '/api/export.json') return json(res, 200, current(), { 'content-disposition': 'attachment; filename="peakcam-tracker.json"' });
      const dm = pathname.match(/^\/documents\/([^/]+)$/); if (req.method === 'GET' && dm && DOCS.has(dm[1]) && !dm[1].includes('/')) { const sourceFile = path.join(sourceDir, dm[1]); const localFile = path.join(ROOT, dm[1]); const file = fs.existsSync(sourceFile) ? sourceFile : localFile; if (!fs.existsSync(file)) return json(res, 404, { error: 'document not found' }); return res.writeHead(200, { 'content-type': dm[1].endsWith('.csv') ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8', 'content-disposition': `inline; filename="${dm[1]}"` }) && res.end(fs.readFileSync(file)); }
      const rm = pathname.match(/^\/api\/records\/([^/]+)\/([^/]+)$/); if (req.method === 'PATCH' && rm) {
        if (!localRequest(req, tailnetOrigin) || !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return json(res, 403, { error: 'local same-origin JSON requests only' });
        const [key, id] = rm.slice(1); const d = current().datasets.find(x => x.key === key); if (!d) return json(res, 404, { error: 'unknown dataset' }); const payload = await body(req); if (payload.revision !== state.revision) return json(res, 409, { error: 'revision conflict', revision: state.revision, updatedAt: state.updatedAt }); const row = d.rows.find(x => x.id === id); if (!row) return json(res, 404, { error: 'record not found' }); validateTracking(payload.tracking, d.editableFields, key); const t = payload.tracking;
        const tracking = { ...row.tracking, ...t, fields: { ...row.tracking.fields, ...t.fields } };
        if (tracking.status === 'Done' && !tracking.evidence.trim()) throw Error('Done requires evidence');
        const nextState = { revision: state.revision + 1, updatedAt: new Date().toISOString(), records: { ...state.records, [key]: { ...state.records[key], [id]: tracking } } };
        save(nextState);
        state = nextState; return json(res, 200, { revision: state.revision, updatedAt: state.updatedAt });
      }
      if (req.method === 'GET') { const file = pathname === '/' ? 'index.html' : pathname.slice(1); if (ASSETS.has(file)) return res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' }) && res.end(fs.readFileSync(path.join(PUBLIC, file))); }
      json(res, 404, { error: 'not found' });
    } catch (e) { json(res, e.message === 'body too large' ? 413 : 400, { error: e.message || 'bad request' }); }
  });
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 3334);
  createTrackerServer({ tailnetOrigin: process.env.PEAKCAM_TRACKER_ORIGIN || '' }).listen(port, '127.0.0.1', () => console.log(`PeakCam commercialization tracker: http://127.0.0.1:${port}`));
}
