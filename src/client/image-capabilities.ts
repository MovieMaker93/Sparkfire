import { useEffect, useState } from "react";
import { api } from "./api";

export interface ImageSizeOption { value: string; label: string; ratio: string; quality: "standard" | "high" }

export interface ImageCapabilities {
  model?: string;
  sizes: ImageSizeOption[];
  defaultSteps?: number;
  maxSteps?: number;
  reported: boolean;
}

export const defaultImageCapabilities: ImageCapabilities = {
  sizes: [
    { value: "1024x1024", label: "Square", ratio: "1:1", quality: "standard" },
    { value: "1536x1024", label: "Landscape", ratio: "3:2", quality: "standard" },
    { value: "1024x1536", label: "Portrait", ratio: "2:3", quality: "standard" },
  ],
  reported: false,
};

/** What the configured image server can generate: sizes per quality, step limits and the model name. */
export function useImageCapabilities() {
  const [capabilities, setCapabilities] = useState(defaultImageCapabilities);
  useEffect(() => {
    let active = true;
    api.imageCapabilities().then((value) => active && setCapabilities(value)).catch(() => undefined);
    return () => { active = false; };
  }, []);
  return capabilities;
}

/** Keeps the chosen aspect ratio when switching between standard and high quality. */
export function sizeForQuality(sizes: ImageSizeOption[], current: string, quality: ImageSizeOption["quality"]) {
  const ratio = sizes.find((size) => size.value === current)?.ratio;
  const candidates = sizes.filter((size) => size.quality === quality);
  return (candidates.find((size) => size.ratio === ratio) || candidates[0])?.value || current;
}
