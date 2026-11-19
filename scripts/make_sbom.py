#!/usr/bin/env python3
"""CycloneDX 1.5 SBOM of what a JT-GELFLOW release ships -> sbom.cdx.json

Run from the repo root, with a Python that has requirements.txt installed and
with node_modules present (Node 18+):

    python3 scripts/make_sbom.py            # write sbom.cdx.json
    python3 scripts/make_sbom.py --check    # exit 1 if the committed file is stale

Three groups of components:
  * npm packages whose code is in dist/client — taken from the actual build
    (scripts/sbom_bundle.mjs), with version, licence and SHA-512 from
    package-lock.json;
  * aiohttp and its transitive dependencies — pip resolves these at install
    time from requirements.txt, so the versions recorded are the ones this
    release was built and tested with, and the requirement range is kept too;
  * the world-atlas boundary data the 2D Map / 3D Globe fetch from unpkg.com
    at runtime.

The output is deterministic for a given tree: the timestamp is the release
date from CHANGELOG.md and the serial number is derived from the content, so
regenerating without changes produces an identical file.
"""
import base64
import hashlib
import json
import re
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "sbom.cdx.json"
REPO = "https://github.com/jasoncheng7115/jt-gelflow"
SITE = "https://jasoncheng7115.github.io/jt-gelflow/"
WORLD_ATLAS = {"name": "world-atlas", "range": "2", "url": "https://unpkg.com/world-atlas@2/countries-110m.json"}


def die(msg):
    sys.exit(f"make_sbom: {msg}")


def npm_purl(name, version):
    return f"pkg:npm/{name.replace('@', '%40')}@{version}"


def release_date(version):
    m = re.search(rf"^## \[{re.escape(version)}\] — (\d{{4}}-\d{{2}}-\d{{2}})", (ROOT / "CHANGELOG.md").read_text(), re.M)
    if not m:
        die(f"CHANGELOG.md has no '## [{version}] — YYYY-MM-DD' heading; add the release entry first")
    return f"{m.group(1)}T00:00:00Z"


# ── npm: what the bundle really contains ─────────────────────────────────────
def bundled_npm(lock):
    # Node resolves packages from the nearest node_modules up the tree, so a
    # checkout nested inside a dev workspace can borrow the parent's.
    if not any((d / "node_modules" / "vite").exists() for d in (ROOT, *ROOT.parents)):
        die("node_modules not found — run `npm install --ignore-scripts` first")
    try:
        out = subprocess.run(["node", "scripts/sbom_bundle.mjs"], cwd=ROOT, check=True,
                             capture_output=True, text=True).stdout
    except FileNotFoundError:
        die("node not found — Node 18+ is needed to inspect the bundle")
    except subprocess.CalledProcessError as e:
        die(f"bundle inspection failed:\n{e.stderr}")
    used = json.loads(out)
    pkgs = lock["packages"]

    def resolve(from_key, dep):
        # Node resolution against lockfile keys: nearest nested node_modules first.
        parts = from_key.split("/node_modules/") if from_key else []
        for i in range(len(parts), -1, -1):
            base = "/node_modules/".join(parts[:i])
            key = f"{base}/node_modules/{dep}" if base else f"node_modules/{dep}"
            if key in pkgs:
                return key
        return None

    comps, deps = [], {}
    for key in used:
        entry = pkgs.get(key)
        if not entry:
            die(f"{key} is in the bundle but not in package-lock.json")
        name = key.rsplit("node_modules/", 1)[1]
        purl = npm_purl(name, entry["version"])
        c = {"type": "library", "name": name, "version": entry["version"], "purl": purl, "bom-ref": purl,
             "licenses": [{"license": {"id": entry.get("license", "NOASSERTION")}}],
             "properties": [{"name": "jt-gelflow:location", "value": "dist/client (frontend bundle)"}]}
        algo, _, b64 = entry.get("integrity", "").partition("-")
        if algo == "sha512":
            c["hashes"] = [{"alg": "SHA-512", "content": base64.b64decode(b64).hex()}]
        comps.append(c)
        deps[purl] = sorted({npm_purl(r.rsplit("node_modules/", 1)[1], pkgs[r]["version"])
                             for d in entry.get("dependencies", {})
                             if (r := resolve(key, d)) in used})
    return comps, deps


# ── Python: aiohttp and everything it pulls in ────────────────────────────────
_PY_PROBE = r"""
import json, sys
from importlib import metadata
try:
    from packaging.requirements import Requirement
except ImportError:
    from pip._vendor.packaging.requirements import Requirement
def norm(n): return n.lower().replace("_", "-").replace(".", "-")
seen, todo, out = set(), [Requirement(r) for r in sys.argv[1:]], []
while todo:
    req = todo.pop()
    if req.marker and not req.marker.evaluate({"extra": ""}): continue
    n = norm(req.name)
    if n in seen: continue
    seen.add(n)
    dist = metadata.distribution(req.name)
    md = dist.metadata
    lic = md.get("License-Expression") or ""
    if not lic:
        cls = [c.split(" :: ")[-1] for c in md.get_all("Classifier") or [] if c.startswith("License :: OSI Approved")]
        lic = cls[0] if cls else (md.get("License") or "")
    kids = [Requirement(r) for r in dist.requires or []]
    kids = [k for k in kids if not k.marker or k.marker.evaluate({"extra": ""})]
    todo += kids
    out.append({"name": md["Name"], "version": dist.version, "license": lic.strip(),
                "requires": sorted({norm(k.name) for k in kids}), "spec": str(req)})
print(json.dumps(out))
"""

_SPDX = {"Apache Software License": "Apache-2.0", "Apache License 2.0": "Apache-2.0", "Apache 2.0": "Apache-2.0",
         "Apache License, Version 2.0": "Apache-2.0", "MIT License": "MIT", "BSD License": "BSD-3-Clause",
         "Python Software Foundation License": "PSF-2.0"}


def py_license(raw):
    """CycloneDX wants an SPDX id, an SPDX expression, or failing both a free-text name."""
    lic = _SPDX.get(raw, raw) or "NOASSERTION"
    if re.search(r" (AND|OR|WITH) ", lic):
        return [{"expression": lic}]
    return [{"license": {"id" if re.fullmatch(r"[A-Za-z0-9.+-]+", lic) else "name": lic}}]


def python_deps():
    reqs = [l.strip() for l in (ROOT / "requirements.txt").read_text().splitlines()
            if l.strip() and not l.startswith("#")]
    try:
        found = json.loads(subprocess.run([sys.executable, "-c", _PY_PROBE, *reqs], check=True,
                                          capture_output=True, text=True).stdout)
    except subprocess.CalledProcessError as e:
        die(f"cannot read installed Python packages ({sys.executable}) — install requirements.txt "
            f"into this interpreter first:\n{e.stderr.strip().splitlines()[-1]}")
    by_norm = {f["name"].lower().replace("_", "-").replace(".", "-"): f for f in found}
    top = {r.split(">")[0].split("=")[0].split("<")[0].strip().lower() for r in reqs}
    comps, deps = [], {}
    for f in sorted(found, key=lambda f: f["name"].lower()):
        purl = f"pkg:pypi/{f['name'].lower().replace('_', '-')}@{f['version']}"
        props = [{"name": "jt-gelflow:location", "value": "server runtime (installed by pip at install time)"},
                 {"name": "jt-gelflow:version-note",
                  "value": "resolved by pip on the target host; this is the version the release was built and tested with"}]
        if f["name"].lower() in top:
            props.append({"name": "jt-gelflow:requirement", "value": f["spec"]})
        comps.append({"type": "library", "name": f["name"], "version": f["version"], "purl": purl, "bom-ref": purl,
                      "licenses": py_license(f["license"]), "properties": props})
        deps[purl] = sorted(f"pkg:pypi/{by_norm[r]['name'].lower().replace('_', '-')}@{by_norm[r]['version']}"
                            for r in f["requires"] if r in by_norm)
    roots = [c["bom-ref"] for c in comps if c["name"].lower() in top]
    return comps, deps, roots


def build(version):
    lock = json.loads((ROOT / "package-lock.json").read_text())
    npm, npm_deps = bundled_npm(lock)
    py, py_deps, py_roots = python_deps()
    atlas_ref = f"data:world-atlas@{WORLD_ATLAS['range']}"
    atlas = {"type": "data", "name": WORLD_ATLAS["name"], "version": WORLD_ATLAS["range"], "bom-ref": atlas_ref,
             "licenses": [{"license": {"id": "ISC"}}],
             "description": "Country boundaries (Natural Earth, public domain) fetched by the browser at runtime "
                            "for the 2D Map and 3D Globe views; not bundled",
             "externalReferences": [{"type": "distribution", "url": WORLD_ATLAS["url"]}],
             "properties": [{"name": "jt-gelflow:location", "value": "fetched at runtime from unpkg.com"}]}
    # The project depends on every bundled package nothing else in the bundle
    # pulls in. (package.json's list is not it: `d3` only re-exports, so it
    # contributes no code and is absent, while its d3-* modules are present.)
    pulled_in = {r for d in npm_deps.values() for r in d}
    root_ref = f"pkg:github/jasoncheng7115/jt-gelflow@v{version}"
    components = sorted(npm, key=lambda c: c["bom-ref"]) + py + [atlas]
    dependencies = ([{"ref": root_ref, "dependsOn": sorted([c["bom-ref"] for c in npm if c["bom-ref"] not in pulled_in]
                                                           + py_roots + [atlas_ref])}]
                    + [{"ref": r, "dependsOn": d} for r, d in sorted({**npm_deps, **py_deps}.items())])
    node_v = subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip()
    bom = {
        "bomFormat": "CycloneDX", "specVersion": "1.5", "serialNumber": "", "version": 1,
        "metadata": {
            "timestamp": release_date(version),
            "tools": {"components": [{"type": "application", "name": "jt-gelflow scripts/make_sbom.py"}]},
            "component": {"type": "application", "name": "jt-gelflow", "version": version, "bom-ref": root_ref,
                          "purl": root_ref, "licenses": [{"license": {"id": "Apache-2.0"}}],
                          "supplier": {"name": "Jason Cheng (Jason Tools)"},
                          "externalReferences": [{"type": "vcs", "url": REPO}, {"type": "website", "url": SITE}]},
            "properties": [
                {"name": "jt-gelflow:built-with-python", "value": "%d.%d" % sys.version_info[:2]},
                {"name": "jt-gelflow:built-with-node", "value": node_v},
                {"name": "jt-gelflow:python-requires", "value": "3.10+"}]},
        "components": components,
        "dependencies": dependencies,
    }
    body = json.dumps({k: v for k, v in bom.items() if k != "serialNumber"}, sort_keys=True)
    bom["serialNumber"] = f"urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, REPO + '#' + hashlib.sha256(body.encode()).hexdigest())}"
    return json.dumps(bom, indent=1, ensure_ascii=False) + "\n"


def main():
    check = "--check" in sys.argv[1:]
    version = json.loads((ROOT / "package.json").read_text())["version"]
    text = build(version)
    if check:
        current = OUT.read_text() if OUT.exists() else ""
        if current != text:
            die(f"sbom.cdx.json is stale for v{version} — run: python3 scripts/make_sbom.py")
        print(f"sbom.cdx.json is current for v{version}")
        return
    OUT.write_text(text)
    n = json.loads(text)["components"]
    print(f"wrote sbom.cdx.json for v{version}: {len(n)} components "
          f"({sum(c['purl'].startswith('pkg:npm') for c in n if 'purl' in c)} npm, "
          f"{sum(c['purl'].startswith('pkg:pypi') for c in n if 'purl' in c)} pypi, "
          f"{sum(c['type'] == 'data' for c in n)} data)")


if __name__ == "__main__":
    main()
