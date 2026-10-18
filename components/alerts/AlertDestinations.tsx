"use client";

import { useState } from "react";
import { Check, Copy, Loader2, Plus, Rss, Send, Trash2, Webhook } from "lucide-react";
import type { DestinationView } from "@/lib/alerts/destinations";
import type { ManageFeeds } from "@/lib/alerts/manage";

interface Props {
  token: string;
  initialDestinations: DestinationView[];
  feeds?: ManageFeeds;
}

interface NewSecret {
  destinationId: string;
  secret: string;
}

/**
 * The "deliver somewhere else" half of /alerts/manage: signed webhooks and
 * the subscriber's own Atom / iCal feed URLs. Every action here calls
 * /api/alerts/manage straight away — nothing waits on the page's Save.
 * The webhook secret is shown exactly once, right after creation; the
 * server never returns it again.
 *
 * Styled with the page's legacy token classes on purpose: this component
 * lives inside AlertManagePage, which has not migrated to the pc-* tokens,
 * and a mixed palette inside one page would read as a bug.
 */
export function AlertDestinations({ token, initialDestinations, feeds }: Props) {
  const [destinations, setDestinations] = useState<DestinationView[]>(initialDestinations);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [newSecret, setNewSecret] = useState<NewSecret | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; detail: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const webhooks = destinations.filter((d) => d.kind === "webhook");

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
    } catch {
      setError("Couldn't copy — select the text and copy it by hand.");
    }
  };

  const addWebhook = async () => {
    setAdding(true);
    setError(null);
    setNewSecret(null);
    try {
      const resp = await fetch("/api/alerts/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "add_webhook", url }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error ?? "Failed to add webhook");
      setDestinations((prev) => [data.destination as DestinationView, ...prev]);
      setNewSecret({ destinationId: data.destination.id, secret: data.secret });
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAdding(false);
    }
  };

  const testWebhook = async (id: string) => {
    setBusyId(id);
    setError(null);
    setTestResult(null);
    try {
      const resp = await fetch("/api/alerts/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "test_webhook", destination_id: id }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.status === 404 || resp.status === 400) throw new Error(data.error ?? "Test failed");
      setTestResult({
        id,
        ok: Boolean(data.ok),
        detail: data.ok ? `Delivered (HTTP ${data.status})` : `Failed: ${data.error ?? "no response"}${data.status ? ` (HTTP ${data.status})` : ""}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  };

  const removeWebhook = async (id: string) => {
    if (!confirm("Remove this webhook? Alerts will stop posting to it immediately.")) return;
    setBusyId(id);
    setError(null);
    try {
      const resp = await fetch(
        `/api/alerts/manage?token=${encodeURIComponent(token)}&destination=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to remove webhook");
      }
      setDestinations((prev) => prev.filter((d) => d.id !== id));
      if (newSecret?.destinationId === id) setNewSecret(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  };

  const inputClass =
    "w-full px-4 py-2.5 bg-surface border border-border rounded-lg text-text-base placeholder:text-text-muted outline-none focus:border-cyan/50 text-[16px] md:text-sm";

  return (
    <section className="mb-8 space-y-6" aria-labelledby="alert-destinations-heading">
      {/* Webhooks */}
      <div className="rounded-lg border border-border bg-surface px-4 py-4">
        <div className="flex items-center gap-2 mb-1">
          <Webhook size={16} className="text-cyan" />
          <h2 id="alert-destinations-heading" className="text-sm font-semibold text-text-base">Webhooks</h2>
        </div>
        <p className="text-xs text-text-muted mb-4">
          Every powder alert is also POSTed as JSON to each URL below, signed with the Standard Webhooks
          headers (<code className="font-mono">webhook-id</code>, <code className="font-mono">webhook-timestamp</code>,{" "}
          <code className="font-mono">webhook-signature</code>). Three attempts per alert; a URL that fails ten
          runs in a row is switched off.
        </p>

        {webhooks.length > 0 && (
          <ul className="space-y-2 mb-4">
            {webhooks.map((d) => {
              const disabled = d.disabled_at !== null;
              return (
                <li key={d.id} className="rounded-lg border border-border bg-surface2 px-3 py-2.5">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-xs text-text-base break-all">{d.target}</p>
                      <p className="text-[11px] text-text-muted mt-1">
                        {disabled
                          ? `Disabled after ${d.failures} failed runs — remove it and add it again to re-enable.`
                          : d.last_delivered_at
                            ? `Last delivered ${new Date(d.last_delivered_at).toLocaleString()}${d.failures > 0 ? ` · ${d.failures} failed run${d.failures === 1 ? "" : "s"} since` : ""}`
                            : d.failures > 0
                              ? `${d.failures} failed run${d.failures === 1 ? "" : "s"}, nothing delivered yet`
                              : "No deliveries yet"}
                      </p>
                      {testResult?.id === d.id && (
                        <p className={`text-[11px] mt-1 ${testResult.ok ? "text-green-500" : "text-red-400"}`}>{testResult.detail}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!disabled && (
                        <button
                          type="button"
                          onClick={() => testWebhook(d.id)}
                          disabled={busyId === d.id}
                          className="flex items-center gap-1 text-xs text-text-subtle hover:text-cyan px-2 py-1.5 pointer-coarse:min-h-11 rounded transition-colors disabled:opacity-50"
                          aria-label={`Send a test delivery to ${d.target}`}
                        >
                          {busyId === d.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                          Test
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeWebhook(d.id)}
                        disabled={busyId === d.id}
                        className="flex items-center gap-1 text-xs text-text-muted hover:text-red-400 px-2 py-1.5 pointer-coarse:min-h-11 rounded transition-colors disabled:opacity-50"
                        aria-label={`Remove webhook ${d.target}`}
                      >
                        <Trash2 size={13} />
                        Remove
                      </button>
                    </div>
                  </div>

                  {newSecret?.destinationId === d.id && (
                    <div className="mt-3 rounded-md border border-cyan/40 bg-cyan/5 px-3 py-2.5">
                      <p className="text-xs font-semibold text-text-base mb-1">Signing secret — shown once</p>
                      <p className="text-[11px] text-text-muted mb-2">
                        Copy it now and store it with your receiver. PeakCam cannot show it again; if you lose it,
                        remove the webhook and add it back for a new one.
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 font-mono text-xs text-text-base break-all select-all">{newSecret.secret}</code>
                        <button
                          type="button"
                          onClick={() => copy(`secret-${d.id}`, newSecret.secret)}
                          className="flex items-center gap-1 text-xs text-cyan px-2 py-1.5 pointer-coarse:min-h-11 rounded hover:bg-cyan/10 shrink-0"
                          aria-label="Copy signing secret"
                        >
                          {copied === `secret-${d.id}` ? <Check size={13} /> : <Copy size={13} />}
                          {copied === `secret-${d.id}` ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) void addWebhook();
          }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <label htmlFor="alert-webhook-url" className="sr-only">Webhook URL</label>
          <input
            id="alert-webhook-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/hooks/peakcam"
            className={inputClass}
          />
          <button
            type="submit"
            disabled={adding || !url.trim()}
            className="flex items-center justify-center gap-2 px-4 py-2.5 pointer-coarse:min-h-11 rounded-lg text-sm font-semibold bg-cyan text-bg hover:bg-cyan/90 transition-colors disabled:opacity-60 shrink-0"
          >
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add webhook URL
          </button>
        </form>
      </div>

      {/* Feeds */}
      {feeds && (
        <div className="rounded-lg border border-border bg-surface px-4 py-4">
          <div className="flex items-center gap-2 mb-1">
            <Rss size={16} className="text-cyan" />
            <h2 className="text-sm font-semibold text-text-base">Your feeds</h2>
          </div>
          <p className="text-xs text-text-muted mb-3">
            The same alerts as a feed: Atom for a reader or an agent that polls, iCal for a calendar of forecast
            storm windows. These links act as your login for this page — don&apos;t post them publicly.
          </p>
          <dl className="space-y-2">
            {[
              { key: "atom", label: "Atom feed", value: feeds.atom },
              { key: "ics", label: "Calendar (iCal)", value: feeds.ics },
            ].map((feed) => (
              <div key={feed.key} className="flex items-center gap-2">
                <dt className="text-xs text-text-subtle w-28 shrink-0">{feed.label}</dt>
                <dd className="flex-1 min-w-0 flex items-center gap-2">
                  <code className="flex-1 font-mono text-[11px] text-text-base truncate select-all" title={feed.value}>{feed.value}</code>
                  <button
                    type="button"
                    onClick={() => copy(feed.key, feed.value)}
                    className="flex items-center gap-1 text-xs text-cyan px-2 py-1.5 pointer-coarse:min-h-11 rounded hover:bg-cyan/10 shrink-0"
                    aria-label={`Copy ${feed.label} URL`}
                  >
                    {copied === feed.key ? <Check size={13} /> : <Copy size={13} />}
                    {copied === feed.key ? "Copied" : "Copy"}
                  </button>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}
    </section>
  );
}
