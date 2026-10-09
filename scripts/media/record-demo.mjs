// Records the README demo clips and screenshots against a running SparklingKit with real models.
//
//   node record-demo.mjs [clip ...]      (BASE_URL, ASSETS, JOBS and OUT override the defaults below)
//
// Each clip is its own browser session, so it becomes its own video (<clip>.webm). Moments spent waiting for
// a model are logged in <clip>.events.json; make-media.mjs fast-forwards them. Run it against a demo copy of
// the app with demo data only (see scripts/media/README.md): everything on screen ends up in the README.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:54400";
const OUT = process.env.OUT || "work/out";
const ASSETS = process.env.ASSETS || "work";
const jobs = JSON.parse(await readFile(process.env.JOBS || path.join(ASSETS, "jobs.json"), "utf8"));
const VIEWPORT = { width: 1440, height: 900 };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
await mkdir(OUT, { recursive: true });

async function clip(name, scene) {
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: "dark", recordVideo: { dir: OUT, size: VIEWPORT } });
  await context.addInitScript(CURSOR);
  const page = await context.newPage();
  const started = Date.now();
  const events = [];
  const mark = (label) => events.push({ label, t: (Date.now() - started) / 1000 });
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  try {
    await scene(page, mark);
  } finally {
    const video = page.video();
    await context.close();
    await rename(await video.path(), path.join(OUT, `${name}.webm`));
    await writeFile(path.join(OUT, `${name}.events.json`), JSON.stringify(events, null, 1));
    console.log(`recorded ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
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

const clips = {
  // The home screen while real jobs run: the Running now strip, recent work with thumbnails, the services chip.
  async workbench(page) {
    for (const prompt of ["Watercolor map of a coastal town with a harbor and a lighthouse", "A minimalist poster of a wind turbine at sunrise, flat colors"]) {
      await api("/modules/text-to-image/jobs", { prompt, size: "1024x1024" });
    }
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
    const picks = page.getByRole("button", { name: /^Pick / });
    await glide(page, picks.nth(0));
    await pause(600);
    await glide(page, picks.nth(2));
    await pause(3500);
  },

  // Grounding: drag the before/after slider over the boxes the model found.
  async grounding(page) {
    await page.goto(`${BASE_URL}/jobs/${jobs.grounding}`);
    await page.getByLabel("Image view").waitFor();
    await pause(1800);
    await glide(page, page.getByRole("button", { name: "Compare", exact: true }));
    const slider = page.getByLabel("Comparison position");
    await slider.waitFor();
    await pause(800);
    const box = await slider.boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.5, y, { steps: 10 });
    await page.mouse.down();
    for (const at of [0.15, 0.85, 0.5]) {
      await page.mouse.move(box.x + box.width * at, y, { steps: 30 });
      await pause(500);
    }
    await page.mouse.up();
    await shot(page, "grounding");
    await pause(1500);
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

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(clips);
for (const name of wanted) {
  try {
    await clip(name, clips[name]);
  } catch (error) {
    console.error(`clip ${name} failed: ${error.message.split("\n")[0]}`);
  }
}
await browser.close();
