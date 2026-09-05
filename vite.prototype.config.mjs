import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { copyFileSync, mkdirSync, renameSync, existsSync } from "node:fs";

const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Builds the authoring (prototype) lane as the site's landing page.
 *
 * Served locally the prototype is a single self-contained HTML file that
 * resolves `three` through an importmap over node_modules and imports the
 * shared engine as `.mjs`. That shape is right for authoring and is left
 * untouched -- this config only produces a deployable copy.
 *
 * It bundles rather than copying because `.mjs` is not reliably served as
 * JavaScript by static hosts (nginx sends application/octet-stream, Apache
 * sends nothing at all), and a browser refuses to execute a module whose MIME
 * type is not JavaScript. GitHub Pages' behaviour here is not documented, so
 * rather than gamble the whole site on it, the build inlines every module into
 * one hashed `.js` and serves no `.mjs`. It also avoids vendoring ~39 MB of
 * three.js that a verbatim copy would need.
 *
 * `three/addons/` is an importmap prefix rather than a real package path, so it
 * is aliased to the directory the importmap points at.
 */

/** The importmap only exists for the un-built file. Once every module is
 *  bundled nothing resolves through it, and leaving it would advertise
 *  node_modules paths that are deliberately not deployed. */
function stripImportmap() {
  return {
    name: "strip-importmap",
    transformIndexHtml(html) {
      const stripped = html.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, "");
      if (stripped === html) throw new Error("importmap not found — check the prototype's <head>");
      return stripped;
    },
  };
}

/** The GLB and the registry are referenced by runtime strings
 *  (`ASSET_URL`, `REGISTRY_URL`), which the bundler cannot see, so they are
 *  copied to the exact paths the running page asks for. Doing it here rather
 *  than in the deploy workflow keeps a local build and CI identical. */
function copyRuntimeAssets(outDir) {
  const files = [
    ["assets/export/avatar_master.glb", "assets/export/avatar_master.glb"],
    ["contracts/measurement-registry.json", "contracts/measurement-registry.json"],
  ];
  return {
    name: "copy-runtime-assets",
    closeBundle() {
      for (const [from, to] of files) {
        const source = resolve(ROOT, from);
        if (!existsSync(source)) throw new Error(`missing runtime asset: ${from}`);
        const target = join(outDir, to);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(source, target);
      }
      // Rollup names an HTML output after its input path; the prototype is the
      // landing page, so it has to arrive as index.html.
      const built = join(outDir, "digital_bra_fit_model_360.html");
      if (existsSync(built)) renameSync(built, join(outDir, "index.html"));
    },
  };
}

const OUT_DIR = resolve(ROOT, "dist");

export default defineConfig({
  root: ROOT,
  base: "./",
  resolve: {
    alias: [
      { find: /^three\/addons\//, replacement: `${resolve(ROOT, "node_modules/three/examples/jsm")}/` },
    ],
  },
  plugins: [stripImportmap(), copyRuntimeAssets(OUT_DIR)],
  build: {
    outDir: OUT_DIR,
    // The production lane is built into dist/viewer first; wiping the
    // directory here would delete it.
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: { input: resolve(ROOT, "digital_bra_fit_model_360.html") },
  },
});
