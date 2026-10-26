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
