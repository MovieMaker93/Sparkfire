import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { CheckCircle2, CircleStop, Clock3, Columns2, LoaderCircle, Maximize, Minus, Plus, Scan, XCircle } from "lucide-react";
import type { WorkflowRun } from "../types";
import { cn, timeAgo } from "./ui";

export interface TranscriptSegment { start: number; end: number; text: string }

export function parseTranscriptSegments(content: string): TranscriptSegment[] {
  try {
    const value = JSON.parse(content) as { segments?: unknown };
    if (!Array.isArray(value.segments)) return [];
    return value.segments.flatMap((segment) => {
      const { start, end, text } = (segment || {}) as Partial<TranscriptSegment>;
      return typeof start === "number" && typeof text === "string" && text.trim()
        ? [{ start, end: typeof end === "number" ? end : start, text: text.trim() }]
        : [];
    });
  } catch {
    return [];
  }
}

export function formatTimestamp(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

/** The segment being spoken at `time`: the last one that has started. */
export function activeSegmentIndex(segments: TranscriptSegment[], time: number) {
  let active = -1;
  for (const [index, segment] of segments.entries()) {
    if (segment.start <= time + 0.05) active = index;
    else break;
  }
  return active;
}

/** Transcript as a timeline: clicking a line seeks the player, and the spoken line follows playback. */
export function TranscriptViewer({ segments, mediaRef }: { segments: TranscriptSegment[]; mediaRef: RefObject<HTMLMediaElement | null> }) {
  const [time, setTime] = useState(0);
  const list = useRef<HTMLOListElement>(null);
  const active = activeSegmentIndex(segments, time);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const update = () => setTime(media.currentTime);
    media.addEventListener("timeupdate", update);
    media.addEventListener("seeked", update);
    return () => {
      media.removeEventListener("timeupdate", update);
      media.removeEventListener("seeked", update);
    };
  }, [mediaRef]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || media.paused || active < 0) return;
    list.current?.children[active]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, mediaRef]);

  function seek(segment: TranscriptSegment) {
    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = segment.start;
    setTime(segment.start);
    void media.play().catch(() => undefined);
  }

  return <ol className="transcript-timeline" ref={list}>
    {segments.map((segment, index) => <li key={`${segment.start}-${index}`} className={cn(index === active && "active")}>
      <button type="button" onClick={() => seek(segment)} title={`Play from ${formatTimestamp(segment.start)}`}><time>{formatTimestamp(segment.start)}</time></button>
      <p>{segment.text}</p>
    </li>)}
  </ol>;
}

/** Image preview with fit/actual size, zoom, drag to pan, and an optional before/after slider. */
export function ImageViewer({ src, title, compareSrc, compareLabel = "Original" }: { src: string; title: string; compareSrc?: string; compareLabel?: string }) {
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [comparing, setComparing] = useState(false);
  const [split, setSplit] = useState(50);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | undefined>(undefined);
  const scale = zoom === "fit" ? 1 : zoom;

  useEffect(() => { setZoom("fit"); setOffset({ x: 0, y: 0 }); setComparing(false); }, [src]);

  const setScale = (value: "fit" | number) => {
    setZoom(value === "fit" ? "fit" : Math.min(8, Math.max(0.25, value)));
    if (value === "fit") setOffset({ x: 0, y: 0 });
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom === "fit" || comparing) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setOffset({ x: drag.current.ox + event.clientX - drag.current.x, y: drag.current.oy + event.clientY - drag.current.y });
  };

  return <div className={cn("image-viewer", zoom !== "fit" && "zoomed", comparing && "comparing")}>
    <div className="image-viewer-tools" role="toolbar" aria-label="Image view">
      <button type="button" className={cn(zoom === "fit" && "active")} onClick={() => setScale("fit")} title="Fit to view"><Scan size={15} />Fit</button>
      <button type="button" className={cn(zoom === 1 && "active")} onClick={() => setScale(1)} title="Actual size"><Maximize size={15} />100%</button>
      <button type="button" onClick={() => setScale(zoom === "fit" ? 1.5 : zoom * 1.5)} aria-label="Zoom in"><Plus size={15} /></button>
      <button type="button" onClick={() => setScale(zoom === "fit" ? 0.75 : zoom / 1.5)} aria-label="Zoom out"><Minus size={15} /></button>
      {compareSrc && <button type="button" className={cn(comparing && "active")} onClick={() => { setComparing(!comparing); setScale("fit"); }} aria-pressed={comparing} title={`Compare with ${compareLabel.toLowerCase()}`}><Columns2 size={15} />Compare</button>}
    </div>
    <div className="image-viewer-stage" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}>
      {comparing && compareSrc ? <div className="image-compare">
        <img src={src} alt={title} draggable={false} />
        <img src={compareSrc} alt={compareLabel} className="image-compare-before" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} draggable={false} />
        <span className="image-compare-divider" style={{ left: `${split}%` }} aria-hidden="true" />
        <span className="image-compare-label before">{compareLabel}</span><span className="image-compare-label after">Result</span>
        <input type="range" min={0} max={100} value={split} onChange={(event) => setSplit(Number(event.target.value))} aria-label="Comparison position" />
      </div> : <img src={src} alt={title} draggable={false} style={zoom === "fit" ? undefined : { transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }} />}
    </div>
  </div>;
}

/** Heading outline for long documents; it reads headings from the rendered article so ids never drift. */
export function DocumentOutline({ articleRef, content }: { articleRef: RefObject<HTMLElement | null>; content: string }) {
  const [headings, setHeadings] = useState<Array<{ level: number; text: string; element: HTMLElement }>>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const found = [...article.querySelectorAll<HTMLElement>("h1, h2, h3")].map((element) => ({ level: Number(element.tagName[1]), text: element.textContent?.trim() || "", element })).filter((heading) => heading.text);
    setHeadings(found);
    setActive(0);
    if (!found.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).map((entry) => found.findIndex((heading) => heading.element === entry.target));
      if (visible.length) setActive(Math.min(...visible));
    }, { rootMargin: "0px 0px -70% 0px" });
    found.forEach((heading) => observer.observe(heading.element));
    return () => observer.disconnect();
  }, [articleRef, content]);

  if (headings.length < 3) return null;
  const top = Math.min(...headings.map((heading) => heading.level));
  return <nav className="document-outline" aria-label="Document outline">
    <p>On this page</p>
    <ol>{headings.map((heading, index) => <li key={`${heading.text}-${index}`} style={{ paddingLeft: `${(heading.level - top) * 12}px` }}>
      <button type="button" className={cn(index === active && "active")} onClick={() => { setActive(index); heading.element.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{heading.text}</button>
    </li>)}</ol>
  </nav>;
}

const runIcons: Record<string, ReactNode> = {
  done: <CheckCircle2 size={14} />, done_with_warnings: <CheckCircle2 size={14} />, failed: <XCircle size={14} />, cancelled: <CircleStop size={14} />, queued: <Clock3 size={14} />,
};

export function runDuration(run: Pick<WorkflowRun, "startedAt" | "completedAt">) {
  if (!run.startedAt || !run.completedAt) return undefined;
  const seconds = Math.max(0, Math.round((Date.parse(run.completedAt) - Date.parse(run.startedAt)) / 1000));
  return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s` : `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
}

/** Every module run on this job, oldest first, as a compact timeline. */
export function RunTimeline({ runs, titleFor }: { runs: WorkflowRun[]; titleFor: (run: WorkflowRun) => string }) {
  if (!runs.length) return null;
  return <details className="run-timeline" open={runs.length > 1}>
    <summary>Run history <small>{runs.length}</small></summary>
    <ol>{runs.map((run) => {
      const duration = runDuration(run);
      return <li key={run.id} className={`run-status-${run.status}`}>
        <span className="run-timeline-dot">{runIcons[run.status] || <LoaderCircle size={14} className="animate-spin" />}</span>
        <span><strong>{titleFor(run)}</strong><small>{timeAgo(run.createdAt)}{duration ? ` · ${duration}` : ""}{run.status === "failed" && run.error ? ` · ${run.error}` : ""}</small></span>
      </li>;
    })}</ol>
  </details>;
}
