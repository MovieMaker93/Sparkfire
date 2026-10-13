import { describe, expect, it } from "vitest";
import { userFileHeaders } from "./user-files.js";

describe("userFileHeaders", () => {
  it("serves documents as plain text with a sandbox, so uploaded HTML or SVG never runs on the app's origin", () => {
    expect(userFileHeaders("text/html")).toEqual({
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    });
    expect(userFileHeaders("image/svg+xml")).toEqual({
      "Content-Type": "image/svg+xml",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    });
  });

  it("lets media keep its type and still sandboxes it", () => {
    for (const mimeType of ["video/mp4", "audio/flac", "image/png"]) {
      expect(userFileHeaders(mimeType), mimeType).toEqual({
        "Content-Type": mimeType,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      });
    }
  });

  it("leaves the CSP off a PDF, whose sandboxed viewer would not display in Chromium", () => {
    expect(userFileHeaders("application/pdf")).toEqual({
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
    });
  });

  it("falls back to plain text for unknown types", () => {
    expect(userFileHeaders("application/octet-stream")["Content-Type"]).toBe("text/plain; charset=utf-8");
  });
});
