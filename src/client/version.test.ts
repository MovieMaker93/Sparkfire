import { describe, expect, it } from "vitest";
import { displayVersion, isNewerVersion, releaseFromGitHub } from "./version";

describe("application versions", () => {
  it("formats release versions consistently", () => {
    expect(displayVersion("0.1.1")).toBe("v0.1.1");
    expect(displayVersion("v0.2.0")).toBe("v0.2.0");
    expect(displayVersion("development")).toBe("development");
  });

  it("detects a newer semantic version", () => {
    expect(isNewerVersion("v0.1.1", "0.1.2")).toBe(true);
    expect(isNewerVersion("0.1.9", "0.1.10")).toBe(true);
    expect(isNewerVersion("0.2.0", "0.1.10")).toBe(false);
    expect(isNewerVersion("0.1.1", "v0.1.1")).toBe(false);
  });

  it("does not suggest releases for development builds", () => {
    expect(isNewerVersion("development", "0.2.0")).toBe(false);
    expect(isNewerVersion(undefined, "0.2.0")).toBe(false);
  });

  it("reads the version from a GitHub release", () => {
    expect(releaseFromGitHub({ tag_name: "v0.3.0", name: "v0.3.0" })).toEqual({ version: "v0.3.0" });
    expect(() => releaseFromGitHub({ tag_name: "nightly" })).toThrow();
    expect(() => releaseFromGitHub(null)).toThrow();
  });
});
