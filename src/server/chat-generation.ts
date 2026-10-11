import { streamDelta } from "./ai.js";
import type { ChatMessage } from "./models.js";

export interface ChatAnswer {
  content: string;
  reasoning: string;
}

export type ChatStreamEvent =
  | { snapshot: ChatAnswer }
  | { reasoning: string }
  | { delta: string }
  | { done: true; message?: ChatMessage }
  | { error: string };

type Listener = (event: ChatStreamEvent) => void;

/**
 * One answer being generated for a chat. It belongs to the server, not to the browser request that started it,
 * so leaving the chat page or reloading never cuts the model off: the page reattaches and replays what it missed.
 */
export class ChatGeneration {
  content = "";
  reasoning = "";
  readonly finished: Promise<void>;
  private readonly controller = new AbortController();
  private readonly listeners = new Set<Listener>();
  private discarded = false;
  private settle!: () => void;

  constructor(readonly chatId: string) {
    this.finished = new Promise((resolve) => { this.settle = resolve; });
  }

  /** Sends the text so far, then every later event, ending with `done` or `error`. */
  subscribe(listener: Listener) {
    if (this.content || this.reasoning) listener({ snapshot: { content: this.content, reasoning: this.reasoning } });
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Stops the model. The partial answer is kept unless `discard` is set (the chat is being deleted). */
  stop(options: { discard?: boolean } = {}) {
    if (options.discard) this.discarded = true;
    this.controller.abort();
  }

  async run(
    open: (signal: AbortSignal) => Promise<AsyncIterable<{ content: string; reasoning: string }>>,
    save: (answer: ChatAnswer) => Promise<ChatMessage>,
  ) {
    const signal = this.controller.signal;
    let final: ChatStreamEvent;
    try {
      for await (const part of await open(signal)) {
        if (part.reasoning) {
          this.reasoning += part.reasoning;
          this.emit({ reasoning: part.reasoning });
        }
        if (part.content) {
          this.content += part.content;
          this.emit({ delta: part.content });
        }
      }
      if (signal.aborted) final = await this.stopped(save);
      else if (!this.content.trim()) final = { error: "The language model finished without returning final content" };
      else final = { done: true, message: await save(this.answer()) };
    } catch (error) {
      final = signal.aborted ? await this.stopped(save) : { error: error instanceof Error ? error.message : String(error) };
    }
    // Released before the last event, so a message sent the moment the answer lands is not refused as busy.
    releaseChatGeneration(this);
    this.emit(final);
    this.listeners.clear();
    this.settle();
  }

  private answer(): ChatAnswer {
    return { content: this.content, reasoning: this.reasoning.trim() };
  }

  private async stopped(save: (answer: ChatAnswer) => Promise<ChatMessage>): Promise<ChatStreamEvent> {
    if (this.discarded || !this.content.trim()) return { done: true };
    try {
      return { done: true, message: await save(this.answer()) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private emit(event: ChatStreamEvent) {
    for (const listener of this.listeners) listener(event);
  }
}

const generations = new Map<string, ChatGeneration>();

export function chatGeneration(chatId: string) {
  return generations.get(chatId);
}

/** Reserves the chat for one answer; undefined while another answer is still being generated. */
export function claimChatGeneration(chatId: string) {
  if (generations.has(chatId)) return undefined;
  const generation = new ChatGeneration(chatId);
  generations.set(chatId, generation);
  return generation;
}

/** Frees a claim whose answer never started, for example when the request was invalid. */
export function releaseChatGeneration(generation: ChatGeneration) {
  if (generations.get(generation.chatId) === generation) generations.delete(generation.chatId);
}

/** Reads an OpenAI-compatible server-sent event stream into content and reasoning deltas. */
export async function* chatStreamDeltas(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ended = false;
  try {
    while (!ended) {
      const { done, value } = await reader.read();
      ended = done;
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = done ? "" : lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let chunk: unknown;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue; // Some compatible servers emit non-JSON bookkeeping events.
        }
        yield streamDelta(chunk);
      }
    }
  } finally {
    if (!ended) await reader.cancel().catch(() => undefined);
  }
}
