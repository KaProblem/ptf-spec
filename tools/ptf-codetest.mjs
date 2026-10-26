#!/usr/bin/env node
// ptf-codetest: smoke test for PTF code labs (CODE-SPEC.md §6).
//
//   ptf-codetest <lab-dir> [<lab-dir> …]   run every step in smoke mode
//   ptf-codetest --step <id> <lab-dir>      run one step only
//
// Each lab is copied to a temporary directory first, so the package stays
// untouched. Dependencies are not installed; run the lab's `setup` before.
// Exit code 1 if any step fails, times out or does not match `expect`.

import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const only = args.includes("--step") ? args.splice(args.indexOf("--step"), 2)[1] : null;
if (!args.length || args[0] === "-h" || args[0] === "--help") {
  console.log("usage: ptf-codetest [--step <id>] <lab-dir> [<lab-dir> …]");
  process.exit(args.length ? 0 : 1);
}

let failed = 0;
for (const dir of args.map((d) => resolve(d))) {
  const lab = JSON.parse(readFileSync(join(dir, "lab.json"), "utf8"));
  const timeout = (lab.smoke?.timeout_s ?? 120) * 1000;
  const env = { ...process.env, ...(lab.smoke?.env ?? {}) };
  const work = join(mkdtempSync(join(tmpdir(), "ptf-lab-")), "lab");
  cpSync(dir, work, { recursive: true });
  console.log(`${lab.id}@${lab.version}`);
  for (const step of lab.steps) {
    if (only && step.id !== only) continue;
    const started = Date.now();
    // `run` is a plain command line from the manifest; run it through the shell like a learner would.
    const r = spawnSync(step.run, { cwd: work, env, shell: true, encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    let problem = null;
    if (r.error?.code === "ETIMEDOUT" || r.signal) problem = `timed out after ${timeout / 1000} s`;
    else if (r.status !== 0) problem = `exit code ${r.status}`;
    else if (step.expect && !new RegExp(step.expect).test(r.stdout)) problem = `output does not match /${step.expect}/`;
    if (problem) {
      failed++;
      console.log(`  FAIL ${step.id} (${secs} s): ${problem}`);
      console.log(out.split("\n").slice(-25).map((l) => `       ${l}`).join("\n"));
    } else {
      console.log(`  ok   ${step.id} (${secs} s)`);
    }
  }
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
