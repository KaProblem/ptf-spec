// The MCP App page (with the PTF host runtime inlined) and the tutor guide. build.mjs replaces this
// module with string constants so dist/ptf-mcp.mjs is a single file.
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

export const PLAYER_HTML = read("./player.html").replace("/*PTF_HOST_RUNTIME*/", () => read("../../runtime/ptf-host.js"));
const skill = (name) => read(`../skills/${name}/SKILL.md`).replace(/^---\n[\s\S]*?\n---\n/, "").trim();

export const TUTOR_GUIDE = skill("ptf-tutor");
export const VERSION = JSON.parse(read("../package.json")).version;
