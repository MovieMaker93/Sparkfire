import { describe, expect, it } from "vitest";
import { compatibleModuleContracts, getModuleContract, MODULE_CONTRACTS, moduleHandoffUrl, moduleWorkflowForArtifact, nextModuleActions } from "./module-router.js";

describe("module artifact router", () => {
  it("hides grounding, which the stack does not ship, and opt-in music until they are configured", () => {
    expect(MODULE_CONTRACTS.filter((contract) => contract.hiddenUntilConfigured).map((contract) => contract.id)).toEqual(["grounding", "text-to-music"]);
  });

  it("puts video and music generation, which load tens of GiB per job, in the heavy GPU lane", () => {
    expect(MODULE_CONTRACTS.filter((contract) => contract.gpuLane === "heavy").map((contract) => contract.id)).toEqual(["text-to-video", "text-to-music"]);
  });

  it("sings text as lyrics and a score as written, and offers a score to nothing else", () => {
    expect(moduleWorkflowForArtifact("text-to-music", "translation")).toBe("text-to-music.default");
    expect(moduleWorkflowForArtifact("text-to-music", "score")).toBe("text-to-music.default");
    expect(compatibleModuleContracts("score", "text-to-music").map((contract) => contract.id)).toEqual(["text-to-music"]);
    expect(compatibleModuleContracts("generated-audio", "text-to-music").map((contract) => contract.id)).toEqual([]);
  });

  it("routes generated images into every compatible image workflow", () => {
    expect(compatibleModuleContracts("generated-image", "text-to-image").map((contract) => contract.id)).toEqual(["ocr", "grounding", "text-to-video"]);
    expect(compatibleModuleContracts("generated-image", "text-to-image", ["text", "image"]).map((contract) => contract.id)).toEqual(["ocr", "grounding", "text-to-video", "mindmap", "chat"]);
    expect(moduleWorkflowForArtifact("ocr", "generated-image")).toBe("ocr.images");
    expect(moduleWorkflowForArtifact("grounding", "generated-image")).toBe("grounding.image");
  });

  it("routes text results into translation, image generation, mind maps, and chat", () => {
    expect(compatibleModuleContracts("document", "ocr").map((contract) => contract.id)).toEqual(["translation", "text-to-image", "text-to-video", "text-to-music", "mindmap", "chat"]);
    expect(moduleWorkflowForArtifact("translation", "document")).toBe("translation.default");
    expect(moduleWorkflowForArtifact("text-to-image", "document")).toBe("text-to-image.default");
    expect(moduleWorkflowForArtifact("mindmap", "document")).toBe("mindmap.default");
  });

  it("derives outgoing actions and handoff URLs from the same contract", () => {
    const ocr = getModuleContract("ocr")!;
    expect(nextModuleActions(ocr).map((action) => action.id)).toEqual(["translation", "text-to-image", "text-to-video", "text-to-music", "mindmap", "chat"]);
    const imageGenerator = getModuleContract("text-to-image")!;
    expect(nextModuleActions(imageGenerator, ["text", "image"]).map((action) => action.id)).toEqual(["ocr", "grounding", "text-to-video", "mindmap", "chat"]);
    expect(moduleHandoffUrl("grounding", "job 1", "artifact/1")).toBe("/tools/grounding?job=job+1&artifact=artifact%2F1");
  });

  it("takes text as a video prompt and an image as its first frame, through one workflow", () => {
    expect(moduleWorkflowForArtifact("text-to-video", "document")).toBe("text-to-video.default");
    expect(moduleWorkflowForArtifact("text-to-video", "generated-image")).toBe("text-to-video.default");
    expect(moduleWorkflowForArtifact("text-to-video", "source-audio")).toBeUndefined();
    expect(getModuleContract("text-to-video")).toMatchObject({ providerKind: "video-generation", produces: ["generated-video"], handoff: { maxInputs: 1 } });
    // A generated video is a final result: nothing consumes it yet.
    expect(compatibleModuleContracts("generated-video")).toEqual([]);
  });
});
