import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TimedWord } from "./ai.js";
import { CUE_MAX_CHARS, CUE_MAX_SEC, CUE_PAUSE_SEC, joinChunkWords, PARAGRAPH_PAUSE_SEC, SENTENCE_PAUSE_SEC, toCues, toParagraphs, toSentences } from "./transcript-timing.js";

// Times in the boundary tests are sums of powers of two (0.5, 2, 7, ...), so a subtraction is exact and no
// 1e-16 rounding error can decide whether a gap reaches its threshold.
const w = (word: string, start: number, end = start + 0.3): TimedWord => ({ word, start, end });

// Words 0.4 s apart with 0.1 s gaps: far below every pause threshold, so only punctuation can cut.
const spoken = (tokens: string[]): TimedWord[] => tokens.map((token, i) => w(token, i * 0.4));
const texts = (tokens: string[]) => toSentences(spoken(tokens)).map((sentence) => sentence.text);

describe("timing thresholds", () => {
  it("uses the documented values", () => {
    expect([SENTENCE_PAUSE_SEC, CUE_PAUSE_SEC, CUE_MAX_SEC, CUE_MAX_CHARS, PARAGRAPH_PAUSE_SEC]).toEqual([1.5, 0.8, 7, 84, 2]);
  });
});

describe("joinChunkWords", () => {
  it("keeps a word heard by two overlapping chunks once", () => {
    const words = joinChunkWords([
      { start: 0, end: 15, words: [w("one", 1), w("two.", 12.5), w("three", 14.2)] },
      { start: 12, end: 30, words: [w("two.", 12.52), w("three", 14.21), w("four", 20)] },
    ]);
    expect(words.map((x) => x.word)).toEqual(["one", "two.", "three", "four"]);
    expect(words[2].start).toBe(14.21);
  });

  it("keeps a word whose start jitters across the seam exactly once", () => {
    // seam 13.5; first case A says 13.48 and B 13.53, second case A says 13.53 and B 13.47
    expect(joinChunkWords([
      { start: 0, end: 15, words: [w("a", 10), w("seam", 13.48)] },
      { start: 12, end: 30, words: [w("seam", 13.53), w("b", 20)] },
    ]).map((x) => x.word)).toEqual(["a", "seam", "b"]);
    expect(joinChunkWords([
      { start: 0, end: 15, words: [w("a", 10), w("seam", 13.53)] },
      { start: 12, end: 30, words: [w("seam", 13.47), w("b", 20)] },
    ]).map((x) => x.word)).toEqual(["a", "seam", "b"]);
  });

  it("keeps every word when chunks do not overlap", () => {
    const words = joinChunkWords([
      { start: 0, end: 10, words: [w("a", 1), w("b", 9.5)] },
      { start: 11, end: 20, words: [w("c", 11.5), w("d", 19)] },
    ]);
    expect(words.map((x) => x.word)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps a word that starts exactly on the seam only from the later chunk", () => {
    // seam (12 + 16) / 2 = 14, exact in binary: the earlier chunk keeps words that start strictly before it
    const words = joinChunkWords([
      { start: 0, end: 16, words: [w("a", 10), w("edge", 14)] },
      { start: 12, end: 30, words: [w("edge", 14.25), w("b", 20)] },
    ]);
    expect(words.map((x) => x.word)).toEqual(["a", "edge", "b"]);
    expect(words[1].start).toBe(14.25);
  });

  it("treats a word whose midpoint is exactly the end of the last kept word as a copy", () => {
    // one ends at 12.5 and two spans 12.25 to 12.75, so its midpoint is 12.5: not after the end
    const words = joinChunkWords([
      { start: 0, end: 15, words: [w("one", 12, 12.5)] },
      { start: 12, end: 30, words: [w("two", 12.25, 12.75), w("three", 20)] },
    ]);
    expect(words.map((x) => x.word)).toEqual(["one", "three"]);
  });

  it("joins three chunks with their own seams", () => {
    const words = joinChunkWords([
      { start: 0, end: 15, words: [w("a", 1), w("b", 14.2)] },
      { start: 12, end: 27, words: [w("b", 14.21), w("c", 20), w("d", 26.2)] },
      { start: 24, end: 40, words: [w("d", 26.22), w("e", 35)] },
    ]);
    expect(words.map((x) => x.word)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("returns the words of a single chunk unchanged", () => {
    const chunk = { start: 0, end: 10, words: [w("a", 1), w("b", 2)] };
    expect(joinChunkWords([chunk])).toEqual(chunk.words);
  });

  it("returns no words for no chunks", () => expect(joinChunkWords([])).toEqual([]));
});

describe("toSentences", () => {
  it("ends sentences after . ? ! and …", () => {
    expect(texts(["Hi.", "Yes?", "No!", "Well…"])).toEqual(["Hi.", "Yes?", "No!", "Well…"]);
  });

  it("lets closing quotes and brackets follow the full stop", () => {
    expect(texts(["He", "said", "\"Stop.\"", "Then", "(he", "left.)", "Next"])).toEqual(["He said \"Stop.\"", "Then (he left.)", "Next"]);
  });

  it("ends a sentence before a pause of 1.5 s, not 1.4 s", () => {
    // 2.0 - 0.5 is exactly 1.5; 1.9 - 0.5 is 1.4
    expect(toSentences([w("one", 0, 0.5), w("two", 2, 2.5)]).map((s) => s.text)).toEqual(["one", "two"]);
    expect(toSentences([w("one", 0, 0.5), w("two", 1.9, 2.4)]).map((s) => s.text)).toEqual(["one two"]);
  });

  it("ends a sentence at a pause even when the next word is lowercase", () => {
    expect(toSentences([w("Mr.", 0, 0.5), w("who", 2, 2.5)]).map((s) => s.text)).toEqual(["Mr.", "who"]);
  });

  it("does not end a sentence after an abbreviation, an initial or before a lowercase word", () => {
    expect(texts(["Mr.", "Quilter", "is", "here."])).toEqual(["Mr. Quilter is here."]);
    expect(texts(["J.", "Smith", "came."])).toEqual(["J. Smith came."]);
    expect(texts(["apples", "etc.", "and", "pears."])).toEqual(["apples etc. and pears."]);
  });

  it("compares abbreviations without the final dot and ignoring case", () => {
    expect(texts(["DR.", "Rossi", "e", "la", "Sig.ra", "Bianchi", "ecc.", "Poi", "i.e.", "Next", "e.g.", "Last."])).toEqual(["DR. Rossi e la Sig.ra Bianchi ecc. Poi i.e. Next e.g. Last."]);
    expect(texts(["Prof.", "Verdi", "vs.", "Dott.", "Neri", "arrived."])).toEqual(["Prof. Verdi vs. Dott. Neri arrived."]);
    expect(texts(["Sig.ra.", "Bianchi", "left."])).toEqual(["Sig.ra. Bianchi left."]);
  });

  it("still ends a sentence at a word that only starts like an abbreviation", () => {
    expect(texts(["Drama.", "Next"])).toEqual(["Drama.", "Next"]);
  });

  it("does not end a sentence when the next word is lowercase after ? ! or …", () => {
    expect(texts(["Really?", "yes", "sure."])).toEqual(["Really? yes sure."]);
  });

  it("attaches punctuation tokens to the word before them", () => {
    expect(texts(["classes", ",", "we", "agree", ".", "Next", "one", "."])).toEqual(["classes, we agree.", "Next one."]);
  });

  it("keeps an abbreviation that arrives as a word and a separate dot", () => {
    expect(texts(["Mr", ".", "Quilter", "is", "here", "."])).toEqual(["Mr. Quilter is here."]);
  });

  it("closes a sentence with quote tokens that arrive on their own", () => {
    expect(texts(["He", "said", "stop", ".", "”", "Next"])).toEqual(["He said stop.”", "Next"]);
  });

  it("never starts a sentence with a punctuation token, even after a long pause", () => {
    // the dot follows its word by 2 s; it still belongs to that word
    expect(toSentences([w("Hello", 0, 0.5), w(".", 2.5, 2.6), w("Next", 2.7, 3)]).map((s) => s.text)).toEqual(["Hello.", "Next"]);
  });

  it("times a sentence from its first word's start to its last word's end", () => {
    const [sentence] = toSentences([w("Hello", 1, 1.5), w("world.", 1.6, 2.3)]);
    expect(sentence).toEqual({ start: 1, end: 2.3, text: "Hello world." });
  });

  it("returns the trailing words as a sentence even without a full stop", () => {
    expect(texts(["It", "ends", "here"])).toEqual(["It ends here"]);
  });

  it("returns no sentences for no words", () => expect(toSentences([])).toEqual([]));
});

describe("toCues", () => {
  it("never runs past 7 s or 84 characters and never splits a word", () => {
    const words = Array.from({ length: 60 }, (_, i) => w(`word${i}`, i * 0.4, i * 0.4 + 0.35));
    const cues = toCues(words);
    for (const cue of cues) {
      expect(cue.end - cue.start).toBeLessThanOrEqual(7);
      expect(cue.text.length).toBeLessThanOrEqual(84);
    }
    expect(cues.flatMap((cue) => cue.text.split(" "))).toEqual(words.map((x) => x.word));
  });

  it("allows a cue of exactly 7 s and starts a new one for the word that would pass it", () => {
    // 15 contiguous half-second words: the first 14 span exactly 7 s
    const words = Array.from({ length: 15 }, (_, i) => w(`w${i}`, i * 0.5, i * 0.5 + 0.5));
    const cues = toCues(words);
    expect(cues.map((cue) => cue.text.split(" ").length)).toEqual([14, 1]);
    expect(cues[0].end - cues[0].start).toBe(7);
  });

  it("allows a cue of exactly 84 characters and splits before the 85th", () => {
    const fit = Array.from({ length: 17 }, (_, i) => w("abcd", i * 0.25, i * 0.25 + 0.25));
    expect(toCues(fit).map((cue) => cue.text.length)).toEqual([84]);
    const over = [...fit.slice(0, 16), w("abcde", 4, 4.25)];
    expect(toCues(over).map((cue) => cue.text.length)).toEqual([79, 5]);
  });

  it("cuts at every sentence end", () => {
    const words = spoken(["Hi.", "Yes?", "No!", "Well…", "Fine", "then"]);
    const cues = toCues(words);
    expect(cues.map((cue) => cue.text)).toEqual(["Hi.", "Yes?", "No!", "Well…", "Fine then"]);
    expect(cues[4].start).toBe(words[4].start);
    expect(cues[4].end).toBe(words[5].end);
    // every sentence boundary is also a cue boundary
    const cueStarts = new Set(cues.map((cue) => cue.start));
    for (const sentence of toSentences(words)) expect(cueStarts.has(sentence.start)).toBe(true);
  });

  it("cuts at a pause of 0.8 s and not at 0.75 s", () => {
    // 0.8 has no exact binary form, so the previous word ends at 0 and the subtraction adds no rounding
    expect(toCues([w("a", -1, 0), w("b", 0.8, 1.1)]).map((cue) => cue.text)).toEqual(["a", "b"]);
    expect(toCues([w("a", 0, 0.5), w("b", 1.25, 1.75)]).map((cue) => cue.text)).toEqual(["a b"]);
    expect(toCues([w("a", 0, 0.5), w("b", 1.375, 1.75)]).map((cue) => cue.text)).toEqual(["a", "b"]);
  });

  it("does not cut before a punctuation token", () => {
    // a 1 s gap would cut a cue, but the dot belongs to the word before it
    expect(toCues([w("Well", 0, 0.5), w(".", 1.5, 1.6), w("Next", 1.7, 2)]).map((cue) => cue.text)).toEqual(["Well.", "Next"]);
  });

  it("keeps a punctuation token with a word that already fills the cue", () => {
    const long = "x".repeat(CUE_MAX_CHARS);
    expect(toCues([w("a", 0, 0.25), w(long, 0.25, 0.5), w(".", 0.5, 0.5), w("b", 0.5, 0.75)]).map((cue) => cue.text)).toEqual(["a", `${long}.`, "b"]);
  });

  describe("when closing tokens follow a cue that is exactly at a cap", () => {
    // 17 contiguous quarter-second "abcd" words are exactly 84 characters over 4.25 s
    const full = Array.from({ length: 17 }, (_, i) => w("abcd", i * 0.25, i * 0.25 + 0.25));

    it("moves the last word out when one dot would pass 84 characters", () => {
      const cues = toCues([...full, w(".", 4.25, 4.25)]);
      expect(cues.map((cue) => cue.text.length)).toEqual([79, 5]);
      expect(cues[1].text).toBe("abcd.");
    });

    it("moves the last word out when two closing tokens would pass 84 characters", () => {
      const cues = toCues([...full, w(".", 4.25, 4.25), w("”", 4.25, 4.25)]);
      expect(cues.map((cue) => cue.text.length)).toEqual([79, 6]);
      expect(cues[1].text).toBe("abcd.”");
    });

    it("keeps the word and its tokens together when they land exactly on 84 characters", () => {
      // 16 x "abcd" is 79 characters; " abc." brings it to exactly 84
      const fit = [...full.slice(0, 16), w("abc", 4, 4.25), w(".", 4.25, 4.25)];
      expect(toCues(fit).map((cue) => cue.text.length)).toEqual([84]);
    });

    it("moves the last word out when a dot would pass 7 s", () => {
      // 14 contiguous half-second words are exactly 7 s; a dot ending at 7.25 would stretch the cue to 7.25 s
      const half = Array.from({ length: 14 }, (_, i) => w(`w${i}`, i * 0.5, i * 0.5 + 0.5));
      const cues = toCues([...half, w(".", 7, 7.25)]);
      expect(cues.map((cue) => cue.text.split(" ").length)).toEqual([13, 1]);
      expect(cues[1].text).toBe("w13.");
      for (const cue of cues) expect(cue.end - cue.start).toBeLessThanOrEqual(CUE_MAX_SEC);
    });

    it("keeps a cue of exactly 7 s when the closing token ends with the last word", () => {
      const half = Array.from({ length: 14 }, (_, i) => w(`w${i}`, i * 0.5, i * 0.5 + 0.5));
      const cues = toCues([...half, w(".", 7, 7)]);
      expect(cues).toHaveLength(1);
      expect(cues[0].end - cues[0].start).toBe(7);
    });

    it("never starts a cue with a closing token", () => {
      const tokens = [w(".", 4.25, 4.25), w("”", 4.25, 4.25), w(",", 4.25, 4.25)];
      for (const cue of toCues([...full, ...tokens, w("Next", 4.25, 4.5)])) expect(cue.text).not.toMatch(/^[.,;:!?…)\]}"”’]/);
    });
  });

  it("puts a word longer than the caps in a cue of its own", () => {
    const long = "x".repeat(90);
    const cues = toCues([w("short", 0, 0.25), w(long, 0.25, 0.5), w("tail", 0.5, 0.75)]);
    expect(cues.map((cue) => cue.text)).toEqual(["short", long, "tail"]);
  });

  it("puts a word that lasts longer than 7 s in a cue of its own", () => {
    const cues = toCues([w("a", 0, 0.5), w("held", 0.5, 9), w("b", 9, 9.5)]);
    expect(cues.map((cue) => cue.text)).toEqual(["a", "held", "b"]);
  });

  it("returns no cues for no words", () => expect(toCues([])).toEqual([]));
});

describe("toParagraphs", () => {
  it("starts a new paragraph after a pause of 2 s", () => {
    expect(toParagraphs([{ start: 0, end: 1, text: "A." }, { start: 1.5, end: 2, text: "B." }, { start: 4, end: 5, text: "C." }])).toBe("A. B.\n\nC.");
  });

  it("keeps sentences together when the pause is just under 2 s", () => {
    expect(toParagraphs([{ start: 0, end: 1, text: "A." }, { start: 2.75, end: 3, text: "B." }])).toBe("A. B.");
  });

  it("returns an empty string for no sentences", () => expect(toParagraphs([])).toBe(""));
});

describe("a recorded Parakeet response", () => {
  it("becomes one sentence and cues that rejoin to the same text", async () => {
    const recorded = JSON.parse(await fs.readFile(new URL("./fixtures/parakeet-verbose.json", import.meta.url), "utf8")) as { text: string; words: TimedWord[] };
    const words = recorded.words.map(({ word, start, end }) => ({ word, start, end }));
    const sentences = toSentences(words);
    expect(sentences.map((sentence) => sentence.text)).toEqual([recorded.text]);
    const cues = toCues(words);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues.map((cue) => cue.text).join(" ")).toBe(recorded.text);
    for (const cue of cues) {
      expect(cue.text.length).toBeLessThanOrEqual(CUE_MAX_CHARS);
      expect(cue.end - cue.start).toBeLessThanOrEqual(CUE_MAX_SEC);
    }
  });
});
