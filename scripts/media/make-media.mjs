// Turns the recordings from record-demo.mjs into README media: one MP4 and one animated WebP per clip, plus
// a short tour of the highlights. Waits for a model are fast-forwarded from the logged events.
//
//   node make-media.mjs <recordings dir> <output dir>        (needs ffmpeg with libx264 and libwebp)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const [input = "out", output = "media"] = process.argv.slice(2);
mkdirSync(output, { recursive: true });

// How fast each kind of logged span plays back.
const SPEED = { wait: 8, stream: 2.5 };
// The tour: [clip, start, end] in seconds of the processed clip; negative times count from the end, and a null
// end means the end of the clip.
const TOUR = [
  ["workbench", 0.4, 4.5],
  ["ocr", 1.5, 8],
  ["image", 1, 6.5],
  ["image", -9, -2],
  ["chat", 3, 14],
  ["grounding", 2.5, 7.5],
  ["mindmap", 1.5, 5.5],
];

function ffmpeg(args) {
  const run = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}`);
}

function duration(file) {
  const run = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  return Number(run.stdout.trim());
}

// Splits the clip at the logged spans and speeds each span up, so only the waiting gets shorter.
function speedFilter(events, total) {
  const spans = [];
  for (const kind of Object.keys(SPEED)) {
    const start = events.find((event) => event.label === `${kind}-start`);
    const end = events.find((event) => event.label === `${kind}-end`);
    if (start && end && end.t > start.t) spans.push({ from: start.t, to: end.t, speed: SPEED[kind] });
  }
  spans.sort((a, b) => a.from - b.from);
  const pieces = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.from > cursor) pieces.push({ from: cursor, to: span.from, speed: 1 });
    pieces.push(span);
    cursor = span.to;
  }
  pieces.push({ from: cursor, to: total, speed: 1 });
  const chains = pieces.map((piece, index) =>
    `[0:v]trim=start=${piece.from.toFixed(3)}:end=${piece.to.toFixed(3)},setpts=(PTS-STARTPTS)/${piece.speed}[p${index}]`);
  return `${chains.join(";")};${pieces.map((_, index) => `[p${index}]`).join("")}concat=n=${pieces.length}:v=1:a=0,fps=30,scale=1280:-2:flags=lanczos[v]`;
}

function encodeMp4(source, target, filter, extra = []) {
  ffmpeg(["-i", source, "-filter_complex", filter, "-map", "[v]", "-c:v", "libx264", "-preset", "slow", "-crf", "24",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", ...extra, target]);
}

function encodeWebp(source, target, width = 960, fps = 12) {
  ffmpeg(["-i", source, "-vf", `fps=${fps},scale=${width}:-2:flags=lanczos`, "-c:v", "libwebp_anim", "-quality", "60",
    "-compression_level", "6", "-loop", "0", "-an", target]);
}

const clips = ["workbench", "ocr", "transcript", "image", "grounding", "chat", "mindmap", "theme"]
  .filter((name) => existsSync(path.join(input, `${name}.webm`)));
for (const name of clips) {
  const source = path.join(input, `${name}.webm`);
  const events = existsSync(path.join(input, `${name}.events.json`))
    ? JSON.parse(readFileSync(path.join(input, `${name}.events.json`), "utf8"))
    : [];
  const mp4 = path.join(output, `${name}.mp4`);
  encodeMp4(source, mp4, speedFilter(events, duration(source)));
  encodeWebp(mp4, path.join(output, `${name}.webp`));
  console.log(`${name}: ${duration(mp4).toFixed(1)} s`);
}

// The tour stitches highlights of the processed clips together.
const parts = TOUR.filter(([name]) => clips.includes(name)).map(([name, start, end], index) => {
  const file = path.join(output, `${name}.mp4`);
  const total = duration(file);
  const from = start < 0 ? Math.max(0, total + start) : start;
  const to = end === null ? total : end < 0 ? total + end : Math.min(end, total);
  return { file, chain: `[${index}:v]trim=start=${from.toFixed(2)}:end=${to.toFixed(2)},setpts=PTS-STARTPTS[t${index}]` };
});
if (parts.length) {
  const filter = `${parts.map((part) => part.chain).join(";")};${parts.map((_, index) => `[t${index}]`).join("")}concat=n=${parts.length}:v=1:a=0[v]`;
  ffmpeg([...parts.flatMap((part) => ["-i", part.file]), "-filter_complex", filter, "-map", "[v]", "-c:v", "libx264",
    "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(output, "tour.mp4")]);
  encodeWebp(path.join(output, "tour.mp4"), path.join(output, "tour.webp"), 1100, 12);
  console.log(`tour: ${duration(path.join(output, "tour.mp4")).toFixed(1)} s`);
}
