import { describe, expect, it } from "vitest";
import { displayTitle, jobLabel, progressTone } from "./ui";

const job = (title: string, overrides: Partial<Parameters<typeof displayTitle>[0]> = {}) => ({
  title,
  type: "pdf" as const,
  moduleId: "ocr" as const,
  workflowId: "ocr.pdf",
  createdAt: "2026-09-30T08:15:00.000Z",
  ...overrides,
});

describe("job labels", () => {
  it("names the producing module", () => {
    expect(jobLabel(job("a.pdf"))).toBe("PDF OCR");
    expect(jobLabel(job("a", { moduleId: "mindmap", type: "text" }))).toBe("Mind map");
    expect(jobLabel(job("a", { workflowId: "flow:abc" }))).toBe("Workflow");
  });
});

describe("displayTitle", () => {
  it("keeps human titles", () => {
    expect(displayTitle(job("Quarterly report.pdf"))).toBe("Quarterly report.pdf");
    expect(displayTitle(job("A quiet reading room at night"))).toBe("A quiet reading room at night");
  });

  it("replaces UUID and hash-like upload names", () => {
    expect(displayTitle(job("74ff7b57-ef9e-48a7-b02d-5f3c0c1a2b3d.pdf"))).toMatch(/^PDF OCR · /);
    expect(displayTitle(job("3f9a0c1e7b2d4a6f8e0c1b2a3d4e5f60.png", { type: "image" }))).toMatch(/^Image OCR · /);
  });
});

describe("progress tone", () => {
  it("moves only while a worker is on the job", () => {
    for (const status of ["preparing", "processing", "merging"] as const) expect(progressTone(status)).toBe("active");
    for (const status of ["queued", "done", "done_with_warnings", "cancelled"] as const) expect(progressTone(status)).toBeUndefined();
  });

  it("marks failed jobs", () => {
    expect(progressTone("failed")).toBe("failed");
  });
});
