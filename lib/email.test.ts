import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  checkResendApiKey,
  EmailSendError,
  sendEmail,
  sendPowderAlertEmail,
  sendWelcomeEmail,
  setEmailClientForTests,
  type EmailClient,
} from "./email";
import { sendCamReportEmail, type CamReportEmailInput } from "./cam-reports/email";

// ─── Fakes ────────────────────────────────────────────────────────────────────

type SentPayload = { from: string; to: string | string[]; subject: string };

function okClient(): EmailClient & { sent: SentPayload[] } {
  const sent: SentPayload[] = [];
  return {
    sent,
    emails: {
      async send(payload: SentPayload) {
        sent.push(payload);
        return { data: { id: "email_123" }, error: null, headers: null };
      },
    },
  } as EmailClient & { sent: SentPayload[] };
}

function failingClient(
  error: { name: string; message: string; statusCode?: number | null } = {
    name: "validation_error",
    message: "The peakcam.io domain is not verified. Please, add and verify your domain on https://resend.com/domains",
    statusCode: 403,
  }
): EmailClient & { calls: number } {
  const client = {
    calls: 0,
    emails: {
      async send() {
        client.calls++;
        return { data: null, error, headers: null };
      },
    },
  };
  return client as unknown as EmailClient & { calls: number };
}

function captureConsole() {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  };
  return {
    errors,
    restore() {
      console.error = original;
    },
  };
}

const ORIGINAL_KEY = process.env.RESEND_API_KEY;

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_test_key_1234567890";
  setEmailClientForTests(null);
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL_KEY;
  setEmailClientForTests(null);
});

// ─── Key shape validation (cheap, no network) ─────────────────────────────────

test("checkResendApiKey distinguishes missing, malformed and well-formed keys", () => {
  assert.strictEqual(checkResendApiKey(undefined).problem, "missing");
  assert.strictEqual(checkResendApiKey("").problem, "missing");
  assert.strictEqual(checkResendApiKey("   ").problem, "missing");

  // The exact shape of the broken production key: 20 chars, no re_ prefix.
  assert.strictEqual(checkResendApiKey("abcd1234efgh5678ijkl").problem, "malformed");
  assert.strictEqual(checkResendApiKey("sk_live_deadbeef").problem, "malformed");
  // Right prefix but no body is still unusable.
  assert.strictEqual(checkResendApiKey("re_").problem, "malformed");

  const good = checkResendApiKey("re_abc123_XyZ456789");
  assert.strictEqual(good.problem, null);
  assert.strictEqual(good.ok, true);
});

test("checkResendApiKey messages name the fix for each failure mode", () => {
  assert.match(checkResendApiKey(undefined).message!, /RESEND_API_KEY/);
  assert.match(checkResendApiKey("abcd1234efgh5678ijkl").message!, /re_/);
});

// ─── The core defect: {error} results must not look like success ──────────────

test("sendEmail reports a Resend {error} result as a failure and logs it", async () => {
  const cap = captureConsole();
  try {
    const result = await sendEmail(
      { emailType: "welcome", to: "skier@example.com", payload: { subject: "hi", html: "<p>hi</p>" } },
      failingClient()
    );
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error!.kind, "api_error");
    assert.strictEqual(result.error!.name, "validation_error");
    assert.strictEqual(cap.errors.length, 1);
    assert.match(cap.errors[0], /^\[email\]/);
    assert.match(cap.errors[0], /welcome/);
    assert.match(cap.errors[0], /skier@example\.com/);
    assert.match(cap.errors[0], /validation_error/);
    // likely-cause hint
    assert.match(cap.errors[0], /not verified/i);
  } finally {
    cap.restore();
  }
});

test("sendEmail treats a success result as success and logs no error", async () => {
  const cap = captureConsole();
  const client = okClient();
  try {
    const result = await sendEmail(
      { emailType: "welcome", to: "skier@example.com", payload: { subject: "hi", html: "<p>hi</p>" } },
      client
    );
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.id, "email_123");
    assert.deepStrictEqual(cap.errors, []);
    assert.strictEqual(client.sent.length, 1);
    assert.strictEqual(client.sent[0].to, "skier@example.com");
  } finally {
    cap.restore();
  }
});

test("sendEmail fails without a network call when the key is missing or malformed", async () => {
  const cap = captureConsole();
  try {
    delete process.env.RESEND_API_KEY;
    const missing = await sendEmail({
      emailType: "welcome",
      to: "skier@example.com",
      payload: { subject: "hi", html: "<p>hi</p>" },
    });
    assert.strictEqual(missing.ok, false);
    assert.strictEqual(missing.error!.kind, "missing_key");

    process.env.RESEND_API_KEY = "abcd1234efgh5678ijkl";
    const malformed = await sendEmail({
      emailType: "welcome",
      to: "skier@example.com",
      payload: { subject: "hi", html: "<p>hi</p>" },
    });
    assert.strictEqual(malformed.ok, false);
    assert.strictEqual(malformed.error!.kind, "malformed_key");
    assert.match(cap.errors.join("\n"), /re_/);
  } finally {
    cap.restore();
  }
});

// ─── Wrappers throw so callers can choose their policy ────────────────────────

test("sendWelcomeEmail throws EmailSendError when Resend returns an error", async () => {
  const cap = captureConsole();
  try {
    await assert.rejects(
      () =>
        sendWelcomeEmail(
          { email: "skier@example.com", manageToken: "tok", resortNames: ["Alta"] },
          failingClient()
        ),
      (err: unknown) => {
        assert.ok(err instanceof EmailSendError);
        assert.strictEqual(err.kind, "api_error");
        assert.strictEqual(err.emailType, "welcome");
        assert.strictEqual(err.to, "skier@example.com");
        assert.match(err.message, /validation_error/);
        return true;
      }
    );
  } finally {
    cap.restore();
  }
});

test("sendWelcomeEmail resolves on success", async () => {
  const client = okClient();
  await sendWelcomeEmail(
    { email: "skier@example.com", manageToken: "tok", resortNames: ["Alta"] },
    client
  );
  assert.strictEqual(client.sent.length, 1);
  assert.match(client.sent[0].subject, /Powder alerts activated/);
});

test("sendPowderAlertEmail throws EmailSendError when Resend returns an error", async () => {
  const cap = captureConsole();
  try {
    await assert.rejects(
      () =>
        sendPowderAlertEmail(
          {
            email: "skier@example.com",
            manageToken: "tok",
            alerts: [{ resortName: "Alta", slug: "alta", newSnow: 12, threshold: 6 }],
          },
          failingClient({ name: "invalid_api_key", message: "API key is invalid", statusCode: 401 })
        ),
      (err: unknown) => {
        assert.ok(err instanceof EmailSendError);
        assert.strictEqual(err.emailType, "powder_alert");
        assert.match(err.message, /invalid_api_key/);
        return true;
      }
    );
  } finally {
    cap.restore();
  }
});

test("sendPowderAlertEmail resolves on success", async () => {
  const client = okClient();
  await sendPowderAlertEmail(
    {
      email: "skier@example.com",
      manageToken: "tok",
      alerts: [{ resortName: "Alta", slug: "alta", newSnow: 12, threshold: 6 }],
    },
    client
  );
  assert.strictEqual(client.sent.length, 1);
  assert.match(client.sent[0].subject, /Alta/);
});

// ─── Cam reports: same defect, but stays fire-and-forget ──────────────────────

function camInput(): CamReportEmailInput {
  return {
    reportId: "r1",
    createdAt: "2026-08-01T00:00:00Z",
    sessionId: "session-abcdef123456",
    reason: "broken",
    resort_link_dead: false,
    suggested_url: null,
    cam: { id: "c1", name: "Base Cam", embed_type: "iframe", embed_url: "https://x", youtube_id: null },
    resort: { name: "Alta", state: "UT" },
    priorReportsIn24h: 0,
    priorReportsIn7d: 1,
  };
}

test("sendCamReportEmail logs a Resend {error} result and does not throw", async () => {
  const cap = captureConsole();
  try {
    await sendCamReportEmail(camInput(), failingClient());
    assert.strictEqual(cap.errors.length, 1);
    assert.match(cap.errors[0], /^\[cam-reports\]/);
    assert.match(cap.errors[0], /validation_error/);
  } finally {
    cap.restore();
  }
});

test("sendCamReportEmail logs nothing on success", async () => {
  const cap = captureConsole();
  const client = okClient();
  try {
    await sendCamReportEmail(camInput(), client);
    assert.deepStrictEqual(cap.errors, []);
    assert.strictEqual(client.sent.length, 1);
  } finally {
    cap.restore();
  }
});
