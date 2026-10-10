import type { TimedWord, TranscriptSegment } from "./ai.js";

export interface WordChunk {
  start: number;
  end: number;
  words: TimedWord[];
}

export const SENTENCE_PAUSE_SEC = 1.5;
export const CUE_PAUSE_SEC = 0.8;
export const CUE_MAX_SEC = 7;
export const CUE_MAX_CHARS = 84;
export const PARAGRAPH_PAUSE_SEC = 2;

// Stored without the final dot, so "Mr." and "Mr" are the same entry.
const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "prof", "st", "jr", "sr", "vs", "etc", "e.g", "i.e", "sig", "sig.ra", "dott", "ecc"]);
// A token made only of these belongs to the word before it (some models emit punctuation as its own token).
const CLOSING_ONLY = /^[.,;:!?…)\]}"”’]+$/;
const CLOSERS = "[)\\]}\"”’'»]";
const SENTENCE_END = new RegExp(`[.?!…]${CLOSERS}*$`);
const TRAILING_CLOSERS = new RegExp(`${CLOSERS}+$`);
const STARTS_LOWERCASE = /^\p{Ll}/u;
const SINGLE_LETTER = /^\p{L}$/u;

// Chunks overlap by a few seconds, so the same words are heard twice. Each chunk keeps what lies before the
// middle of its overlap with the next one. The midpoint test then drops a copy the earlier chunk already
// kept, and recovers a word the earlier chunk lost because its start jittered just past the seam.
export function joinChunkWords(chunks: WordChunk[]): TimedWord[] {
  const kept: TimedWord[] = [];
  chunks.forEach((chunk, index) => {
    const next = chunks[index + 1];
    const seam = next ? (next.start + chunk.end) / 2 : Infinity;
    for (const word of chunk.words) {
      if (word.start >= seam) continue;
      const last = kept[kept.length - 1];
      if (last && (word.start + word.end) / 2 <= last.end) continue;
      kept.push(word);
    }
  });
  return kept;
}

export function toSentences(words: TimedWord[]): TranscriptSegment[] {
  const sentences: TranscriptSegment[] = [];
  let group: TimedWord[] = [];
  words.forEach((word, index) => {
    group.push(word);
    if (endsSentence(words, index)) {
      sentences.push(toSegment(group));
      group = [];
    }
  });
  if (group.length) sentences.push(toSegment(group));
  return sentences;
}

export function toCues(words: TimedWord[]): TranscriptSegment[] {
  const cues: TranscriptSegment[] = [];
  let group: TimedWord[] = [];
  let text = "";
  const flush = () => {
    if (!group.length) return;
    cues.push(toSegment(group));
    group = [];
    text = "";
  };
  for (let first = 0; first < words.length; ) {
    // A word and the closing tokens after it are admitted or refused together: the tokens never open a cue,
    // and the caps are checked with them included. A unit that is over a cap on its own still becomes a cue.
    let last = first;
    while (last + 1 < words.length && isClosingOnly(words[last + 1].word)) last += 1;
    const unit = words.slice(first, last + 1);
    const withUnit = (base: string) => unit.reduce((joined, word) => appendWord(joined, word.word), base);
    if (group.length && (words[last].end - group[0].start > CUE_MAX_SEC || withUnit(text).length > CUE_MAX_CHARS)) flush();
    group.push(...unit);
    text = withUnit(text);
    const next = words[last + 1];
    if ((next && next.start - words[last].end >= CUE_PAUSE_SEC) || endsSentence(words, last)) flush();
    first = last + 1;
  }
  flush();
  return cues;
}

export function toParagraphs(sentences: TranscriptSegment[]): string {
  let text = "";
  sentences.forEach((sentence, index) => {
    if (index > 0) text += sentence.start - sentences[index - 1].end >= PARAGRAPH_PAUSE_SEC ? "\n\n" : " ";
    text += sentence.text;
  });
  return text;
}

function endsSentence(words: TimedWord[], index: number): boolean {
  const word = words[index];
  const next = words[index + 1];
  // A closing token belongs to the word before it, so no boundary can fall between the two.
  if (next && isClosingOnly(next.word)) return false;
  if (next && next.start - word.end >= SENTENCE_PAUSE_SEC) return true;
  // A dot that arrived as its own token is judged with the word it closes, or "Mr" "." would end a sentence.
  const text = isClosingOnly(word.word) && index > 0 ? words[index - 1].word + word.word : word.word;
  if (!SENTENCE_END.test(text) || isAbbreviation(text)) return false;
  return !(next && STARTS_LOWERCASE.test(next.word));
}

function isAbbreviation(text: string): boolean {
  const core = text.replace(TRAILING_CLOSERS, "");
  if (!core.endsWith(".")) return false;
  const base = core.slice(0, -1);
  return SINGLE_LETTER.test(base) || ABBREVIATIONS.has(base.toLowerCase());
}

function isClosingOnly(word: string): boolean {
  return CLOSING_ONLY.test(word);
}

function appendWord(text: string, word: string): string {
  if (!text) return word;
  return isClosingOnly(word) ? text + word : `${text} ${word}`;
}

function joinWords(words: TimedWord[]): string {
  return words.reduce((text, word) => appendWord(text, word.word), "");
}

function toSegment(words: TimedWord[]): TranscriptSegment {
  return { start: words[0].start, end: words[words.length - 1].end, text: joinWords(words) };
}
