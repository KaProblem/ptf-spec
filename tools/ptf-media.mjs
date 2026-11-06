// Audio and video of a bundle (SPEC.md §6.9): the rules that ptf-check and hosts share.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Largest file a bundle may hold itself; larger ones are referenced by https URL. */
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

export const MEDIA_TYPES = {
  mp3: { kind: "audio", mime: "audio/mpeg" },
  m4a: { kind: "audio", mime: "audio/mp4" },
  mp4: { kind: "video", mime: "video/mp4" },
};

export const extOf = (src) => String(src).split(/[?#]/)[0].split(".").pop().toLowerCase();
export const mimeOf = (src) => MEDIA_TYPES[extOf(src)]?.mime ?? null;
export const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");

/** Checks the first bytes: MP3 (ID3 tag or frame sync) or ISO base media (ftyp box). */
export function sniffMedia(buf, ext) {
  if (ext === "mp3") return (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
  return buf.length > 8 && buf.toString("latin1", 4, 8) === "ftyp";
}

/** Duration in seconds via ffprobe, or null when ffprobe is not installed. */
export function probeDuration(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  if (r.error || r.status !== 0) return null;
  const d = parseFloat(r.stdout);
  return Number.isFinite(d) ? d : null;
}

/** Plain text of a transcript: a .vtt loses its header, cue numbers, timings and tags. */
export function transcriptText(raw, file) {
  if (!String(file).endsWith(".vtt")) return raw.trim();
  return raw.replace(/^\uFEFF?WEBVTT[^\n]*\n/, "").split(/\r?\n\r?\n/)
    .map((cue) => cue.split(/\r?\n/).filter((l) => !/-->/.test(l) && !/^\d+$/.test(l.trim()) && !/^(NOTE|STYLE|REGION)\b/.test(l)).join(" "))
    .map((s) => s.replace(/<[^>]+>/g, "").trim()).filter(Boolean).join("\n");
}

export const wordCount = (text) => (String(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

// CLI: node tools/ptf-media.mjs entry <bundle-dir> <media/file> [transcript]
// prints the `media` entry fields that a file needs (sha256, bytes, duration_s), for pasting into an element.
// The basename test keeps the CLI from running when this file is bundled into the MCP server.
if (import.meta.url.endsWith("/ptf-media.mjs") && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, bundle, src, transcript] = process.argv.slice(2);
  if (cmd !== "entry" || !bundle || !src) {
    console.error("usage: ptf-media entry <bundle-dir> <media/file.mp3|m4a|mp4> [media/transcript.txt|vtt]");
    process.exit(2);
  }
  const file = resolve(bundle, src);
  const rel = relative(resolve(bundle), file).split("\\").join("/");
  const type = MEDIA_TYPES[extOf(rel)];
  if (!existsSync(file) || !type) { console.error(`${rel}: not an existing .mp3, .m4a or .mp4 file`); process.exit(1); }
  const buf = readFileSync(file);
  const dur = probeDuration(file);
  const id = rel.split("/").pop().replace(/\.[^.]+$/, "");
  const tr = transcript ?? [".txt", ".vtt"].map((e) => `media/${id}${e}`).find((p) => existsSync(join(bundle, p))) ?? `media/${id}.txt`;
  console.log([`  - id: ${id}`, `    kind: ${type.kind}`, `    src: ${rel}`, `    sha256: ${sha256Hex(buf)}`, `    bytes: ${buf.length}`,
    `    duration_s: ${dur == null ? "?   # ffprobe not found: fill in the length in seconds" : Math.round(dur * 10) / 10}`,
    `    transcript: ${tr}`, `    license: ?`].join("\n"));
  if (buf.length > MAX_MEDIA_BYTES) console.error("warning: over 10 MiB; host the file elsewhere and use an https URL as src");
}
