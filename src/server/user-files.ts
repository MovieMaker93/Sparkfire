import type { Response } from "express";

/** Headers for a user's file: only media and PDFs keep their type, so an uploaded HTML or SVG never runs on the app's origin. */
export function userFileHeaders(mimeType: string): Record<string, string> {
  const renderable = /^(image|audio|video)\//.test(mimeType) || mimeType === "application/pdf";
  return {
    "Content-Type": renderable ? mimeType : "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    // Chromium will not show a PDF inside a sandboxed document; its viewer runs no page script.
    ...(mimeType === "application/pdf" ? {} : { "Content-Security-Policy": "sandbox" }),
  };
}

export function sendUserFile(response: Response, file: string, mimeType: string, inlineName?: string) {
  response.set(userFileHeaders(mimeType));
  if (inlineName) response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(inlineName)}`);
  response.sendFile(file);
}
