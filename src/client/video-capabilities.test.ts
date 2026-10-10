import { describe, expect, it } from "vitest";
import { previewArtifact } from "./components/ui";
import { promptBehindArtifact } from "./video-capabilities";

describe("video handoff", () => {
  const job = { runs: [{ id: "run-image", params: { prompt: "  Neon harbor at dawn  " } }, { id: "run-ocr", params: {} }] };

  it("starts an image's video from the prompt that made the image", () => {
    expect(promptBehindArtifact(job, { createdByRunId: "run-image" })).toBe("Neon harbor at dawn");
    expect(promptBehindArtifact(job, { createdByRunId: "run-ocr" })).toBe("");
    expect(promptBehindArtifact(job, {})).toBe("");
  });

  it("shows a generated video as a job's preview when it has no generated image", () => {
    const artifact = (id: string, kind: string, path: string) => ({ id, kind, path }) as never;
    expect(previewArtifact({ artifacts: [artifact("p", "text", "input/prompt.txt"), artifact("v", "generated-video", "output/generated-video.mp4")] })).toMatchObject({ id: "v" });
    expect(previewArtifact({ artifacts: [artifact("v", "generated-video", "output/generated-video.mp4"), artifact("i", "generated-image", "output/generated-image.png")] })).toMatchObject({ id: "i" });
  });
});
