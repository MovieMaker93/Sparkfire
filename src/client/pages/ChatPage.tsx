import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, ArrowUp, Bot, Brain, Check, ChevronLeft, Copy, FileText, LoaderCircle, MessageCircle, Paperclip, Pencil, Plus, Search, Square, Trash2, UserRound, X } from "lucide-react";
import { CHAT_EFFORTS, MAX_CHAT_ATTACHMENTS, type ChatEffort } from "../../shared/contracts";
import { api, chatAttachmentUrl, streamChat, uploadChatAttachments } from "../api";
import { EFFORT_LABELS, modelLabel, readChatEffort, saveChatEffort } from "../chat-effort";
import { createClientId } from "../client-id";
import { writeClipboardText } from "../clipboard";
import { cn, ConfirmDialog, formatBytes, RenameDialog, timeAgo } from "../components/ui";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import type { Chat, ChatAttachment, ChatMessage, Job } from "../types";

const ATTACHMENT_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/*,.md,.markdown,.csv,.tsv,.json,.jsonl,.xml,.yaml,.yml,.toml,.log,.py,.js,.ts,.tsx,.jsx,.java,.c,.cpp,.go,.rs,.sh,.sql";
import { useGlobalSearch } from "../components/GlobalSearch";
import { useToast } from "../components/ToastProvider";

export function ChatPage() {
  const { id } = useParams();
  const [chats, setChats] = useState<Chat[]>([]);
  const [chat, setChat] = useState<Chat>();
  const [settledChatId, setSettledChatId] = useState<string>();
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftReasoning, setDraftReasoning] = useState("");
  const [effort, setEffort] = useState<ChatEffort>(readChatEffort);
  const [llmModel, setLlmModel] = useState("");
  // Files waiting to go out with the next message, tied to the chat they were uploaded to.
  const [pending, setPending] = useState<{ chatId?: string; items: ChatAttachment[] }>({ items: [] });
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Chat>();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [referenceJob, setReferenceJob] = useState<Job>();
  const [referenceStatus, setReferenceStatus] = useState<"idle" | "loading" | "ready" | "missing">("idle");
  const controller = useRef<AbortController | undefined>(undefined);
  const messages = useRef<HTMLDivElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const initialPromptSent = useRef("");
  const navigate = useNavigate();
  const location = useLocation();
  const { openSearch } = useGlobalSearch();
  const toast = useToast();
  const initialPrompt = ((location.state as { initialPrompt?: string } | null)?.initialPrompt || "").trim();

  useEffect(() => { api.chats().then(setChats).catch(() => undefined); }, [id, streaming]);
  useEffect(() => {
    api.settings().then((settings) => {
      setTimezone(settings.ui.timezone);
      setLlmModel(settings.endpoints.llm.model);
    }).catch(() => undefined);
  }, []);
  useEffect(() => {
    const linkedJobId = chat?.linkedJobId;
    setReferenceJob(undefined);
    if (!linkedJobId) { setReferenceStatus("idle"); return; }
    let active = true;
    setReferenceStatus("loading");
    api.job(linkedJobId)
      .then((job) => { if (active) { setReferenceJob(job); setReferenceStatus("ready"); } })
      .catch(() => { if (active) setReferenceStatus("missing"); });
    return () => { active = false; };
  }, [chat?.linkedJobId]);
  useEffect(() => {
    let active = true;
    setError("");
    if (!id) {
      setChat(undefined);
      setSettledChatId(undefined);
      return () => { active = false; };
    }
    api.chat(id)
      .then((value) => { if (active) setChat(value); })
      .catch((value) => { if (active) { setChat(undefined); setError(value.message); } })
      .finally(() => { if (active) setSettledChatId(id); });
    return () => { active = false; };
  }, [id]);
  useEffect(() => {
    const container = messages.current;
    container?.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [chat?.messages.length, draft]);
  useEffect(() => {
    const textarea = composerInput.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 176)}px`;
  }, [input]);

  async function newChat() {
    const created = await api.createChat();
    navigate(`/chat/${created.id}`);
  }
  function askToDelete(item: Chat) {
    if (streaming && item.id === id) return;
    setDeleteError("");
    setDeleteTarget(item);
  }
  function askToRename() {
    if (!chat) return;
    setRenameValue(chat.title);
    setRenameError("");
    setRenameOpen(true);
  }
  async function confirmRename() {
    if (!chat) return;
    setRenaming(true);
    setRenameError("");
    try {
      const renamed = await api.renameChat(chat.id, renameValue);
      setChat(renamed);
      setChats((items) => items.map((item) => item.id === renamed.id ? renamed : item));
      setRenameOpen(false);
      toast.success("Conversation renamed", renamed.title);
    } catch (renameFailure) {
      setRenameError(renameFailure instanceof Error ? renameFailure.message : String(renameFailure));
    } finally {
      setRenaming(false);
    }
  }
  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api.deleteChat(deleteTarget.id);
      setChats((items) => items.filter((item) => item.id !== deleteTarget.id));
      if (deleteTarget.id === id) {
        setChat(undefined);
        setSettledChatId(undefined);
        navigate("/chat", { replace: true });
      }
      toast.success("Conversation deleted", deleteTarget.title);
      setDeleteTarget(undefined);
    } catch (deleteFailure) {
      setDeleteError(deleteFailure instanceof Error ? deleteFailure.message : String(deleteFailure));
    } finally {
      setDeleting(false);
    }
  }
  async function ensureChat() {
    if (chat) return chat;
    const created = await api.createChat();
    setChat(created);
    navigate(`/chat/${created.id}`, { replace: true });
    return created;
  }

  async function addFiles(files: File[]) {
    const room = MAX_CHAT_ATTACHMENTS - attachments.length;
    if (!files.length || streaming || loadingChat) return;
    if (room <= 0) return setError(`Attach at most ${MAX_CHAT_ATTACHMENTS} files per message`);
    const batch = files.slice(0, room);
    setError(files.length > room ? `Only the first ${room} files were attached (${MAX_CHAT_ATTACHMENTS} per message)` : "");
    setUploading((count) => count + batch.length);
    try {
      const current = await ensureChat();
      const added = await uploadChatAttachments(current.id, batch);
      setPending((previous) => ({ chatId: current.id, items: [...(previous.chatId === current.id ? previous.items : []), ...added] }));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
    } finally {
      setUploading((count) => count - batch.length);
    }
  }

  async function send(contentOverride?: string, chatOverride?: Chat) {
    const content = (contentOverride ?? input).trim();
    const files = contentOverride === undefined ? attachments : [];
    if ((!content && !files.length) || streaming || uploading || (!chatOverride && loadingChat)) return;
    const current = chatOverride || await ensureChat();
    const optimistic: ChatMessage = { id: createClientId(), role: "user", content, createdAt: new Date().toISOString(), ...(files.length ? { attachments: files } : {}) };
    setChat({ ...current, messages: [...current.messages, optimistic] });
    setPending({ items: [] });
    setInput("");
    setDraft("");
    setDraftReasoning("");
    setError("");
    setStreaming(true);
    controller.current = new AbortController();
    let accumulated = "";
    let reasoning = "";
    try {
      await streamChat(current.id, content, {
        onDelta: (delta) => { accumulated += delta; setDraft(accumulated); },
        onReasoning: (delta) => { reasoning += delta; setDraftReasoning(reasoning); },
        onDone: () => undefined,
        onError: setError,
      }, controller.current.signal, { effort, attachmentIds: files.map((file) => file.id) });
      setChat(await api.chat(current.id));
      setDraft("");
      setDraftReasoning("");
    } catch (streamError) {
      if ((streamError as Error).name !== "AbortError") setError(streamError instanceof Error ? streamError.message : String(streamError));
    } finally {
      setStreaming(false);
    }
  }

  const loadingChat = Boolean(id && chat?.id !== id && settledChatId !== id);
  const attachments = pending.chatId && pending.chatId === chat?.id ? pending.items : [];
  useEffect(() => {
    if (!id || !initialPrompt || chat?.id !== id || streaming) return;
    const key = `${id}:${initialPrompt}`;
    if (initialPromptSent.current === key) return;
    initialPromptSent.current = key;
    navigate(`/chat/${id}`, { replace: true, state: null });
    void send(initialPrompt, chat);
  }, [chat?.id, id, initialPrompt, streaming]);
  const visibleMessages = chat?.messages.filter((message) => message.role !== "system") || [];
  return (
    <div className="chat-layout">
      <aside className={cn("chat-list", id && "hidden lg:flex")}>
        <div className="flex items-center justify-between px-1"><div><p className="eyebrow">CONVERSATIONS</p><h1 className="mt-1 text-xl font-semibold">Chat</h1></div><div className="chat-list-actions"><button className="list-search-button" onClick={() => openSearch({ scope: "chats" })} aria-label="Search conversations" title="Search conversations"><Search size={17} /></button><button className="icon-button bg-white" onClick={newChat} aria-label="New chat"><Plus size={18} /></button></div></div>
        <div className="mt-6 space-y-1.5 overflow-y-auto">
          {chats.map((item) => <Link key={item.id} to={`/chat/${item.id}`} className={cn("chat-list-item", item.id === id && "chat-list-item-active")}><MessageCircle size={16} /><div className="min-w-0"><p className="truncate text-sm font-medium">{item.title}</p><p className="mt-0.5 text-[14px] text-muted">{timeAgo(item.updatedAt)}</p></div></Link>)}
          {!chats.length && <p className="px-3 py-8 text-center text-sm text-muted">No conversations yet.</p>}
        </div>
      </aside>
      <section className={cn("chat-pane", !id && "hidden lg:flex")}>
        <header className="chat-header">
          <Link to="/chat" className="icon-button lg:hidden"><ChevronLeft size={19} /></Link>
          {loadingChat ? <div className="chat-header-skeleton" aria-hidden="true"><span className="skeleton" /><span className="skeleton" /></div> : <div className="min-w-0 flex-1"><p className="truncate font-semibold">{chat?.title || "New conversation"}</p><p className="mt-0.5 text-[14px] text-muted">{modelLabel(chat?.model || llmModel)}</p></div>}
          {!loadingChat && chat && <div className="chat-header-actions"><button className="icon-button" onClick={askToRename} disabled={streaming} aria-label="Rename conversation" title="Rename conversation"><Pencil size={16} /></button><button className="icon-button destructive-icon-button" onClick={() => askToDelete(chat)} disabled={streaming} aria-label="Delete conversation" title={streaming ? "Stop the response before deleting this conversation" : "Delete conversation"}><Trash2 size={17} /></button></div>}
        </header>
        {!loadingChat && chat?.linkedJobId && <ChatReferenceBanner chat={chat} job={referenceJob} status={referenceStatus} />}
        <div ref={messages} className="chat-messages" aria-busy={loadingChat}>
          {loadingChat ? <ChatLoadingSkeleton /> : <>
            {!visibleMessages.length && !draft && !error && <div className="chat-welcome"><span><Bot size={28} /></span><h2>What are you working on?</h2><p>Ask a question, develop an idea, or open a completed job in chat to explore its contents.</p><div className="mt-6 flex flex-wrap justify-center gap-2">{["Summarize a concept", "Draft a project outline", "Compare two approaches"].map((suggestion) => <button key={suggestion} onClick={() => setInput(suggestion)}>{suggestion}</button>)}</div></div>}
            <div className="chat-reading-column">
              {visibleMessages.map((message) => <Message key={message.id} message={message} timezone={timezone} chatId={chat?.id} />)}
              {(draft || draftReasoning) && <Message message={{ id: "draft", role: "assistant", content: draft, reasoning: draftReasoning, createdAt: new Date().toISOString() }} timezone={timezone} streaming />}
              {streaming && !draft && !draftReasoning && <div className="message-row"><span className="avatar avatar-ai"><Bot size={15} /></span><span className="thinking"><i /><i /><i /></span></div>}
              {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
            </div>
          </>}
        </div>
        <div className="chat-composer-wrap">
          <div
            className={cn("chat-composer", dragging && "chat-composer-dragging")}
            onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
            onDrop={(event) => { if (!event.dataTransfer.files.length) return; event.preventDefault(); setDragging(false); void addFiles(Array.from(event.dataTransfer.files)); }}
          >
            {(attachments.length > 0 || uploading > 0) && <div className="composer-attachments">
              {attachments.map((attachment) => <AttachmentChip key={attachment.id} chatId={pending.chatId!} attachment={attachment} onRemove={() => setPending((previous) => ({ ...previous, items: previous.items.filter((item) => item.id !== attachment.id) }))} />)}
              {uploading > 0 && <span className="attachment-chip"><LoaderCircle size={15} className="animate-spin" /><span className="attachment-chip-name">Uploading {uploading} {uploading === 1 ? "file" : "files"}…</span></span>}
            </div>}
            <button type="button" className="attach-button" onClick={() => fileInput.current?.click()} disabled={streaming || loadingChat || attachments.length >= MAX_CHAT_ATTACHMENTS} aria-label="Attach files" title="Attach images, PDFs, or text files"><Plus size={19} /></button>
            <input ref={fileInput} type="file" multiple accept={ATTACHMENT_ACCEPT} className="hidden" onChange={(event) => { void addFiles(Array.from(event.target.files || [])); event.target.value = ""; }} />
            <textarea ref={composerInput} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} onPaste={(event) => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); void addFiles(files); } }} placeholder={loadingChat ? "Loading conversation…" : "Message your local model…"} rows={1} disabled={streaming || loadingChat} />
            {streaming ? <button className="send-button" onClick={() => controller.current?.abort()} aria-label="Stop"><Square size={14} fill="currentColor" /></button> : <button className="send-button" onClick={() => void send()} disabled={loadingChat || uploading > 0 || (!input.trim() && !attachments.length)} aria-label="Send"><ArrowUp size={18} /></button>}
          </div>
          <div className="chat-composer-footer">
            <div className="theme-choice effort-choice" role="radiogroup" aria-label="Thinking effort">
              <span><Brain size={14} />Thinking</span>
              {CHAT_EFFORTS.map((value) => <button key={value} type="button" role="radio" aria-checked={effort === value} className={cn(effort === value && "active")} disabled={streaming} onClick={() => { setEffort(value); saveChatEffort(value); }}>{EFFORT_LABELS[value]}</button>)}
            </div>
            <p>Enter to send · Shift + Enter for a new line</p>
          </div>
        </div>
      </section>
      <RenameDialog open={renameOpen} title="Rename conversation" label="Conversation name" value={renameValue} busy={renaming} error={renameError} onChange={setRenameValue} onCancel={() => !renaming && setRenameOpen(false)} onConfirm={confirmRename} />
      <ConfirmDialog open={Boolean(deleteTarget)} title="Delete conversation?" description={<>“{deleteTarget?.title}” and all of its messages will be permanently deleted.</>} busy={deleting} error={deleteError} onCancel={() => !deleting && setDeleteTarget(undefined)} onConfirm={confirmDelete} />
    </div>
  );
}

export function chatReferenceNames(chat: Pick<Chat, "linkedArtifactIds">, job?: Job) {
  if (!job) return [];
  const linkedIds = new Set(chat.linkedArtifactIds || []);
  const linkedArtifacts = job.artifacts.filter((artifact) => linkedIds.has(artifact.id));
  const primaryArtifacts = job.artifacts.filter((artifact) => artifact.role === "primary");
  const candidates = [...job.inputs.map((input) => input.name), ...linkedArtifacts.map((artifact) => artifact.name)];
  if (!candidates.length) candidates.push(...primaryArtifacts.map((artifact) => artifact.name));
  return [...new Set(candidates)];
}

function ChatReferenceBanner({ chat, job, status }: { chat: Chat; job?: Job; status: "idle" | "loading" | "ready" | "missing" }) {
  const names = chatReferenceNames(chat, job);
  const visibleNames = names.slice(0, 2).join(", ");
  const remaining = Math.max(0, names.length - 2);
  const fallbackName = chat.title.replace(/^Chat\s*·\s*/i, "") || "Linked work";
  const detail = status === "missing"
    ? "The original work is no longer available"
    : status === "loading"
      ? "Loading reference…"
      : `${visibleNames || job?.title || fallbackName}${remaining ? ` and ${remaining} more` : ""}`;
  const content = <>
    <span className="chat-reference-icon"><Paperclip size={19} /></span>
    <span className="chat-reference-copy"><span><strong>Reference attached</strong><small>Used as context in this conversation</small></span><b>{detail}</b></span>
    {status !== "missing" && <span className="chat-reference-open">Open reference<ArrowRight size={16} /></span>}
  </>;
  return status === "missing"
    ? <div className="chat-reference-banner unavailable" role="note" aria-label="Reference attachment unavailable">{content}</div>
    : <Link className="chat-reference-banner" to={`/jobs/${encodeURIComponent(chat.linkedJobId!)}`} role="note" aria-label={`Open attached reference: ${detail}`}>{content}</Link>;
}

function ChatLoadingSkeleton() {
  return <div className="chat-loading" role="status" aria-label="Loading conversation">
    <span className="sr-only">Loading conversation…</span>
    <div className="chat-loading-row"><span className="skeleton chat-loading-avatar" /><span className="skeleton chat-loading-block" /></div>
    <div className="chat-loading-row from-user"><span className="skeleton chat-loading-avatar" /><span className="skeleton chat-loading-block" /></div>
    <div className="chat-loading-row tall"><span className="skeleton chat-loading-avatar" /><span className="skeleton chat-loading-block" /></div>
  </div>;
}

function Message({ message, timezone, streaming, chatId }: { message: ChatMessage; timezone: string; streaming?: boolean; chatId?: string }) {
  const assistant = message.role === "assistant";
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyResetTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyResetTimer.current), []);

  async function copyMessage() {
    try {
      await writeClipboardText(message.content);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.clearTimeout(copyResetTimer.current);
    copyResetTimer.current = window.setTimeout(() => setCopyState("idle"), 1800);
  }

  const copyLabel = copyState === "copied" ? "Copied message" : copyState === "failed" ? "Could not copy message" : "Copy message";
  const timestamp = formatMessageTimestamp(message.createdAt, timezone);
  const compactTime = formatMessageTime(message.createdAt, timezone);
  return <div className={cn("message-row", !assistant && "message-user")}>
    <span className={cn("avatar", assistant ? "avatar-ai" : "avatar-user")}>{assistant ? <Bot size={15} /> : <UserRound size={15} />}</span>
    <div className="message-body">
      {assistant && message.reasoning && <Reasoning text={message.reasoning} live={Boolean(streaming && !message.content)} />}
      {chatId && message.attachments?.length ? <div className="message-attachments">{message.attachments.map((attachment) => <AttachmentChip key={attachment.id} chatId={chatId} attachment={attachment} preview />)}</div> : null}
      {(message.content || (!message.reasoning && !message.attachments?.length)) && <div className={cn("message-content", !assistant && "message-bubble")}><ChatMarkdown>{message.content}</ChatMarkdown>{streaming && <span className="cursor" />}</div>}
      {!streaming && message.content && <div className="message-actions"><time dateTime={message.createdAt} title={`${timestamp} (${timezone.replaceAll("_", " ")})`}>{compactTime}</time><button type="button" className={cn("message-copy-button", copyState)} onClick={copyMessage} aria-label={copyLabel} title={copyLabel}>{copyState === "copied" ? <Check size={15} /> : <Copy size={15} />}<span>{copyState === "failed" ? "Copy failed" : copyState === "copied" ? "Copied" : "Copy"}</span></button></div>}
    </div>
  </div>;
}

function attachmentDetail(attachment: ChatAttachment) {
  if (attachment.kind === "image") return formatBytes(attachment.size);
  if (attachment.pageImages) return `scan · ${attachment.pageImages} ${attachment.pageImages === 1 ? "page" : "pages"}`;
  return attachment.textChars !== undefined ? `${attachment.textChars.toLocaleString()} chars` : formatBytes(attachment.size);
}

// A file in the composer (removable) or on a sent message (opens the file; images show a preview).
function AttachmentChip({ chatId, attachment, onRemove, preview }: { chatId: string; attachment: ChatAttachment; onRemove?: () => void; preview?: boolean }) {
  const url = chatAttachmentUrl(chatId, attachment.id);
  if (preview && attachment.kind === "image") {
    return <a className="message-attachment-image" href={url} target="_blank" rel="noreferrer" title={attachment.name}><img src={url} alt={attachment.name} loading="lazy" /></a>;
  }
  return <span className="attachment-chip">
    {attachment.kind === "image" ? <img src={url} alt="" /> : <FileText size={16} />}
    {preview ? <a className="attachment-chip-name" href={url} target="_blank" rel="noreferrer" title={attachment.name}>{attachment.name}</a> : <span className="attachment-chip-name" title={attachment.name}>{attachment.name}</span>}
    <small>{attachmentDetail(attachment)}</small>
    {onRemove && <button type="button" onClick={onRemove} aria-label={`Remove ${attachment.name}`} title="Remove"><X size={14} /></button>}
  </span>;
}

// Open while the model is still thinking, then folded away once the answer starts.
function Reasoning({ text, live }: { text: string; live: boolean }) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return <details className="message-reasoning" open={live}>
    <summary><Brain size={14} /><span>{live ? "Thinking…" : "Reasoning"}</span><small>{words} {words === 1 ? "word" : "words"}</small></summary>
    <p>{text}</p>
  </details>;
}

export function formatMessageTimestamp(value: string, timezone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    const day = new Intl.DateTimeFormat(undefined, { timeZone: timezone, year: "numeric", month: "short", day: "numeric" }).format(date);
    const time = new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
    return `${day} · ${time}`;
  } catch {
    return formatMessageTimestamp(value, "UTC");
  }
}

export function formatMessageTime(value: string, timezone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(date);
  } catch {
    return formatMessageTime(value, "UTC");
  }
}

export function ChatMarkdown({ children }: { children: string }) {
  return <MarkdownRenderer>{children}</MarkdownRenderer>;
}
