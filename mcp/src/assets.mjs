// The MCP App pages (simulator player with the PTF host runtime inlined, quiz, figure card with the figure stylesheet inlined), the question block schema and the tutor guide. build.mjs replaces this
// module with string constants so dist/ptf-mcp.mjs is a single file.
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

export const PLAYER_HTML = read("./player.html").replace("/*PTF_HOST_RUNTIME*/", () => read("../../runtime/ptf-host.js"));
export const QUIZ_HTML = read("./quiz.html");
export const FIGURE_HTML = read("./figure.html").replace("/*PTF_FIGURE_CSS*/", () => read("../../runtime/ptf-figure.css"));
export const QUESTION_SCHEMA = JSON.parse(read("../../schemas/question-block.schema.json"));
const skill = (name) => read(`../skills/${name}/SKILL.md`).replace(/^---\n[\s\S]*?\n---\n/, "").trim();

export const TUTOR_GUIDE = skill("ptf-tutor");
export const VERSION = JSON.parse(read("../package.json")).version;
