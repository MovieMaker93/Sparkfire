import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { brandMarkPath } from "./brand";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

/** The `--sk-*` tokens one theme block of styles.css defines, by name. */
function themeTokens(selector: string) {
  const css = read("./styles.css");
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...block.matchAll(/--(sk-[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}

describe("brand assets", () => {
  it("draws the favicon with the in-app mark's path", () => {
    expect(read("./public/favicon.svg")).toContain(`d="${brandMarkPath}"`);
  });

  it("fills the favicon with each theme's accent", () => {
    const favicon = read("./public/favicon.svg");
    expect(favicon).toContain(`path{fill:${themeTokens(":root")["sk-accent"]}}`);
    expect(favicon).toContain(`@media (prefers-color-scheme:light){path{fill:${themeTokens(':root[data-theme="light"]')["sk-accent"]}}}`);
  });

  it("gives the light theme a value for every dark theme colour", () => {
    const dark = Object.keys(themeTokens(":root")).filter((name) => !name.startsWith("sk-radius"));
    expect(Object.keys(themeTokens(':root[data-theme="light"]')).sort()).toEqual(dark.sort());
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
