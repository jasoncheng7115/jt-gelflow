// Lists the npm packages whose code actually ends up in the frontend bundle.
// Used by scripts/make_sbom.py — run from the repo root:  node scripts/sbom_bundle.mjs
//
// Runs the project's own vite config with write:false, so dist/ is never
// touched, and records every module that contributes rendered code. That is
// the honest answer to "what do we ship": package-lock's dev flags and
// dependency lists both disagree with it (CLI-only deps such as commander are
// never bundled; tree-shaken d3 submodules contribute nothing).
import { build } from 'vite';

const used = new Map(); // lockfile key -> rendered bytes

const collect = {
  name: 'jt-gelflow-sbom-collect',
  generateBundle(_opts, bundle) {
    for (const out of Object.values(bundle)) {
      if (out.type !== 'chunk') continue;
      for (const [id, info] of Object.entries(out.modules)) {
        if (!info.renderedLength) continue;
        // node_modules/a/node_modules/@scope/b/... -> "node_modules/a/node_modules/@scope/b"
        const m = id.replace(/\\/g, '/').match(/(node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*)\//);
        if (!m) continue;
        used.set(m[1], (used.get(m[1]) || 0) + info.renderedLength);
      }
    }
  },
};

await build({ logLevel: 'silent', plugins: [collect], build: { write: false } });
process.stdout.write(JSON.stringify(Object.fromEntries([...used].sort())) + '\n');
