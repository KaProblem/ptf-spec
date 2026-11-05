// Answer checks (SPEC.md §7.1): a script per element recomputes the answers of its
// question blocks, and ptf-check compares them with what the blocks claim. `fact`
// entries check numbers and claims in the element's text.
//
// The script is a classic script without imports. It runs in a fresh node:vm context
// that holds only the ECMAScript built-ins, `check` and `ptf`; code generation from
// strings is off and the run is limited to one second. node:vm is not a security
// boundary: run ptf-check on untrusted content only where no secrets are reachable.
import vm from "node:vm";

// Kinds whose answer is a value someone has to work out.
export const COMPUTED_KINDS = new Set(["estimate_number", "calculation_steps"]);

const NUM = /[−-]?\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?(?:e[−-]?\d+)?|[−-]?\d+(?:[.,]\d+)?(?:e[−-]?\d+)?/i;

// The first number in a text: "≈ 3.11 h" → 3.11, "440 000 km" → 440000, "1,02" → 1.02.
// Returns { value, decimals } or null.
export function parseNumber(text) {
  if (typeof text === "number") return { value: text, decimals: decimalsOf(text) };
  const m = String(text ?? "").match(NUM);
  if (!m) return null;
  const s = m[0].replace(/[   ]/g, "").replace(/−/g, "-").replace(",", ".");
  const [mant] = s.toLowerCase().split("e");
  return { value: Number(s), decimals: mant.includes(".") ? mant.split(".")[1].length : 0 };
}

function decimalsOf(n) {
  const s = String(n);
  if (/e/i.test(s)) return 0;
  return s.includes(".") ? s.split(".")[1].length : 0;
}

// A printed value agrees with a computed one if it is the computed value rounded to the
// printed digits (half a unit of the last printed digit), or within `tol`.
function agrees(printed, computed, tol = 0) {
  const p = parseNumber(printed);
  if (!p || !Number.isFinite(p.value)) return false;
  const half = 0.5 * 10 ** -p.decimals;
  return Math.abs(p.value - computed) <= Math.max(half, tol) * (1 + 1e-9) + 1e-12;
}

function sameText(a, b) {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

// Does one value match a gap / guess_next answer (with `accepted` variants)?
function matchesAnswer(computed, answer, accepted = []) {
  if (typeof computed === "number") return [answer, ...accepted].some((a) => agrees(a, computed));
  return [answer, ...accepted].some((a) => sameText(a, computed));
}

const show = (v) => (typeof v === "number" ? String(Number(v.toPrecision(10))) : JSON.stringify(v));

// Compares what a check returned with the question block. Returns a list of problems.
export function compare(q, got) {
  if (got === undefined || got === true) return [];
  if (got === false) return ["check returned false"];
  if (typeof got === "string" && !["guess_next", "cloze"].includes(q.kind)) return [got];
  const out = [];
  switch (q.kind) {
    case "estimate_number": {
      if (typeof got !== "number" || !Number.isFinite(got)) return [`check must return a number, got ${show(got)}`];
      // The stored answer must be the computed value, up to rounding or half the tolerance.
      if (!agrees(q.answer, got, (q.tolerance ?? 0) / 2)) out.push(`answer ${q.answer} but the check computes ${show(got)}`);
      break;
    }
    case "multiple_choice": {
      if (!Array.isArray(got) || got.length !== (q.options ?? []).length || got.some((x) => typeof x !== "boolean")) {
        return [`check must return one true/false per option (${(q.options ?? []).length}), got ${show(got)}`];
      }
      q.options.forEach((o, i) => {
        if (Boolean(o.correct) !== got[i]) out.push(`option ${i + 1} "${o.text}" is marked ${o.correct ? "correct" : "wrong"} but the check says ${got[i] ? "correct" : "wrong"}`);
      });
      break;
    }
    case "cloze": {
      const gaps = q.gaps ?? [];
      if (!Array.isArray(got) || got.length !== gaps.length) return [`check must return one value per gap (${gaps.length}), got ${show(got)}`];
      gaps.forEach((g, i) => {
        if (got[i] === null || got[i] === undefined) return;
        if (!matchesAnswer(got[i], g.answer, g.accepted)) out.push(`gap ${i + 1} is "${g.answer}" but the check computes ${show(got[i])}`);
      });
      break;
    }
    case "guess_next": {
      if (!matchesAnswer(got, q.answer, q.accepted)) out.push(`answer "${q.answer}" but the check computes ${show(got)}`);
      break;
    }
    case "calculation_steps": {
      const res = Array.isArray(got) ? { rows: got } : got;
      if (!res || typeof res !== "object") return [`check must return the row values or { rows, result }, got ${show(got)}`];
      const rows = q.rows ?? [];
      if (res.rows !== undefined) {
        if (!Array.isArray(res.rows) || res.rows.length !== rows.length) return [`check must return one value per row (${rows.length}), got ${show(res.rows)}`];
        rows.forEach((r, i) => {
          const v = res.rows[i];
          if (v === null || v === undefined) return;
          const cell = r[r.length - 1];
          const ok = typeof v === "number" ? agrees(cell, v) : sameText(cell, v);
          if (!ok) out.push(`row ${i + 1} shows "${cell}" but the check computes ${show(v)}`);
        });
      }
      if (res.result !== undefined && res.result !== null) {
        const cell = q.result?.value;
        const ok = typeof res.result === "number" ? agrees(cell, res.result) : sameText(cell, res.result);
        if (!ok) out.push(`result shows "${cell}" but the check computes ${show(res.result)}`);
      }
      break;
    }
    default:
      out.push(`kind ${q.kind} has no automatic comparison; return true after your own assertions`);
  }
  return out;
}

// Helpers available to check scripts as `ptf`.
function helpers() {
  return Object.freeze({
    num: (text) => {
      const p = parseNumber(text);
      if (!p) throw new Error(`no number in ${JSON.stringify(text)}`);
      return p.value;
    },
    near: (a, b, tol = 1e-9) => Math.abs(a - b) <= tol,
    assert: (cond, msg = "assertion failed") => { if (!cond) throw new Error(msg); },
    round: (x, digits = 0) => Math.round(x * 10 ** digits) / 10 ** digits,
  });
}

// Runs one check script against the element's questions (a Map id → block).
// Returns { problems: [{ id, msg }], checked: Set of ids }.
export function runChecks(source, filename, questions) {
  const registered = [];
  const facts = [];
  const problems = [];
  const context = vm.createContext(
    { check: (id, fn) => registered.push({ id, fn }), fact: (text, fn) => facts.push({ text, fn }), ptf: helpers() },
    { codeGeneration: { strings: false, wasm: false } },
  );
  try {
    new vm.Script(source, { filename }).runInContext(context, { timeout: 1000 });
  } catch (e) {
    return { problems: [{ id: null, msg: `check script failed: ${e.message}` }], checked: new Set() };
  }
  const checked = new Set();
  for (const { id, fn } of registered) {
    const q = questions.get(id);
    if (!q) { problems.push({ id, msg: `check for unknown question id "${id}"` }); continue; }
    if (checked.has(id)) { problems.push({ id, msg: "question is checked twice" }); continue; }
    checked.add(id);
    if (typeof fn !== "function") { problems.push({ id, msg: "check needs a function" }); continue; }
    let got;
    try {
      // The question is passed as a copy: a check cannot change what is compared.
      context.__q = JSON.parse(JSON.stringify(q));
      context.__fn = fn;
      got = new vm.Script("__fn(__q)").runInContext(context, { timeout: 1000 });
    } catch (e) {
      problems.push({ id, msg: `check threw: ${e.message}` });
      continue;
    }
    for (const msg of compare(q, got)) problems.push({ id, msg });
  }
  // fact(text, fn): a number or claim in the element's text; fn returns true or uses ptf.assert.
  for (const { text, fn } of facts) {
    let got;
    try {
      context.__fn = fn;
      got = typeof fn === "function" ? new vm.Script("__fn()").runInContext(context, { timeout: 1000 }) : fn;
    } catch (e) {
      problems.push({ id: null, msg: `fact "${text}" threw: ${e.message}` });
      continue;
    }
    if (got !== true && got !== undefined) problems.push({ id: null, msg: `fact "${text}" does not hold` });
  }
  return { problems, checked };
}
