import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { brandMarkPath } from "./brand";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

describe("brand assets", () => {
  it("draws the favicon with the in-app mark's path", () => {
    expect(read("./public/favicon.svg")).toContain(`d="${brandMarkPath}"`);
  });

  it("links only icons that exist", () => {
    const linked = [...read("./index.html").matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)" href="\/([^"]+)"/g)].map((match) => match[1]);
    const manifest = JSON.parse(read("./public/site.webmanifest")) as { icons: { src: string }[] };
    expect(linked).toEqual(["favicon.ico", "favicon.svg", "apple-touch-icon.png", "site.webmanifest"]);
    for (const file of [...linked, ...manifest.icons.map((icon) => icon.src.slice(1))]) {
      expect(existsSync(new URL(`./public/${file}`, import.meta.url)), file).toBe(true);
    }
  });
});
