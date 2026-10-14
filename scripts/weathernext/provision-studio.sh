#!/bin/bash
# provision-studio.sh -- provision the Mac Studio ("studio") for the
# WeatherNext powder-probability job. Idempotent: safe to re-run.
#
# Run ON the Studio, never from inside a village tree:
#   scp scripts/weathernext/provision-studio.sh studio:~/
#   ssh studio 'bash ~/provision-studio.sh'           # provision only
#   ssh studio 'bash ~/provision-studio.sh --load'    # also load job
#   bash provision-studio.sh --dry-run                # print plan only
#
# What it does:
#   1. finds uv (brew or ~/.local/bin), installing it with brew when
#      Homebrew is present, else with uv's official installer;
#   2. clones or fast-forwards a dedicated peakcam checkout at
#      ~/Code/peakcam from origin (refuses a dirty checkout);
#   3. creates scripts/weathernext/.venv inside that checkout with a
#      uv-managed CPython and installs locked dependencies;
#   4. renders ~/Library/LaunchAgents/com.peakcam.weathernext-sync.plist
#      from the template in the checkout. The job is NOT loaded unless
#      --load is passed: its "sync-latest" subcommand does not exist
#      until the allowlisted WeatherNext Zarr source lands.
#
# Bootstrap note: the Studio clones from origin, so step 2 fails with
# an explanatory error until scripts/weathernext/ (including this
# file) is committed and pushed. The Studio also needs GitHub SSH
# auth for the default clone URL (add its public key to GitHub), or
# override PEAKCAM_GIT_URL with an URL it can read.
#
# Studio facts this assumes (verified by read-only ssh 2026-10-12):
# user totcho_admin, /bin/zsh login shell, /bin/bash = bash 3.2 (this
# script stays 3.2-compatible), Homebrew at /opt/homebrew with uv,
# /usr/bin/git 2.54, ~/Code and ~/Library/LaunchAgents present,
# non-login PATH has no brew so every path below is absolute or the
# script fixes PATH itself.

set -euo pipefail

LABEL="com.peakcam.weathernext-sync"
GIT_URL="${PEAKCAM_GIT_URL:-git@github.com:jaredschueler07/peakcam.git}"
BRANCH="${PEAKCAM_BRANCH:-main}"
CHECKOUT_DIR="${PEAKCAM_CHECKOUT_DIR:-$HOME/Code/peakcam}"
PYTHON_VERSION="${WN_PYTHON_VERSION:-3.12}"
TEMPLATE_OVERRIDE="${PEAKCAM_PLIST_TEMPLATE:-}"
DRY_RUN=0
LOAD_JOB=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --load) LOAD_JOB=1 ;;
    -h|--help)
      sed -n '2,40p' "$0" 2>/dev/null || true
      exit 0 ;;
    *) echo "unknown argument: $arg (expected --dry-run or --load)" >&2; exit 2 ;;
  esac
done

# Non-login ssh and launchd do not see Homebrew or ~/.local/bin.
PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH

log() { printf '%s\n' "==> $*"; }
die() { printf '%s\n' "error: $*" >&2; exit 1; }
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf 'dry-run: %s\n' "$*"
  else
    "$@"
  fi
}
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# --- guards ---------------------------------------------------------

[ "$(uname -s)" = "Darwin" ] || die "this script provisions macOS (launchd) only"
[ -n "${HOME:-}" ] || die "HOME is not set"

CWD_PHYS="$(cd -P . && pwd -P)"
case "$(lower "$CWD_PHYS")/" in
  *"/village-secondary/"*)
    die "refusing to run from inside the village-secondary tree ($CWD_PHYS); cd elsewhere first" ;;
  *"/village/"*)
    die "refusing to run from inside the village tree ($CWD_PHYS); cd elsewhere first" ;;
esac

case "$(lower "$CHECKOUT_DIR")/" in
  *"/village-secondary/"*|*"/village/"*)
    die "checkout dir must not be inside a village tree: $CHECKOUT_DIR" ;;
esac
[ "$CHECKOUT_DIR" != "$HOME" ] || die "checkout dir must not be \$HOME itself"

WN_DIR="$CHECKOUT_DIR/scripts/weathernext"
VENV_PYTHON="$WN_DIR/.venv/bin/python"
LOG_DIR="$HOME/Library/Logs/peakcam-weathernext"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"

SCRIPT_DIR=""
case "${BASH_SOURCE:-}" in
  */*) SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE}")" 2>/dev/null && pwd -P)" || SCRIPT_DIR="" ;;
esac

# --- uv ---------------------------------------------------------------

resolve_uv() {
  if command -v uv >/dev/null 2>&1; then
    command -v uv
  elif [ -x /opt/homebrew/bin/uv ]; then
    printf '%s\n' "/opt/homebrew/bin/uv"
  elif [ -x "$HOME/.local/bin/uv" ]; then
    printf '%s\n' "$HOME/.local/bin/uv"
  else
    return 1
  fi
}

UV_BIN="$(resolve_uv || true)"
if [ -z "$UV_BIN" ]; then
  log "uv not found; installing"
  if [ -x /opt/homebrew/bin/brew ]; then
    run /opt/homebrew/bin/brew install uv
  elif command -v brew >/dev/null 2>&1; then
    run brew install uv
  elif [ -x /usr/bin/curl ]; then
    # Official uv installer; installs into ~/.local/bin.
    run env UV_NO_MODIFY_PATH=1 /bin/sh -c \
      '/usr/bin/curl -LsSf https://astral.sh/uv/install.sh | /bin/sh'
  else
    die "cannot install uv: neither Homebrew nor /usr/bin/curl is available"
  fi
  UV_BIN="$(resolve_uv || true)"
  if [ -z "$UV_BIN" ] && [ "$DRY_RUN" -eq 0 ]; then
    die "uv installation did not produce a usable uv binary"
  fi
  # In dry-run UV_BIN stays a placeholder name for printed commands.
  [ -n "$UV_BIN" ] || UV_BIN="uv"
fi
log "uv: $UV_BIN"

# --- checkout -----------------------------------------------------------

GIT_BIN=""
if [ -x /usr/bin/git ]; then
  GIT_BIN="/usr/bin/git"
elif command -v git >/dev/null 2>&1; then
  GIT_BIN="$(command -v git)"
else
  die "git not found (expected /usr/bin/git on the Studio)"
fi

# Never hang on a credential or host-key prompt during provisioning.
GIT_TERMINAL_PROMPT=0
GIT_SSH_COMMAND="/usr/bin/ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"
export GIT_TERMINAL_PROMPT GIT_SSH_COMMAND

if [ -e "$CHECKOUT_DIR" ]; then
  if [ ! -d "$CHECKOUT_DIR/.git" ]; then
    die "$CHECKOUT_DIR exists but is not a git checkout; refusing to touch it"
  fi
  CURRENT_BRANCH="$("$GIT_BIN" -C "$CHECKOUT_DIR" rev-parse --abbrev-ref HEAD)"
  [ "$CURRENT_BRANCH" = "$BRANCH" ] || \
    die "$CHECKOUT_DIR is on branch '$CURRENT_BRANCH', expected '$BRANCH'; refusing to switch branches"
  if [ -n "$("$GIT_BIN" -C "$CHECKOUT_DIR" status --porcelain)" ]; then
    die "$CHECKOUT_DIR has uncommitted changes; refusing to update over them"
  fi
  log "updating checkout at $CHECKOUT_DIR (fast-forward only)"
  run "$GIT_BIN" -C "$CHECKOUT_DIR" pull --ff-only origin "$BRANCH"
else
  log "cloning $GIT_URL into $CHECKOUT_DIR"
  run mkdir -p "$(dirname "$CHECKOUT_DIR")"
  if ! run "$GIT_BIN" clone --branch "$BRANCH" --single-branch "$GIT_URL" "$CHECKOUT_DIR"; then
    die "git clone failed. For the default SSH URL the Studio needs a GitHub-authorized key; add its public key to GitHub or set PEAKCAM_GIT_URL to an URL the Studio can read."
  fi
fi

if [ "$DRY_RUN" -eq 0 ] && [ ! -f "$WN_DIR/pyproject.toml" ]; then
  die "$WN_DIR/pyproject.toml is missing from origin/$BRANCH. This work (scripts/weathernext/, including this script) must be committed and pushed before the Studio can provision from its clone."
fi

# --- Python environment ---------------------------------------------------
# uv-managed CPython in the project dir; never the system interpreter.

log "installing uv-managed CPython $PYTHON_VERSION (idempotent)"
run "$UV_BIN" python install "$PYTHON_VERSION"

if [ "$DRY_RUN" -eq 1 ]; then
  printf 'dry-run: (cd %s && [ -x .venv/bin/python ] || %s venv --python %s .venv)\n' \
    "$WN_DIR" "$UV_BIN" "$PYTHON_VERSION"
  printf 'dry-run: (cd %s && %s sync --locked)\n' "$WN_DIR" "$UV_BIN"
else
  if [ ! -x "$VENV_PYTHON" ]; then
    log "creating $WN_DIR/.venv"
    (cd "$WN_DIR" && "$UV_BIN" venv --python "$PYTHON_VERSION" .venv)
  fi
  log "installing locked dependencies into $WN_DIR/.venv"
  (cd "$WN_DIR" && UV_PROJECT_ENVIRONMENT="$WN_DIR/.venv" "$UV_BIN" sync --locked)
  log "smoke check: import the harness with the project interpreter"
  "$VENV_PYTHON" -c 'import peakcam_weathernext; print("peakcam_weathernext import OK")'
  "$WN_DIR/.venv/bin/peakcam-weathernext" --help >/dev/null
fi

# --- launchd plist ----------------------------------------------------------

TEMPLATE=""
if [ -n "$TEMPLATE_OVERRIDE" ]; then
  TEMPLATE="$TEMPLATE_OVERRIDE"
elif [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/$LABEL.plist.template" ]; then
  TEMPLATE="$SCRIPT_DIR/$LABEL.plist.template"
elif [ -f "$WN_DIR/$LABEL.plist.template" ]; then
  TEMPLATE="$WN_DIR/$LABEL.plist.template"
fi
if [ "$DRY_RUN" -eq 0 ]; then
  [ -n "$TEMPLATE" ] && [ -f "$TEMPLATE" ] || \
    die "plist template not found (looked next to this script and in $WN_DIR); set PEAKCAM_PLIST_TEMPLATE"
else
  [ -n "$TEMPLATE" ] || TEMPLATE="$WN_DIR/$LABEL.plist.template"
fi
log "plist template: $TEMPLATE"

sed_escape() { printf '%s' "$1" | sed -e 's/[&|]/\\&/g'; }
render_plist() {
  # $1 = template file; rendered plist goes to stdout.
  sed \
    -e "s|__LABEL__|$(sed_escape "$LABEL")|g" \
    -e "s|__VENV_PYTHON__|$(sed_escape "$VENV_PYTHON")|g" \
    -e "s|__WN_DIR__|$(sed_escape "$WN_DIR")|g" \
    -e "s|__LOG_DIR__|$(sed_escape "$LOG_DIR")|g" \
    -e "s|__HOME__|$(sed_escape "$HOME")|g" \
    "$1"
}

run mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

if [ "$DRY_RUN" -eq 1 ]; then
  if [ -f "$TEMPLATE" ]; then
    printf 'dry-run: rendered plist that would be written to %s:\n' "$PLIST_DST"
    render_plist "$TEMPLATE"
  else
    printf 'dry-run: template %s not present yet (it arrives with the clone); skipping render\n' "$TEMPLATE"
  fi
else
  TMP_PLIST="$(mktemp "$HOME/Library/LaunchAgents/.tmp-$LABEL.XXXXXX")"
  trap 'rm -f "$TMP_PLIST"' EXIT
  render_plist "$TEMPLATE" > "$TMP_PLIST"
  grep -q '__LABEL__\|__HOME__\|__WN_DIR__\|__VENV_PYTHON__\|__LOG_DIR__' "$TMP_PLIST" && \
    die "rendered plist still contains an unsubstituted placeholder" || true
  /usr/bin/plutil -lint "$TMP_PLIST" >/dev/null || die "rendered plist failed plutil -lint"
  chmod 644 "$TMP_PLIST"
  mv -f "$TMP_PLIST" "$PLIST_DST"
  trap - EXIT
  log "wrote $PLIST_DST"
fi

DOMAIN="gui/$(id -u)"
if [ "$LOAD_JOB" -eq 1 ]; then
  log "loading $LABEL into $DOMAIN"
  run /bin/launchctl bootout "$DOMAIN/$LABEL" || true
  run /bin/launchctl bootstrap "$DOMAIN" "$PLIST_DST"
  log "loaded. Note: sync-latest fails closed until the allowlisted sync subcommand lands."
else
  log "job NOT loaded (by design). Load it later with:"
  printf '  /bin/launchctl bootstrap %s %s\n' "$DOMAIN" "$PLIST_DST"
  printf '  # or re-run this script with --load\n'
fi

log "done. Checkout: $CHECKOUT_DIR | venv: $WN_DIR/.venv | logs: $LOG_DIR"