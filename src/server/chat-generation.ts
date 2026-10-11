import { streamDelta, type ChatCompletionMessage, type ModelToolCall, type ToolCallFragment } from "./ai.js";
import type { ChatMessage } from "./models.js";
import type { ChatSource, ChatTool, ChatToolActivity } from "../shared/contracts.js";

export interface ChatAnswer {
  content: string;
  reasoning: string;
  activity: ChatToolActivity[];
}

export type ChatStreamEvent =
  | { snapshot: ChatAnswer }
  | { reasoning: string }
  | { delta: string }
  | { activity: ChatToolActivity }
  | { done: true; message?: ChatMessage }
  | { error: string };

type Listener = (event: ChatStreamEvent) => void;

export interface StreamPart {
  content: string;
  reasoning: string;
  toolCalls?: ToolCallFragment[];
}

/** One request to the model: the tool calls and results so far in this answer, and whether to offer tools. */
export interface ChatTurn {
  followUp: ChatCompletionMessage[];
  offerTools: boolean;
}

/** The tools the model may call while answering, and how many rounds of calls one answer may take. */
export interface ChatTools {
  maxRounds: number;
  /** What the activity list shows for a call; undefined for a tool this answer does not offer. */
  describe(call: ModelToolCall): { tool: ChatTool; input: string } | undefined;
  /** Runs a call; `content` goes back to the model. Failures the model can work around return `error`, not throw. */
  execute(call: ModelToolCall, signal: AbortSignal): Promise<{ content: string; sources?: ChatSource[]; error?: string }>;
}

/**
 * One answer being generated for a chat. It belongs to the server, not to the browser request that started it,
 * so leaving the chat page or reloading never cuts the model off: the page reattaches and replays what it missed.
 */
export class ChatGeneration {
  content = "";
  reasoning = "";
  activity: ChatToolActivity[] = [];
  readonly finished: Promise<void>;
  private readonly controller = new AbortController();
  private readonly listeners = new Set<Listener>();
  private discarded = false;
  private settle!: () => void;

  constructor(readonly chatId: string) {
    this.finished = new Promise((resolve) => { this.settle = resolve; });
  }

  /** Sends the answer so far, then every later event, ending with `done` or `error`. */
  subscribe(listener: Listener) {
    if (this.content || this.reasoning || this.activity.length) {
      listener({ snapshot: { content: this.content, reasoning: this.reasoning, activity: structuredClone(this.activity) } });
    }
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Stops the model. The partial answer is kept unless `discard` is set (the chat is being deleted). */
  stop(options: { discard?: boolean } = {}) {
    if (options.discard) this.discarded = true;
    this.controller.abort();
  }

  async run(
    open: (signal: AbortSignal, turn: ChatTurn) => Promise<AsyncIterable<StreamPart>>,
    save: (answer: ChatAnswer) => Promise<ChatMessage>,
    tools?: ChatTools,
  ) {
    const signal = this.controller.signal;
    let final: ChatStreamEvent;
    try {
      const followUp: ChatCompletionMessage[] = [];
      // After the last allowed round the model is asked once more without tools, so it answers from what it found.
      for (let round = 0; ; round += 1) {
        const offerTools = Boolean(tools) && round < tools!.maxRounds;
        const { calls, content } = await this.streamRound(await open(signal, { followUp: [...followUp], offerTools }));
        if (signal.aborted || !offerTools || !calls.length) break;
        followUp.push({ role: "assistant", content, tool_calls: calls });
        for (const call of calls) {
          if (signal.aborted) break;
          followUp.push({ role: "tool", tool_call_id: call.id, content: await this.callTool(tools!, call, signal) });
        }
        if (signal.aborted) break;
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

  /** Streams one model response; returns the tool calls it asked for and the text it wrote in this round. */
  private async streamRound(stream: AsyncIterable<StreamPart>) {
    const fragments = new Map<number, { id: string; name: string; arguments: string }>();
    // Text from an earlier round ("Let me look that up.") stays, set apart from what follows.
    const separate = Boolean(this.content.trim());
    let content = "";
    for await (const part of stream) {
      if (part.reasoning) {
        this.reasoning += part.reasoning;
        this.emit({ reasoning: part.reasoning });
      }
      if (part.content) {
        const delta = separate && !content ? `\n\n${part.content}` : part.content;
        content += part.content;
        this.content += delta;
        this.emit({ delta });
      }
      for (const fragment of part.toolCalls || []) {
        const call = fragments.get(fragment.index) || { id: "", name: "", arguments: "" };
        if (fragment.id) call.id = fragment.id;
        if (fragment.name) call.name += fragment.name;
        if (fragment.arguments) call.arguments += fragment.arguments;
        fragments.set(fragment.index, call);
      }
    }
    const calls: ModelToolCall[] = [...fragments.entries()]
      .sort(([left], [right]) => left - right)
      .filter(([, call]) => call.name)
      .map(([index, call]) => ({
        id: call.id || `call_${this.activity.length}_${index}`,
        type: "function",
        function: { name: call.name, arguments: call.arguments || "{}" },
      }));
    return { calls, content };
  }

  private async callTool(tools: ChatTools, call: ModelToolCall, signal: AbortSignal) {
    const described = tools.describe(call);
    if (!described) return `Error: there is no tool named "${call.function.name}".`;
    const activity: ChatToolActivity = { id: call.id, ...described, status: "running" };
    this.activity.push(activity);
    this.emit({ activity: structuredClone(activity) });
    try {
      const result = await tools.execute(call, signal);
      activity.status = result.error ? "error" : "done";
      if (result.error) activity.error = result.error;
      if (result.sources?.length) activity.sources = result.sources;
      return result.content;
    } catch (error) {
      activity.status = "error";
      activity.error = signal.aborted ? "Stopped" : error instanceof Error ? error.message : String(error);
      if (signal.aborted) throw error;
      return `Error: ${activity.error}`;
    } finally {
      this.emit({ activity: structuredClone(activity) });
    }
  }

  private answer(): ChatAnswer {
    return { content: this.content, reasoning: this.reasoning.trim(), activity: structuredClone(this.activity) };
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

/** Reads an OpenAI-compatible server-sent event stream into content, reasoning and tool-call deltas. */
export async function* chatStreamDeltas(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamPart> {
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
