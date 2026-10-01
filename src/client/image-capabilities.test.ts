import { describe, expect, it } from "vitest";
import { defaultImageCapabilities, sizeForQuality, type ImageSizeOption } from "./image-capabilities";

const sizes: ImageSizeOption[] = [
  ...defaultImageCapabilities.sizes,
  { value: "2048x2048", label: "Square", ratio: "1:1", quality: "high" },
  { value: "2496x1664", label: "Landscape", ratio: "3:2", quality: "high" },
];

describe("sizeForQuality", () => {
  it("keeps the aspect ratio across qualities", () => {
    expect(sizeForQuality(sizes, "1536x1024", "high")).toBe("2496x1664");
    expect(sizeForQuality(sizes, "2048x2048", "standard")).toBe("1024x1024");
  });

  it("falls back to the first size of a quality without that ratio", () => {
    expect(sizeForQuality(sizes, "1024x1536", "high")).toBe("2048x2048");
  });
});
