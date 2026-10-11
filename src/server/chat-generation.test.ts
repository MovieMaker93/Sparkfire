import { describe, expect, it, vi } from "vitest";
import { chatGeneration, chatStreamDeltas, claimChatGeneration, releaseChatGeneration, type ChatAnswer, type ChatStreamEvent } from "./chat-generation.js";
import type { ChatMessage } from "./models.js";

function saved(answer: ChatAnswer): ChatMessage {
  return { id: "answer", role: "assistant", content: answer.content, createdAt: "2026-10-11T00:00:00.000Z", ...(answer.reasoning ? { reasoning: answer.reasoning } : {}) };
}

/** A model stream the test feeds by hand, which fails with AbortError once the signal fires, like fetch does. */
function manualStream(signal: AbortSignal) {
  const queue: Array<{ content: string; reasoning: string }> = [];
  let wake: (() => void) | undefined;
  let ended = false;
  signal.addEventListener("abort", () => wake?.());
  const stream = {
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
        const next = queue.shift();
        if (next) { yield next; continue; }
        if (ended) return;
        await new Promise<void>((resolve) => { wake = resolve; });
      }
    },
  };
  return {
    stream,
    push(part: Partial<{ content: string; reasoning: string }>) { queue.push({ content: "", reasoning: "", ...part }); wake?.(); },
    end() { ended = true; wake?.(); },
  };
}

async function flush() {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

describe("chat generation", () => {
  it("keeps generating without listeners and replays the answer so far to a page that reattaches", async () => {
    const generation = claimChatGeneration("chat-replay")!;
    let feed!: ReturnType<typeof manualStream>;
    const save = vi.fn(async (answer: ChatAnswer) => saved(answer));
    const running = generation.run(async (signal) => (feed = manualStream(signal)).stream, save);
    await flush();

    const first: ChatStreamEvent[] = [];
    const leave = generation.subscribe((event) => first.push(event));
    feed.push({ reasoning: "Think. " });
    feed.push({ content: "Hello" });
    await flush();
    leave();
    feed.push({ content: " world" });
    await flush();

    const second: ChatStreamEvent[] = [];
    chatGeneration("chat-replay")!.subscribe((event) => second.push(event));
    feed.push({ content: "!" });
    feed.end();
    await running;

    expect(first).toEqual([{ reasoning: "Think. " }, { delta: "Hello" }]);
    expect(second).toEqual([
      { snapshot: { content: "Hello world", reasoning: "Think. " } },
      { delta: "!" },
      { done: true, message: saved({ content: "Hello world!", reasoning: "Think." }) },
    ]);
    expect(save).toHaveBeenCalledOnce();
    expect(chatGeneration("chat-replay")).toBeUndefined();
  });

  it("refuses a second answer for the same chat until the first one ends", async () => {
    const generation = claimChatGeneration("chat-busy")!;
    expect(claimChatGeneration("chat-busy")).toBeUndefined();
    expect(claimChatGeneration("chat-other")).toBeDefined();
    releaseChatGeneration(generation);
    expect(claimChatGeneration("chat-busy")).toBeDefined();
  });

  it("saves the partial answer when the user stops it", async () => {
    const generation = claimChatGeneration("chat-stop")!;
    let feed!: ReturnType<typeof manualStream>;
    const events: ChatStreamEvent[] = [];
    generation.subscribe((event) => events.push(event));
    const running = generation.run(async (signal) => (feed = manualStream(signal)).stream, async (answer) => saved(answer));
    await flush();
    feed.push({ content: "Partial" });
    await flush();
    generation.stop();
    await running;
    expect(events.at(-1)).toEqual({ done: true, message: saved({ content: "Partial", reasoning: "" }) });
  });

  it("saves nothing when the chat is being deleted", async () => {
    const generation = claimChatGeneration("chat-delete")!;
    let feed!: ReturnType<typeof manualStream>;
    const save = vi.fn(async (answer: ChatAnswer) => saved(answer));
    void generation.run(async (signal) => (feed = manualStream(signal)).stream, save);
    await flush();
    feed.push({ content: "Partial" });
    await flush();
    generation.stop({ discard: true });
    await generation.finished;
    expect(save).not.toHaveBeenCalled();
  });

  it("reports a model failure and an empty answer as errors", async () => {
    const failing = claimChatGeneration("chat-fail")!;
    const failed: ChatStreamEvent[] = [];
    failing.subscribe((event) => failed.push(event));
    await failing.run(async () => { throw new Error("connection refused"); }, async (answer) => saved(answer));
    expect(failed).toEqual([{ error: "connection refused" }]);

    const empty = claimChatGeneration("chat-empty")!;
    const events: ChatStreamEvent[] = [];
    empty.subscribe((event) => events.push(event));
    await empty.run(async () => [{ content: "", reasoning: "only thoughts" }], async (answer) => saved(answer));
    expect(events.at(-1)).toEqual({ error: "The language model finished without returning final content" });
  });
});

describe("chatStreamDeltas", () => {
  it("parses server-sent events split across chunks and skips bookkeeping lines", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"choices":[{"delta":{"reasoning_content":"Hm"}}]}\n\ndata: {"choi',
      'ces":[{"delta":{"content":"Hi"}}]}\n\n: keep-alive\ndata: not json\n\n',
      'data: {"choices":[{"delta":{"content":"!"}}]}\n\ndata: [DONE]\n\n',
    ];
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        chunks.forEach((chunk) => stream.enqueue(encoder.encode(chunk)));
        stream.close();
      },
    });
    const parts = [];
    for await (const part of chatStreamDeltas(body)) parts.push(part);
    expect(parts).toEqual([{ content: "", reasoning: "Hm" }, { content: "Hi", reasoning: "" }, { content: "!", reasoning: "" }]);
  });
});
