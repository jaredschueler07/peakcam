import { Resend } from "resend";
import type { CreateEmailOptions, CreateEmailResponse } from "resend";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://peakcam.io";
const FROM = "PeakCam Alerts <alerts@send.peakcam.io>";

// ─── Sending core ─────────────────────────────────────────────────────────────
//
// The Resend SDK does NOT throw on API errors — it resolves `{ data, error }`.
// Every send therefore has to inspect `error`, or a dead key / unverified
// domain / rate limit is indistinguishable from a delivered email.

/** The slice of the Resend client we use — lets tests inject a fake. */
export interface EmailClient {
  emails: { send(payload: CreateEmailOptions): Promise<CreateEmailResponse> };
}

export type EmailFailureKind = "missing_key" | "malformed_key" | "api_error";

export interface EmailFailure {
  kind: EmailFailureKind;
  /** Resend error code (`validation_error`, `invalid_api_key`, …) when kind is api_error. */
  name?: string;
  message: string;
  statusCode?: number | null;
}

export type EmailResult =
  | { ok: true; id: string | undefined; error?: undefined }
  | { ok: false; id?: undefined; error: EmailFailure };

export class EmailSendError extends Error {
  readonly kind: EmailFailureKind;
  readonly emailType: string;
  readonly to: string;
  readonly resendErrorName?: string;
  readonly statusCode?: number | null;

  constructor(emailType: string, to: string, failure: EmailFailure) {
    super(`${emailType} email to ${to} failed: ${failure.name ?? failure.kind}: ${failure.message}`);
    this.name = "EmailSendError";
    this.kind = failure.kind;
    this.emailType = emailType;
    this.to = to;
    this.resendErrorName = failure.name;
    this.statusCode = failure.statusCode;
  }
}

/**
 * Local, network-free validation of the API key's shape. Distinguishes the two
 * failure modes we can detect without a round trip; the third (a well-formed
 * key the API rejects) can only surface on a real send.
 */
export function checkResendApiKey(key: string | undefined): {
  ok: boolean;
  problem: "missing" | "malformed" | null;
  message?: string;
} {
  const trimmed = key?.trim();
  if (!trimmed) {
    return {
      ok: false,
      problem: "missing",
      message: "RESEND_API_KEY is not set — no transactional email can be sent.",
    };
  }
  if (!trimmed.startsWith("re_") || trimmed.length < 10) {
    return {
      ok: false,
      problem: "malformed",
      message:
        `RESEND_API_KEY does not look like a Resend key (expected a re_ prefix, got ${trimmed.length} chars ` +
        `starting "${trimmed.slice(0, 3)}") — check the value in the Vercel project env.`,
    };
  }
  return { ok: true, problem: null };
}

/** Test seam: inject a fake client for the module-level send paths. */
let clientOverride: EmailClient | null = null;
export function setEmailClientForTests(client: EmailClient | null): void {
  clientOverride = client;
}

function resolveClient(explicit?: EmailClient): EmailClient | EmailFailure {
  if (explicit) return explicit;
  if (clientOverride) return clientOverride;
  const key = checkResendApiKey(process.env.RESEND_API_KEY);
  if (!key.ok) {
    return { kind: key.problem === "missing" ? "missing_key" : "malformed_key", message: key.message! };
  }
  return new Resend(process.env.RESEND_API_KEY!.trim()) as unknown as EmailClient;
}

/** Best-guess remediation hint, keyed off the Resend error code. */
function likelyCause(name: string, message: string): string {
  if (/domain is not verified/i.test(message)) {
    return `the sending domain in FROM (${FROM}) is not verified in Resend — add and verify it, or send from a verified subdomain`;
  }
  switch (name) {
    case "missing_api_key":
    case "invalid_api_key":
      return "RESEND_API_KEY is not a key Resend recognises — check the value in the Vercel project env";
    case "restricted_api_key":
      return "the API key exists but lacks sending permission — issue a full-access or sending key";
    case "invalid_from_address":
      return `the FROM address (${FROM}) is not usable with this account`;
    case "rate_limit_exceeded":
    case "daily_quota_exceeded":
    case "monthly_quota_exceeded":
      return "the Resend account is over quota / rate limited — this send was dropped";
    case "validation_error":
      return "Resend rejected the request payload (address or fields)";
    default:
      return "see the Resend error message above";
  }
}

/**
 * Send one email and classify the outcome. Never throws for delivery problems —
 * it returns them, and always logs them under the stable `[email]` prefix so a
 * broken key is greppable in Vercel logs even if a caller ignores the result.
 */
export async function sendEmail(
  opts: {
    emailType: string;
    to: string;
    payload: Omit<CreateEmailOptions, "from" | "to">;
    /** Log-line prefix, so each subsystem's failures stay greppable. */
    logPrefix?: string;
  },
  client?: EmailClient
): Promise<EmailResult> {
  const tag = `[${opts.logPrefix ?? "email"}]`;
  const resolved = resolveClient(client);
  if (!("emails" in resolved)) {
    console.error(`${tag} ${opts.emailType} to ${opts.to} not sent — ${resolved.message}`);
    return { ok: false, error: resolved };
  }

  let response: CreateEmailResponse;
  try {
    response = await resolved.emails.send({
      ...opts.payload,
      from: FROM,
      to: opts.to,
    } as CreateEmailOptions);
  } catch (err) {
    // Network/transport failure — the SDK does throw for these.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${tag} ${opts.emailType} to ${opts.to} failed (transport): ${message}`);
    return { ok: false, error: { kind: "api_error", name: "transport_error", message } };
  }

  if (response.error) {
    const { name, message, statusCode } = response.error;
    console.error(
      `${tag} ${opts.emailType} to ${opts.to} FAILED — ${name}` +
        `${statusCode ? ` (HTTP ${statusCode})` : ""}: ${message} — likely cause: ${likelyCause(name, message)}`
    );
    return { ok: false, error: { kind: "api_error", name, message, statusCode } };
  }

  return { ok: true, id: response.data?.id };
}

async function sendOrThrow(
  emailType: string,
  to: string,
  payload: Omit<CreateEmailOptions, "from" | "to">,
  client?: EmailClient
): Promise<void> {
  const result = await sendEmail({ emailType, to, payload }, client);
  if (!result.ok) throw new EmailSendError(emailType, to, result.error);
}

// ─── Welcome email ────────────────────────────────────────────────────────────

/** Throws {@link EmailSendError} if the mail was not accepted by Resend. */
export async function sendWelcomeEmail(
  params: {
    email: string;
    manageToken: string;
    resortNames: string[];
  },
  client?: EmailClient
) {
  const manageUrl = `${SITE_URL}/alerts/manage?token=${params.manageToken}`;
  const resortList = params.resortNames.map((n) => `<li>${n}</li>`).join("");

  await sendOrThrow("welcome", params.email, {
    subject: "Powder alerts activated — PeakCam",
    html: buildEmailHtml({
      preheader: `You'll be notified when your resorts get fresh snow.`,
      title: "Powder alerts are on.",
      body: `
        <p>You're now set up for powder alerts at:</p>
        <ul style="margin: 16px 0; padding-left: 20px; color: #94a3b8;">${resortList}</ul>
        <p>We'll email you whenever a resort you follow hits your snow threshold.</p>
      `,
      ctaUrl: manageUrl,
      ctaLabel: "Manage your alerts",
      manageUrl,
    }),
  }, client);
}

// ─── Existing-subscriber manage link ──────────────────────────────────────────
// Sent when /api/alerts/subscribe is called with an address that is already
// subscribed. The endpoint has no proof the caller owns that address, so it
// must not apply the requested changes; mailing the manage link puts the edit
// in the hands of whoever actually reads the inbox. The copy deliberately does
// not echo back the resorts the caller asked for — that request may not have
// come from the subscriber.

/** Throws {@link EmailSendError} if the mail was not accepted by Resend. */
export async function sendManageLinkEmail(
  params: {
    email: string;
    manageToken: string;
  },
  client?: EmailClient
) {
  const manageUrl = `${SITE_URL}/alerts/manage?token=${params.manageToken}`;

  await sendOrThrow("manage_link", params.email, {
    subject: "Your PeakCam powder alerts",
    html: buildEmailHtml({
      preheader: "You're already subscribed — here's your link to change what you follow.",
      title: "You're already on the list.",
      body: `
        <p>Someone just used this address to sign up for powder alerts on PeakCam,
        and it's already subscribed — so nothing has been changed.</p>
        <p>Use the link below to add resorts, adjust your snow thresholds, or
        unsubscribe. If this wasn't you, you can ignore this email; your alerts
        are exactly as you left them.</p>
      `,
      ctaUrl: manageUrl,
      ctaLabel: "Manage your alerts",
      manageUrl,
    }),
  }, client);
}

// ─── Powder alert email ───────────────────────────────────────────────────────

/** Throws {@link EmailSendError} if the mail was not accepted by Resend. */
export async function sendPowderAlertEmail(
  params: {
    email: string;
    manageToken: string;
    alerts: Array<{ resortName: string; slug: string; newSnow: number; threshold: number }>;
  },
  client?: EmailClient
) {
  const manageUrl = `${SITE_URL}/alerts/manage?token=${params.manageToken}`;

  const topResort = params.alerts[0];
  const subject =
    params.alerts.length === 1
      ? `${topResort.newSnow}" of new snow at ${topResort.resortName} — PeakCam`
      : `Powder at ${params.alerts.length} resorts — PeakCam`;

  const alertRows = params.alerts
    .map(
      (a) => `
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #1e293b;">
          <a href="${SITE_URL}/resorts/${a.slug}"
             style="color: #22d3ee; font-weight: 600; text-decoration: none;">
            ${a.resortName}
          </a>
        </td>
        <td style="padding: 12px 0; border-bottom: 1px solid #1e293b; text-align: right;">
          <span style="color: #a78bfa; font-family: monospace; font-size: 20px; font-weight: 700;">
            +${a.newSnow}"
          </span>
          <span style="color: #64748b; font-size: 12px; display: block;">in 24h</span>
        </td>
      </tr>`
    )
    .join("");

  await sendOrThrow("powder_alert", params.email, {
    subject,
    html: buildEmailHtml({
      preheader: `${topResort.newSnow}" of fresh snow at ${topResort.resortName}${params.alerts.length > 1 ? ` and ${params.alerts.length - 1} more` : ""}.`,
      title: "Fresh powder dropped.",
      body: `
        <table style="width: 100%; border-collapse: collapse; margin: 24px 0;">
          <tbody>${alertRows}</tbody>
        </table>
      `,
      ctaUrl: `${SITE_URL}/resorts/${topResort.slug}`,
      ctaLabel: `Check conditions at ${topResort.resortName}`,
      manageUrl,
    }),
  }, client);
}

// ─── HTML shell ───────────────────────────────────────────────────────────────

function buildEmailHtml(params: {
  preheader: string;
  title: string;
  body: string;
  ctaUrl: string;
  ctaLabel: string;
  manageUrl: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PeakCam</title>
</head>
<body style="margin:0; padding:0; background:#0a0f1a; font-family:'Inter',system-ui,sans-serif; color:#e2e8f0;">

  <!-- Preheader -->
  <span style="display:none; max-height:0; overflow:hidden; mso-hide:all;">
    ${params.preheader}&nbsp;&#847;&nbsp;
  </span>

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0f1a;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table width="600" cellpadding="0" cellspacing="0"
               style="background:#0f172a; border-radius:12px; border:1px solid #1e293b; overflow:hidden; max-width:600px;">

          <!-- Header bar -->
          <tr>
            <td style="background:linear-gradient(90deg,#7c3aed,#22d3ee,#7c3aed); height:3px;"></td>
          </tr>

          <!-- Logo + nav -->
          <tr>
            <td style="padding: 24px 32px 0;">
              <a href="${SITE_URL}" style="color:#22d3ee; font-size:18px; font-weight:700; text-decoration:none; letter-spacing:0.05em;">
                PEAKCAM
              </a>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 32px 32px 24px;">
              <h1 style="margin:0 0 16px; font-size:28px; font-weight:700; color:#f8fafc; line-height:1.2;">
                ${params.title}
              </h1>
              <div style="color:#94a3b8; font-size:15px; line-height:1.6;">
                ${params.body}
              </div>

              <!-- CTA -->
              <a href="${params.ctaUrl}"
                 style="display:inline-block; margin-top:24px; padding:12px 28px;
                        background:#22d3ee; color:#0a0f1a; border-radius:8px;
                        font-weight:700; font-size:14px; text-decoration:none;
                        letter-spacing:0.03em;">
                ${params.ctaLabel}
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; border-top: 1px solid #1e293b;">
              <p style="margin:0; color:#475569; font-size:12px; line-height:1.6;">
                You're receiving this because you subscribed to powder alerts on PeakCam.
                <a href="${params.manageUrl}" style="color:#22d3ee; text-decoration:none;">
                  Manage or unsubscribe
                </a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}
