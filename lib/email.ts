import { Resend } from "resend";

// Lazy init so the module can be imported at build time without the key set
function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  return new Resend(key);
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://peakcam.io";
const FROM = "PeakCam Alerts <alerts@peakcam.io>";

// ─── Welcome email ────────────────────────────────────────────────────────────

export async function sendWelcomeEmail(params: {
  email: string;
  manageToken: string;
  resortNames: string[];
}) {
  const manageUrl = `${SITE_URL}/alerts/manage?token=${params.manageToken}`;
  const resortList = params.resortNames.map((n) => `<li>${n}</li>`).join("");

  await getResend().emails.send({
    from: FROM,
    to: params.email,
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
  });
}

// ─── Powder alert email ───────────────────────────────────────────────────────

export async function sendPowderAlertEmail(params: {
  email: string;
  manageToken: string;
  alerts: Array<{ resortName: string; slug: string; newSnow: number; threshold: number }>;
}) {
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

  await getResend().emails.send({
    from: FROM,
    to: params.email,
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
  });
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
