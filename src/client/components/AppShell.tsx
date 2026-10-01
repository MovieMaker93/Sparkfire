import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { AudioLines, BrainCircuit, ChevronUp, GitBranch, Images, Image as ImageIcon, LayoutGrid, Languages, MessageCircle, Network, PanelLeftClose, PanelLeftOpen, ScanSearch, ScanText, Search, Settings } from "lucide-react";
import { api } from "../api";
import { settingsUpdatedEvent } from "../settings-events";
import type { Health, ModuleDescriptor, Settings as AppSettings, SparkStatus } from "../types";
import { displayVersion, isNewerVersion, latestRelease, type ReleaseManifest } from "../version";
import { useGlobalSearch } from "./GlobalSearch";

const moduleIcons = { "scan-text": ScanText, "audio-lines": AudioLines, languages: Languages, "scan-search": ScanSearch, image: ImageIcon, network: Network, "message-circle": MessageCircle };
const mobileNav = [
  { to: "/", label: "Home", icon: LayoutGrid, exact: true },
  { to: "/workflows", label: "Flows", icon: GitBranch, exact: false },
  { to: "/chat", label: "Chat", icon: MessageCircle, exact: false },
  { to: "/settings", label: "Settings", icon: Settings, exact: false },
] as const;

const services = [
  { kind: "stt" as const, label: "STT", fallback: "Speech recognition", icon: AudioLines },
  { kind: "ocr" as const, label: "OCR", fallback: "Document recognition", icon: ScanText },
  { kind: "llm" as const, label: "LLM", fallback: "Language model", icon: BrainCircuit },
  { kind: "translation" as const, label: "Translation", fallback: "Not configured", icon: Languages },
  { kind: "grounding" as const, label: "Grounding", fallback: "Not configured", icon: ScanSearch },
  { kind: "image-generation" as const, label: "Image", fallback: "Not configured", icon: ImageIcon },
];
const sidebarPreferenceKey = "sparklingkit:sidebar-collapsed";
const monitorPreferenceKey = "sparklingkit:monitor-expanded";

type ServiceState = "online" | "disabled" | "offline" | "checking";

function serviceState(health: Health | undefined, kind: (typeof services)[number]["kind"]): ServiceState {
  const endpoint = health?.endpoints[kind];
  return endpoint?.ok ? "online" : endpoint && !endpoint.enabled ? "disabled" : health ? "offline" : "checking";
}

const serviceStateLabel: Record<ServiceState, string> = { online: "Online", disabled: "Disabled", offline: "Offline", checking: "Checking" };

/** One compact control for all model services; the per-service rows live in a popover. */
function ServicesChip({ health }: { health?: Health }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const states = services.map(({ kind }) => serviceState(health, kind));
  const enabled = states.filter((state) => state !== "disabled");
  const online = states.filter((state) => state === "online").length;
  const summary = health ? `${online}/${enabled.length} online` : "Checking";
  const tone = !health ? "checking" : enabled.length && online === enabled.length ? "online" : online ? "partial" : "offline";

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return <div className="services-chip-wrap" ref={wrapper}>
    <button type="button" className={`services-chip tone-${tone}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog" aria-label={`AI services, ${summary}`} title={`AI services · ${summary}`}>
      <span className="services-chip-dots" aria-hidden="true">{states.map((state, index) => <i key={services[index].kind} className={state} />)}</span>
      <span className="services-chip-label">AI services</span>
      <span className="services-chip-count">{summary}</span>
      <ChevronUp size={15} className="services-chip-caret" />
    </button>
    {open && <div className="services-popover" role="dialog" aria-label="AI services">
      <div className="services-popover-heading"><strong>AI services</strong><small>{summary}</small></div>
      <div className="service-list">
        {services.map(({ kind, label, fallback, icon: Icon }, index) => {
          const endpoint = health?.endpoints[kind];
          const state = states[index];
          return <div className="service-row" key={kind}>
            <span className={`service-icon service-icon-${kind}`}><Icon size={16} strokeWidth={1.9} /></span>
            <span className="service-copy"><strong>{label}</strong><small title={endpoint?.model || fallback}>{endpoint?.model || fallback}</small></span>
            <span className={`service-state ${state}`}><i />{serviceStateLabel[state]}</span>
          </div>;
        })}
      </div>
      <Link to="/settings" state={{ backgroundLocation: location }} className="services-popover-link" onClick={() => setOpen(false)}>Manage services</Link>
    </div>}
  </div>;
}

function gibibytes(bytes: number) {
  return `${(bytes / 2 ** 30).toFixed(1)} GiB`;
}

function ProductFooter({ currentVersion, latest }: { currentVersion?: string; latest?: ReleaseManifest }) {
  const updateAvailable = isNewerVersion(currentVersion, latest?.version);
  return <footer className="product-footer">
    <div className="product-footer-links"><a href="https://sparklingkit.com" target="_blank" rel="noreferrer">sparklingkit.com</a><i /><a href="https://github.com/stevibe/SparklingKit" target="_blank" rel="noreferrer">GitHub</a></div>
    <div className="product-footer-version" aria-live="polite"><span>{displayVersion(currentVersion)}</span>{updateAvailable && <a href="https://github.com/stevibe/SparklingKit/blob/main/docs/deployment.md#upgrade" target="_blank" rel="noreferrer" title={`${displayVersion(latest?.version)} is available. Open the upgrade guide.`}>Update available</a>}</div>
  </footer>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<Health>();
  const [sparkStatus, setSparkStatus] = useState<SparkStatus>();
  const [systemStatusBaseUrl, setSystemStatusBaseUrl] = useState<string>();
  const [modules, setModules] = useState<ModuleDescriptor[]>([]);
  const [latest, setLatest] = useState<ReleaseManifest>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return window.localStorage.getItem(sidebarPreferenceKey) === "true"; } catch { return false; }
  });
  const [monitorExpanded, setMonitorExpanded] = useState(() => {
    try { return window.localStorage.getItem(monitorPreferenceKey) === "true"; } catch { return false; }
  });
  const location = useLocation();
  const { openSearch } = useGlobalSearch();

  useEffect(() => {
    let active = true;
    const refresh = () => api.health().then((value) => active && setHealth(value)).catch(() => active && setHealth(undefined));
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    let active = true;
    const applySettings = (settings: AppSettings) => {
      if (active) setSystemStatusBaseUrl(settings.systemStatus.baseUrl.trim());
    };
    const handleSettingsUpdated = (event: Event) => applySettings((event as CustomEvent<AppSettings>).detail);
    api.settings().then(applySettings).catch(() => active && setSystemStatusBaseUrl(""));
    window.addEventListener(settingsUpdatedEvent, handleSettingsUpdated);
    return () => {
      active = false;
      window.removeEventListener(settingsUpdatedEvent, handleSettingsUpdated);
    };
  }, []);
  useEffect(() => {
    if (!systemStatusBaseUrl) {
      setSparkStatus(undefined);
      return;
    }
    let active = true;
    const refresh = () => api.systemStatus().then((value) => active && setSparkStatus(value)).catch(() => active && setSparkStatus(undefined));
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [systemStatusBaseUrl]);
  useEffect(() => { api.modules().then(setModules).catch(() => setModules([])); }, []);
  useEffect(() => {
    const controller = new AbortController();
    latestRelease(controller.signal).then(setLatest).catch(() => undefined);
    return () => controller.abort();
  }, []);
  const enabled = health ? Object.values(health.endpoints).filter((item) => item.enabled) : [];
  const healthy = enabled.filter((item) => item.ok).length;
  const serviceSummary = health ? `${healthy}/${enabled.length} online` : "Checking";
  const activeChat = location.pathname.startsWith("/chat/");
  const gpu = sparkStatus?.gpu.devices[0];
  const memory = sparkStatus?.host.memory;
  const onlineModels = sparkStatus?.services.filter((service) => service.ok).length || 0;
  const toggleMonitor = () => {
    const next = !monitorExpanded;
    setMonitorExpanded(next);
    try { window.localStorage.setItem(monitorPreferenceKey, String(next)); } catch { /* Storage can be unavailable in private contexts. */ }
  };
  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try { window.localStorage.setItem(sidebarPreferenceKey, String(next)); } catch { /* Storage can be unavailable in private contexts. */ }
  };
  return (
    <div className={`app-shell min-h-screen bg-canvas text-ink ${activeChat ? "active-chat-shell" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <header className="mobile-header">
        <Link to="/" className="brand-wordmark" aria-label="SparklingKit home">SparklingKit</Link>
        <Link to="/settings" state={{ backgroundLocation: location }} className="mobile-service-chip" aria-label={`Open settings, ${serviceSummary}`}><i className={enabled.length > 0 && healthy === enabled.length ? "online" : ""} />{serviceSummary}</Link>
      </header>
      <aside className="sidebar" id="app-sidebar">
        <div className="sidebar-brand-row">
          <Link to="/" className="brand-wordmark" aria-label="SparklingKit home">SparklingKit</Link>
          <button type="button" className="sidebar-collapse-button" onClick={toggleSidebar} aria-controls="app-sidebar" aria-expanded={!sidebarCollapsed} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>{sidebarCollapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}</button>
        </div>
        <button type="button" className="sidebar-search-button" onClick={() => openSearch()} title="Search SparklingKit (⌘K)" aria-label="Search SparklingKit"><Search size={18} /><span>Search</span><kbd>⌘K</kbd></button>
        <p className="nav-label">Workspace</p>
        <nav>
          <NavLink to="/" end title="Workbench" aria-label="Workbench" className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`}><LayoutGrid size={19} strokeWidth={1.8} /><span>Workbench</span></NavLink>
          <NavLink to="/workflows" title="Workflows" aria-label="Workflows" className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`}><GitBranch size={19} strokeWidth={1.8} /><span>Workflows</span></NavLink>
          <NavLink to="/gallery" title="Gallery" aria-label="Gallery" className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`}><Images size={19} strokeWidth={1.8} /><span>Gallery</span></NavLink>
          <p className="nav-label nav-label-tools">Tools</p>
          <div className="module-nav-list">{modules.map((module) => {
            const Icon = moduleIcons[module.icon];
            return <NavLink key={module.id} to={module.route} title={module.title} aria-label={module.title} className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`}><Icon size={19} strokeWidth={1.8} /><span>{module.title}</span>{module.implementation === "planned" && <small>Planned</small>}</NavLink>;
          })}</div>
          <NavLink to="/settings" state={{ backgroundLocation: location }} title="Settings" aria-label="Settings" className={({ isActive }) => `nav-link settings-nav-link ${isActive ? "nav-link-active" : ""}`}><Settings size={19} strokeWidth={1.8} /><span>Settings</span></NavLink>
        </nav>
        <div className="sidebar-status mt-auto">
          {systemStatusBaseUrl && <div className={`spark-monitor ${monitorExpanded ? "expanded" : ""}`}>
            <button type="button" className="spark-monitor-summary" onClick={toggleMonitor} aria-expanded={monitorExpanded} title={monitorExpanded ? "Hide machine details" : "Show machine details"}>
              <span className="spark-monitor-heading"><strong>{sparkStatus?.host.hostname || "System monitor"}</strong><span className={sparkStatus ? "online" : ""}><i />{sparkStatus ? "Live" : "Unavailable"}</span></span>
              {memory ? <>
                <span className="spark-memory-track" role="img" aria-label={`Memory ${Math.round(memory.usedPercent)}% used`}><i style={{ width: `${Math.min(100, memory.usedPercent)}%` }} /></span>
                <span className="spark-monitor-foot"><span>{gibibytes(memory.usedBytes)} / {gibibytes(memory.totalBytes)}</span><span>GPU {gpu?.utilizationPercent ?? 0}%</span></span>
              </> : <small>Waiting for status data</small>}
            </button>
            {monitorExpanded && sparkStatus && <dl className="spark-monitor-details">
              <div><dt>CUDA allocations</dt><dd>{gibibytes(sparkStatus.gpu.allocatedProcessMemoryBytes)}</dd></div>
              {gpu?.temperatureC != null && <div><dt>Temperature</dt><dd>{gpu.temperatureC}°C</dd></div>}
              <div><dt>Models online</dt><dd>{onlineModels}/{sparkStatus.services.length}</dd></div>
            </dl>}
          </div>}
          <ServicesChip health={health} />
          <ProductFooter currentVersion={health?.version} latest={latest} />
        </div>
      </aside>
      <main className="main-content">{children}<div className="mobile-product-footer"><ProductFooter currentVersion={health?.version} latest={latest} /></div></main>
      <nav className="mobile-tabbar" aria-label="Primary navigation">
        {mobileNav.slice(0, 2).map(({ to, label, icon: Icon, exact }) => <NavLink key={to} to={to} end={exact} className={({ isActive }) => isActive ? "active" : ""}><Icon size={20} strokeWidth={1.9} /><span>{label}</span></NavLink>)}
        <button type="button" onClick={() => openSearch()} aria-label="Search"><Search size={20} strokeWidth={1.9} /><span>Search</span></button>
        {mobileNav.slice(2).map(({ to, label, icon: Icon, exact }) => <NavLink key={to} to={to} state={to === "/settings" ? { backgroundLocation: location } : undefined} end={exact} className={({ isActive }) => isActive ? "active" : ""}><Icon size={20} strokeWidth={1.9} /><span>{label}</span></NavLink>)}
      </nav>
    </div>
  );
}
