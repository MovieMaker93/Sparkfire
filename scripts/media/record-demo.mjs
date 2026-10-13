// Records the README demo clips and stills against a running Sparkfire with real models.
//
//   node record-demo.mjs [scene ...]     (BASE_URL, ASSETS, JOBS and OUT override the defaults below)
//
// Each clip is its own browser session, saved as Chromium's own screencast frames with their times
// (<clip>/frames.json); make-media.mjs turns them into video. Moments spent waiting for a model are logged in
// <clip>.events.json, and make-media.mjs fast-forwards them. Stills are single screenshots (<still>.png) for the
// README sections without a clip. Run it against a demo copy of the app with demo data only (see
// scripts/media/README.md): everything on screen ends up in the README.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:54400";
const OUT = process.env.OUT || "work/out";
const ASSETS = process.env.ASSETS || "work";
const jobs = JSON.parse(await readFile(process.env.JOBS || path.join(ASSETS, "jobs.json"), "utf8"));
const VIEWPORT = { width: 1440, height: 900 };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TRANSLATE_TEXT = "The Harbor Point feasibility study recommends a phased approach. The first phase turns the old ferry terminal into a public market that opens in spring 2028; the second adds forty affordable homes and a seawall that protects the waterfront from storm surges.";

// Headless recordings show no pointer, so draw one that follows the mouse and pulses on click.
const CURSOR = `
  addEventListener("DOMContentLoaded", () => {
    const dot = document.createElement("div");
    dot.style.cssText = "position:fixed;left:0;top:0;width:22px;height:22px;margin:-3px 0 0 -3px;z-index:2147483647;pointer-events:none;transition:transform .12s";
    dot.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2l15 10.5-6.6 1.3L16 21l-3 1.4-3.6-7.2L4 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(dot);
    addEventListener("mousemove", (e) => { dot.style.left = e.clientX + "px"; dot.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", () => { dot.style.transform = "scale(.8)"; }, true);
    addEventListener("mouseup", () => { dot.style.transform = "scale(1)"; }, true);
  });`;

const browser = await chromium.launch();
// The screencast sends frames at CSS size unless Chromium itself renders at 2x, whatever the context's
// deviceScaleFactor says, so the clips get their own browser launched with the flag (and the context set to match).
const CLIP_SCALE = 2;
const clipBrowser = await chromium.launch({ args: [`--force-device-scale-factor=${CLIP_SCALE}`] });
await mkdir(OUT, { recursive: true });

async function clip(name, scene) {
  const context = await clipBrowser.newContext({ viewport: VIEWPORT, colorScheme: "dark", deviceScaleFactor: CLIP_SCALE });
  await context.addInitScript(CURSOR);
  const page = await context.newPage();
  const dir = path.join(OUT, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const started = Date.now();
  const events = [];
  const mark = (label) => events.push({ label, t: (Date.now() - started) / 1000 });
  // Playwright's recordVideo squeezes the same frames into about 1 Mbit/s of VP8, which blurs text, so keep
  // the frames themselves. Chromium sends one whenever the page repaints; each lasts until the next.
  const frames = [];
  const writes = [];
  const cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = `${String(frames.length).padStart(6, "0")}.jpg`;
    frames.push({ file, t: (metadata.timestamp ?? Date.now() / 1000) - started / 1000 });
    writes.push(writeFile(path.join(dir, file), Buffer.from(data, "base64")));
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: VIEWPORT.width * CLIP_SCALE, maxHeight: VIEWPORT.height * CLIP_SCALE });
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  try {
    await scene(page, mark);
  } finally {
    const end = (Date.now() - started) / 1000;
    await cdp.send("Page.stopScreencast").catch(() => {});
    await Promise.all(writes);
    await context.close();
    await writeFile(path.join(dir, "frames.json"), JSON.stringify({ end, frames }));
    await writeFile(path.join(OUT, `${name}.events.json`), JSON.stringify(events, null, 1));
    console.log(`recorded ${name} (${end.toFixed(1)} s, ${frames.length} frames)`);
  }
}

async function glide(page, locator, { click = true } = {}) {
  await locator.waitFor({ state: "visible" });
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 24 });
  await pause(250);
  if (click) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function scroll(page, total, steps = 18) {
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, total / steps);
    await pause(45);
  }
}

async function api(route, body) {
  const response = await fetch(`${BASE_URL}/api${route}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  return response.json();
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

// Stills are single screenshots for the README, each in its own browser session without a screencast.
const STILL_CONTEXTS = {
  phone: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  monitor: { deviceScaleFactor: 2 },
  // The graphs fit four nodes into the canvas at about half size; at 2x their labels stay legible full size.
  "workflow-editor": { deviceScaleFactor: 2 },
  "workflow-run": { deviceScaleFactor: 2 },
};

async function still(name, scene) {
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: "dark", ...STILL_CONTEXTS[name] });
  const page = await context.newPage();
  try {
    await scene(page);
    console.log(`captured ${name}`);
  } finally {
    await context.close();
  }
}

const clips = {
  // The home screen while real jobs run: the Running now strip with images and a video, recent work, the services chip.
  async workbench(page) {
    for (const prompt of ["Watercolor map of a coastal town with a harbor and a lighthouse", "A minimalist poster of a wind turbine at sunrise, flat colors"]) {
      await api("/modules/text-to-image/jobs", { prompt, size: "1024x1024" });
    }
    const video = new FormData();
    video.set("prompt", "Stop-motion animation of a clay snail crossing a mossy log, soft studio light");
    video.set("sound", "gentle forest ambience, a soft wooden xylophone");
    await fetch(`${BASE_URL}/api/modules/text-to-video/jobs`, { method: "POST", body: video });
    await page.goto(`${BASE_URL}/`);
    await page.getByLabel("Running now").waitFor();
    await pause(2500);
    await shot(page, "workbench");
    await scroll(page, 900);
    await pause(2200);
    await scroll(page, -900);
    await pause(1500);
  },

  // OCR result: the recognised document with its outline, then the Markdown source.
  async ocr(page) {
    await page.goto(`${BASE_URL}/jobs/${jobs.ocr}`);
    const outline = page.getByLabel("Document outline");
    await outline.waitFor();
    await pause(2000);
    await shot(page, "ocr");
    await glide(page, outline.getByText("4. Costs and schedule"));
    await pause(2200);
    await glide(page, outline.getByText("5. Risks"));
    await pause(2000);
    await glide(page, page.getByRole("button", { name: "Source", exact: true }));
    await pause(2200);
    await glide(page, page.getByRole("button", { name: "Preview", exact: true }));
    await pause(1500);
  },

  // Transcript: timed lines that jump the player to that moment.
  async transcript(page) {
    await page.goto(`${BASE_URL}/jobs/${jobs.asr}`);
    const lines = page.locator(".transcript-timeline li button");
    await lines.first().waitFor();
    await pause(1800);
    await shot(page, "transcript");
    const count = await lines.count();
    for (const index of [count - 1, 0, count - 1]) {
      await glide(page, lines.nth(index));
      await pause(2200);
    }
  },

  // Text to image on Qwen-Image-2.1-Turbo, then the gallery's side-by-side compare.
  async image(page, mark) {
    await page.goto(`${BASE_URL}/tools/text-to-image`);
    const prompt = page.locator(".image-prompt-input");
    await glide(page, prompt);
    await prompt.pressSequentially("A lighthouse on a rocky island under the northern lights, long exposure photo", { delay: 28 });
    await pause(500);
    // Generating opens the job page, which shows live progress and then the image.
    await glide(page, page.getByRole("button", { name: "Generate image" }));
    await page.waitForURL(/\/jobs\//, { timeout: 60_000 });
    await pause(2500);
    mark("wait-start");
    await page.locator(".status-badge.status-done").first().waitFor({ timeout: 300_000 });
    mark("wait-end");
    await page.getByLabel("Image view").waitFor();
    await pause(2800);
    await shot(page, "image");
    await glide(page, page.getByRole("link", { name: "Gallery" }));
    await page.locator(".gallery-grid figure").first().waitFor();
    await pause(1800);
    await shot(page, "gallery");
    await glide(page, page.getByRole("button", { name: "Compare" }));
    const picks = page.locator(".gallery-card:not(:has(.gallery-video-badge))").getByRole("button", { name: /^Pick / });
    await glide(page, picks.nth(0));
    await pause(600);
    await glide(page, picks.nth(2));
    await pause(3500);
  },

  // Text to video on FastH3: a prompt and its sound, a turn in the GPU lane behind a video already rendering,
  // the progress view, then the finished clip playing.
  async video(page, mark) {
    const first = new FormData();
    first.set("prompt", "Stop-motion animation of a clay fox curling up under a paper moon, soft studio light");
    first.set("sound", "a quiet music box, soft crackle of paper");
    await fetch(`${BASE_URL}/api/modules/text-to-video/jobs`, { method: "POST", body: first });
    await page.goto(`${BASE_URL}/tools/text-to-video`);
    const prompt = page.locator(".video-generation-form .image-prompt-input");
    await glide(page, prompt);
    await prompt.pressSequentially("A small paper boat drifting down a rain-soaked street gutter at night, close-up, neon reflections on the water", { delay: 28 });
    const sound = page.getByLabel("Sound");
    await glide(page, sound);
    await sound.pressSequentially("steady rain, trickling water, distant traffic", { delay: 28 });
    await pause(600);
    await glide(page, page.getByRole("button", { name: "Generate video" }));
    await page.waitForURL(/\/jobs\//, { timeout: 60_000 });
    // The first video still holds the GPU, so this one waits its turn instead of loading beside it.
    await page.getByText("Waiting for the GPU").first().waitFor({ timeout: 60_000 });
    mark("lane-wait");
    await pause(4000);
    await shot(page, "video-waiting");
    mark("wait-start");
    await page.locator(".status-badge.status-done").first().waitFor({ timeout: 900_000 });
    mark("wait-end");
    const player = page.locator("video").first();
    await player.waitFor();
    await player.evaluate((element) => { element.muted = true; return element.play(); });
    await pause(5500);
    await shot(page, "video");
    await pause(1500);
  },

  // Web search in chat: turn Web on, ask something current, watch the searches, then the cited answer.
  async websearch(page, mark) {
    await page.goto(`${BASE_URL}/chat`);
    await glide(page, page.getByRole("radiogroup", { name: "Thinking effort" }).getByRole("radio", { name: "Low" }));
    await pause(300);
    await glide(page, page.getByRole("radiogroup", { name: "Web search" }).getByRole("radio", { name: "On" }));
    await pause(500);
    const box = page.getByPlaceholder("Message your local model…");
    await glide(page, box);
    await box.pressSequentially("What is the latest Node.js LTS release, and until when is it supported?", { delay: 24 });
    await pause(400);
    await page.keyboard.press("Enter");
    mark("wait-start");
    await page.locator(".message-activity-steps li").first().waitFor({ timeout: 300_000 });
    await page.locator(".message-row:not(.message-user) .message-content").first().waitFor({ timeout: 600_000 });
    mark("wait-end");
    mark("stream-start");
    await page.locator(".message-row:not(.message-user) .message-actions").last().waitFor({ timeout: 600_000 });
    mark("stream-end");
    await pause(1500);
    await glide(page, page.locator(".message-activity summary").last());
    await pause(1200);
    await scroll(page, 500, 10);
    await pause(2500);
    await shot(page, "websearch");
  },

  // Chat: attach the report with the + button, choose a thinking level, watch the reasoning and the answer.
  async chat(page, mark) {
    await page.goto(`${BASE_URL}/chat`);
    await glide(page, page.getByRole("radio", { name: "Low" }));
    await pause(400);
    await glide(page, page.getByLabel("Attach files"), { click: false });
    await page.locator(".chat-composer input[type=file]").setInputFiles(path.join(ASSETS, "harbor-point-feasibility.pdf"));
    await page.locator(".composer-attachments .attachment-chip").first().waitFor();
    await pause(800);
    const box = page.getByPlaceholder("Message your local model…");
    await glide(page, box);
    await box.pressSequentially("What are the three biggest risks, and what does the brief recommend?", { delay: 24 });
    await pause(400);
    await page.keyboard.press("Enter");
    mark("wait-start");
    await page.locator(".message-reasoning, .message-row:not(.message-user) .message-content").first().waitFor({ timeout: 300_000 });
    mark("wait-end");
    mark("stream-start");
    await page.locator(".message-row:not(.message-user) .message-actions").last().waitFor({ timeout: 300_000 });
    mark("stream-end");
    await pause(1500);
    await scroll(page, 600, 10);
    await pause(1500);
    await shot(page, "chat");
    await glide(page, page.locator(".message-reasoning summary").last());
    await pause(2500);
  },

  // Mind map: fold and unfold branches of the map built from the report.
  async mindmap(page) {
    await page.goto(`${BASE_URL}/jobs/${jobs.mindmap}`);
    const collapse = page.getByRole("button", { name: /^Collapse / });
    await collapse.first().waitFor();
    await pause(2200);
    await shot(page, "mindmap");
    await glide(page, collapse.nth(1));
    await pause(1200);
    await glide(page, page.getByRole("button", { name: /^Expand / }).first());
    await pause(2000);
  },

  // Appearance: dark, light and back, previewed live from Settings.
  async theme(page) {
    await page.goto(`${BASE_URL}/settings`);
    const light = page.getByRole("radio", { name: "Light" });
    await light.waitFor();
    await pause(1200);
    await glide(page, light);
    await pause(2500);
    await shot(page, "settings-light");
    await glide(page, page.getByRole("radio", { name: "Dark" }));
    await pause(1800);
  },
};

const outputItem = (page, name) => page.locator(".file-tree-item").filter({ has: page.locator("strong", { hasText: name }) });

const stills = {
  // Text translation into Italian, with the live preview filled in.
  async translate(page) {
    await page.goto(`${BASE_URL}/tools/translation`);
    await page.getByRole("combobox", { name: "To language" }).click();
    await page.getByLabel("Search languages").fill("Italian");
    await page.getByRole("option", { name: /^Italian/ }).click();
    await page.getByPlaceholder("Enter text").fill(TRANSLATE_TEXT);
    await page.waitForFunction(() => {
      const out = document.querySelector(".translation-pane.output textarea");
      return out instanceof HTMLTextAreaElement && out.value.trim().length > 0 && out.getAttribute("aria-busy") === "false";
    }, null, { timeout: 120_000 });
    // Filling leaves the source scrolled to its end; show both texts from their first line.
    await page.locator(".translation-pane textarea").evaluateAll((areas) => areas.forEach((area) => { area.blur(); area.scrollTop = 0; }));
    await pause(800);
    await shot(page, "translate");
  },

  // The finished song: its player, the files it came with and the license line.
  async song(page) {
    await page.goto(`${BASE_URL}/jobs/${jobs.song}`);
    await glide(page, outputItem(page, /^Song$/));
    await page.locator(".source-media-preview audio").first().waitFor();
    await page.locator(".generated-disclosure").first().waitFor();
    await pause(1200);
    await shot(page, "song");
  },

  // The Executive summary preset's result on the OCR job.
  async preset(page) {
    await page.goto(`${BASE_URL}/jobs/${jobs.ocr}`);
    await glide(page, outputItem(page, /^Executive Summary$/));
    await page.locator(".preview-content :is(h1, h2, p)").first().waitFor();
    await pause(1200);
    await shot(page, "preset");
  },

  // The demo workflow in the node editor, fitted to the canvas.
  async "workflow-editor"(page) {
    await page.goto(`${BASE_URL}/workflows/${jobs.workflow}`);
    await page.locator(".workflow-canvas .workflow-node").nth(3).waitFor();
    await page.locator(".workflow-canvas .react-flow__controls-fitview").click();
    await pause(1000);
    await shot(page, "workflow-editor");
  },

  // The finished workflow run on its job page, every node done.
  async "workflow-run"(page) {
    await page.goto(`${BASE_URL}/jobs/${jobs.workflowRun}`);
    await page.locator(".job-workflow-record").click();
    await page.locator(".workflow-status-graph .workflow-status-node").nth(3).waitFor();
    await pause(1200);
    await shot(page, "workflow-run");
  },

  // The sidebar's Spark monitor opened, above the services chip.
  async monitor(page) {
    await page.goto(`${BASE_URL}/`);
    await page.locator(".spark-monitor-summary").click();
    await page.locator(".spark-monitor-details").waitFor();
    await pause(800);
    await page.locator(".sidebar-status").screenshot({ path: path.join(OUT, "monitor.png") });
  },

  // The deployment setup page. Nothing is clicked: verifying would probe the stack from the demo copy.
  async setup(page) {
    await page.goto(`${BASE_URL}/setup`);
    await page.getByRole("heading", { name: "Connect your AI services" }).waitFor();
    await pause(1000);
    await shot(page, "setup");
  },

  // The Workbench on a phone, with the tab bar.
  async phone(page) {
    await page.goto(`${BASE_URL}/`);
    await page.getByRole("navigation", { name: "Primary navigation" }).waitFor();
    await pause(2500);
    await shot(page, "phone");
  },
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : [...Object.keys(clips), ...Object.keys(stills)];
for (const name of wanted) {
  try {
    if (clips[name]) await clip(name, clips[name]);
    else if (stills[name]) await still(name, stills[name]);
    else console.error(`unknown scene ${name}`);
  } catch (error) {
    console.error(`${clips[name] ? "clip" : "still"} ${name} failed: ${error.message.split("\n")[0]}`);
  }
}
await Promise.all([browser.close(), clipBrowser.close()]);
