// components/cam/CamReportModal.tsx
"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { Cam, CamReportReason } from "@/lib/types";

interface Props {
  cam: Cam;
  resortName: string;
  onClose: () => void;
  onSubmitted: () => void;
  onAlreadyReported: () => void;
}

const SESSION_KEY = "peakcam_session";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Matches the secure-context fallback pattern from ConditionVoter.
function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(SESSION_KEY);
  if (id && UUID_RE.test(id)) return id;
  id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
  try {
    window.localStorage.setItem(SESSION_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

const REASONS: { value: CamReportReason; label: string }[] = [
  { value: "broken", label: "Broken / won't load" },
  { value: "wrong_view", label: "Wrong view / wrong location" },
  { value: "other", label: "Something else" },
];

export function CamReportModal({
  cam,
  resortName,
  onClose,
  onSubmitted,
  onAlreadyReported,
}: Props) {
  const [reason, setReason] = useState<CamReportReason | null>(null);
  const [resortLinkDead, setResortLinkDead] = useState(false);
  const [suggestedUrl, setSuggestedUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");

  useEffect(() => {
    setSessionId(getOrCreateSessionId());
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason || !sessionId) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/cam-reports/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cam_id: cam.id,
          session_id: sessionId,
          reason,
          resort_link_dead: resortLinkDead,
          suggested_url: suggestedUrl.trim() || null,
        }),
      });

      if (res.status === 201) {
        onSubmitted();
        return;
      }
      if (res.status === 429) {
        onAlreadyReported();
        return;
      }

      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Something went wrong. Try again in a moment.");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Report · ${resortName} — ${cam.name}`}
    >
      <form onSubmit={handleSubmit} className="px-6 pt-5 pb-6 space-y-5">
        <fieldset className="space-y-2">
          <legend className="pc-eyebrow mb-1.5" style={{ color: "var(--pc-bark)" }}>
            What&rsquo;s wrong?
          </legend>
          {REASONS.map((r) => (
            <label
              key={r.value}
              className="flex items-center gap-3 cursor-pointer text-ink text-[14px] font-medium"
            >
              <input
                type="radio"
                name="reason"
                value={r.value}
                checked={reason === r.value}
                onChange={() => setReason(r.value)}
                className="w-4 h-4 accent-alpen"
              />
              {r.label}
            </label>
          ))}
        </fieldset>

        <label className="flex items-center gap-3 cursor-pointer text-ink text-[14px] font-medium">
          <input
            type="checkbox"
            checked={resortLinkDead}
            onChange={(e) => setResortLinkDead(e.target.checked)}
            className="w-4 h-4 accent-alpen"
          />
          Resort&rsquo;s own site link is also dead
        </label>

        <div>
          <label
            htmlFor="suggested-url"
            className="pc-eyebrow block mb-1.5"
            style={{ color: "var(--pc-bark)" }}
          >
            Know a working link? (optional)
          </label>
          <input
            id="suggested-url"
            type="url"
            value={suggestedUrl}
            onChange={(e) => setSuggestedUrl(e.target.value)}
            placeholder="https://…"
            maxLength={500}
            className="w-full bg-snow text-ink placeholder:text-bark
                       border-[1.5px] border-ink rounded-full shadow-stamp-sm
                       px-4 py-2 text-[14px] font-medium
                       focus:shadow-[3px_3px_0_#a93f20] focus:border-alpen-dk
                       outline-none transition-shadow duration-100"
          />
        </div>

        {error && (
          <p className="text-poor text-[12px] font-semibold">{error}</p>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center px-4 py-2 rounded-full
                       text-ink text-[13px] font-semibold hover:bg-ink/5
                       transition-colors duration-150"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!reason || submitting}
            className={`inline-flex items-center px-4 py-2 rounded-full
              border-[1.5px] border-ink text-[14px] font-bold
              transition-[transform,box-shadow] duration-100
              ${!reason || submitting
                ? "bg-cream text-bark border-bark cursor-not-allowed shadow-none"
                : "bg-alpen text-cream-50 shadow-stamp hover:shadow-stamp-hover hover:-translate-x-[1px] hover:-translate-y-[1px]"
              }`}
          >
            {submitting ? "Sending…" : "Send report"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
