#!/usr/bin/env node
// Seeds DATA_DIR (default ./data) with sample jobs and chats for UI development.
// Requires ffmpeg on PATH. Existing dev-* jobs are left untouched; pass --force to rebuild them.
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dataDir = path.resolve(process.env.DATA_DIR || "data");
const force = process.argv.includes("--force");
const now = Date.now();
const iso = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

const minimalPdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 66>>stream
BT /F1 28 Tf 72 700 Td (Quarterly operations report) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF
`;

const sources = {
  "garden.png": (file) => ffmpeg(["-f", "lavfi", "-i", "gradients=s=1024x768:c0=0x1f6f50:c1=0xf2c661:c2=0x2b2037:n=3:seed=7", "-frames:v", "1", file]),
  "harbor.png": (file) => ffmpeg(["-f", "lavfi", "-i", "gradients=s=1024x1024:c0=0x0b3d91:c1=0x67dca5:c2=0xff7770:n=3:seed=21", "-frames:v", "1", file]),
  "portrait.png": (file) => ffmpeg(["-f", "lavfi", "-i", "mandelbrot=s=768x1024:maxiter=180", "-frames:v", "1", file]),
  "receipt.jpg": (file) => ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=900x1200", "-frames:v", "1", file]),
  "standup.wav": (file) => ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-ac", "1", "-ar", "16000", file]),
  "demo.mp4": (file) => ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=640x360:d=6", "-f", "lavfi", "-i", "sine=frequency=330:duration=6", "-shortest", "-pix_fmt", "yuv420p", file]),
  "report.pdf": async (file) => fs.writeFile(file, minimalPdf),
};

const transcriptSegments = [
  { start: 0, end: 4.2, text: "Good morning everyone, let's start with the release status." },
  { start: 4.2, end: 9.8, text: "The OCR migration is finished and the new layout export is ready for review." },
  { start: 9.8, end: 15.1, text: "Translation previews are faster after yesterday's fix." },
  { start: 15.1, end: 21.5, text: "Action item: Sara prepares the DGX memory report by Friday." },
];

const mindmap = {
  version: 1,
  title: "Attention Is All You Need",
  generatedAt: iso(30),
  root: {
    id: "node-1", label: "Transformer Architecture", note: "NIPS 2017 paper introducing pure attention models.",
    children: [
      { id: "node-2", label: "Attention Mechanisms", note: "Global dependency modelling without recurrence.", children: [
        { id: "node-3", label: "Scaled dot-product", children: [] },
        { id: "node-4", label: "Multi-head attention", children: [] },
      ] },
      { id: "node-5", label: "Training Strategy", note: "Optimization and regularization choices.", children: [
        { id: "node-6", label: "Adam Optimizer", note: "beta1=0.9, beta2=0.98, epsilon=1e-9", children: [] },
        { id: "node-7", label: "Regularization", note: "Residual dropout and label smoothing.", children: [] },
      ] },
      { id: "node-8", label: "Results", note: "State of the art BLEU on WMT 2014.", children: [] },
    ],
  },
};

const documentMd = `# Quarterly operations report

## Summary

Processing volume grew **38%** quarter over quarter while median turnaround fell to 4 minutes.

## Highlights

- OCR handled 12,480 pages with a 0.6% retry rate.
- Transcription covered 214 hours of audio.
- Translation previews now return in under one second.

## Throughput by service

| Service | Jobs | Median time |
| --- | ---: | ---: |
| OCR | 1,204 | 3m 10s |
| Transcription | 388 | 6m 42s |
| Translation | 951 | 0m 48s |

## Next steps

1. Move the image service to the switchable backend.
2. Publish the memory budget for the full six-model stack.
`;

const jobs = [
  { id: "dev-01-pdf-report", type: "pdf", title: "Quarterly operations report.pdf", minutesAgo: 9, input: "report.pdf", mime: "application/pdf",
    outputs: { "document.md": documentMd, "mindmap.json": JSON.stringify(mindmap, null, 2), "mindmap-outline.md": "# Attention Is All You Need\n\n- **Attention Mechanisms**\n- **Training Strategy**\n- **Results**\n" } },
  { id: "dev-02-standup", type: "audio", title: "Team standup.wav", minutesAgo: 35, input: "standup.wav", mime: "audio/wav",
    outputs: {
      "transcript.md": `# Team standup.wav\n\n${transcriptSegments.map((segment) => segment.text).join(" ")}\n`,
      "transcript.json": JSON.stringify({ text: transcriptSegments.map((segment) => segment.text).join(" "), segments: transcriptSegments }, null, 2),
      "transcript.srt": transcriptSegments.map((segment, index) => `${index + 1}\n00:00:${String(Math.floor(segment.start)).padStart(2, "0")},000 --> 00:00:${String(Math.floor(segment.end)).padStart(2, "0")},000\n${segment.text}\n`).join("\n"),
    } },
  { id: "dev-03-video", type: "audio", title: "Product demo.mp4", minutesAgo: 80, input: "demo.mp4", mime: "video/mp4",
    outputs: { "transcript.md": "# Product demo.mp4\n\nThis is the new SparklingKit workbench.\n", "transcript.json": JSON.stringify({ text: "This is the new SparklingKit workbench.", segments: [{ start: 0, end: 6, text: "This is the new SparklingKit workbench." }] }, null, 2) } },
  { id: "dev-04-garden", type: "text", moduleId: "text-to-image", workflowId: "text-to-image.default", title: "A quiet reading room at night, warm table lamps, rain on tall windows", minutesAgo: 120, prompt: true,
    copyOutputs: { "generated-image.png": "garden.png" } },
  { id: "dev-05-harbor", type: "text", moduleId: "text-to-image", workflowId: "text-to-image.default", title: "Neon harbor at dawn, long exposure, reflections", minutesAgo: 200, prompt: true,
    copyOutputs: { "generated-image.png": "harbor.png" } },
  { id: "dev-06-portrait", type: "text", moduleId: "text-to-image", workflowId: "text-to-image.default", title: "Fractal portrait of a lighthouse keeper", minutesAgo: 1500, prompt: true,
    copyOutputs: { "generated-image.png": "portrait.png" } },
  { id: "dev-07-receipt", type: "image", title: "receipt.jpg", minutesAgo: 1700, input: "receipt.jpg", mime: "image/jpeg",
    outputs: { "document.md": "# receipt.jpg\n\n**Total:** 42.80 EUR\n\n| Item | Price |\n| --- | ---: |\n| Coffee | 3.20 |\n| Notebook | 39.60 |\n" } },
  { id: "dev-08-grounding", type: "image", moduleId: "grounding", workflowId: "grounding.image", title: "harbor.png", minutesAgo: 2900, input: "harbor.png", mime: "image/png",
    groundingPreview: { source: "harbor.png", box: [120, 610, 300, 210] },
    outputs: { "grounding.annotations.json": JSON.stringify({ version: 1, imageWidth: 1024, imageHeight: 1024, results: [{ query: "boat", boxes: [{ x1: 120, y1: 610, x2: 420, y2: 820 }] }] }, null, 2) } },
  { id: "dev-09-uuid", type: "pdf", title: "74ff7b57-ef9e-48a7-b02d-5f3c0c1a2b3d.pdf", minutesAgo: 4400, input: "report.pdf", mime: "application/pdf",
    outputs: { "document.md": "# 74ff7b57-ef9e-48a7-b02d-5f3c0c1a2b3d.pdf\n\nInvoice 2026-0815 for consulting services.\n" } },
  { id: "dev-10-translation", type: "text", moduleId: "translation", workflowId: "translation.default", title: "Release notes → Italian", minutesAgo: 5000, textInput: "Release notes: faster previews and a new gallery.",
    outputs: { "translation.italian.md": "Note di rilascio: anteprime più veloci e una nuova galleria.\n" } },
  { id: "dev-11-running", type: "pdf", title: "Annual report 2025.pdf", minutesAgo: 2, input: "report.pdf", mime: "application/pdf", status: "processing", progress: 46, stage: "Reading documents", detail: "Annual report 2025.pdf", outputs: {} },
  { id: "dev-12-queued", type: "audio", title: "Board meeting.wav", minutesAgo: 1, input: "standup.wav", mime: "audio/wav", status: "queued", progress: 0, stage: "Waiting for a worker", outputs: {} },
];

async function main() {
  const mediaDir = path.join(dataDir, "tmp", "dev-media");
  await fs.mkdir(mediaDir, { recursive: true });
  for (const [name, make] of Object.entries(sources)) {
    const file = path.join(mediaDir, name);
    if (force || !(await fs.stat(file).catch(() => null))) await make(file);
  }
  for (const job of jobs) {
    const root = path.join(dataDir, "jobs", job.id);
    if (!force && await fs.stat(root).catch(() => null)) continue;
    await fs.rm(root, { recursive: true, force: true });
    for (const dir of ["input", "work", "output"]) await fs.mkdir(path.join(root, dir), { recursive: true });
    const inputs = [];
    if (job.input) {
      const storedName = `001-${path.parse(job.input).name}${path.extname(job.input)}`;
      await fs.copyFile(path.join(mediaDir, job.input), path.join(root, "input", storedName));
      inputs.push({ name: job.title, storedName, mimeType: job.mime, size: (await fs.stat(path.join(root, "input", storedName))).size });
    } else {
      const text = job.prompt ? job.title : job.textInput;
      await fs.writeFile(path.join(root, "input", job.prompt ? "prompt.txt" : "source.txt"), `${text}\n`);
      inputs.push({ name: job.prompt ? "Prompt.txt" : "Source.txt", storedName: job.prompt ? "prompt.txt" : "source.txt", mimeType: "text/plain", size: Buffer.byteLength(`${text}\n`) });
    }
    const outputFiles = [];
    for (const [name, content] of Object.entries(job.outputs || {})) {
      await fs.writeFile(path.join(root, "output", name), content);
      outputFiles.push(name);
    }
    if (job.groundingPreview) {
      const { source, box: [x, y, width, height] } = job.groundingPreview;
      const data = (await fs.readFile(path.join(mediaDir, source))).toString("base64");
      await fs.writeFile(path.join(root, "output", "grounding-preview.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><image href="data:image/png;base64,${data}" width="1024" height="1024"/><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="#67dca5" stroke-width="6" rx="6"/><text x="${x + 8}" y="${y - 12}" fill="#67dca5" font-family="sans-serif" font-size="28" font-weight="700">boat</text></svg>`);
      outputFiles.unshift("grounding-preview.svg");
    }
    for (const [name, mediaName] of Object.entries(job.copyOutputs || {})) {
      await fs.copyFile(path.join(mediaDir, mediaName), path.join(root, "output", name));
      outputFiles.push(name);
    }
    const status = job.status || "done";
    const manifest = {
      id: job.id,
      type: job.type,
      ...(job.moduleId ? { moduleId: job.moduleId, workflowId: job.workflowId } : {}),
      status,
      createdAt: iso(job.minutesAgo + 3),
      updatedAt: iso(job.minutesAgo),
      startedAt: iso(job.minutesAgo + 2),
      ...(status === "done" ? { completedAt: iso(job.minutesAgo) } : {}),
      title: job.title,
      progress: job.progress ?? 100,
      stage: job.stage || "Complete",
      ...(job.detail ? { detail: job.detail } : {}),
      inputs,
      outputFiles,
      warnings: [],
      params: job.prompt ? { prompt: job.title, size: "1024x1024" } : {},
    };
    if (job.id === "dev-01-pdf-report") {
      const run = (id, moduleId, workflowId, start, end, outputs) => ({ id, moduleId, workflowId, status: "done", progress: 100, stage: "Complete", createdAt: iso(start), updatedAt: iso(end), startedAt: iso(start), completedAt: iso(end), inputArtifactIds: [], outputArtifactIds: outputs, params: {}, steps: [], warnings: [] });
      manifest.runs = [run("run-ocr", "ocr", "ocr.pdf", job.minutesAgo + 3, job.minutesAgo + 1.4, []), run("run-map", "mindmap", "mindmap.default", job.minutesAgo + 0.9, job.minutesAgo, [])];
    }
    await fs.writeFile(path.join(root, "job.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const chatsDir = path.join(dataDir, "chats", "dev-chat-1");
  if (force || !(await fs.stat(chatsDir).catch(() => null))) {
    await fs.mkdir(chatsDir, { recursive: true });
    await fs.writeFile(path.join(chatsDir, "chat.json"), `${JSON.stringify({
      id: "dev-chat-1", title: "Summarize the operations report", createdAt: iso(40), updatedAt: iso(38), model: "qwen36-35b-a3b-nvfp4", temperature: 0.7,
      linkedJobId: "dev-01-pdf-report",
      messages: [
        { id: "m1", role: "user", content: "What changed this quarter?", createdAt: iso(39) },
        { id: "m2", role: "assistant", content: "Volume grew **38%** and median turnaround dropped to 4 minutes.", createdAt: iso(38) },
      ],
    }, null, 2)}\n`);
  }
  console.log(`Seeded ${jobs.length} jobs into ${path.join(dataDir, "jobs")}`);
}

await main();
