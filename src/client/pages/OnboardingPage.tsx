import { useMemo, useState } from "react";
import { Check, CircleAlert, Copy, Cpu, LoaderCircle, Network, ServerCog } from "lucide-react";
import { api } from "../api";
import { BrandWordmark } from "../components/BrandMark";
import { cn } from "../components/ui";
import { useToast } from "../components/ToastProvider";
import { ENDPOINT_KINDS, type EndpointConfig, type EndpointHealth, type EndpointKind, type Settings } from "../../shared/contracts";
import { OPTIONAL_REFERENCE_ENDPOINT_KINDS, REFERENCE_ENDPOINT_KINDS, referenceSettingsForHost, type StackDeployment } from "../../shared/reference-stack";

type OnboardingTab = "local" | "remote";

const serviceLabels: Record<EndpointKind, string> = {
  llm: "Multimodal LLM",
  ocr: "OCR",
  stt: "Transcription",
  translation: "Translation",
  grounding: "Grounding",
  "image-generation": "Image generation",
  "video-generation": "Video generation",
  "music-generation": "Music generation",
};

// Video generation may be left out of a deployment (--video-backend none), so its absence does not fail setup.
const checkedReferenceKinds: EndpointKind[] = [...REFERENCE_ENDPOINT_KINDS, ...OPTIONAL_REFERENCE_ENDPOINT_KINDS];
const isOptionalReferenceKind = (kind: EndpointKind) => (OPTIONAL_REFERENCE_ENDPOINT_KINDS as readonly EndpointKind[]).includes(kind);

// There is no hosted installer, so the stack starts from a clone.
const installCommand = `git clone --depth 1 https://github.com/MovieMaker93/Sparkfire.git
cd Sparkfire
./scripts/start-dgx-spark.sh --accept-model-licenses`;

export function OnboardingPage({ settings, canCancel, onComplete, onCancel }: {
  settings: Settings;
  canCancel: boolean;
  onComplete: (settings: Settings) => void;
  onCancel: () => void;
}) {
  const [tab, setTab] = useState<OnboardingTab>(settings.setup.mode === "split" ? "remote" : "local");
  const [remoteHost, setRemoteHost] = useState(guessReferenceHost(settings));
  const [referenceChecks, setReferenceChecks] = useState<Partial<Record<EndpointKind, EndpointHealth | "testing">>>({});
  const [verifiedStack, setVerifiedStack] = useState<StackDeployment>();
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const configuredCount = useMemo(() => ENDPOINT_KINDS.filter((kind) => isConfigured(settings.endpoints[kind])).length, [settings]);

  function changeTab(next: OnboardingTab) {
    setTab(next);
    setError("");
    setVerifiedStack(undefined);
    setReferenceChecks({});
  }

  async function copyText(value: string, label = "Command copied") {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(label);
    } catch {
      toast.error("Could not copy to the clipboard");
    }
  }

  async function verifyReference() {
    if (checking) return;
    setChecking(true);
    setError("");
    setVerifiedStack(undefined);
    setReferenceChecks(Object.fromEntries(checkedReferenceKinds.map((kind) => [kind, "testing"])));
    try {
      const host = tab === "local" ? "host.docker.internal" : remoteHost;
      const mode = tab === "local" ? "all-in-one" : "split";
      const candidate = referenceSettingsForHost(settings, host, mode);
      const results = await Promise.all(checkedReferenceKinds.map(async (kind) => {
        try {
          return [kind, await api.testEndpoint(kind, candidate.endpoints[kind])] as const;
        } catch (value) {
          return [kind, failedHealth(kind, candidate.endpoints[kind], value)] as const;
        }
      }));
      const checks = Object.fromEntries(results) as Record<EndpointKind, EndpointHealth>;
      setReferenceChecks(checks);
      const failures = results.filter(([kind, result]) => !result.ok && !isOptionalReferenceKind(kind)).map(([kind]) => serviceLabels[kind]);
      if (failures.length) {
        setError(`${REFERENCE_ENDPOINT_KINDS.length - failures.length}/${REFERENCE_ENDPOINT_KINDS.length} AI services of the stack responded. Check ${failures.join(", ")} and try again.`);
        return;
      }
      // Video is on when it answered; a stack started with --video-backend none leaves it out.
      const video = checks["video-generation"]?.ok === true;
      setVerifiedStack({ host, mode, video });
      toast.success("Stack verified", video ? "Review the connection and apply when ready." : "Video generation did not answer and stays off.");
    } catch (value) {
      setReferenceChecks({});
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setChecking(false);
    }
  }

  async function applyReference() {
    if (!verifiedStack || saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = await api.applyStack(verifiedStack);
      toast.success("Deployment connected", "Your jobs, chats, workflows, and files were preserved.");
      onComplete(saved);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSaving(false);
    }
  }

  return <main className="onboarding-page">
    <div className="onboarding-shell">
      <header className="onboarding-header">
        <div className="brand-wordmark"><BrandWordmark /></div>
        {canCancel && <button className="button-secondary compact" onClick={onCancel}>Back to workspace</button>}
      </header>

      <section className="onboarding-content onboarding-setup">
        <div className="onboarding-intro">
          <span>{canCancel ? "Deployment setup" : "Welcome to Sparkfire"}</span>
          <h1>Connect your AI services</h1>
          <p>Sparkfire runs on its own model stack on a DGX Spark, with one model per service chosen to share its memory: Saluki 27B for chat, PaddleOCR-VL, Parakeet, Hy-MT2, Qwen-Image-2.1-Turbo, FastH3 and YuE2. Tell Sparkfire where the stack runs; the models come with it.</p>
        </div>

        {canCancel && configuredCount > 0 && <div className="onboarding-existing-note">
          <CircleAlert size={20} />
          <span><strong>You already have {configuredCount} configured service{configuredCount === 1 ? "" : "s"}.</strong><small>Nothing changes until you apply this setup. Jobs, chats, workflows, and files will not be removed.</small></span>
        </div>}

        <div className="onboarding-tabs" role="tablist" aria-label="AI service deployment">
          <button className={tab === "local" ? "active" : ""} onClick={() => changeTab("local")} role="tab" aria-selected={tab === "local"}><Cpu size={18} /><span><strong>Run models locally</strong><small>DGX and app on this machine</small></span></button>
          <button className={tab === "remote" ? "active" : ""} onClick={() => changeTab("remote")} role="tab" aria-selected={tab === "remote"}><Network size={18} /><span><strong>Run models remotely</strong><small>DGX on another machine</small></span></button>
        </div>

        <div className="onboarding-tab-panel" role="tabpanel">
          <div className="onboarding-panel-heading">
            <span className="onboarding-option-icon">{tab === "local" ? <Cpu size={24} /> : <Network size={24} />}</span>
            <div><h2>{tab === "local" ? "Start the model stack on this machine" : "Start the model stack on your DGX Spark"}</h2><p>{tab === "local" ? "Local means the server running this Sparkfire container, not the phone or computer viewing this page." : "Use the same model installer, then provide an address reachable from the Sparkfire server."}</p></div>
          </div>

          <div className="onboarding-step"><span>1</span><div><h3>Install and start the models</h3><p>Model weights remain on the DGX and are downloaded from their publishers.</p></div></div>
          <div className="onboarding-command"><span><ServerCog size={18} /><code>{installCommand}</code></span><button onClick={() => void copyText(installCommand)} aria-label="Copy model installation command"><Copy size={17} /></button></div>
          <p className="onboarding-script-note">The script builds the service images, downloads the models and starts the services in a memory-safe order. It never installs Docker itself; <code>./scripts/start-dgx-spark.sh status</code> and <code>stop</code> manage the stack later.</p>

          <div className="onboarding-step onboarding-connect-step"><span>2</span><div><h3>{tab === "local" ? "Verify local services" : "Connect this workspace"}</h3><p>{tab === "local" ? "Sparkfire uses Docker's host gateway to reach ports 8330–8334, 8336, 8337, and 8339." : "Ports 8330–8334, 8336, 8337, and 8339 must be reachable from this server over a trusted LAN or VPN. Web search stays on the Spark, so it is off in a workspace on another machine."}</p></div></div>
          {tab === "remote" && <label className="onboarding-host-field">DGX hostname or IP<input className="input" value={remoteHost} onChange={(event) => { setRemoteHost(event.target.value); setVerifiedStack(undefined); setReferenceChecks({}); setError(""); }} placeholder="192.168.22.33 or dgx-spark.local" /></label>}

          <ReferenceChecks checks={referenceChecks} />
          {error && <p className="onboarding-error" role="alert">{error}</p>}
          <div className="onboarding-review-note"><strong>Applying points every service at the stack's models on this Spark, with the system monitor.</strong><span>It does not change workspace data or processing settings.</span></div>
          <div className="onboarding-actions">{canCancel && <button className="button-secondary" onClick={onCancel}>Cancel</button>}{!verifiedStack ? <button className="button-primary" onClick={() => void verifyReference()} disabled={checking || (tab === "remote" && !remoteHost.trim())}>{checking ? <><LoaderCircle size={18} className="animate-spin" />Checking services…</> : "Verify services"}</button> : <button className="button-primary" onClick={() => void applyReference()} disabled={saving}>{saving ? <><LoaderCircle size={18} className="animate-spin" />Applying…</> : <><Check size={18} />Apply and continue</>}</button>}</div>
        </div>
      </section>
    </div>
  </main>;
}

function ReferenceChecks({ checks }: { checks: Partial<Record<EndpointKind, EndpointHealth | "testing">> }) {
  if (!Object.keys(checks).length) return null;
  return <div className="onboarding-reference-checks">{checkedReferenceKinds.map((kind) => {
    const result = checks[kind];
    const optional = isOptionalReferenceKind(kind);
    return <div className={cn(result !== "testing" && result?.ok ? "online" : result === "testing" ? "checking" : optional ? "skipped" : "offline")} key={kind}><span>{result === "testing" ? <LoaderCircle size={16} className="animate-spin" /> : result?.ok ? <Check size={16} /> : <i />}</span><strong>{serviceLabels[kind]}{optional ? " · optional" : ""}</strong><small>{result === "testing" ? "Checking…" : result?.ok ? `${result.latencyMs} ms` : optional ? "Not running · stays off" : result?.error || "Unavailable"}</small></div>;
  })}</div>;
}

function isConfigured(endpoint: EndpointConfig) {
  return endpoint.enabled && Boolean(endpoint.baseUrl.trim() && endpoint.model.trim());
}

function guessReferenceHost(settings: Settings) {
  const baseUrl = settings.endpoints.ocr.baseUrl;
  if (!baseUrl) return "";
  try {
    const host = new URL(baseUrl).hostname;
    return host === "host.docker.internal" ? "" : host;
  } catch {
    return "";
  }
}

function failedHealth(kind: EndpointKind, endpoint: EndpointConfig, value: unknown): EndpointHealth {
  return { kind, ok: false, enabled: endpoint.enabled, latencyMs: 0, model: endpoint.model, availableModels: [], error: value instanceof Error ? value.message : String(value) };
}
