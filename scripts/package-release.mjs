// Assemble a deployable release directory from an EXISTING `next build` output (output: "standalone").
// Plain Node ESM, no dependencies:
//
//   pnpm build                          # must have run first
//   node scripts/package-release.mjs release
//
// Produces <outDir>/ with:
//   server.js, package.json, node_modules/, drizzle/meta/   (from .next/standalone, minus any .env*)
//   .next/…                                                 (from .next/standalone/.next)
//   .next/static/                                           (from .next/static — NOT part of standalone)
//   public/                                                 (from public/)
//   RELEASE.txt                                             (git sha, UTC timestamp, node version)
//
// The result is uploaded verbatim to <app root>/releases/<name>/ on cPanel and started by deploy/cpanel/app.js.
// It contains no secrets: every runtime value comes from the cPanel environment variables.

import { execFileSync } from "node:child_process";
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STANDALONE = path.join(REPO_ROOT, ".next", "standalone");
const STATIC = path.join(REPO_ROOT, ".next", "static");
const PUBLIC = path.join(REPO_ROOT, "public");

function die(message) {
  console.error(`[package-release] ERROR: ${message}`);
  process.exit(1);
}

const arg = process.argv[2];
if (!arg) die("usage: node scripts/package-release.mjs <outDir>   (e.g. `node scripts/package-release.mjs release`)");

const outDir = path.resolve(REPO_ROOT, arg);
if (outDir === REPO_ROOT || REPO_ROOT.startsWith(outDir + path.sep)) {
  die(`refusing to write the release into ${outDir} — pick a dedicated sub-directory such as "release".`);
}

if (!existsSync(STANDALONE)) {
  die(`${STANDALONE} is missing. Run \`pnpm build\` first (next.config.ts must keep output: "standalone").`);
}
if (!existsSync(STATIC)) die(`${STATIC} is missing — the build looks incomplete. Re-run \`pnpm build\`.`);
if (!existsSync(PUBLIC)) die(`${PUBLIC} is missing.`);

/** Never ship a local .env into a release: the server gets its environment from the cPanel UI. */
const skipEnvFiles = (src) => !path.basename(src).startsWith(".env");

function gitSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Total bytes and file count of a tree (for the log line — shared hosting disk is the scarce resource). */
async function measure(dir) {
  let bytes = 0;
  let files = 0;
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    files += 1;
    bytes += (await stat(path.join(entry.parentPath ?? entry.path, entry.name))).size;
  }
  return { bytes, files };
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// 1) the standalone server, its traced node_modules, package.json and drizzle/meta (read by /api/health)
await cp(STANDALONE, outDir, { recursive: true, filter: skipEnvFiles });
// 2) the client assets Next deliberately leaves out of standalone
await cp(STATIC, path.join(outDir, ".next", "static"), { recursive: true });
// 3) static files served from the web root (icons, sw.js, sw-routing.js)
await cp(PUBLIC, path.join(outDir, "public"), { recursive: true });

const sha = gitSha();
await writeFile(
  path.join(outDir, "RELEASE.txt"),
  [
    `sha=${sha}`,
    `built_at=${new Date().toISOString()}`,
    `node=${process.version}`,
    `base_path=${process.env.BASE_PATH ?? ""}`,
    "",
  ].join("\n"),
  "utf8",
);

if (!existsSync(path.join(outDir, "server.js"))) die("server.js is missing from the packaged release — the build output is not standalone.");

const { bytes, files } = await measure(outDir);
console.log(`[package-release] ${path.relative(REPO_ROOT, outDir) || outDir}: ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB (sha ${sha.slice(0, 7)})`);
