#!/usr/bin/env bash
# cam-check.sh — recurring PeakCam camera-preview check with an escalation ladder.
#
#   tier 0  scripts/cam-check.ts           facts + deterministic rules      always
#   tier 1  Muse Glimmer (local Ollama)    cheap triage of the facts        always
#   tier 2  Muse Code   (muse exec, spark) read-only investigation in repo  when tier 0 or 1 flags an issue
#   tier 3  Muse Wonder (muse exec)        deeper diagnosis + fix plan      when tier 2 asks, or tier 2 fails on CRITICAL
#
# The ladder never changes anything: tiers 2 and 3 run with writes disabled
# and only report. Runs on the Studio from com.peakcam.cam-check.plist.
# Per-run artefacts: $STATE_DIR/runs/<stamp>/ (facts, prompts, raw model
# output, report.md). $STATE_DIR/latest.md is the last report.
#
# Notifications (WhatsApp via `hermes send`) go out when the status changes,
# whenever tier 2/3 ran, and once a day as a digest. An unchanged alert set
# does not re-escalate inside the cooldown window.
#
# Flags: --dry-run (tier 0 only, no notify)  --no-notify  --force-escalate
#        --skip-mini  --skip-site
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${CAM_CHECK_REPO:-$(dirname "$SCRIPT_DIR")}"
STATE_DIR="${CAM_CHECK_STATE:-$HOME/Library/Application Support/peakcam-cam-check}"
OLLAMA_URL="${CAM_CHECK_OLLAMA:-http://127.0.0.1:11434}"
GLIMMER_MODEL="${CAM_CHECK_GLIMMER:-muse-glimmer:30b-mxfp8-dflash}"
MUSE_CODE_MODEL="${CAM_CHECK_MUSE_CODE:-muse-spark-1.3}"
MUSE_WONDER_MODEL="${CAM_CHECK_MUSE_WONDER:-muse-wonder-full-1.0}"
MUSE_BIN="${CAM_CHECK_MUSE:-$HOME/.local/bin/muse}"
NOTIFY_TARGET="${CAM_CHECK_NOTIFY:-whatsapp}"
HERMES_SEND="${CAM_CHECK_HERMES_SEND:-docker exec -i hermes-studio-gateway hermes send}"
DIGEST_HOUR="${CAM_CHECK_DIGEST_HOUR:-7}"
COOLDOWN_H="${CAM_CHECK_COOLDOWN_H:-24}"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

DRY=0; NOTIFY=1; FORCE=0; EXTRA=()
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1; NOTIFY=0 ;;
    --no-notify) NOTIFY=0 ;;
    --force-escalate) FORCE=1 ;;
    --skip-mini) EXTRA+=(--no-mini) ;;
    --skip-site) EXTRA+=(--no-site) ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done

STAMP="$(date +%Y%m%d-%H%M%S)"
RUN="$STATE_DIR/runs/$STAMP"
STATE="$STATE_DIR/state.json"
mkdir -p "$RUN"
[ -f "$STATE" ] || echo '{}' > "$STATE"
log() { printf '[cam-check %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
with_timeout() { perl -e 'alarm shift; exec @ARGV' "$@"; }
jget() { python3 -c 'import json,sys
d=json.load(open(sys.argv[1]))
for k in sys.argv[2].split("."):
    d=d.get(k) if isinstance(d,dict) else None
print("" if d is None else (json.dumps(d) if isinstance(d,(dict,list)) else d))' "$1" "$2" 2>/dev/null; }

# ── tier 0: facts + rules ────────────────────────────────────────────────
baseline="$(jget "$STATE" baseline)"; baseline="${baseline:-0}"
log "tier 0: collecting facts (baseline coverage $baseline)"
if ! ( cd "$REPO" && with_timeout 300 npx tsx scripts/cam-check.ts --json "$RUN/facts.json" --md "$RUN/facts.md" --baseline "$baseline" ${EXTRA[@]+"${EXTRA[@]}"} ) > "$RUN/tier0.log" 2>&1; then
  log "tier 0 failed; see $RUN/tier0.log"
  python3 - "$RUN" <<'EOF'
import json, sys, datetime
run = sys.argv[1]
err = open(f"{run}/tier0.log").read()[-1500:]
out = {"status": "CRITICAL", "alerts": [{"severity": "critical", "code": "cam_check_failed", "message": "scripts/cam-check.ts did not complete: " + err.strip().splitlines()[-1] if err.strip() else "no output"}],
       "facts": {"ts": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "baseline": 0, "db": {"ok": False}, "mini": {"ok": False}, "site": {"ok": False}}}
json.dump(out, open(f"{run}/facts.json", "w"), indent=2)
open(f"{run}/facts.md", "w").write(f"# PeakCam camera-preview check\n\nStatus: CRITICAL\n\n- cam_check_failed: the facts collector crashed.\n\n```\n{err}\n```\n")
EOF
fi
status="$(jget "$RUN/facts.json" status)"
log "tier 0: $status — $(tail -1 "$RUN/tier0.log" 2>/dev/null)"

# ── tier 1: Glimmer triage (local) ───────────────────────────────────────
if [ "$DRY" = 1 ]; then
  echo '{"status":"skipped","summary":"dry run"}' > "$RUN/glimmer.json"
else
  log "tier 1: Glimmer ($GLIMMER_MODEL) triage"
  python3 - "$SCRIPT_DIR/cam-check/prompt-glimmer.txt" "$RUN/facts.md" "$GLIMMER_MODEL" > "$RUN/glimmer-req.json" <<'EOF'
import json, sys
system = open(sys.argv[1]).read()
facts = open(sys.argv[2]).read()
print(json.dumps({"model": sys.argv[3], "stream": False, "temperature": 0, "response_format": {"type": "json_object"},
                  "messages": [{"role": "system", "content": system}, {"role": "user", "content": facts}]}))
EOF
  if with_timeout 480 curl -s -m 450 "$OLLAMA_URL/v1/chat/completions" -H 'Content-Type: application/json' -d @"$RUN/glimmer-req.json" > "$RUN/glimmer-raw.json" 2> "$RUN/glimmer.err"; then
    python3 - "$RUN/glimmer-raw.json" > "$RUN/glimmer.json" <<'EOF' || echo '{"status":"unavailable","summary":"Glimmer returned something that is not the expected JSON"}' > "$RUN/glimmer.json"
import json, sys, re
raw = json.load(open(sys.argv[1]))
text = raw["choices"][0]["message"]["content"]
m = re.search(r"\{.*\}", text, re.S)
d = json.loads(m.group(0))
d.setdefault("status", "issue"); d.setdefault("summary", ""); d.setdefault("issues", [])
d["usage"] = raw.get("usage")
print(json.dumps(d))
EOF
  else
    echo '{"status":"unavailable","summary":"Glimmer (Ollama) did not answer in time"}' > "$RUN/glimmer.json"
  fi
fi
glimmer_status="$(jget "$RUN/glimmer.json" status)"
log "tier 1: $glimmer_status — $(jget "$RUN/glimmer.json" summary | head -c 200)"

# ── escalation decision ──────────────────────────────────────────────────
sig="$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(",".join(sorted(a["code"] for a in d["alerts"] if a["severity"]!="info")))' "$RUN/facts.json")"
last_sig="$(jget "$STATE" last_escalation_sig)"
last_ts="$(jget "$STATE" last_escalation_ts)"; last_ts="${last_ts:-0}"
now_ts="$(date +%s)"
want2=0
[ "$status" != "OK" ] && want2=1
[ "$glimmer_status" = "issue" ] && want2=1
[ "$FORCE" = 1 ] && want2=1
if [ "$want2" = 1 ] && [ "$FORCE" = 0 ] && [ -n "$sig" ] && [ "$sig" = "$last_sig" ] && [ $(( now_ts - ${last_ts%.*} )) -lt $(( COOLDOWN_H * 3600 )) ]; then
  log "escalation: alert set unchanged since last escalation ($sig); cooldown, not re-escalating"
  want2=0; cooled=1
else
  cooled=0
fi
[ "$DRY" = 1 ] && want2=0
escalated=0

run_muse() { # <model> <effort> <steps> <prompt-file> <out-prefix> <timeout>
  local model="$1" effort="$2" steps="$3" prompt="$4" out="$5" to="$6"
  ( cd "$REPO" && with_timeout "$to" "$MUSE_BIN" exec \
      --model "$model" --effort "$effort" --max-model-steps "$steps" \
      --workspace "$REPO" --trust-workspace --disable-write --disable-web-tools \
      --disable-request-user-input --disable-reminders --approval-mode never \
      --output-schema "$SCRIPT_DIR/cam-check/tier.schema.json" \
      --prompt-file "$prompt" ) > "$out-raw.txt" 2> "$out.err"
  local rc=$?
  python3 - "$out-raw.txt" "$rc" > "$out.json" <<'EOF' || echo "{\"verdict\":\"failed\",\"severity\":\"none\",\"diagnosis\":\"muse exec rc=$rc produced no JSON\",\"evidence\":[],\"recommended_actions\":[],\"escalate_to_wonder\":false}" > "$out.json"
import json, sys, re
text = open(sys.argv[1]).read()
blocks = re.findall(r"\{.*\}", text, re.S)
d = None
for b in reversed(blocks):
    try:
        d = json.loads(b); break
    except Exception:
        # try trimming to the outermost balanced object
        depth = 0
        for i, ch in enumerate(b):
            if ch == "{": depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try: d = json.loads(b[:i+1]); break
                    except Exception: pass
        if d: break
if not isinstance(d, dict): raise SystemExit(1)
d["rc"] = int(sys.argv[2])
print(json.dumps(d))
EOF
  return $rc
}

# ── tier 2: Muse Code ────────────────────────────────────────────────────
if [ "$want2" = 1 ]; then
  log "tier 2: Muse Code ($MUSE_CODE_MODEL) investigating"
  { cat "$SCRIPT_DIR/cam-check/prompt-muse.txt"; echo; echo "## Facts (tier 0)"; echo; cat "$RUN/facts.md"; echo; echo "## Glimmer triage (tier 1)"; echo; cat "$RUN/glimmer.json"; echo; } > "$RUN/tier2-prompt.md"
  run_muse "$MUSE_CODE_MODEL" medium 40 "$RUN/tier2-prompt.md" "$RUN/tier2" 900
  escalated=2
  log "tier 2: $(jget "$RUN/tier2.json" verdict) / $(jget "$RUN/tier2.json" severity) — $(jget "$RUN/tier2.json" diagnosis | head -c 200)"
  want3=0
  [ "$(jget "$RUN/tier2.json" escalate_to_wonder)" = "True" ] && want3=1
  [ "$(jget "$RUN/tier2.json" verdict)" = "failed" ] && [ "$status" = "CRITICAL" ] && want3=1
  if [ "$want3" = 1 ]; then
    log "tier 3: Muse Wonder ($MUSE_WONDER_MODEL)"
    { cat "$RUN/tier2-prompt.md"; echo; echo "## Muse Code findings (tier 2)"; echo; cat "$RUN/tier2.json"; echo; echo "You are the final tier. Give the definitive diagnosis, a concrete fix plan (files, commands, order), and anything the operator must decide. Do not escalate further."; } > "$RUN/tier3-prompt.md"
    run_muse "$MUSE_WONDER_MODEL" high 60 "$RUN/tier3-prompt.md" "$RUN/tier3" 1800
    escalated=3
    log "tier 3: $(jget "$RUN/tier3.json" verdict) / $(jget "$RUN/tier3.json" severity) — $(jget "$RUN/tier3.json" diagnosis | head -c 200)"
  fi
fi

# ── report + notify + state ──────────────────────────────────────────────
decision="$(python3 "$SCRIPT_DIR/cam-check/report.py" "$RUN" "$STATE" --escalated "$escalated" --cooled "$cooled" --digest-hour "$DIGEST_HOUR" --sig "$sig" --notify "$NOTIFY")"
cp "$RUN/report.md" "$STATE_DIR/latest.md"
send="$(printf '%s' "$decision" | python3 -c 'import json,sys;print(json.load(sys.stdin)["send"])')"
reason="$(printf '%s' "$decision" | python3 -c 'import json,sys;print(json.load(sys.stdin)["reason"])')"
log "report: $RUN/report.md (send=$send: $reason)"
if [ "$send" = "True" ] && [ "$NOTIFY" = 1 ]; then
  if printf '%s' "$decision" | python3 -c 'import json,sys;sys.stdout.write(json.load(sys.stdin)["message"])' | with_timeout 120 $HERMES_SEND -t "$NOTIFY_TARGET" -s "PeakCam cam-check: $status" -f - > "$RUN/notify.log" 2>&1; then
    log "notified $NOTIFY_TARGET"
  else
    log "notify failed; see $RUN/notify.log"
  fi
fi

# keep 30 days of runs
find "$STATE_DIR/runs" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} + 2>/dev/null
log "done: $status (tier $escalated)"
