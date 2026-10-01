import { describe, expect, it } from "vitest";
import { activeSegmentIndex, formatTimestamp, parseTranscriptSegments, runDuration } from "./Viewers";

describe("transcript viewer helpers", () => {
  const segments = [{ start: 0, end: 4, text: "a" }, { start: 4.2, end: 9, text: "b" }, { start: 9.8, end: 15, text: "c" }];

  it("reads segments from transcript JSON and ignores malformed ones", () => {
    expect(parseTranscriptSegments(JSON.stringify({ text: "x", segments: [{ start: 1, end: 2, text: " hi " }, { start: "1", text: "bad" }, { start: 3, text: "" }] }))).toEqual([{ start: 1, end: 2, text: "hi" }]);
    expect(parseTranscriptSegments("not json")).toEqual([]);
  });

  it("finds the segment being spoken", () => {
    expect(activeSegmentIndex(segments, 0)).toBe(0);
    expect(activeSegmentIndex(segments, 4.19)).toBe(1);
    expect(activeSegmentIndex(segments, 20)).toBe(2);
    expect(activeSegmentIndex([{ start: 2, end: 3, text: "late" }], 1)).toBe(-1);
  });

  it("formats timestamps", () => {
    expect(formatTimestamp(9.8)).toBe("0:09");
    expect(formatTimestamp(754)).toBe("12:34");
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });
});

describe("run durations", () => {
  it("formats elapsed time and skips unfinished runs", () => {
    expect(runDuration({ startedAt: "2026-09-30T10:00:00Z", completedAt: "2026-09-30T10:00:42Z" })).toBe("42s");
    expect(runDuration({ startedAt: "2026-09-30T10:00:00Z", completedAt: "2026-09-30T10:03:05Z" })).toBe("3m 05s");
    expect(runDuration({ startedAt: "2026-09-30T10:00:00Z" })).toBeUndefined();
  });
});
