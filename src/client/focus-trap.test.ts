import { describe, expect, it } from "vitest";
import { wrapFocusIndex } from "./focus-trap";

describe("wrapFocusIndex", () => {
  it("wraps forward from the last element", () => {
    expect(wrapFocusIndex(3, 2, false)).toBe(0);
  });

  it("wraps backward from the first element", () => {
    expect(wrapFocusIndex(3, 0, true)).toBe(2);
  });

  it("pulls focus in from outside at the first element when moving forward", () => {
    expect(wrapFocusIndex(3, -1, false)).toBe(0);
  });

  it("pulls focus in from outside at the last element when moving backward", () => {
    expect(wrapFocusIndex(3, -1, true)).toBe(2);
  });

  it("lets the browser move focus between the ends", () => {
    expect(wrapFocusIndex(3, 1, false)).toBe(-1);
    expect(wrapFocusIndex(3, 1, true)).toBe(-1);
  });

  it("returns -1 for an empty dialog", () => {
    expect(wrapFocusIndex(0, -1, false)).toBe(-1);
    expect(wrapFocusIndex(0, -1, true)).toBe(-1);
  });
});
