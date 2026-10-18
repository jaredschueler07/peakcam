#!/usr/bin/env node
/**
 * alert-e2e-test.mjs — end-to-end checks for the powder alert path.
 *
 * Two modes:
 *
 * 1. Email path (the original): subscribe a test email, force-trigger the
 *    cron twice, check dedup. Sends REAL email to the test address and, if
 *    thresholds are exceeded, to every production subscriber.
 *
 *      node scripts/alert-e2e-test.mjs --email you+peakcamtest@domain.com --resort-slug jackson-hole
 *
 * 2. Webhook path (Sprint 7): start a local HTTP listener, register it as a
 *    webhook for an existing subscriber (by manage_token), ask the manage
 *    API for a test delivery, verify the Standard Webhooks signature on
 *    what arrived, then remove the webhook. Sends NO email and does NOT run
 *    the cron unless --trigger is passed.
 *
 *      SITE_URL=http://127.0.0.1:3300 node scripts/alert-e2e-test.mjs --webhook --token <manage_token>
 *
 *    The server must allow plain-http loopback targets for this:
 *    start it with ALERT_WEBHOOK_ALLOW_LOOPBACK=1. Against production, pass
 *    --public-url https://<tunnel-to-this-machine>/hook instead (the
 *    listener still runs locally; the tunnel forwards to it).
 *
 * Env (from .env.local): CRON_SECRET (email mode / --trigger),
 * NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (email mode).
 * SITE_URL overrides the target (default https://www.peakcam.io).
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (k && !(k in process.env)) process.env[k] = v;
  }
}
loadEnv(path.join(ROOT, ".env.local"));

const SITE = process.env.SITE_URL || "https://www.peakcam.io";
const CRON_SECRET = process.env.CRON_SECRET;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const v = argv[i];
  if (!v.startsWith("--")) continue;
  const next = argv[i + 1];
  if (next === undefined || next.startsWith("--")) args[v.slice(2)] = true;
  else { args[v.slice(2)] = next; i++; }
}

async function j(url, init) {
  const r = await fetch(url, init);
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; }
  catch { return { status: r.status, body: t }; }
}

// ── Webhook mode ─────────────────────────────────────────────

/** Standard Webhooks verification, written out so the check does not depend on the app's code. */
function verifySignature(secret, headers, body) {
  const id = headers["webhook-id"];
  const ts = headers["webhook-timestamp"];
  const sigs = headers["webhook-signature"];
  if (!id || !ts || !sigs) return { ok: false, reason: "missing headers" };
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > 300) return { ok: false, reason: "timestamp outside 5 min" };
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest();
  for (const candidate of String(sigs).split(" ")) {
    const [version, value] = candidate.split(",", 2);
    if (version !== "v1" || !value) continue;
    const given = Buffer.from(value, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true, id };
  }
  return { ok: false, reason: "no matching v1 signature" };
}

function startListener(port) {
  const received = [];
  const waiters = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const entry = { method: req.method, url: req.url, headers: req.headers, body };
      received.push(entry);
      for (const w of waiters.splice(0)) w(entry);
      res.writeHead(204).end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({
        server,
        port: server.address().port,
        received,
        next(timeoutMs) {
          return new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error(`no delivery within ${timeoutMs} ms`)), timeoutMs);
            waiters.push((entry) => { clearTimeout(t); res(entry); });
          });
        },
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

async function webhookMode() {
  const token = args.token;
  if (!token || token === true) {
    console.error("Usage: --webhook --token <manage_token> [--listen-port N] [--public-url https://…/hook] [--trigger]");
    process.exit(1);
  }
  let failed = false;
  const fail = (msg) => { console.error("  FAIL:", msg); failed = true; };

  console.log("[1/6] Starting local listener...");
  const listener = await startListener(Number(args["listen-port"] ?? 0));
  const hookUrl = args["public-url"] && args["public-url"] !== true ? args["public-url"] : `http://127.0.0.1:${listener.port}/hook`;
  console.log("  listening on 127.0.0.1:" + listener.port + ", registering", hookUrl);

  let destinationId = null;
  try {
    console.log("[2/6] Registering webhook via POST /api/alerts/manage...");
    const added = await j(`${SITE}/api/alerts/manage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, action: "add_webhook", url: hookUrl }),
    });
    if (added.status !== 201 || !added.body?.secret || !added.body?.destination?.id) {
      console.error("  status:", added.status, "body:", added.body);
      if (added.status === 400 && /https|public host/.test(String(added.body?.error))) {
        console.error("  (loopback targets need ALERT_WEBHOOK_ALLOW_LOOPBACK=1 on the server, or pass --public-url)");
      }
      process.exit(1);
    }
    destinationId = added.body.destination.id;
    const secret = added.body.secret;
    console.log("  destination:", destinationId, "secret prefix:", secret.slice(0, 6) + "…");
    if (!/^whsec_[A-Za-z0-9+/]{32}$/.test(secret)) fail("secret is not whsec_ + base64(24 bytes)");

    console.log("[3/6] Requesting a test delivery...");
    const deliveryPromise = listener.next(15_000);
    const test = await j(`${SITE}/api/alerts/manage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, action: "test_webhook", destination_id: destinationId }),
    });
    console.log("  status:", test.status, "body:", test.body);
    if (test.status !== 200 || test.body?.ok !== true) fail("test delivery was not reported as delivered");

    console.log("[4/6] Verifying the delivery that arrived...");
    const delivery = await deliveryPromise;
    const verdict = verifySignature(secret, delivery.headers, delivery.body);
    console.log("  webhook-id:", delivery.headers["webhook-id"], "timestamp:", delivery.headers["webhook-timestamp"]);
    console.log("  signature:", verdict.ok ? "VALID" : `INVALID (${verdict.reason})`);
    if (!verdict.ok) fail("signature did not verify");
    let payload = null;
    try { payload = JSON.parse(delivery.body); } catch { fail("body is not JSON"); }
    if (payload) {
      console.log("  payload type:", payload.type);
      if (payload.type !== "powder.test") fail(`expected type powder.test, got ${payload.type}`);
    }
    if (delivery.headers["content-type"] !== "application/json") fail("content-type is not application/json");
    // A tampered body must not verify.
    if (verifySignature(secret, delivery.headers, delivery.body + " ").ok) fail("tampered body still verified");

    if (args.trigger) {
      if (!CRON_SECRET) { fail("--trigger needs CRON_SECRET"); }
      else {
        console.log("[5/6] Triggering the cron (this emails real subscribers if thresholds are exceeded)...");
        const trig = await j(`${SITE}/api/alerts/trigger`, {
          method: "POST",
          headers: { Authorization: `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
        });
        console.log("  status:", trig.status, "run:", trig.body?.run, "webhooks:", trig.body?.webhooks);
        if (!trig.body?.run?.id) fail("trigger response has no run id (migration 023 / run log)");
        if ((trig.body?.webhooks?.attempted ?? 0) > 0) {
          const live = await listener.next(5_000).catch(() => null);
          if (live) {
            const v = verifySignature(secret, live.headers, live.body);
            console.log("  live powder.alert received, signature", v.ok ? "VALID" : "INVALID");
            if (!v.ok) fail("live alert signature invalid");
          }
        }
      }
    } else {
      console.log("[5/6] Skipping cron trigger (pass --trigger to run it; it sends real email).");
    }
  } finally {
    console.log("[6/6] Cleaning up...");
    if (destinationId) {
      const del = await j(`${SITE}/api/alerts/manage?token=${encodeURIComponent(token)}&destination=${encodeURIComponent(destinationId)}`, { method: "DELETE" });
      console.log("  removed webhook:", del.status, del.body);
      if (del.status !== 200) failed = true;
    }
    await listener.close();
  }
  console.log(failed ? "RESULT: FAIL" : "RESULT: PASS — signed webhook delivery verified");
  process.exit(failed ? 1 : 0);
}

if (args.webhook) {
  await webhookMode();
}

// ── Email mode (original) ────────────────────────────────────

if (!args.email || !args["resort-slug"]) {
  console.error("Usage: --email X --resort-slug Y   (or --webhook --token T)");
  process.exit(1);
}
if (!CRON_SECRET) {
  console.error("Missing CRON_SECRET in .env.local — required to trigger /api/alerts/trigger");
  process.exit(1);
}

console.log("[0/4] Resolving resort slug -> id...");
if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error("  Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in env");
  process.exit(1);
}
const resortLookup = await j(
  `${SUPABASE_URL}/rest/v1/resorts?slug=eq.${encodeURIComponent(args["resort-slug"])}&select=id,name&is_active=eq.true`,
  { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
);
if (resortLookup.status !== 200 || !Array.isArray(resortLookup.body) || resortLookup.body.length === 0) {
  console.error("  Could not resolve resort slug:", resortLookup.status, resortLookup.body);
  process.exit(1);
}
const resortId = resortLookup.body[0].id;
console.log("  resolved:", resortLookup.body[0].name, "->", resortId);

console.log("[1/4] Subscribing test email...");
const sub = await j(`${SITE}/api/alerts/subscribe`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: args.email,
    resort_ids: [resortId],
    thresholds: { [resortId]: 1 },
  }),
});
console.log("  status:", sub.status, "body:", sub.body);

console.log("[2/4] Triggering alert cron...");
const trig = await j(`${SITE}/api/alerts/trigger`, {
  method: "POST",
  headers: { Authorization: `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
});
console.log("  status:", trig.status, "body:", trig.body);
if (trig.body?.run?.id) console.log("  run row:", trig.body.run.id, "logged:", trig.body.run.logged);

console.log("[3/4] Re-triggering (dedup check)...");
const trig2 = await j(`${SITE}/api/alerts/trigger`, {
  method: "POST",
  headers: { Authorization: `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
});
console.log("  status:", trig2.status, "body:", trig2.body);
if ((trig.body?.sent ?? 0) === 0) {
  console.warn("  WARN: dedup check not exercised — first trigger sent 0 emails.");
  console.warn("        Pick a resort with fresh snow above threshold to exercise dedup.");
} else if (trig.body?.sent > 0 && trig2.body?.sent > 0) {
  console.error("  FAIL: dedup did not prevent second send");
  process.exit(1);
} else {
  console.log("  OK: dedup suppressed second send");
}

console.log("[4/4] Done. Check inbox for email; use manage link to test edit/unsubscribe.");
