#!/usr/bin/env python3
"""Build the cam-check report for one run, decide whether to notify, update state.

Called by scripts/cam-check.sh:
    report.py <run-dir> <state.json> --escalated 0|2|3 --cooled 0|1 --digest-hour 7 --sig <codes> --notify 0|1

Writes <run-dir>/report.md and prints a JSON decision {"send": bool, "reason": str, "message": str}.
The message is the short WhatsApp text; the full report stays on disk.
"""
import argparse
import datetime as dt
import json
import os
import sys


def load(path, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return default


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("state")
    ap.add_argument("--escalated", type=int, default=0)
    ap.add_argument("--cooled", type=int, default=0)
    ap.add_argument("--digest-hour", type=int, default=7)
    ap.add_argument("--sig", default="")
    ap.add_argument("--notify", type=int, default=1)
    a = ap.parse_args()

    facts = load(os.path.join(a.run, "facts.json"), {"status": "CRITICAL", "alerts": [], "facts": {}})
    glimmer = load(os.path.join(a.run, "glimmer.json"), {"status": "unavailable", "summary": ""})
    tier2 = load(os.path.join(a.run, "tier2.json"))
    tier3 = load(os.path.join(a.run, "tier3.json"))
    state = load(a.state, {}) or {}

    status = facts.get("status", "CRITICAL")
    alerts = facts.get("alerts", [])
    f = facts.get("facts", {})
    db = f.get("db", {}) or {}
    now = dt.datetime.now()
    today = now.strftime("%Y-%m-%d")

    # ── report.md ────────────────────────────────────────────────────────
    L = [f"# PeakCam cam-check — {f.get('ts', now.isoformat())}", "", f"**Status: {status}**  (tier reached: {a.escalated or 1})", ""]
    L.append("## Alerts")
    L += [f"- [{x['severity']}] {x['code']}: {x['message']}" for x in alerts] or ["- none"]
    L += ["", "## Tier 1 — Muse Glimmer", f"- status: {glimmer.get('status')}", f"- {glimmer.get('summary', '')}"]
    L += [f"  - {i}" for i in glimmer.get("issues", []) or []]
    for name, t in (("Tier 2 — Muse Code", tier2), ("Tier 3 — Muse Wonder", tier3)):
        if not t:
            continue
        L += ["", f"## {name}", f"- verdict: {t.get('verdict')} ({t.get('severity')})", "", t.get("diagnosis", ""), ""]
        if t.get("evidence"):
            L += ["Evidence:"] + [f"- {e}" for e in t["evidence"]]
        if t.get("recommended_actions"):
            L += ["", "Recommended actions:"] + [f"{i + 1}. {s}" for i, s in enumerate(t["recommended_actions"])]
        if t.get("escalate_to_wonder") and t.get("wonder_question"):
            L += ["", f"Asked Wonder: {t['wonder_question']}"]
    if a.cooled:
        L += ["", "_Alert set unchanged since the last escalation; tier 2 skipped (cooldown)._"]
    try:
        with open(os.path.join(a.run, "facts.md"), encoding="utf-8") as fh:
            L += ["", "---", "", fh.read()]
    except OSError:
        pass
    with open(os.path.join(a.run, "report.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")

    # ── short message ────────────────────────────────────────────────────
    M = []
    if db.get("ok"):
        M.append(f"Cards with a preview: {db.get('coverage')}/{db.get('resorts')} · newest still {db.get('newestStillAgeH')} h ago · {db.get('stills')} captured")
    for x in alerts:
        if x["severity"] != "info":
            M.append(f"• [{x['severity']}] {x['message'][:220]}")
    if glimmer.get("status") in ("issue", "unavailable"):
        M.append(f"Glimmer: {glimmer.get('summary', '')[:200]}")
    final = tier3 or tier2
    if final:
        who = "Wonder" if tier3 else "Muse Code"
        M.append(f"{who}: {final.get('verdict')} ({final.get('severity')}) — {final.get('diagnosis', '')[:400]}")
        for i, s in enumerate(final.get("recommended_actions", [])[:3]):
            M.append(f"  {i + 1}. {s[:200]}")
    elif a.cooled:
        M.append("(same alerts as last escalation; not re-investigated)")
    M.append(f"Report: {os.path.join(a.run, 'report.md')}")
    message = "\n".join(M)

    # ── decide ───────────────────────────────────────────────────────────
    prev = state.get("prev_status")
    digest_due = now.hour >= a.digest_hour and state.get("last_digest_date") != today
    if a.escalated:
        send, reason = True, f"escalated to tier {a.escalated}"
    elif prev is not None and prev != status:
        send, reason = True, f"status changed {prev} → {status}"
    elif prev is None:
        send, reason = True, "first run"
    elif digest_due:
        send, reason = True, "daily digest"
    else:
        send, reason = False, "no change"

    # ── state ────────────────────────────────────────────────────────────
    state["prev_status"] = status
    state["last_run"] = now.isoformat(timespec="seconds")
    state["last_run_dir"] = a.run
    if db.get("ok") and db.get("coverage") is not None:
        state["baseline"] = max(int(state.get("baseline", 0) or 0), int(db["coverage"]))
        state["last_coverage"] = int(db["coverage"])
    if a.escalated:
        state["last_escalation_sig"] = a.sig
        state["last_escalation_ts"] = now.timestamp()
        state["last_escalation_dir"] = a.run
    if send and a.notify and digest_due:
        state["last_digest_date"] = today
    with open(a.state, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2)

    print(json.dumps({"send": send, "reason": reason, "message": message, "status": status}))


if __name__ == "__main__":
    sys.exit(main())
