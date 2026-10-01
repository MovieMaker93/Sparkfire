import { describe, expect, it } from "vitest";
import { galleryItems, thumbnailSource, thumbnailWidth } from "./thumbnails.js";
import type { Artifact, JobManifest } from "./models.js";

const artifact = (overrides: Partial<Artifact>): Artifact => ({
  id: "a", name: "image.png", path: "output/image.png", kind: "generated-image", mimeType: "image/png",
  role: "primary", createdAt: "2026-09-30T10:00:00.000Z", derivedFrom: [], metadata: {}, ...overrides,
});

const job = (id: string, artifacts: Artifact[], overrides: Partial<JobManifest> = {}): JobManifest => ({
  schemaVersion: 2, id, type: "text", moduleId: "text-to-image", workflowId: "text-to-image.default", status: "done",
  createdAt: "2026-09-30T09:00:00.000Z", updatedAt: "2026-09-30T10:00:00.000Z", title: id, progress: 100, stage: "Complete",
  inputs: [], outputFiles: [], artifacts, runs: [], warnings: [], params: {}, ...overrides,
} as JobManifest);

describe("thumbnails", () => {
  it("snaps widths to the cached sizes", () => {
    expect(thumbnailWidth(undefined)).toBe(320);
    expect(thumbnailWidth("100")).toBe(160);
    expect(thumbnailWidth(500)).toBe(640);
    expect(thumbnailWidth(5000)).toBe(640);
  });

  it("previews rasters, videos and PDFs but not SVG or audio", () => {
    expect(thumbnailSource(artifact({}))).toBe("image");
    expect(thumbnailSource(artifact({ name: "clip.mp4", path: "input/001-clip.mp4", kind: "source-video", mimeType: "video/mp4" }))).toBe("video");
    expect(thumbnailSource(artifact({ name: "a.pdf", path: "input/001-a.pdf", kind: "source-pdf", mimeType: "application/pdf" }))).toBe("pdf");
    expect(thumbnailSource(artifact({ name: "grounding-preview.svg", path: "output/grounding-preview.svg", kind: "grounded-image", mimeType: "image/svg+xml" }))).toBeUndefined();
    expect(thumbnailSource(artifact({ name: "a.wav", path: "input/001-a.wav", kind: "source-audio", mimeType: "audio/wav" }))).toBeUndefined();
  });
});

describe("gallery", () => {
  const generated = job("gen", [artifact({ id: "g1", createdAt: "2026-09-30T12:00:00.000Z", metadata: { model: "Qwen-Image-2.1", seed: 7 } })], { params: { prompt: "neon harbor", size: "1024x1024" } });
  const uploaded = job("ocr", [artifact({ id: "s1", role: "source", kind: "source-image", path: "input/001-scan.jpg", name: "scan.jpg", mimeType: "image/jpeg", createdAt: "2026-09-30T11:00:00.000Z" })], { type: "image", moduleId: "ocr", workflowId: "ocr.images", params: { prompt: "ignored" } });
  const vector = job("svg", [artifact({ id: "v1", kind: "grounded-image", path: "output/grounding-preview.svg", name: "grounding-preview.svg", mimeType: "image/svg+xml" })]);

  it("lists raster images newest first with generation details", () => {
    const items = galleryItems([uploaded, vector, generated]);
    expect(items.map((item) => item.artifactId)).toEqual(["g1", "s1"]);
    expect(items[0]).toMatchObject({ prompt: "neon harbor", model: "Qwen-Image-2.1", seed: 7, size: "1024x1024" });
    expect(items[1].prompt).toBeUndefined();
  });

  it("filters by source and model", () => {
    expect(galleryItems([uploaded, generated], { source: "uploaded" }).map((item) => item.artifactId)).toEqual(["s1"]);
    expect(galleryItems([uploaded, generated], { source: "generated" }).map((item) => item.artifactId)).toEqual(["g1"]);
    expect(galleryItems([uploaded, generated], { model: "Z-Image-Turbo" })).toEqual([]);
  });
});
