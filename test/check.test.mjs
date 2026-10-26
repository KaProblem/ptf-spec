import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECK = new URL("../tools/ptf-check.mjs", import.meta.url).pathname;
const EXAMPLE = new URL("../examples/minimal-library", import.meta.url).pathname;
const run = (...args) => spawnSync(process.execPath, [CHECK, ...args], { encoding: "utf8" });

function copyExample() {
  const dir = join(mkdtempSync(join(tmpdir(), "ptf-")), "lib");
  cpSync(EXAMPLE, dir, { recursive: true });
  return dir;
}

test("minimal example library is valid", () => {
  const r = run(EXAMPLE);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /0 error\(s\), 0 warning\(s\)/);
});

test("hash is stable and matches sim.json", () => {
  const sim = join(EXAMPLE, "sims/counter/1.0.0");
  const manifest = JSON.parse(readFileSync(join(sim, "sim.json"), "utf8"));
  assert.equal(run("hash", sim).stdout.trim(), manifest.integrity);
});

test("detects forbidden APIs and integrity drift in simulators", () => {
  const lib = copyExample();
  const html = join(lib, "sims/counter/1.0.0/index.html");
  writeFileSync(html, readFileSync(html, "utf8").replace("let n = 0;", "let n = 0; fetch('https://x'); localStorage.n = 1;"));
  const r = run(lib);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /forbidden in simulators: network request \(fetch\)/);
  assert.match(r.stdout, /forbidden in simulators: storage \(localStorage\)/);
  assert.match(r.stdout, /integrity mismatch/);
});

test("detects broken content references", () => {
  const lib = copyExample();
  const el = join(lib, "bundles/demo/elements/counting.md");
  let text = readFileSync(el, "utf8");
  text = text.replace("ptf:sim/counter@^1.0.0", "ptf:sim/counter@^2.0.0")
             .replace('"misconception": "counting-skips"', '"misconception": "nope"')
             .replace("# Misconceptions", "# Mistakes");
  writeFileSync(el, text);
  const r = run(lib);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no version of ptf:sim\/counter satisfies \^2\.0\.0/);
  assert.match(r.stdout, /missing required heading "# Misconceptions"/);
  assert.match(r.stdout, /misconception "nope" is not defined/);
});

test("rejects invalid question blocks", () => {
  const lib = copyExample();
  const el = join(lib, "bundles/demo/elements/counting.md");
  writeFileSync(el, readFileSync(el, "utf8").replace('"answer": "4",', ""));
  const r = run(lib);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /#q1/);
});

test("allows source references only in Further reading and Sources", () => {
  const lib = copyExample();
  const el = join(lib, "bundles/demo/elements/counting.md");
  const src = readFileSync(el, "utf8");
  writeFileSync(el, src + "- [A video](https://example.org/v): counting songs (video, at 1:30).\n");
  assert.match(run(lib).stdout, /0 error\(s\), 0 warning\(s\)/);
  writeFileSync(el, src.replace("# Level: child\n", "# Level: child\n\nAs shown in the video at 1:30, count apples.\n"));
  assert.match(run(lib).stdout, /refer to source material/);
});

test("accepts allowlisted vendored builds and rejects tampered or undeclared ones", () => {
  const lib = copyExample();
  const sim = join(lib, "sims/counter/1.0.0");
  const vendor = spawnSync(process.execPath, [new URL("../tools/ptf-vendor.mjs", import.meta.url).pathname, "add", sim, "planck@1.4.2"], { encoding: "utf8" });
  assert.equal(vendor.status, 0, vendor.stderr);
  run("hash", "--write", sim);
  run("lock", join(lib, "bundles/demo"), lib);
  const ok = run(lib);
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /0 error\(s\), 0 warning\(s\)/);

  const file = join(sim, "vendor/planck-1.4.2.min.js");
  writeFileSync(file, readFileSync(file, "utf8") + "\nfetch('https://x');");
  writeFileSync(join(sim, "vendor/extra.js"), "window.x = 1;");
  run("hash", "--write", sim);
  const bad = run(lib);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /does not match its declared sha256/);
  assert.match(bad.stdout, /forbidden in simulators: network request \(fetch\)/);
  assert.match(bad.stdout, /script in vendor\/ that is not a declared, allowlisted build/);
});
