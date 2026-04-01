import { readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { $ } from "bun";

const outdir = "dist";

// Goder: feature flags that should be enabled in the production build.
// Must match the ENABLED_FEATURES set in src/entrypoints/cli.tsx.
const ENABLED_FEATURES = [
    'BG_SESSIONS',
    'BUDDY',
    'COORDINATOR_MODE',
    'TRANSCRIPT_CLASSIFIER',
    'MCP_SKILLS',
    'HARD_FAIL',
];

// Step 1: Clean output directory
const { rmSync } = await import("fs");
rmSync(outdir, { recursive: true, force: true });

// Step 2: Bundle with splitting using CLI bundler.
// We use `bun build` CLI (not Bun.build() API) because the CLI supports
// --feature flags that control bun:bundle's feature() function at bundle
// time. Bun.build() API doesn't support plugins for bun:bundle, so
// feature() always returns false and tree-shakes out all gated code.
const featureFlags = ENABLED_FEATURES.map(f => `--feature=${f}`).join(" ");
const cmd = `bun build src/entrypoints/cli.tsx --outdir ${outdir} --target bun --splitting ${featureFlags}`;

const result = await $`${cmd.split(" ")}`.nothrow().quiet();

if (result.exitCode !== 0) {
    console.error("Build failed:");
    console.error(result.stderr.toString());
    process.exit(1);
}

// Step 3: Post-process output files
const files = await readdir(outdir);
const IMPORT_META_REQUIRE = "var __require = import.meta.require;";
const COMPAT_REQUIRE = `var __require = typeof import.meta.require === "function" ? import.meta.require : (await import("module")).createRequire(import.meta.url);`;

let patchedRequire = 0;
let fileCount = 0;

for (const file of files) {
    if (!file.endsWith(".js")) continue;
    fileCount++;
    const filePath = join(outdir, file);
    let content = await readFile(filePath, "utf-8");
    let modified = false;

    // Node.js compat — replace import.meta.require with createRequire fallback
    if (content.includes(IMPORT_META_REQUIRE)) {
        content = content.replace(IMPORT_META_REQUIRE, COMPAT_REQUIRE);
        patchedRequire++;
        modified = true;
    }

    if (modified) {
        await writeFile(filePath, content);
    }
}

console.log(
    `Bundled ${fileCount} files to ${outdir}/ (patched ${patchedRequire} for Node.js compat, ${ENABLED_FEATURES.length} feature flags enabled)`,
);
