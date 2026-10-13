// Turns the recordings from record-demo.mjs into README media: one MP4 and one animated WebP per clip, a WebP
// per still, and a short tour of the highlights. Waits for a model are fast-forwarded from the logged events.
//
//   node make-media.mjs <recordings dir> <output dir>        (needs ffmpeg with libx264 and libwebp)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [input = "out", output = "media"] = process.argv.slice(2);
mkdirSync(output, { recursive: true });

// How fast each kind of logged span plays back.
const SPEED = { wait: 8, stream: 2.5 };
// The MP4s keep the recording's full 1440 × 900; the animated WebPs that play inline are a little smaller.
const MP4_CRF = "18";
const WEBP = { width: 1280, fps: 15, quality: "78" };
// The steps between the frames and the final files are kept almost lossless, so text is encoded only once.
const INTERMEDIATE = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "6", "-pix_fmt", "yuv420p"];
// The tour: [clip, start, end] in seconds of the processed clip; negative times count from the end, and a null
// end means the end of the clip.
const TOUR = [
  ["workbench", 0.9, 5],
  ["ocr", 1.5, 7],
  ["image", 2, 6],
  ["image", -9, -2],
  ["video", 2.5, 9],
  ["video", -8, -1.5],
  ["websearch", 1.5, 10.5],
  ["websearch", 17, 23.5],
  ["chat", 3, 11],
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

// Plays the screencast frames at their recorded times: each frame stays on screen until the next one.
function assemble(dir, target) {
  const { end, frames } = JSON.parse(readFileSync(path.join(dir, "frames.json"), "utf8"));
  frames.sort((a, b) => a.t - b.t);
  const lines = ["ffconcat version 1.0"];
  frames.forEach((frame, index) => {
    const from = index === 0 ? 0 : frame.t;
    const to = index + 1 < frames.length ? frames[index + 1].t : end;
    lines.push(`file '${frame.file}'`, `duration ${Math.max(to - from, 0.001).toFixed(4)}`);
  });
  // The concat demuxer ignores the last duration unless the file is listed once more.
  lines.push(`file '${frames.at(-1).file}'`);
  writeFileSync(path.join(dir, "frames.txt"), `${lines.join("\n")}\n`);
  ffmpeg(["-f", "concat", "-safe", "0", "-i", path.join(dir, "frames.txt"), "-vf", "fps=30", ...INTERMEDIATE, target]);
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
  return `${chains.join(";")};${pieces.map((_, index) => `[p${index}]`).join("")}concat=n=${pieces.length}:v=1:a=0,fps=30[v]`;
}

function encodeMp4(source, target) {
  ffmpeg(["-i", source, "-c:v", "libx264", "-preset", "slow", "-crf", MP4_CRF, "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", "-an", target]);
}

function encodeWebp(source, target) {
  ffmpeg(["-i", source, "-vf", `fps=${WEBP.fps},scale=${WEBP.width}:-2:flags=lanczos`, "-c:v", "libwebp_anim",
    "-quality", WEBP.quality, "-compression_level", "6", "-loop", "0", "-an", target]);
}

const megabytes = (file) => `${(readFileSync(file).length / 1e6).toFixed(1)} MB`;

const edited = {};
for (const name of ["workbench", "ocr", "transcript", "image", "video", "websearch", "chat", "mindmap", "theme"]) {
  let source = path.join(input, `${name}.webm`);
  if (existsSync(path.join(input, name, "frames.json"))) {
    source = path.join(input, `${name}.mkv`);
    assemble(path.join(input, name), source);
  }
  if (!existsSync(source)) continue;
  const events = existsSync(path.join(input, `${name}.events.json`))
    ? JSON.parse(readFileSync(path.join(input, `${name}.events.json`), "utf8"))
    : [];
  edited[name] = path.join(input, `${name}.edited.mkv`);
  ffmpeg(["-i", source, "-filter_complex", speedFilter(events, duration(source)), "-map", "[v]", ...INTERMEDIATE, edited[name]]);
  encodeMp4(edited[name], path.join(output, `${name}.mp4`));
  encodeWebp(edited[name], path.join(output, `${name}.webp`));
  console.log(`${name}: ${duration(edited[name]).toFixed(1)} s, MP4 ${megabytes(path.join(output, `${name}.mp4`))}, WebP ${megabytes(path.join(output, `${name}.webp`))}`);
}

// The stills from record-demo.mjs. Lossless WebP keeps their text sharp; a still that would pass 1 MB is encoded
// lossy instead, so the README stays light.
const STILLS = ["translate", "song", "preset", "workflow-editor", "workflow-run", "monitor", "setup", "phone"];
for (const name of STILLS) {
  const source = path.join(input, `${name}.png`);
  if (!existsSync(source)) continue;
  const target = path.join(output, `${name}.webp`);
  ffmpeg(["-i", source, "-c:v", "libwebp", "-lossless", "1", "-compression_level", "6", target]);
  if (readFileSync(target).length > 1e6) ffmpeg(["-i", source, "-c:v", "libwebp", "-quality", "90", "-compression_level", "6", target]);
  console.log(`${name}: WebP ${megabytes(target)}`);
}

// The tour stitches highlights of the processed clips together.
const parts = TOUR.filter(([name]) => edited[name]).map(([name, start, end], index) => {
  const file = edited[name];
  const total = duration(file);
  const from = start < 0 ? Math.max(0, total + start) : start;
  const to = end === null ? total : end < 0 ? total + end : Math.min(end, total);
  return { file, chain: `[${index}:v]trim=start=${from.toFixed(2)}:end=${to.toFixed(2)},setpts=PTS-STARTPTS[t${index}]` };
});
if (parts.length) {
  const tour = path.join(input, "tour.edited.mkv");
  const filter = `${parts.map((part) => part.chain).join(";")};${parts.map((_, index) => `[t${index}]`).join("")}concat=n=${parts.length}:v=1:a=0[v]`;
  ffmpeg([...parts.flatMap((part) => ["-i", part.file]), "-filter_complex", filter, "-map", "[v]", ...INTERMEDIATE, tour]);
  encodeMp4(tour, path.join(output, "tour.mp4"));
  encodeWebp(tour, path.join(output, "tour.webp"));
  console.log(`tour: ${duration(tour).toFixed(1)} s, MP4 ${megabytes(path.join(output, "tour.mp4"))}, WebP ${megabytes(path.join(output, "tour.webp"))}`);
}
