# JT-GELFLOW — Upgrade SOP (English)

> **Language / 語言切換：** [English](UPGRADE.md) | [繁體中文](UPGRADE_zh-TW.md)

This is the operations-grade upgrade procedure for **JT-GELFLOW v1.5.0+**. Version updates pull from the public GitHub repo.

---

## 0. Upgrade-safety guarantees

Before any upgrade procedure, know what is guaranteed safe and what is not:

| Guarantee | How it's enforced |
|-----------|-------------------|
| **`config.json` survives every upgrade** | `config.json` is `.gitignore`d. `git pull` cannot touch it. `install.sh` rescues it before any reset and restores afterwards. |
| **Unknown config keys are tolerated** | `Config.from_dict()` filters via `__dataclass_fields__`. An old key that no longer exists in the schema is silently ignored, not crashed on. |
| **Service is hot-reloaded with new code** | `install.sh` ends with `systemctl restart jt-gelflow.service` (not just `enable --now`), so the running Python is replaced. |
| **No data loss on UDP/TCP port re-bind** | Service is restarted; in-flight GELF messages during the ~1 s downtime are lost (UDP is lossy by design). For zero-loss, use `sudo jt-gelflow update` during a low-traffic window. |

What is **not** guaranteed:

- The Python venv / system pip state is shared with whatever else lives on the box. If a major Python version transition forces a `requirements.txt` bump that conflicts with another app, there could be friction. JT-GELFLOW only requires `aiohttp` + `aiohttp-cors`; conflicts are rare in practice.
- Major UI changes (e.g., feature renames in Settings) may require a one-time visit to the Settings panel after upgrade to confirm the shape.

---

## 1. Routine upgrade (recommended)

For minor and patch versions, use the bundled CLI from anywhere on the host:

```bash
sudo jt-gelflow update
```

This runs:

1. `git -C /opt/jt-gelflow pull --ff-only`
2. `pip install --quiet -r requirements.txt`
3. `npm install && npm run build` (only if Node 18+ is installed)
4. `systemctl restart jt-gelflow.service`

If `pull --ff-only` succeeds (the normal case), this is the fastest path — typically under 30 s including frontend build.

---

## 2. Resilient upgrade (use when routine fails or schema changes are involved)

If `sudo jt-gelflow update` fails — most commonly with `fatal: Not possible to fast-forward, aborting` — use the full installer instead. It has a stronger upgrade path: rescue config → fetch → reset to upstream → restore config.

```bash
curl -fsSL https://raw.githubusercontent.com/jasoncheng7115/jt-gelflow/main/install.sh | sudo bash
```

What's different:

1. Detects the existing checkout under `/opt/jt-gelflow`.
2. Tries `git pull --ff-only` first (clean upgrade path).
3. If that fails:
   - Copies `config.json` to a tmp directory.
   - One-time migration: `git rm --cached config.json` (untracks it from index — only matters when upgrading from a version that tracked it).
   - `git fetch + git reset --hard origin/main` (forcibly aligns with upstream).
   - `git clean -fd -e config.json` (removes anything stale, except the file we want preserved).
   - Copies `config.json` back from tmp.
4. Re-runs pip + npm + systemctl restart.
5. Prints the URL.

This path is safe even when upstream introduces breaking schema changes (like the v1.4 → v1.5 removal of `sankey_stages` / `sankey_columns`).

---

## 3. Pre-upgrade checklist

Before touching production:

```bash
# 1. Snapshot current config (so you can compare/restore manually if needed)
sudo cp /opt/jt-gelflow/config.json /opt/jt-gelflow/config.json.before-$(date +%Y%m%d)

# 2. Confirm service is healthy
sudo jt-gelflow status
curl -sI http://127.0.0.1:8099/ | head -1   # expect 200

# 3. Note current version
grep VERSION /opt/jt-gelflow/src/client/App.tsx | head -1

# 4. Check GitHub for the latest tag / CHANGELOG
# https://github.com/jasoncheng7115/jt-gelflow/blob/main/CHANGELOG.md
```

---

## 4. Post-upgrade verification

```bash
# Service still active
sudo jt-gelflow status

# Same ports listening
ss -tulnp | grep -E ":(8099|12201|12202) "

# Config preserved
diff /opt/jt-gelflow/config.json /opt/jt-gelflow/config.json.before-$(date +%Y%m%d)
# Expect either empty diff, or only fields you've changed yourself

# Live traffic still flowing
curl -s http://127.0.0.1:8099/api/stats
# Expect messageCount > 0 within ~10 seconds

# Web UI reachable
curl -sI http://$(hostname -I | awk '{print $1}'):8099/ | head -1
```

If the browser already had the page open: **hard-refresh** (`Ctrl+Shift+R` / `Cmd+Shift+R`) to drop the old JS bundle. The new bundle has a different hash and will load automatically.

---

## 5. Pin to a specific version

If you want to lock to a particular release (e.g., for a regulated environment that doesn't auto-track `main`):

```bash
JT_GELFLOW_BRANCH=v1.5.0 \
  curl -fsSL https://raw.githubusercontent.com/jasoncheng7115/jt-gelflow/v1.5.0/install.sh | sudo bash
```

(Replace `v1.5.0` with the tag of your choice.)

For an existing checkout you want to pin:

```bash
cd /opt/jt-gelflow
sudo git fetch --tags origin
sudo git checkout v1.5.0
sudo systemctl restart jt-gelflow.service
```

`config.json` survives this just like any other upgrade.

---

## 6. Rollback

To revert to a previous version:

```bash
cd /opt/jt-gelflow
# List available tags
sudo git tag -l 'v*' | sort -V

# Reset to the previous tag (replace v1.4.0 with whichever)
sudo git fetch --tags origin
sudo git reset --hard v1.4.0

# Reinstall deps + rebuild
sudo python3 -m pip install --quiet -r requirements.txt
sudo npm install --silent && sudo npm run build --silent  # if Node 18+
sudo systemctl restart jt-gelflow.service
```

`config.json` survives the reset because it's `.gitignore`d. If a setting from the newer version is in your `config.json` and the older version doesn't recognize it — that's fine, the old `Config.from_dict()` ignores unknown keys (as of v1.5.0+).

---

## 7. Uninstall (for completeness)

```bash
sudo jt-gelflow uninstall          # removes binaries + service unit; preserves config.json
sudo jt-gelflow uninstall --purge  # also deletes config.json
```

After `uninstall` (without `--purge`), re-running `install.sh` later will rescue the surviving `config.json` and seed the fresh checkout from it. **It is safe to remove + reinstall.**

---

## 8. Common upgrade pitfalls

| Symptom | Cause | Fix |
|---------|-------|-----|
| `fatal: Not possible to fast-forward, aborting.` | Upstream history is no longer linear from your local commit (force-push / re-init / branch reshuffle). | Use the resilient path: re-run `install.sh`. |
| Service stays on old code after `update` | Bug in pre-v1.5.0 `install.sh` — used `enable --now` (no-op when running). | Fixed in v1.5.0. For older installs, `sudo systemctl restart jt-gelflow.service` after the update. |
| `Error loading config, using defaults: unexpected keyword argument 'X'` | Pre-v1.5.0 server — strict config parsing. | v1.5.0+ tolerates unknown keys. Manually remove the offending key from `config.json` to silence the warning. |
| Browser still on old UI after upgrade | Cached JS bundle (different hash). | Hard refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`). |
| Customizations from Settings reverted to defaults | Your config didn't survive — check `journalctl -u jt-gelflow.service` for `Error loading config…`. | Restore from the `.before-DATE` snapshot you took in §3. |

---

## 9. See also

- [INSTALL.md](INSTALL.md) — first-time install SOP
- [README.md](README.md) — feature overview
- [CHANGELOG.md](CHANGELOG.md) — release history
