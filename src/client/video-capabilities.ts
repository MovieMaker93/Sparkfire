import { useEffect, useState } from "react";
import { api } from "./api";
import type { ImageSizeOption } from "./image-capabilities";

export interface VideoVariantOption { id: string; label: string; description: string }

export interface VideoCapabilities {
  model?: string;
  sizes: ImageSizeOption[];
  durations: number[];
  variants: VideoVariantOption[];
  defaultVariant?: string;
  firstFrame: boolean;
  disclosure?: string;
  reported: boolean;
}

export const defaultVideoCapabilities: VideoCapabilities = {
  sizes: [{ value: "864x480", label: "480p", ratio: "16:9", quality: "standard" }],
  durations: [5],
  variants: [],
  firstFrame: false,
  reported: false,
};

/** What the configured video server can make: sizes, clip lengths, quality variants and whether it takes a first frame. */
export function useVideoCapabilities() {
  const [capabilities, setCapabilities] = useState(defaultVideoCapabilities);
  useEffect(() => {
    let active = true;
    api.videoCapabilities().then((value) => active && setCapabilities(value)).catch(() => undefined);
    return () => { active = false; };
  }, []);
  return capabilities;
}

/** The prompt that made an image, when the image came from a generation run: the natural start for animating it. */
export function promptBehindArtifact(job: { runs: Array<{ id: string; params: Record<string, unknown> }> }, artifact: { createdByRunId?: string }) {
  const run = artifact.createdByRunId ? job.runs.find((candidate) => candidate.id === artifact.createdByRunId) : undefined;
  return typeof run?.params.prompt === "string" ? run.params.prompt.trim() : "";
}
