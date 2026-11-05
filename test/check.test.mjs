import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECK = new URL("../tools/ptf-check.mjs", import.meta.url).pathname;
const EXAMPLE = new URL("../examples/minimal-library", import.meta.url).pathname;
const run = (...args) => spawnSync(process.execPath, [CHECK, ...args], { encoding: "utf8" });

// Without ptf-catalog.json unless asked: edits would otherwise also fail its digests.
function copyExample({ catalog = false } = {}) {
  const dir = join(mkdtempSync(join(tmpdir(), "ptf-")), "lib");
  cpSync(EXAMPLE, dir, { recursive: true });
  if (!catalog) rmSync(join(dir, "ptf-catalog.json"));
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
  const noObjectives = src.replace(/objectives:\n((?:  - |    ).*\n)+/, "").replace(/\s*"objectives": \[[^\]]*\],/g, "");
  writeFileSync(el, noObjectives);
  const r = run(lib);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /no `objectives`/);
  writeFileSync(el, src.replace(/objectives:\n((?:  - |    ).*\n)+/, "objectives: []\n"));
  assert.equal(run(lib).status, 1);
});

test("checks that questions name existing objectives and cover each one per level", () => {
  const lib = copyExample();
  const el = join(lib, "bundles/demo/elements/counting.md");
  const src = readFileSync(el, "utf8");
  writeFileSync(el, src.replace('"objectives": ["next-one"]', '"objectives": ["nxt"]'));
  let r = run(lib);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /objective "nxt" is not an objective id/);
  writeFileSync(el, src.replace('"objectives": ["next-one"],', ""));
  r = run(lib);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /objectives without a check question: highschool: next-one/);
  assert.match(r.stdout, /check question without `objectives`/);
  writeFileSync(el, src.replace("  - id: count\n    text: Count", "  - Count"));
  assert.match(run(lib).stdout, /objectives without `id`/);
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

test("accepts prerequisites from other libraries and checks path sharing", () => {
  const lib = copyExample();
  const el = join(lib, "bundles/demo/elements/counting.md");
  const src = readFileSync(el, "utf8");
  writeFileSync(el, src.replace("\n---\n", "\nrequires:\n  - id: ptf:el/math/numbers\n    catalog: https://example.org/ptf-catalog.json\n---\n"));
  let r = run(lib);
  assert.equal(r.status, 0, r.stdout);

  const path = join(lib, "bundles/demo/paths/count-to-ten.md");
  writeFileSync(path, readFileSync(path, "utf8").replace("mode: optional", "mode: always"));
  writeFileSync(el, src.replace("\n---\n", "\nrequires:\n  - id: ptf:el/math/numbers\n---\n"));
  r = run(lib);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /count-to-ten\.md.*sharing/s);
  assert.match(r.stdout, /counting\.md.*requires/s);
});

test("catalog lists every package with its digest and catches drift", () => {
  const lib = copyExample({ catalog: true });
  const file = join(lib, "ptf-catalog.json");
  const catalog = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(catalog.packages.map((p) => `${p.kind} ${p.id}@${p.version} ${p.path}`), [
    "bundle demo@0.3.0 bundles/demo",
    "sim ptf:sim/counter@1.0.0 sims/counter/1.0.0",
    "code ptf:code/counting@1.0.0 code/counting/1.0.0",
  ]);
  const el = join(lib, "bundles/demo/elements/counting.md");
  writeFileSync(el, readFileSync(el, "utf8") + "\nOne more line.\n");
  cpSync(join(lib, "sims/counter/1.0.0"), join(lib, "sims/counter/1.0.1"), { recursive: true });
  const sim = join(lib, "sims/counter/1.0.1/sim.json");
  writeFileSync(sim, readFileSync(sim, "utf8").replace('"version": "1.0.0"', '"version": "1.0.1"'));
  let r = run(lib);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /bundle demo@0\.3\.0: digest differs from the files/);
  assert.match(r.stdout, /sim ptf:sim\/counter@1\.0\.1 is not listed/);

  r = run("catalog", "--write", lib);
  assert.equal(r.status, 0, r.stderr);
  const rewritten = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(rewritten.title, catalog.title, "header fields are kept");
  assert.equal(rewritten.packages.length, 4);
  assert.match(run(lib).stdout, /0 error\(s\)/);
});

test("catalog schema rejects bad ids, auth and digests", () => {
  const lib = copyExample({ catalog: true });
  const file = join(lib, "ptf-catalog.json");
  const catalog = JSON.parse(readFileSync(file, "utf8"));
  catalog.id = "Not A Domain";
  catalog.auth = { type: "oauth2" };
  catalog.packages[0].digest = "md5-abc";
  writeFileSync(file, JSON.stringify(catalog));
  const r = run(lib);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /\/id must match pattern/);
  assert.match(r.stdout, /\/auth must have required property 'authorization_endpoint'/);
  assert.match(r.stdout, /\/packages\/0\/digest must match pattern/);
});

test("answer checks catch wrong answers and missing checks", () => {
  const lib = copyExample();
  const el = join(lib, "bundles/demo/elements/counting.md");
  writeFileSync(el, readFileSync(el, "utf8").replace('"answer": 26', '"answer": 25').replace('{ "text": "8", "correct": false', '{ "text": "8", "correct": true'));
  let r = run(lib);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /q3: answer 25 but the check computes 26/);
  assert.match(r.stdout, /q2: option 2 "8" is marked correct but the check says wrong/);

  const checks = join(lib, "bundles/demo/checks/counting.js");
  writeFileSync(checks, 'check("q2", (q) => q.options.map((o) => o.correct));\ncheck("nope", () => 1);\nfact("1 + 1 = 3", () => 1 + 1 === 3);\n');
  r = run(lib);
  assert.match(r.stdout, /fact "1 \+ 1 = 3" does not hold/);
  assert.match(r.stdout, /check for unknown question id "nope"/);
  assert.match(r.stdout, /computed answers without a check in checks\/counting\.js: q1, q3/);
});

test("answer checks run without node APIs and with a time limit", () => {
  const lib = copyExample();
  const checks = join(lib, "bundles/demo/checks/counting.js");
  writeFileSync(checks, 'check("q1", () => typeof require + typeof process + typeof fetch);\ncheck("q3", () => eval("26"));\ncheck("q2", () => { for (;;) {} });\n');
  const r = run(lib);
  assert.match(r.stdout, /q1: answer "4" but the check computes "undefinedundefinedundefined"/);
  assert.match(r.stdout, /q3: check threw: Code generation from strings disallowed/);
  assert.match(r.stdout, /q2: check threw: Script execution timed out/);
});

test("rounded numbers in calculation steps agree with computed values", async () => {
  const { compare } = await import("../tools/answer-checks.mjs");
  const q = { kind: "calculation_steps", rows: [["a", "≈ 3.11 h"], ["b", "440 000 km"], ["c", "1,02"]], result: { value: "about 3.1 hours" } };
  assert.deepEqual(compare(q, { rows: [Math.log(0.5) / Math.log(0.8), 440000, 1.02], result: 3.106 }), []);
  assert.equal(compare(q, [3.2, null, null]).length, 1);
  const r = { kind: "calculation_steps", rows: [["t", "√(112 / 9.81) ≈ 3.38 s"], ["A", "2.83 · 10⁻³ m²"], ["k", "8.48e-4 kg/m"], ["d", "19.6 − 4.9 = 14.7 m"]] };
  assert.deepEqual(compare(r, [Math.sqrt(112 / 9.81), Math.PI * 0.03 ** 2, 8.482e-4, 14.7]), []);
  assert.equal(compare(r, [null, 2.9e-3, null, null]).length, 1);
});

test("checks figures: format rules, references and translations", () => {
  const lib = copyExample();
  const figs = join(lib, "bundles/demo/figures");
  const svg = join(figs, "count-apples.svg");
  const good = readFileSync(svg, "utf8");
  writeFileSync(svg, good
    .replace('viewBox="0 0 320 180"', 'viewBox="0 0 480 180"')
    .replace('<circle class="s-warn f-warn-soft w2"', '<circle onclick="alert(1)" fill="#ff0000" class="s-warn red"')
    .replace("</defs>", '</defs><script>alert(1)</script><image href="https://example.org/x.png"/>')
    .replace('data-step="3"', 'data-step="4"'));
  writeFileSync(join(figs, "orphan.de.svg"), good);
  writeFileSync(join(figs, "notes.txt"), "x");
  const el = join(lib, "bundles/demo/elements/counting.md");
  writeFileSync(el, readFileSync(el, "utf8").replace("  - id: count-apples\n    objectives: [next-one]", "  - id: count-apples\n    objectives: [nope]\n  - id: missing"));
  const r = run(lib);
  assert.equal(r.status, 1);
  for (const re of [/viewBox is 480 units wide/, /attribute onclick on <circle> is not allowed/, /fill="#ff0000" on <circle>: colours only through classes/,
    /<script> is not allowed/, /<image> is not allowed/, /unknown class\(es\) red/, /steps must be numbered 1\.\.3 without gaps/,
    /canonical figures\/orphan\.svg is missing/, /figures\/ holds only <id>\.svg/, /figure "missing" not found/]) {
    assert.match(r.stdout, re);
  }
  assert.doesNotMatch(r.stdout, /figure "count-apples" not found/);   // invalid, reported on the file, not as missing
});

test("a translated figure must keep the steps of the canonical one", () => {
  const lib = copyExample();
  const de = join(lib, "bundles/demo/figures/count-apples.de.svg");
  writeFileSync(de, readFileSync(de, "utf8").replace(/<g data-step="3"[\s\S]*?<\/g>\n/, ""));
  const r = run(lib);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /has 2 step\(s\), the canonical figure 3/);
});
