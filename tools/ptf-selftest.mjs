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
import { existsSync, readFileSync, statSync } from "node:fs";
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
window.sim = PTFHost.mount(document.getElementById("frame"), {
  src: ${JSON.stringify(simUrl)}, init,
  onReady() { __ptf.ready = true; log("ready", {}); },
  onEvent(e) { __ptf.events.push(e); log("event", e); },
  onState(s) { __ptf.states.push(s); log("state", s); },
  onError(e) { __ptf.errors.push(e); log("ERROR", e); },
  onHang() { __ptf.hang = true; log("HANG", {}); }
});
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
  const failures = [];
  try {
    await page.goto(hostUrl);
    await page.waitForFunction(() => window.__ptf.ready, null, { timeout: 5000 }).catch(() => failures.push("simulator never sent ptf/ready"));
    const frame = page.frameLocator("iframe");
    for (const step of steps) {
      try {
        if (step.init) continue;
        if (step.click) await frame.locator(step.click).first().click({ timeout: 3000 });
        if (step.type) await frame.locator(step.type.selector).first().fill(step.type.text, { timeout: 3000 });
        if (step.setLevel) await page.evaluate((l) => window.sim.setLevel(l), step.setLevel);
        if (step.goto) await page.evaluate((s) => window.sim.goto(s.station || s, s.station ? { focus: !!s.focus } : undefined), step.goto);
        if (step.expectText) await frame.getByText(step.expectText, { exact: false }).first().waitFor({ state: "visible", timeout: 3000 });
        if (step.expectEvent) await page.waitForFunction((v) => window.__ptf.events.some((e) => e.verb === v), step.expectEvent, { timeout: 3000 });
        if (step.snapshot) { const t = await page.evaluate(() => window.sim.snapshot()); if (!t) throw new Error("empty snapshot"); }
        if (step.expectNoError) {
          await page.waitForTimeout(200);
          const errors = await page.evaluate(() => window.__ptf.errors);
          if (errors.length) throw new Error("ptf/error: " + errors.map((e) => e.message).join("; "));
        }
      } catch (e) {
        failures.push(`${JSON.stringify(step)}: ${e.message.split("\n")[0]}`);
      }
    }
    const pong = await page.evaluate(() => window.sim.ping().then(() => true, () => false));
    if (!pong) failures.push("no answer to ptf/ping");
  } finally {
    await browser.close();
    simServer.close(); hostServer.close();
  }
  const label = `${manifest.id}@${manifest.version}`;
  if (failures.length) { console.log(`FAIL ${label}`); for (const f of failures) console.log(`     ${f}`); }
  else console.log(`ok   ${label} (${steps.length} steps)`);
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
