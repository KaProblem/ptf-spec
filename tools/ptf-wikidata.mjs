#!/usr/bin/env node
// ptf-wikidata: find and verify Wikidata subject anchors (`about`, SPEC.md §6.6).
//
//   ptf-wikidata search <concept> [--lang en]   list candidate items for a concept
//   ptf-wikidata title <Wikipedia title>        the item of an English Wikipedia article
//   ptf-wikidata verify <library-dir>            check every `about` ID in a library
//
// Needs network access to www.wikidata.org. `verify` fails on IDs that do not
// exist or redirect to another item, and warns when a `label` differs from the
// item's English label.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import YAML from "yaml";

const API = "https://www.wikidata.org/w/api.php";
const WIKI = "https://www.wikidata.org/wiki";
const HEADERS = { "User-Agent": "ptf-wikidata/0.1 (https://github.com/KaProblem/ptf-spec)" };

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Wikidata answered ${res.status} for ${url}`);
  return res.json();
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

function frontmatter(file) {
  const m = readFileSync(file, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  try { return m ? YAML.parse(m[1]) ?? {} : {}; } catch { return {}; }
}

async function search(concept, lang) {
  const r = await api({ action: "wbsearchentities", search: concept, language: lang, uselang: lang, type: "item", limit: "8" });
  if (!r.search?.length) { console.log(`no items for "${concept}"`); return; }
  for (const hit of r.search) console.log(`${hit.id.padEnd(11)} ${hit.label ?? ""}${hit.description ? `  · ${hit.description}` : ""}`);
}

async function title(t) {
  const res = await fetch(`${WIKI}/Special:ItemByTitle/enwiki/${encodeURIComponent(t.replace(/ /g, "_"))}`, { headers: HEADERS, redirect: "manual" });
  const id = res.headers.get("location")?.match(/\/(Q[0-9]+)$/)?.[1];
  if (res.status === 429) throw new Error("Wikidata rate limit (429); wait a minute and try again");
  if (!id) { console.log(`no item for the English Wikipedia article "${t}"`); return; }
  const entity = Object.values((await (await fetch(`${WIKI}/Special:EntityData/${id}.json`, { headers: HEADERS })).json()).entities)[0];
  console.log(`${entity.id.padEnd(11)} ${entity.labels?.en?.value ?? ""}  · ${entity.descriptions?.en?.value ?? ""}`);
}

async function verify(root) {
  const uses = [];   // { file, id, label }
  for (const f of walk(root)) {
    const d = frontmatter(f);
    if (d.type !== "Learning Element") continue;
    for (const a of d.about ?? []) uses.push({ file: relative(process.cwd(), f), id: a?.wikidata, label: a?.label });
  }
  const ids = [...new Set(uses.map((u) => u.id).filter((id) => /^Q[1-9][0-9]*$/.test(id ?? "")))];
  // Special:EntityData is cached and less rate-limited than the action API.
  const items = {};
  for (const id of ids) {
    const res = await fetch(`${WIKI}/Special:EntityData/${id}.json`, { headers: HEADERS });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`Wikidata answered ${res.status} for ${id}`);
    const entity = Object.values((await res.json()).entities ?? {})[0];
    if (entity) items[id] = entity;
  }
  let errors = 0, warnings = 0;
  for (const u of uses) {
    const item = items[u.id];
    if (!item) { console.log(`error  ${u.file}: ${u.id} does not exist`); errors++; continue; }
    if (item.id !== u.id) { console.log(`error  ${u.file}: ${u.id} redirects to ${item.id}`); errors++; continue; }
    const label = item.labels?.en?.value;
    if (u.label && label && u.label.toLowerCase() !== label.toLowerCase()) {
      console.log(`warn   ${u.file}: ${u.id} is "${label}" (${item.descriptions?.en?.value ?? "no description"}), not "${u.label}"`);
      warnings++;
    }
  }
  console.log(`ptf-wikidata: ${uses.length} anchor(s), ${ids.length} item(s) · ${errors} error(s), ${warnings} warning(s)`);
  process.exit(errors ? 1 : 0);
}

const [cmd, ...rest] = process.argv.slice(2);
const langAt = rest.indexOf("--lang");
const lang = langAt >= 0 ? rest.splice(langAt, 2)[1] : "en";
if (cmd === "search" && rest.length) await search(rest.join(" "), lang);
else if (cmd === "title" && rest.length) await title(rest.join(" "));
else if (cmd === "verify") await verify(rest[0] ?? ".");
else { console.log("usage: ptf-wikidata search <concept> [--lang en] | title <Wikipedia title> | verify <library-dir>"); process.exit(2); }
