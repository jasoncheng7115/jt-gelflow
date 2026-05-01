#!/usr/bin/env bash
# JT-GELFLOW one-line installer (Linux only)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/jasoncheng7115/jt-gelflow/main/install.sh | sudo bash
#
# Environment overrides (for development / mirrors):
#   JT_GELFLOW_REPO_URL   git clone source (default: https://github.com/jasoncheng7115/jt-gelflow.git)
#   JT_GELFLOW_BRANCH     branch / tag to check out (default: main)
#   JT_GELFLOW_DIR        install directory (default: /opt/jt-gelflow)
#   JT_GELFLOW_NO_SERVICE 1 → skip systemd setup
#   JT_GELFLOW_YES        1 → answer yes to interactive prompts (CI / unattended)

set -euo pipefail

REPO_URL="${JT_GELFLOW_REPO_URL:-https://github.com/jasoncheng7115/jt-gelflow.git}"
BRANCH="${JT_GELFLOW_BRANCH:-main}"
INSTALL_DIR="${JT_GELFLOW_DIR:-/opt/jt-gelflow}"
SERVICE_NAME="jt-gelflow"
UNIT_DST="/etc/systemd/system/${SERVICE_NAME}.service"
CLI_DST="/usr/local/bin/jt-gelflow"
NO_SERVICE="${JT_GELFLOW_NO_SERVICE:-0}"
ASSUME_YES="${JT_GELFLOW_YES:-0}"

# ---- pretty output -----------------------------------------------------------
RED=$'\033[31m'; GREEN=$'\033[32m'; CYAN=$'\033[36m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
info()  { printf '%s›%s %s\n' "$CYAN" "$RESET" "$*"; }
warn()  { printf '%swarn:%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
err()   { printf '%serror:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }
ok()    { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$*"; }

# Read interactive prompts from /dev/tty so `curl | bash` still works.
ask_yes_no() {
  local prompt="$1" default="${2:-y}" reply
  if [ "$ASSUME_YES" = "1" ]; then echo "$default"; return; fi
  if [ ! -e /dev/tty ]; then echo "$default"; return; fi
  printf '%s [%s/n] ' "$prompt" "$([ "$default" = "y" ] && echo Y || echo y)" > /dev/tty
  IFS= read -r reply < /dev/tty || reply=""
  reply="${reply:-$default}"
  case "$reply" in y|Y|yes|YES) echo "y" ;; *) echo "n" ;; esac
}

# ---- preconditions -----------------------------------------------------------
require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    err "Installer must run as root. Try: curl -fsSL ... | sudo bash"
  fi
}

require_linux() {
  case "$(uname -s)" in
    Linux) ;;
    *) err "JT-GELFLOW only supports Linux. Detected: $(uname -s)" ;;
  esac
}

network_preflight() {
  info "checking network reachability"
  local hosts=("github.com" "registry.npmjs.org" "pypi.org")
  for h in "${hosts[@]}"; do
    if ! curl -fsS -m 5 -o /dev/null --head "https://$h"; then
      err "cannot reach https://$h — check network / DNS / proxy"
    fi
  done
  ok "network reachable"
}

# ---- distro / package manager ------------------------------------------------
PKG_MGR=""
detect_pkg_mgr() {
  if command -v apt-get >/dev/null 2>&1; then PKG_MGR="apt"
  elif command -v dnf >/dev/null 2>&1; then PKG_MGR="dnf"
  elif command -v yum >/dev/null 2>&1; then PKG_MGR="yum"
  elif command -v pacman >/dev/null 2>&1; then PKG_MGR="pacman"
  elif command -v zypper >/dev/null 2>&1; then PKG_MGR="zypper"
  else err "no supported package manager found (apt/dnf/yum/pacman/zypper)"
  fi
  info "package manager: $PKG_MGR"
}

pkg_install() {
  case "$PKG_MGR" in
    apt)    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@" ;;
    dnf)    dnf install -y "$@" ;;
    yum)    yum install -y "$@" ;;
    pacman) pacman -S --needed --noconfirm "$@" ;;
    zypper) zypper install -y "$@" ;;
  esac
}

pkg_refresh() {
  case "$PKG_MGR" in
    apt)    apt-get update -qq ;;
    dnf|yum|zypper|pacman) : ;;  # refresh-on-install
  esac
}

# Translate logical package name → distro-specific.
pkg_for() {
  local logical="$1"
  case "$logical:$PKG_MGR" in
    git:*)              echo "git" ;;
    curl:*)             echo "curl" ;;
    python:apt)         echo "python3 python3-pip python3-venv" ;;
    python:dnf)         echo "python3 python3-pip" ;;
    python:yum)         echo "python3 python3-pip" ;;
    python:pacman)      echo "python python-pip" ;;
    python:zypper)      echo "python3 python3-pip" ;;
    node:apt)           echo "nodejs npm" ;;
    node:dnf)           echo "nodejs npm" ;;
    node:yum)           echo "nodejs npm" ;;
    node:pacman)        echo "nodejs npm" ;;
    node:zypper)        echo "nodejs npm" ;;
    *)                  echo "$logical" ;;
  esac
}

# ---- dependency installation -------------------------------------------------
ensure_command() {
  local logical="$1" check_cmd="$2"
  if command -v "$check_cmd" >/dev/null 2>&1; then return; fi
  info "installing $logical (missing $check_cmd)"
  # shellcheck disable=SC2086
  pkg_install $(pkg_for "$logical")
}

check_python_version() {
  local v
  v="$(python3 -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")' 2>/dev/null || echo "0.0")"
  local major="${v%%.*}" minor="${v#*.}"
  if [ "$major" -lt 3 ] || { [ "$major" -eq 3 ] && [ "$minor" -lt 10 ]; }; then
    err "Python 3.10+ required, found $v. Upgrade Python and rerun."
  fi
  info "python $v"
}

# Ubuntu/Debian ship python3 without the pip module — `python3-pip` is a
# separate package. ensure_command 'python' only fires when python3 itself is
# missing, so on a vanilla Ubuntu install we skip pip entirely. Check for the
# pip module directly and install the per-distro package if absent.
ensure_python_pip() {
  if python3 -m pip --version >/dev/null 2>&1; then return; fi
  info "installing pip (python3 -m pip not available)"
  case "$PKG_MGR" in
    apt)              pkg_install python3-pip ;;
    dnf|yum|zypper)   pkg_install python3-pip ;;
    pacman)           pkg_install python-pip ;;
  esac
}

check_node_version() {
  if ! command -v node >/dev/null 2>&1; then
    warn "node not installed; npm build will be skipped (committed dist/ will be used)"
    return 1
  fi
  local v
  v="$(node --version 2>/dev/null | sed 's/^v//')"
  local major="${v%%.*}"
  if [ "${major:-0}" -lt 18 ]; then
    warn "Node 18+ recommended, found $v — falling back to committed dist/"
    return 1
  fi
  info "node $v"
  return 0
}

install_deps() {
  pkg_refresh
  ensure_command curl curl
  ensure_command git git
  ensure_command python python3
  check_python_version
  ensure_python_pip
  ensure_command node node || true  # node is optional (we ship pre-built dist/)
}

# ---- repo clone / update -----------------------------------------------------
# Files that are user-state and must survive a reinstall (never tracked in git).
# Order matters: first match wins for the rescue list below.
USER_STATE_FILES=(config.json)

# Rescue user-state files into a tmp dir before destructive operations, returns
# the tmp dir path on stdout (or empty string if nothing to rescue).
_rescue_user_state() {
  local rescue_dir
  local found=0
  rescue_dir="$(mktemp -d)"
  for f in "${USER_STATE_FILES[@]}"; do
    if [ -f "$INSTALL_DIR/$f" ]; then
      cp -a "$INSTALL_DIR/$f" "$rescue_dir/$f"
      found=1
    fi
  done
  if [ "$found" -eq 1 ]; then
    echo "$rescue_dir"
  else
    rm -rf "$rescue_dir"
    echo ""
  fi
}

# Restore rescued user-state files into the (re-)cloned install dir.
_restore_user_state() {
  local rescue_dir="$1"
  [ -n "$rescue_dir" ] && [ -d "$rescue_dir" ] || return 0
  for f in "${USER_STATE_FILES[@]}"; do
    if [ -f "$rescue_dir/$f" ]; then
      cp -a "$rescue_dir/$f" "$INSTALL_DIR/$f"
      info "preserved user $f from previous install"
    fi
  done
  rm -rf "$rescue_dir"
}

clone_or_update_repo() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "existing checkout in $INSTALL_DIR — fetching"
    git -C "$INSTALL_DIR" fetch --quiet origin "$BRANCH"
    git -C "$INSTALL_DIR" checkout --quiet "$BRANCH"

    # Idempotent migration: if a previous version tracked config.json before
    # we moved to the gitignored model, untrack it from the index so future
    # git operations leave it alone. Safe to run repeatedly.
    for f in "${USER_STATE_FILES[@]}"; do
      if git -C "$INSTALL_DIR" ls-files --error-unmatch "$f" >/dev/null 2>&1; then
        info "untracking $f from git index (one-time migration)"
        git -C "$INSTALL_DIR" rm --cached --quiet "$f" >/dev/null 2>&1 || true
      fi
    done

    # Try fast-forward first — the clean upgrade path.
    if git -C "$INSTALL_DIR" pull --ff-only --quiet 2>/dev/null; then
      return
    fi
    # Couldn't fast-forward. Common cause: schema migration leaves the local
    # tree incompatible with upstream history. Rescue user state, forcibly
    # align with upstream, restore.
    warn "fast-forward refused — performing reset + restore (user state preserved)"
    local rescued
    rescued="$(_rescue_user_state)"
    git -C "$INSTALL_DIR" reset --hard --quiet "origin/$BRANCH"
    git -C "$INSTALL_DIR" clean -fdq -e config.json
    _restore_user_state "$rescued"
    return
  fi

  # Edge case: install dir exists, is non-empty, but is not a git checkout.
  # Common cause: previous `uninstall` (no --purge) left config.json behind.
  # Rescue user-state files, wipe the dir, fresh-clone, restore.
  if [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    local rescued
    rescued="$(_rescue_user_state)"
    # If anything *other* than user-state files exists, refuse — that means
    # there's unknown data we shouldn't blow away.
    local stragglers
    stragglers="$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 \
      $(printf '! -name %q ' "${USER_STATE_FILES[@]}") \
      2>/dev/null)"
    if [ -n "$stragglers" ]; then
      [ -n "$rescued" ] && rm -rf "$rescued"
      err "$INSTALL_DIR contains unexpected files. Move it aside and rerun:\n$stragglers"
    fi
    info "preparing to reinstall on top of partial $INSTALL_DIR"
    rm -rf "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
    info "cloning $REPO_URL → $INSTALL_DIR"
    git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
    _restore_user_state "$rescued"
    return
  fi

  info "cloning $REPO_URL → $INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
}

# ---- python deps -------------------------------------------------------------
install_python_deps() {
  info "pip install -r requirements.txt"
  if python3 -m pip install --break-system-packages --quiet -r "$INSTALL_DIR/requirements.txt" 2>/dev/null; then
    return
  fi
  python3 -m pip install --quiet -r "$INSTALL_DIR/requirements.txt"
}

# ---- frontend build ----------------------------------------------------------
build_frontend() {
  if ! check_node_version; then
    info "skipping frontend build (using committed dist/)"
    [ -d "$INSTALL_DIR/dist/client" ] || err "no committed dist/client found and node unavailable — install Node 18+ and rerun"
    return
  fi
  info "npm install (this may take a minute)"
  (cd "$INSTALL_DIR" && npm install --no-audit --no-fund --silent)
  info "npm run build"
  (cd "$INSTALL_DIR" && npm run build --silent)
  ok "frontend built"
}

# ---- config seed -------------------------------------------------------------
# config.json is gitignored; the repo ships config.example.json. On first install
# we copy example → config.json so the user has an editable starting point.
# On reinstall / upgrade, the existing config.json is left untouched.
seed_config() {
  local cfg="$INSTALL_DIR/config.json"
  local example="$INSTALL_DIR/config.example.json"
  if [ -f "$cfg" ]; then
    info "config.json exists — preserving (will not overwrite)"
    return
  fi
  if [ -f "$example" ]; then
    cp "$example" "$cfg"
    info "seeded config.json from config.example.json"
  else
    warn "no config.example.json shipped — server will use built-in defaults until first save"
  fi
}

# ---- CLI install -------------------------------------------------------------
# Use a symlink, not a copy. Without this, /usr/local/bin/jt-gelflow froze at
# whatever version install.sh shipped on first run — bug fixes to the CLI
# script wouldn't take effect via `jt-gelflow update` because the running
# binary was the old copy. Symlink → CLI always tracks the repo file.
install_cli() {
  chmod 0755 "$INSTALL_DIR/bin/jt-gelflow"
  if [ -L "$CLI_DST" ] && [ "$(readlink -f "$CLI_DST")" = "$INSTALL_DIR/bin/jt-gelflow" ]; then
    return  # already correct
  fi
  rm -f "$CLI_DST"  # clear stale regular file or wrong-target symlink
  ln -s "$INSTALL_DIR/bin/jt-gelflow" "$CLI_DST"
  ok "CLI symlinked → $CLI_DST → $INSTALL_DIR/bin/jt-gelflow"
}

# ---- systemd unit ------------------------------------------------------------
install_service() {
  if [ "$NO_SERVICE" = "1" ]; then
    info "JT_GELFLOW_NO_SERVICE=1 — skipping systemd setup"
    return
  fi
  if ! command -v systemctl >/dev/null 2>&1; then
    warn "systemctl not present — skipping service install. Run manually: python3 $INSTALL_DIR/run.py"
    return
  fi

  local enable
  enable="$(ask_yes_no "Install + enable jt-gelflow.service via systemd?" "y")"
  if [ "$enable" != "y" ]; then
    info "skipping systemd setup (you can run it manually with: python3 $INSTALL_DIR/run.py)"
    return
  fi

  install -m 0644 "$INSTALL_DIR/packaging/jt-gelflow.service" "$UNIT_DST"
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
  # Use restart, not start/enable-now — if the service is already running on a
  # previous version, only restart will pick up the new code.
  systemctl restart "$SERVICE_NAME"
  ok "service enabled and (re)started"
}

# ---- post-install checks -----------------------------------------------------
print_summary() {
  local port
  port="$(python3 -c "import json; print(json.load(open('$INSTALL_DIR/config.json'))['http_port'])" 2>/dev/null || echo 8099)"
  echo
  ok "installation complete"
  echo
  local host_ip
  host_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if [ -n "$host_ip" ]; then
    echo "  Web UI:    http://${host_ip}:${port}"
  else
    echo "  Web UI:    http://<server-ip>:${port}  (run 'hostname -I' to find the IP)"
  fi
  echo "  GELF UDP:  $(python3 -c "import json; print(json.load(open('$INSTALL_DIR/config.json'))['gelf_udp_port'])" 2>/dev/null || echo 12201)"
  echo "  GELF TCP:  $(python3 -c "import json; print(json.load(open('$INSTALL_DIR/config.json'))['gelf_tcp_port'])" 2>/dev/null || echo 12202)"
  echo
  echo "Manage:"
  echo "  sudo jt-gelflow status"
  echo "  sudo jt-gelflow logs"
  echo "  sudo jt-gelflow restart"
  echo "  sudo jt-gelflow update"
  echo
}

# ---- main --------------------------------------------------------------------
main() {
  echo "JT-GELFLOW installer"
  require_root
  require_linux
  detect_pkg_mgr
  network_preflight
  install_deps
  clone_or_update_repo
  install_python_deps
  build_frontend
  seed_config
  install_cli
  install_service
  print_summary
}

main "$@"
