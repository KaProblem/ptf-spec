#!/usr/bin/env node
// ptf-selftest: run a simulator's test.json in a real browser, under the same
// sandbox a production host uses (SIMULATOR-SPEC.md §5.1, §6).
//
//   ptf-selftest <sim-dir> [<sim-dir> ...]
//   ptf-selftest --serve <sim-dir>     open a local dev host to try a simulator by hand
//
// The simulator is served from its own origin with the PTF CSP header and embedded
// with sandbox="allow-scripts" by runtime/ptf-host.js on a second origin.
// Requires Playwright with Chromium (npm i -D playwright && npx playwright install chromium).

import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SPEC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2" };

function csp(hostOrigin) {
  return ["default-src 'none'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "font-src 'self' data:", "media-src 'self' data: blob:", "connect-src 'none'",
    "form-action 'none'", "base-uri 'none'", `frame-ancestors ${hostOrigin}`].join("; ");
}

function listen(handler) {
  return new Promise((res) => { const s = createServer(handler); s.listen(0, "127.0.0.1", () => res(s)); });
}

function serveStatic(root, extraHeaders) {
  return (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!p.startsWith(root + sep) && p !== root) { res.writeHead(403).end(); return; }
    const file = existsSync(p) && statSync(p).isDirectory() ? join(p, "index.html") : p;
    if (!existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store", ...extraHeaders() });
    res.end(readFileSync(file));
  };
}

function hostPage(simUrl, init, title) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PTF dev host · ${title}</title>
<style>body{font:15px system-ui;margin:0;background:#eef1f4}header{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 16px;background:#18212e;color:#fff}
header select,header button{font:inherit;min-height:36px}#frame{margin:16px;background:#fff;outline:2px dashed #0e6e68}
#log{margin:16px;font:12px ui-monospace,monospace;white-space:pre-wrap;max-height:30vh;overflow:auto;background:#fff;padding:8px}</style></head>
<body><header><strong>PTF dev host</strong><span>${title}</span>
<select id="lvl"><option>child</option><option selected>highschool</option><option>college</option><option>expert</option></select>
<button id="snap">Snapshot</button><button id="theme">Toggle theme</button></header>
<div id="frame"></div><div id="log"></div>
<script src="/__ptf/ptf-host.js"></script>
<script>
window.__ptf = { events: [], errors: [], states: [], ready: false, hang: false };
const log = (t, o) => { const el = document.getElementById("log"); el.textContent = t + " " + JSON.stringify(o) + "\\n" + el.textContent; };
const init = ${JSON.stringify(init)};
document.getElementById("lvl").value = init.level || "highschool";
// Mount (or remount, to test resume) the simulator; a remount passes the last ptf/state back in.
window.__mount = (state) => {
  if (window.sim) window.sim.destroy();
  __ptf.ready = false;
  window.sim = PTFHost.mount(document.getElementById("frame"), {
    src: ${JSON.stringify(simUrl)}, init: state === undefined ? init : Object.assign({}, init, { state }),
    onReady() { __ptf.ready = true; log("ready", {}); },
    onEvent(e) { __ptf.events.push(e); log("event", e); },
    onState(s) { __ptf.states.push(s); log("state", s); },
    onError(e) { __ptf.errors.push(e); log("ERROR", e); },
    onHang() { __ptf.hang = true; log("HANG", {}); }
  });
};
__mount();
document.getElementById("lvl").onchange = (e) => sim.setLevel(e.target.value);
document.getElementById("snap").onclick = async () => log("snapshot", await sim.snapshot());
let dark = false;
document.getElementById("theme").onclick = () => { dark = !dark; sim.setTheme({ mode: dark ? "dark" : "light", tokens: {} }); };
</script></body></html>`;
}

async function startServers(simDir, init) {
  let hostOrigin = "";
  const simServer = await listen(serveStatic(simDir, () => ({ "Content-Security-Policy": csp(hostOrigin) })));
  const simOrigin = `http://127.0.0.1:${simServer.address().port}`;
  const manifest = JSON.parse(readFileSync(join(simDir, "sim.json"), "utf8"));
  const simUrl = `${simOrigin}/${manifest.entry || "index.html"}`;
  const hostServer = await listen((req, res) => {
    if (req.url === "/__ptf/ptf-host.js") {
      res.writeHead(200, { "Content-Type": TYPES[".js"] }).end(readFileSync(join(SPEC_DIR, "runtime", "ptf-host.js")));
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[".html"] }).end(hostPage(simUrl, init, `${manifest.id}@${manifest.version}`));
  });
  hostOrigin = `http://localhost:${hostServer.address().port}`;   // different host name = different origin
  return { simServer, hostServer, hostUrl: hostOrigin + "/", manifest };
}

function newerVersion(simDir, version) {
  const semver = createRequire(import.meta.url)("semver");
  const parent = dirname(simDir);
  const newer = readdirSync(parent).filter((v) => semver.valid(v) && semver.gt(v, version) && existsSync(join(parent, v, "sim.json")));
  return newer.sort(semver.rcompare)[0] ?? null;
}

async function runOne(chromium, simDir) {
  simDir = resolve(simDir);
  const testFile = join(simDir, "test.json");
  const steps = existsSync(testFile) ? JSON.parse(readFileSync(testFile, "utf8")).steps : [{ expectNoError: true }];
  const initStep = steps.find((s) => s.init);
  const { simServer, hostServer, hostUrl, manifest } = await startServers(simDir, initStep?.init ?? {});
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const blocked = [];
  page.on("console", (m) => { if (m.type() === "error" && /Content Security Policy|blocked/i.test(m.text())) blocked.push(m.text()); });
  const failures = [], contract = [], warnings = [];
  try {
    await page.goto(hostUrl);
    await page.waitForFunction(() => window.__ptf.ready, null, { timeout: 5000 }).catch(() => failures.push("simulator never sent ptf/ready"));
    const frame = page.frameLocator("iframe");
    const simFrame = () => page.frames().find((f) => f !== page.mainFrame());
    const visibleStations = () => simFrame().evaluate(() => [...document.querySelectorAll("[data-station]")]
      .filter((el) => !el.parentElement.closest("[data-station]"))
      .filter((el) => (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null))
      .map((el) => el.dataset.station));
    const snapshot = () => page.evaluate(() => window.sim.snapshot());
    for (const step of steps) {
      try {
        if (step.init) continue;
        if (step.click) await frame.locator(step.click).first().click({ timeout: 3000 });
        if (step.type) await frame.locator(step.type.selector).first().fill(step.type.text, { timeout: 3000 });
        if (step.setLevel) await page.evaluate((l) => window.sim.setLevel(l), step.setLevel);
        if (step.goto) await page.evaluate((s) => typeof s === "string" ? window.sim.goto(s) : window.sim.goto(s.station ?? null, { focus: !!s.focus }), step.goto);
        if (step.expectText) await frame.getByText(step.expectText, { exact: false }).first().waitFor({ state: "visible", timeout: 3000 });
        if (step.expectEvent) {
          const want = typeof step.expectEvent === "string" ? { verb: step.expectEvent } : step.expectEvent;
          await page.waitForFunction((w) => window.__ptf.events.some((e) => e.verb === w.verb && (w.station === undefined || e.station === w.station)),
            want, { timeout: 3000 });
        }
        if (step.expectStations) {
          await page.waitForTimeout(100);
          const shown = await visibleStations();
          if (shown.join(",") !== step.expectStations.join(","))
            throw new Error(`visible stations [${shown.join(", ")}], expected [${step.expectStations.join(", ")}]`);
        }
        if (step.snapshot) {
          const t = await snapshot();
          if (!t) throw new Error("empty snapshot");
          const want = typeof step.snapshot === "object" ? [].concat(step.snapshot.contains ?? []) : [];
          const missing = want.filter((w) => !t.includes(w));
          if (missing.length) throw new Error(`snapshot lacks ${missing.map((m) => JSON.stringify(m)).join(", ")}: ${JSON.stringify(t)}`);
        }
        if (step.reload) {
          // Resume round trip: remount with the last ptf/state; the learner must see the same thing again.
          await page.waitForTimeout(200);
          const before = await snapshot();
          const state = await page.evaluate(() => window.__ptf.states.at(-1));
          if (state === undefined) throw new Error("simulator sent no ptf/state to resume from");
          await page.evaluate((st) => window.__mount(st), state);
          await page.waitForFunction(() => window.__ptf.ready, null, { timeout: 5000 });
          const after = await snapshot();
          if (after !== before) throw new Error(`snapshot changed after resume:\n       before: ${before}\n       after:  ${after}`);
        }
        if (step.expectNoError) {
          await page.waitForTimeout(200);
          const errors = await page.evaluate(() => window.__ptf.errors);
          if (errors.length) throw new Error("ptf/error: " + errors.map((e) => e.message).join("; "));
        }
      } catch (e) {
        failures.push(`${JSON.stringify(step)}: ${e.message.split("\n")[0]}`);
      }
    }
    // Contract checks that every package must pass, whatever its test.json says (§6).
    const seen = new Set(await page.evaluate(() => window.__ptf.events.map((e) => e.verb)));
    for (const verb of manifest.events ?? [])
      if (!seen.has(verb)) warnings.push(`declared event "${verb}" was never emitted; add steps to test.json that trigger it`);
    if (!(manifest.events ?? []).length) contract.push(`sim.json declares no events, so the tutor never learns what the learner did (§7 rule 10)`);
    for (const st of manifest.stations ?? []) {
      try {
        if (st.levels?.length) await page.evaluate((l) => window.sim.setLevel(l), st.levels[0]);
        await page.evaluate((id) => window.sim.goto(id, { focus: true }), st.id);
        await page.waitForTimeout(100);
        const shown = await visibleStations();
        if (shown.join(",") !== st.id) contract.push(`focus on "${st.id}" shows [${shown.join(", ")}] (§4.7)`);
      } catch (e) { contract.push(`focus on "${st.id}": ${e.message.split("\n")[0]}`); }
    }
    const errors = await page.evaluate(() => window.__ptf.errors);
    if (errors.length) contract.push("ptf/error during the contract checks: " + errors.map((e) => e.message).join("; "));
    const pong = await page.evaluate(() => window.sim.ping().then(() => true, () => false));
    if (!pong) failures.push("no answer to ptf/ping");
  } finally {
    await browser.close();
    simServer.close(); hostServer.close();
  }
  const label = `${manifest.id}@${manifest.version}`;
  // Published versions are immutable (§3): contract gaps in a superseded version are reported, not failed.
  const newer = newerVersion(simDir, manifest.version);
  if (!newer) failures.push(...contract.map((c) => `contract: ${c}`));
  if (failures.length) { console.log(`FAIL ${label}`); for (const f of failures) console.log(`     ${f}`); }
  else console.log(`ok   ${label} (${steps.length} steps)`);
  if (newer) for (const c of contract) console.log(`     note (superseded by ${newer}): ${c}`);
  for (const w of warnings) console.log(`     warning: ${w}`);
  if (blocked.length) console.log(`     note: ${blocked.length} request(s) blocked by CSP, e.g. ${blocked[0].slice(0, 160)}`);
  return failures.length === 0;
}

const args = process.argv.slice(2);
if (!args.length) { console.log("usage: ptf-selftest <sim-dir>... | --serve <sim-dir>"); process.exit(2); }

if (args[0] === "--serve") {
  const { hostUrl, manifest } = await startServers(resolve(args[1] ?? "."), { level: "highschool" });
  console.log(`PTF dev host for ${manifest.id}@${manifest.version}: ${hostUrl}  (Ctrl+C to stop)`);
} else {
  let chromium;
  try { chromium = createRequire(import.meta.url)("playwright").chromium; }
  catch { console.error("ptf-selftest needs Playwright: npm i -D playwright && npx playwright install chromium"); process.exit(2); }
  let ok = true;
  for (const d of args) ok = (await runOne(chromium, d)) && ok;
  process.exit(ok ? 0 : 1);
}
