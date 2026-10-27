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

test("warns about elements without objectives and checks their shape", () => {
  const lib = copyExample();
  const el = join(lib, "bundles/demo/elements/counting.md");
  const src = readFileSync(el, "utf8");
  writeFileSync(el, src.replace(/objectives:\n(  - .*\n)+/, ""));
  const r = run(lib);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /no `objectives`/);
  writeFileSync(el, src.replace(/objectives:\n(  - .*\n)+/, "objectives: []\n"));
  assert.equal(run(lib).status, 1);
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

test("checks code labs: forbidden APIs, integrity, missing step files and step refs", () => {
  const lib = copyExample();
  const step = join(lib, "code/counting/1.0.0/steps/01_count.py");
  writeFileSync(step, readFileSync(step, "utf8") + "\nimport subprocess\neval('1')\nmodel.eval()\n");
  const manifest = join(lib, "code/counting/1.0.0/lab.json");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace("steps/02_count_to.py\"", "steps/missing.py\""));
  const el = join(lib, "bundles/demo/elements/counting.md");
  writeFileSync(el, readFileSync(el, "utf8").replace("step: count\n", "step: nope\n"));
  const r = run(lib);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /01_count\.py:\d+: forbidden in code labs: starting processes or network access/);
  assert.match(r.stdout, /01_count\.py:\d+: forbidden in code labs: evaluating code from strings/);
  assert.equal((r.stdout.match(/evaluating code from strings/g) ?? []).length, 1, "model.eval() must not be flagged");
  assert.match(r.stdout, /step count-to: file steps\/missing\.py missing/);
  assert.match(r.stdout, /code lab ptf:code\/counting@1\.0\.0 has no step "nope"/);
  assert.match(r.stdout, /integrity mismatch: lab\.json/);
});

test("ptf-codetest runs every step and checks expect", () => {
  const CODETEST = new URL("../tools/ptf-codetest.mjs", import.meta.url).pathname;
  const ok = spawnSync(process.execPath, [CODETEST, join(EXAMPLE, "code/counting/1.0.0")], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /ok {3}count-to/);
  const lib = copyExample();
  const manifest = join(lib, "code/counting/1.0.0/lab.json");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace('"counted to 10"', '"counted to 11"'));
  const bad = spawnSync(process.execPath, [CODETEST, join(lib, "code/counting/1.0.0")], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /FAIL count .*does not match/);
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

test("checks Wikidata subject anchors", () => {
  const lib = copyExample();
  const el = join(lib, "bundles/demo/elements/counting.md");
  const text = readFileSync(el, "utf8").replace(/^about:\n(  .*\n)+/m, "");
  writeFileSync(el, text.replace("status: draft", "about:\n  - wikidata: X12\nstatus: draft"));
  let r = run(lib);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /about\/0\/wikidata must match pattern/);
  writeFileSync(el, text.replace("status: draft", "status: reviewed"));
  r = run(lib);
  assert.match(r.stdout, /status reviewed without `about`/);
});
