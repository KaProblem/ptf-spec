#!/usr/bin/env node
// ptf-vendor: allowlisted third-party libraries for simulators (SIMULATOR-SPEC.md §8).
//
//   ptf-vendor list                          show the allowlist
//   ptf-vendor add <sim-dir> <build>@<ver>   copy an allowlisted build into a simulator package
//                                            and declare it in sim.json "vendor"
//   ptf-vendor build <build>@<ver> [--write] rebuild from its recipe (needs npm and network) and
//                                            compare with the allowlisted hash; --write replaces it
//
// Builds are classic scripts (IIFE/UMD) that define one global, so they work from a sandboxed
// srcdoc iframe where ES module imports cannot be resolved.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SPEC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_DIR = join(SPEC_DIR, "vendor");
const ALLOWLIST = join(VENDOR_DIR, "allowlist.json");

export const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
export function loadAllowlist() { return JSON.parse(readFileSync(ALLOWLIST, "utf8")); }

function entry(key) {
  const list = loadAllowlist();
  const e = list.builds[key];
  if (!e) { console.error(`${key} is not on the allowlist (${Object.keys(list.builds).join(", ")})`); process.exit(1); }
  return e;
}

function list() {
  const { builds } = loadAllowlist();
  for (const [key, e] of Object.entries(builds)) {
    console.log(`${key.padEnd(22)} ${e.license.padEnd(6)} ${(e.bytes / 1024).toFixed(0).padStart(4)} KB  global ${e.global.padEnd(7)} ${e.purpose}`);
  }
}

function add(simDir, key) {
  const e = entry(key);
  const src = join(VENDOR_DIR, e.dir, e.file);
  const manifestFile = join(simDir, "sim.json");
  if (!existsSync(manifestFile)) { console.error(`no sim.json in ${simDir}`); process.exit(1); }
  mkdirSync(join(simDir, "vendor"), { recursive: true });
  copyFileSync(src, join(simDir, "vendor", e.file));
  const m = JSON.parse(readFileSync(manifestFile, "utf8"));
  const decl = { build: key, path: `vendor/${e.file}`, sha256: e.sha256, license: e.license };
  m.vendor = [...(m.vendor ?? []).filter((v) => v.build !== key), decl];
  writeFileSync(manifestFile, JSON.stringify(m, null, 2) + "\n");
  console.log(`added ${key} as ${decl.path}`);
  console.log(`next: <script src="${decl.path}"></script> before your own script, then ptf-check hash --write ${simDir}`);
}

function build(key, write) {
  const e = entry(key);
  const recipe = JSON.parse(readFileSync(join(VENDOR_DIR, e.dir, "build.json"), "utf8"));
  const work = mkdtempSync(join(tmpdir(), "ptf-vendor-"));
  const sh = (cmd, args) => {
    const r = spawnSync(cmd, args, { cwd: work, stdio: "inherit", shell: process.platform === "win32" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  };
  writeFileSync(join(work, "package.json"), "{}");
  sh("npm", ["install", "--silent", "--no-audit", "--no-fund", `${recipe.package}@${recipe.version}`, `esbuild@${recipe.esbuild}`]);
  writeFileSync(join(work, "entry.js"), readFileSync(join(VENDOR_DIR, e.dir, recipe.entry), "utf8"));
  sh(join("node_modules", ".bin", "esbuild"), ["entry.js", "--bundle", "--minify", "--format=iife", `--global-name=${recipe.global}`,
    "--legal-comments=eof", `--target=${recipe.target}`, `--outfile=${e.file}`]);
  const out = join(work, e.file), hex = sha256(out);
  console.log(`${key}: ${hex} (${statSync(out).size} bytes)`);
  if (hex === e.sha256) { console.log("matches the allowlist"); return; }
  if (!write) { console.error(`differs from the allowlist (${e.sha256}); use --write to replace it`); process.exit(1); }
  copyFileSync(out, join(VENDOR_DIR, e.dir, e.file));
  const list = loadAllowlist();
  Object.assign(list.builds[key], { sha256: hex, bytes: statSync(out).size });
  writeFileSync(ALLOWLIST, JSON.stringify(list, null, 2) + "\n");
  console.log("allowlist updated");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "list") list();
  else if (cmd === "add" && a && b) add(resolve(a), b);
  else if (cmd === "build" && a) build(a, process.argv.includes("--write"));
  else { console.log("usage: ptf-vendor list | add <sim-dir> <build>@<version> | build <build>@<version> [--write]"); process.exit(2); }
}
