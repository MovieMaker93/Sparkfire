import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Columns2, Download, ExternalLink, Images, X } from "lucide-react";
import { api, thumbnailUrl } from "../api";
import { cn, displayTitle, timeAgo } from "../components/ui";
import type { GalleryItem } from "../types";

type Source = "all" | "generated" | "uploaded";

const sources: Array<{ value: Source; label: string }> = [
  { value: "all", label: "All" },
  { value: "generated", label: "Generated" },
  { value: "uploaded", label: "Uploaded" },
];

/** Maps a job-relative artifact path onto the routes that serve job files. */
export function artifactFileUrl(item: Pick<GalleryItem, "jobId" | "path">) {
  const [folder, ...rest] = item.path.split("/");
  const relative = rest.map(encodeURIComponent).join("/");
  return folder === "input" ? `/api/jobs/${encodeURIComponent(item.jobId)}/input/${relative}` : `/api/jobs/${encodeURIComponent(item.jobId)}/files/${relative}`;
}

const itemKey = (item: GalleryItem) => `${item.jobId}/${item.artifactId}`;

function itemTitle(item: GalleryItem) {
  return item.prompt || displayTitle({ title: item.jobTitle, type: item.jobType, moduleId: item.moduleId, workflowId: item.workflowId, createdAt: item.createdAt });
}

export function GalleryPage() {
  const [source, setSource] = useState<Source>("all");
  const [model, setModel] = useState("");
  const [data, setData] = useState<{ items: GalleryItem[]; total: number; models: string[] }>();
  const [error, setError] = useState("");
  const [comparing, setComparing] = useState(false);
  const [picked, setPicked] = useState<GalleryItem[]>([]);
  const [open, setOpen] = useState<GalleryItem>();

  useEffect(() => {
    let active = true;
    setError("");
    api.gallery({ source, model, limit: 200 })
      .then((result) => active && setData(result))
      .catch((value) => active && setError(value instanceof Error ? value.message : String(value)));
    return () => { active = false; };
  }, [source, model]);

  useEffect(() => {
    if (!open && picked.length < 2) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(undefined);
      setPicked([]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, picked.length]);

  function choose(item: GalleryItem) {
    if (!comparing) return setOpen(item);
    setPicked((current) => current.some((candidate) => itemKey(candidate) === itemKey(item))
      ? current.filter((candidate) => itemKey(candidate) !== itemKey(item))
      : [...current, item].slice(-2));
  }

  const items = data?.items || [];
  return <div className="page-wrap content-page gallery-page">
    <header className="gallery-header">
      <div><h1>Gallery</h1><p>{data ? `${data.total} image${data.total === 1 ? "" : "s"}` : "Loading…"}</p></div>
      <div className="gallery-controls">
        <div className="theme-choice" role="radiogroup" aria-label="Image source">{sources.map((option) => <button key={option.value} type="button" role="radio" aria-checked={source === option.value} className={cn(source === option.value && "active")} onClick={() => setSource(option.value)}>{option.label}</button>)}</div>
        {Boolean(data?.models.length) && <select className="input gallery-model" value={model} onChange={(event) => setModel(event.target.value)} aria-label="Model"><option value="">All models</option>{data!.models.map((name) => <option key={name} value={name}>{name}</option>)}</select>}
        <button type="button" className={comparing ? "button-primary compact" : "button-secondary compact"} onClick={() => { setComparing(!comparing); setPicked([]); }} aria-pressed={comparing}><Columns2 size={16} />Compare</button>
      </div>
    </header>
    {comparing && <p className="gallery-hint">Pick two images to compare them side by side ({picked.length}/2).</p>}
    {error && <p className="form-error">{error}</p>}
    {data && !items.length ? <div className="empty-card"><Images size={28} /><strong>No images yet</strong><p>Generated images and uploaded pictures appear here.</p></div> : <div className="gallery-grid">
      {items.map((item) => {
        const pickIndex = picked.findIndex((candidate) => itemKey(candidate) === itemKey(item));
        return <figure key={itemKey(item)} className={cn("gallery-card", pickIndex >= 0 && "picked")}>
          <button type="button" onClick={() => choose(item)} aria-label={comparing ? `Pick ${itemTitle(item)} for comparison` : `Open ${itemTitle(item)}`}>
            <img src={thumbnailUrl(item.jobId, item.artifactId, 640)} alt="" loading="lazy" decoding="async" />
            {comparing && <span className="gallery-pick" aria-hidden="true">{pickIndex >= 0 ? pickIndex + 1 : ""}</span>}
          </button>
          <figcaption><strong title={itemTitle(item)}>{itemTitle(item)}</strong><small>{item.model && <span className="gallery-model-chip">{item.model}</span>}{item.role === "source" ? "Uploaded" : "Generated"} · {timeAgo(item.createdAt)}</small></figcaption>
        </figure>;
      })}
    </div>}
    {open && <div className="modal-backdrop gallery-lightbox" onMouseDown={(event) => event.target === event.currentTarget && setOpen(undefined)}>
      <div className="gallery-lightbox-card" role="dialog" aria-modal="true" aria-label={itemTitle(open)}>
        <img src={artifactFileUrl(open)} alt={itemTitle(open)} />
        <aside>
          <button type="button" className="icon-button gallery-close" onClick={() => setOpen(undefined)} aria-label="Close"><X size={18} /></button>
          <ImageDetails item={open} />
          <div className="gallery-lightbox-actions">
            <Link to={`/jobs/${encodeURIComponent(open.jobId)}`} className="button-secondary compact"><ExternalLink size={15} />Open job</Link>
            <a href={artifactFileUrl(open)} download={open.name} className="button-primary compact"><Download size={15} />Download</a>
          </div>
        </aside>
      </div>
    </div>}
    {picked.length === 2 && <div className="modal-backdrop gallery-compare" onMouseDown={(event) => event.target === event.currentTarget && setPicked([])}>
      <div className="gallery-compare-card" role="dialog" aria-modal="true" aria-label="Compare images">
        <header><strong>Compare</strong><button type="button" className="icon-button" onClick={() => setPicked([])} aria-label="Close comparison"><X size={18} /></button></header>
        <div className="gallery-compare-grid">{picked.map((item) => <section key={itemKey(item)}><img src={artifactFileUrl(item)} alt={itemTitle(item)} /><ImageDetails item={item} /></section>)}</div>
      </div>
    </div>}
  </div>;
}

function ImageDetails({ item }: { item: GalleryItem }) {
  const rows: Array<[string, string | number | undefined]> = [
    ["Model", item.model],
    ["Size", item.size?.replace("x", " × ")],
    ["Seed", item.seed],
    ["Steps", item.steps],
    ["Created", new Date(item.createdAt).toLocaleString()],
  ];
  return <div className="gallery-details">
    <p>{itemTitle(item)}</p>
    <dl>{rows.filter(([, value]) => value !== undefined && value !== "").map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </div>;
}
