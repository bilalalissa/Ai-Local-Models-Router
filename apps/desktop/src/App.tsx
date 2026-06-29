import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  Bot,
  Clipboard,
  Cloud,
  Cpu,
  Download,
  FileBarChart,
  FileJson,
  FileText,
  Home,
  Laptop,
  Layers3,
  Menu,
  MessageSquare,
  Monitor,
  Network,
  Pause,
  Play,
  Route,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  RefreshCw
} from "lucide-react";
import {
  type AppStateSnapshot,
  type PauseDuration,
  type PauseSettings,
  type PauseSource,
  getAppState,
  pauseApp,
  resumeApp,
  subscribeAppState,
  updatePauseSettings
} from "./appState";
import {
  type HardwareExportFormat,
  type HardwareFixtureSummary,
  type HardwareSpecs,
  exportHardwareSpecs,
  formatBytesGb,
  listHardwareFixtures,
  loadHardwareFixture,
  refreshHardwareSpecs
} from "./hardware";

type PageId =
  | "dashboard"
  | "machine-specs"
  | "model-fit-map"
  | "models"
  | "providers"
  | "router"
  | "remote-pcs"
  | "updates"
  | "settings"
  | "logs";

type NavItem = {
  id: PageId;
  label: string;
  icon: typeof Home;
};

type EmptyPage = {
  title: string;
  eyebrow: string;
  summary: string;
  readiness: string[];
};

type PauseAction = {
  label: string;
  duration: PauseDuration;
  reason: string;
};

const navItems: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "machine-specs", label: "Machine Specs", icon: Cpu },
  { id: "model-fit-map", label: "Model Fit Map", icon: FileBarChart },
  { id: "models", label: "Models", icon: Layers3 },
  { id: "providers", label: "Providers", icon: Cloud },
  { id: "router", label: "Router", icon: Route },
  { id: "remote-pcs", label: "Remote PCs", icon: Monitor },
  { id: "updates", label: "Updates", icon: Download },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "logs", label: "Logs", icon: FileText }
];

const pageContent: Record<
  Exclude<PageId, "dashboard" | "machine-specs" | "router" | "settings" | "logs">,
  EmptyPage
> = {
  "model-fit-map": {
    title: "Model Fit Map",
    eyebrow: "Stage 1 page shell",
    summary:
      "Compatibility scoring and seeded recommendations are implemented in Stage 4.",
    readiness: ["Model table frame", "Filter rail", "Compatibility legend"]
  },
  models: {
    title: "Models",
    eyebrow: "Stage 1 page shell",
    summary:
      "Install, uninstall, force, and switch model actions are intentionally inactive until later stages.",
    readiness: ["Installed model list", "Detail pane", "Manual action area"]
  },
  providers: {
    title: "Providers",
    eyebrow: "Stage 1 page shell",
    summary:
      "Provider cards are present as a visual shell; real adapters begin with mock providers in Stage 5.",
    readiness: ["MLX-LM card", "Ollama card", "LM Studio card", "Custom endpoint card"]
  },
  "remote-pcs": {
    title: "Remote PCs",
    eyebrow: "Stage 1 page shell",
    summary:
      "Remote discovery, pairing, and Windows broker integration are deferred to Stages 11 and 12.",
    readiness: ["Discovery controls", "Manual IP entry", "Paired devices list"]
  },
  updates: {
    title: "Updates",
    eyebrow: "Stage 1 page shell",
    summary:
      "Metadata checks, update cards, and update history are implemented in Stage 10.",
    readiness: ["Available updates area", "History table", "Privacy mode note"]
  }
};

const installedModels = [
  { name: "Qwen3 8B", size: "8.0B", format: "Q4_K_M", fit: "Good", lastUsed: "Now" },
  { name: "Llama 3.1 8B", size: "8.0B", format: "Q4_K_M", fit: "Good", lastUsed: "2h ago" },
  { name: "Phi-3.5 Mini", size: "3.8B", format: "Q4_K_M", fit: "Smooth", lastUsed: "2d ago" }
];

const pauseActions: PauseAction[] = [
  {
    label: "Pause now",
    duration: "UntilManualResume",
    reason: "Pause until manually resumed"
  },
  {
    label: "Pause after current generation",
    duration: "AfterCurrentGeneration",
    reason: "Pause after current generation"
  },
  {
    label: "Pause for 15 minutes",
    duration: { ForMinutes: 15 },
    reason: "Pause for 15 minutes"
  },
  {
    label: "Pause for 1 hour",
    duration: { ForMinutes: 60 },
    reason: "Pause for 1 hour"
  }
];

const initialAppState: AppStateSnapshot = {
  lifecycle_state: "Running",
  settings: {
    remember_pause_state_after_restart: true,
    allow_critical_health_security_notifications_while_paused: true
  },
  paused_until_ms: null,
  pause_reason: null,
  suspended_tasks: {
    routing_changes: 0,
    update_checks: 0,
    model_installs: 0,
    remote_discovery: 0,
    health_polling: 0
  },
  pause_history: []
};

export default function App() {
  const [activePage, setActivePage] = useState<PageId>(() => pageFromHash());
  const [appState, setAppState] = useState<AppStateSnapshot>(initialAppState);
  const activeLabel = useMemo(
    () => navItems.find((item) => item.id === activePage)?.label ?? "Dashboard",
    [activePage]
  );
  const isPaused = appState.lifecycle_state === "Paused";

  useEffect(() => {
    const onHashChange = () => setActivePage(pageFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    let ignore = false;
    let unlisten: (() => void) | undefined;

    getAppState()
      .then((snapshot) => {
        if (!ignore) {
          setAppState(snapshot);
        }
      })
      .catch(() => {
        if (!ignore) {
          setAppState(initialAppState);
        }
      });

    subscribeAppState((snapshot) => setAppState(snapshot)).then((unsubscribe) => {
      unlisten = unsubscribe;
    });

    return () => {
      ignore = true;
      unlisten?.();
    };
  }, []);

  const handlePause = useCallback(
    async (source: PauseSource, action: PauseAction = pauseActions[0]) => {
      const snapshot = await pauseApp({
        source,
        duration: action.duration,
        reason: action.reason
      });
      setAppState(snapshot);
    },
    []
  );

  const handleResume = useCallback(async (source: PauseSource) => {
    const snapshot = await resumeApp(source);
    setAppState(snapshot);
  }, []);

  const handleSettingsChange = useCallback(async (settings: PauseSettings) => {
    const snapshot = await updatePauseSettings(settings);
    setAppState(snapshot);
  }, []);

  return (
    <div className={`app-shell ${isPaused ? "is-paused" : ""}`}>
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <main className="main-shell">
        <TopBar
          appState={appState}
          activeLabel={activeLabel}
          onPause={() => handlePause(topBarSource(activePage))}
          onResume={() => handleResume(topBarSource(activePage))}
        />
        <section className="page-surface">
          {isPaused ? (
            <PausedBanner
              suspendedTotal={totalSuspended(appState)}
              onResume={() => handleResume(topBarSource(activePage))}
            />
          ) : null}
          {activePage === "dashboard" ? (
            <Dashboard appState={appState} onPause={handlePause} onResume={handleResume} />
          ) : activePage === "machine-specs" ? (
            <MachineSpecsPage />
          ) : activePage === "router" ? (
            <RouterShell appState={appState} onPause={handlePause} onResume={handleResume} />
          ) : activePage === "settings" ? (
            <SettingsPage
              appState={appState}
              onPause={handlePause}
              onResume={handleResume}
              onSettingsChange={handleSettingsChange}
            />
          ) : activePage === "logs" ? (
            <LogsPage appState={appState} />
          ) : (
            <EmptyStatePage page={pageContent[activePage]} />
          )}
        </section>
      </main>
    </div>
  );
}

function pageFromHash(): PageId {
  const hash = window.location.hash.replace("#", "");
  return navItems.some((item) => item.id === hash) ? (hash as PageId) : "dashboard";
}

function Sidebar({
  activePage,
  onNavigate
}: {
  activePage: PageId;
  onNavigate: (id: PageId) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand-row">
        <div className="brand-mark">
          <Bot size={17} />
        </div>
        <span>Local AI Router</span>
      </div>
      <nav className="nav-list" aria-label="Primary navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={`nav-item ${activePage === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => {
                window.location.hash = item.id === "dashboard" ? "" : item.id;
                onNavigate(item.id);
              }}
              type="button"
            >
              <Icon size={19} />
              <span>{item.label}</span>
              {item.id === "updates" ? <span className="count-badge">2</span> : null}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <div className="status-dot-row">
          <span className="dot green" />
          <span>Stage 3 hardware</span>
        </div>
        <span className="version">v0.1.0</span>
      </div>
    </aside>
  );
}

function TopBar({
  appState,
  activeLabel,
  onPause,
  onResume
}: {
  appState: AppStateSnapshot;
  activeLabel: string;
  onPause: () => void;
  onResume: () => void;
}) {
  const isPaused = appState.lifecycle_state === "Paused";
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-button" aria-label="Menu" type="button">
          <Menu size={20} />
        </button>
        <span className="active-page-label">{activeLabel}</span>
      </div>
      <div className="topbar-status">
        <span className={`state-pill ${isPaused ? "paused" : "running"}`}>
          <span className={isPaused ? "dot amber" : "dot green"} />
          {appState.lifecycle_state}
        </span>
        <button
          className={isPaused ? "resume-button" : "pause-button"}
          type="button"
          onClick={isPaused ? onResume : onPause}
        >
          {isPaused ? <Play size={16} /> : <Pause size={16} />}
          {isPaused ? "Resume" : "Pause"}
        </button>
        <div className="provider-summary">
          <span className="dot green" />
          <span>Provider: MLX-LM Server</span>
          <span className="divider" />
          <span>Model: Qwen3 8B</span>
          <span className="fit-pill good">Good</span>
        </div>
      </div>
      <div className="topbar-actions">
        <button className="icon-button" aria-label="Activity" type="button">
          <Activity size={20} />
        </button>
        <button className="icon-button" aria-label="Notifications" type="button">
          <Bell size={19} />
        </button>
      </div>
    </header>
  );
}

function Dashboard({
  appState,
  onPause,
  onResume
}: {
  appState: AppStateSnapshot;
  onPause: (source: PauseSource, action?: PauseAction) => Promise<void>;
  onResume: (source: PauseSource) => Promise<void>;
}) {
  const isPaused = appState.lifecycle_state === "Paused";
  return (
    <div className="dashboard-grid">
      <Panel className="machine-panel" title="Machine Summary">
        <div className="machine-heading">
          <Laptop size={22} />
          <strong>MacBook M3 Pro</strong>
          <span className="os-chip">macOS 14.5</span>
        </div>
        <SpecRows
          rows={[
            ["Chip", "Apple M3 Pro"],
            ["CPU", "12-core (8P + 4E)"],
            ["Unified Memory", "18 GB"],
            ["GPU", "18-core"],
            ["Storage", "1 TB SSD"],
            ["Platform", "Apple Silicon (arm64)"]
          ]}
        />
      </Panel>

      <Panel title="System Load">
        <div className="metric-grid">
          <LoadMeter label="CPU" value={23} detail="2.8 / 12 cores" />
          <LoadMeter label="GPU" value={41} detail="Shell data" />
          <LoadMeter label="Memory" value={68} detail="12.2 / 18 GB" warn />
          <LoadMeter label="VRAM" value={52} detail="Unified" />
        </div>
        <p className="fine-print">
          Dashboard values remain sample data until model scoring arrives; real specs are on
          Machine Specs.
        </p>
      </Panel>

      <Panel title="Active Provider" className="provider-panel">
        <StatusLine label="Provider" value="MLX-LM Server" tone="green" />
        <StatusLine label="Base URL" value="http://127.0.0.1:8080" />
        <StatusLine label="Active Model" value="Qwen3 8B" />
        <StatusLine label="Compatibility" value="Good" badge="good" />
        <StatusLine label="Router Mode" value="Auto (Local preferred)" />
        <StatusLine label="App State" value={appState.lifecycle_state} />
      </Panel>

      <Panel title="Installed Models" className="wide-panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Size</th>
              <th>Format</th>
              <th>Fit</th>
              <th>Last Used</th>
            </tr>
          </thead>
          <tbody>
            {installedModels.map((model) => (
              <tr key={model.name}>
                <td>{model.name}</td>
                <td>{model.size}</td>
                <td>{model.format}</td>
                <td>
                  <span className={`fit-pill ${model.fit.toLowerCase()}`}>{model.fit}</span>
                </td>
                <td>{model.lastUsed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Available Updates">
        <div className="update-row">
          <div>
            <strong>Qwen3 8B (GGUF)</strong>
            <span>Model metadata shell</span>
          </div>
          <span className="fit-pill smooth">Model</span>
        </div>
        <div className="update-row">
          <div>
            <strong>Local AI Router</strong>
            <span>App update shell</span>
          </div>
          <span className="fit-pill good">App</span>
        </div>
      </Panel>

      <Panel title="Remote PC">
        <div className="remote-list">
          <RemoteRow name="Studio-Win11" gpu="RTX 4090" status="Online" />
          <RemoteRow name="Office-Workstation" gpu="RTX 3090" status="Online" />
          <RemoteRow name="Render-Node-01" gpu="RTX 3080 Ti" status="Idle" amber />
        </div>
      </Panel>

      <Panel title="Quick Actions" className="quick-actions">
        <div className="actions-grid">
          <ActionButton
            icon={isPaused ? Play : Pause}
            label={isPaused ? "Resume app" : "Pause app"}
            onClick={() => (isPaused ? onResume("Dashboard") : onPause("Dashboard"))}
          />
          <ActionButton icon={Download} label="Install recommended setup" />
          <ActionButton icon={Play} label="Start provider" />
          <ActionButton icon={MessageSquare} label="Test chat" />
          <ActionButton icon={FileText} label="Export specs" />
          <ActionButton icon={Settings} label="Open settings" />
        </div>
      </Panel>

      <Panel title="Pause Options" className="pause-options-panel">
        <div className="pause-options">
          {pauseActions.map((action) => (
            <button
              className="secondary-button"
              key={action.label}
              type="button"
              onClick={() => onPause("Dashboard", action)}
              disabled={isPaused}
            >
              {action.label}
            </button>
          ))}
          <button
            className="resume-button"
            type="button"
            onClick={() => onResume("Dashboard")}
            disabled={!isPaused}
          >
            Resume now
          </button>
        </div>
      </Panel>
    </div>
  );
}

function MachineSpecsPage() {
  const [specs, setSpecs] = useState<HardwareSpecs | null>(null);
  const [fixtures, setFixtures] = useState<HardwareFixtureSummary[]>([]);
  const [selectedSource, setSelectedSource] = useState("__live");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading live hardware probe...");
  const [error, setError] = useState<string | null>(null);

  const rawJson = useMemo(() => (specs ? JSON.stringify(specs, null, 2) : ""), [specs]);
  const primaryGpu = specs?.gpus[0];
  const primaryStorage = specs?.storage[0];

  const loadLiveSpecs = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus("Refreshing live hardware probe...");
    try {
      const nextSpecs = await refreshHardwareSpecs();
      setSpecs(nextSpecs);
      setSelectedSource("__live");
      setStatus("Live hardware probe loaded.");
    } catch (err) {
      setError(errorMessage(err));
      setStatus("Live hardware probe failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    Promise.all([refreshHardwareSpecs(), listHardwareFixtures()])
      .then(([nextSpecs, nextFixtures]) => {
        if (ignore) return;
        setSpecs(nextSpecs);
        setFixtures(nextFixtures);
        setStatus("Live hardware probe loaded.");
      })
      .catch((err) => {
        if (ignore) return;
        setError(errorMessage(err));
        setStatus("Hardware probe failed. Fixture mode is still available.");
        listHardwareFixtures()
          .then((nextFixtures) => {
            if (!ignore) setFixtures(nextFixtures);
          })
          .catch(() => undefined);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, []);

  const handleSourceChange = useCallback(
    async (sourceId: string) => {
      setSelectedSource(sourceId);
      setLoading(true);
      setError(null);
      try {
        if (sourceId === "__live") {
          await loadLiveSpecs();
          return;
        }
        const fixture = await loadHardwareFixture(sourceId);
        setSpecs(fixture);
        setStatus(`Fixture loaded: ${fixture.name}.`);
      } catch (err) {
        setError(errorMessage(err));
        setStatus("Could not load hardware profile.");
      } finally {
        setLoading(false);
      }
    },
    [loadLiveSpecs]
  );

  const handleDownload = useCallback(
    async (format: HardwareExportFormat) => {
      if (!specs) return;
      const content = await exportHardwareSpecs(specs, format);
      downloadTextFile(content, hardwareExportFilename(specs, format), exportMimeType(format));
      setStatus(`${format} export downloaded.`);
    },
    [specs]
  );

  const handleCopy = useCallback(
    async (format: HardwareExportFormat) => {
      if (!specs) return;
      const content = await exportHardwareSpecs(specs, format);
      await copyText(content);
      setStatus(`${format} export copied to clipboard.`);
    },
    [specs]
  );

  if (!specs) {
    return (
      <div className="machine-specs-page">
        <Panel title="Machine Specs">
          <div className="loading-state">
            <RefreshCw size={22} />
            <strong>{status}</strong>
            {error ? <span>{error}</span> : <span>Preparing hardware probe data.</span>}
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="machine-specs-page">
      <Panel title="Hardware Probe">
        <div className="hardware-toolbar">
          <div className="hardware-title">
            <Laptop size={24} />
            <div>
              <strong>{specs.name}</strong>
              <span>
                {specs.platform.os} {specs.platform.os_version} / {specs.platform.architecture}
              </span>
            </div>
          </div>
          <select
            aria-label="Hardware source"
            onChange={(event) => handleSourceChange(event.target.value)}
            value={selectedSource}
          >
            <option value="__live">Live machine</option>
            {fixtures.map((fixture) => (
              <option key={fixture.id} value={fixture.id}>
                {fixture.name}
              </option>
            ))}
          </select>
          <button className="secondary-button" disabled={loading} onClick={loadLiveSpecs} type="button">
            <RefreshCw size={16} />
            Refresh live
          </button>
        </div>
        <div className="probe-status-row">
          <span className={specs.source === "Live" ? "fit-pill smooth" : "fit-pill tight"}>
            {specs.source}
          </span>
          <span>{status}</span>
          {error ? <strong>{error}</strong> : null}
        </div>
      </Panel>

      <div className="hardware-grid">
        <Panel title="Platform">
          <SpecRows
            rows={[
              ["Family", specs.platform.family],
              ["Operating System", `${specs.platform.os} ${specs.platform.os_version}`],
              ["Architecture", specs.platform.architecture],
              ["Captured", formatTimestamp(specs.captured_at_ms)]
            ]}
          />
        </Panel>

        <Panel title="CPU and Memory">
          <SpecRows
            rows={[
              ["CPU", specs.cpu.brand],
              ["Physical Cores", String(specs.cpu.physical_cores)],
              ["Logical Cores", String(specs.cpu.logical_cores)],
              ["Memory", formatBytesGb(specs.memory.total_bytes)],
              ["Unified Memory", specs.memory.unified_memory ? "Yes" : "No"]
            ]}
          />
        </Panel>

        <Panel title="Primary GPU">
          <SpecRows
            rows={[
              ["GPU", primaryGpu?.name ?? "Unknown"],
              ["Vendor", primaryGpu?.vendor ?? "Unknown"],
              ["Memory / VRAM", formatBytesGb(primaryGpu?.memory_bytes ?? null)],
              ["Integrated", primaryGpu?.integrated ? "Yes" : "No"],
              ["Detected GPUs", String(specs.gpus.length)]
            ]}
          />
        </Panel>

        <Panel title="Storage">
          <SpecRows
            rows={[
              ["Mount", primaryStorage?.mount ?? "Unknown"],
              ["Total", formatBytesGb(primaryStorage?.total_bytes ?? null)],
              ["Available", formatBytesGb(primaryStorage?.available_bytes ?? null)],
              ["Volumes", String(specs.storage.length)]
            ]}
          />
        </Panel>

        <Panel title="System Load">
          <div className="metric-grid">
            <LoadMeter label="CPU" value={Math.round(specs.load.cpu_percent)} detail="Live or fixture" />
            <LoadMeter
              label="Memory"
              value={Math.round(specs.load.memory_percent)}
              detail={formatBytesGb(specs.memory.total_bytes)}
              warn={specs.load.memory_percent >= 75}
            />
            <LoadMeter
              label="GPU"
              value={Math.round(specs.load.gpu_percent ?? 0)}
              detail={specs.load.gpu_percent === null ? "Not reported" : "Live or fixture"}
            />
            <LoadMeter
              label="VRAM"
              value={Math.round(specs.load.vram_percent ?? 0)}
              detail={specs.load.vram_percent === null ? "Not reported" : "Live or fixture"}
            />
          </div>
          <p className="fine-print">
            Live Stage 3 load values are conservative placeholders until background telemetry is
            added in Stage 9.
          </p>
        </Panel>

        <Panel title="Export Specs" className="hardware-export-panel">
          <div className="export-actions">
            <button className="secondary-button" type="button" onClick={() => handleDownload("Json")}>
              <FileJson size={16} />
              JSON
            </button>
            <button className="secondary-button" type="button" onClick={() => handleDownload("Csv")}>
              <FileText size={16} />
              CSV
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => handleDownload("Markdown")}
            >
              <FileText size={16} />
              Markdown
            </button>
            <button className="secondary-button" type="button" onClick={() => handleCopy("Json")}>
              <Clipboard size={16} />
              Copy JSON
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => handleCopy("Markdown")}
            >
              <Clipboard size={16} />
              Copy Markdown
            </button>
          </div>
          <div className="fixture-summary">
            <strong>Fixture coverage</strong>
            <span>
              Apple Silicon, Intel Mac 8/16/32 GB, and Windows GTX 1060 / 30 GB RAM.
            </span>
          </div>
        </Panel>
      </div>

      <Panel title="All GPUs and Volumes">
        <div className="hardware-table-grid">
          <table className="data-table">
            <thead>
              <tr>
                <th>GPU</th>
                <th>Vendor</th>
                <th>Memory</th>
                <th>Integrated</th>
              </tr>
            </thead>
            <tbody>
              {specs.gpus.map((gpu) => (
                <tr key={`${gpu.name}-${gpu.vendor}`}>
                  <td>{gpu.name}</td>
                  <td>{gpu.vendor}</td>
                  <td>{formatBytesGb(gpu.memory_bytes)}</td>
                  <td>{gpu.integrated ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="data-table">
            <thead>
              <tr>
                <th>Mount</th>
                <th>Total</th>
                <th>Available</th>
              </tr>
            </thead>
            <tbody>
              {specs.storage.map((volume) => (
                <tr key={volume.mount}>
                  <td>{volume.mount}</td>
                  <td>{formatBytesGb(volume.total_bytes)}</td>
                  <td>{formatBytesGb(volume.available_bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Raw JSON">
        <pre className="raw-json">{rawJson}</pre>
      </Panel>
    </div>
  );
}

function RouterShell({
  appState,
  onPause,
  onResume
}: {
  appState: AppStateSnapshot;
  onPause: (source: PauseSource, action?: PauseAction) => Promise<void>;
  onResume: (source: PauseSource) => Promise<void>;
}) {
  const isPaused = appState.lifecycle_state === "Paused";
  const modes = [
    ["Auto", Route],
    ["Manual", SlidersHorizontal],
    ["Forced", ShieldCheck],
    ["Remote preferred", Network],
    ["Local only", Monitor],
    ["Remote only", Cloud],
    ["Paused", Pause]
  ] as const;

  return (
    <div className="router-shell">
      <div className="paused-banner">
        <div className="pause-emblem">
          <Pause size={24} />
        </div>
        <div>
          <strong>
            {isPaused ? "Local AI Router is paused." : "Router automation is running."}
          </strong>
          <span>
            {isPaused
              ? "Automation, update checks, routing changes, and remote discovery are suspended."
              : "Use pause controls to suspend router automation before Stage 8 wiring."}
          </span>
        </div>
        <button className="secondary-button" type="button">
          Pause settings
        </button>
        <button
          className={isPaused ? "resume-button" : "secondary-button"}
          type="button"
          onClick={() => (isPaused ? onResume("Router") : onPause("Router"))}
        >
          {isPaused ? "Resume" : "Pause now"}
        </button>
      </div>

      <Panel title="Routing mode">
        <div className="mode-grid">
          {modes.map(([label, Icon]) => (
            <button
              className={
                (isPaused && label === "Paused") || (!isPaused && label === "Auto")
                  ? "mode-card active"
                  : "mode-card"
              }
              key={label}
              type="button"
            >
              <Icon size={22} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <p className="fine-print">
          {isPaused
            ? "Routing is paused. No automatic decisions or changes will be made."
            : "Routing controls are non-functional until Stage 8."}
        </p>
      </Panel>

      <div className="router-columns">
        <Panel title="Active decision">
          <StatusLine label="Last active model" value="Qwen3 8B" />
          <StatusLine label="Last router decision" value="Used local model (Auto mode)" />
          <div className="fallback-list">
            <span>Fallback candidates</span>
            <ol>
              <li>Llama 3.1 8B (Ollama)</li>
              <li>Phi-3.5 Mini (Ollama)</li>
              <li>Qwen2.5-Coder 7B (LM Studio)</li>
            </ol>
          </div>
        </Panel>

        <Panel title="Router thresholds">
          <Threshold label="RAM usage (max)" value="85%" />
          <Threshold label="CPU usage (max)" value="80%" />
          <Threshold label="GPU VRAM usage (max)" value="90%" />
          <Threshold label="Latency (max)" value="1500 ms" />
          <Threshold label="Upgrade cooldown" value="10 min" />
        </Panel>

        <Panel title="Suspended automation">
          <SuspendedRow label="Pending routing changes" value={String(appState.suspended_tasks.routing_changes)} />
          <SuspendedRow label="Update checks" value={String(appState.suspended_tasks.update_checks)} />
          <SuspendedRow label="Model pulls / updates" value={String(appState.suspended_tasks.model_installs)} />
          <SuspendedRow label="Remote discovery" value={String(appState.suspended_tasks.remote_discovery)} />
          <SuspendedRow label="Metric collection" value={String(appState.suspended_tasks.health_polling)} />
          <SuspendedRow label="Total suspended tasks" value={String(totalSuspended(appState))} />
        </Panel>
      </div>

      <Panel title="Test prompt">
        <div className="test-prompt-shell">
          <textarea
            aria-label="Test prompt placeholder"
            disabled
            placeholder="Explain how transformers work in large language models."
          />
          <div className="test-actions">
            <button
              className={isPaused ? "secondary-button" : "ghost-button"}
              disabled={!isPaused}
              type="button"
              onClick={() => onResume("Router")}
            >
              {isPaused ? "Resume to run" : "Run available in Stage 8"}
            </button>
            <button className="secondary-button" type="button">
              Run once while paused
            </button>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function PausedBanner({
  suspendedTotal,
  onResume
}: {
  suspendedTotal: number;
  onResume: () => void;
}) {
  return (
    <div className="global-paused-banner">
      <div className="pause-emblem compact">
        <Pause size={18} />
      </div>
      <div>
        <strong>Local AI Router is paused.</strong>
        <span>Automation, update checks, routing changes, and remote discovery are suspended.</span>
      </div>
      <span className="suspended-total">{suspendedTotal} suspended</span>
      <button className="resume-button" type="button" onClick={onResume}>
        <Play size={15} />
        Resume
      </button>
    </div>
  );
}

function SettingsPage({
  appState,
  onPause,
  onResume,
  onSettingsChange
}: {
  appState: AppStateSnapshot;
  onPause: (source: PauseSource, action?: PauseAction) => Promise<void>;
  onResume: (source: PauseSource) => Promise<void>;
  onSettingsChange: (settings: PauseSettings) => Promise<void>;
}) {
  const isPaused = appState.lifecycle_state === "Paused";
  const settings = appState.settings;

  return (
    <div className="settings-grid">
      <Panel title="Pause Behavior">
        <div className="settings-list">
          <label className="setting-row">
            <span>
              <strong>Remember pause state after restart</strong>
              <small>Reopen in Paused state when the app was manually paused.</small>
            </span>
            <input
              type="checkbox"
              checked={settings.remember_pause_state_after_restart}
              onChange={(event) =>
                onSettingsChange({
                  ...settings,
                  remember_pause_state_after_restart: event.target.checked
                })
              }
            />
          </label>
          <label className="setting-row">
            <span>
              <strong>Allow critical health/security notifications while paused</strong>
              <small>Non-critical notifications remain suppressed in paused mode.</small>
            </span>
            <input
              type="checkbox"
              checked={settings.allow_critical_health_security_notifications_while_paused}
              onChange={(event) =>
                onSettingsChange({
                  ...settings,
                  allow_critical_health_security_notifications_while_paused: event.target.checked
                })
              }
            />
          </label>
        </div>
      </Panel>

      <Panel title="Pause Controls">
        <div className="pause-options settings-controls">
          {pauseActions.map((action) => (
            <button
              className="secondary-button"
              disabled={isPaused}
              key={action.label}
              onClick={() => onPause("Settings", action)}
              type="button"
            >
              {action.label}
            </button>
          ))}
          <button
            className="resume-button"
            disabled={!isPaused}
            onClick={() => onResume("Settings")}
            type="button"
          >
            Resume now
          </button>
        </div>
      </Panel>

      <Panel title="Current Pause State" className="settings-wide">
        <div className="state-summary">
          <StatusLine label="State" value={appState.lifecycle_state} />
          <StatusLine label="Reason" value={appState.pause_reason ?? "Not paused"} />
          <StatusLine
            label="Paused until"
            value={appState.paused_until_ms ? formatTimestamp(appState.paused_until_ms) : "Manual resume"}
          />
          <StatusLine label="Suspended tasks" value={String(totalSuspended(appState))} />
        </div>
      </Panel>
    </div>
  );
}

function LogsPage({ appState }: { appState: AppStateSnapshot }) {
  const history = [...appState.pause_history].reverse();

  return (
    <div className="logs-page">
      <Panel title="Pause / Resume Logs">
        {history.length === 0 ? (
          <div className="empty-log-state">
            <TerminalSquare size={22} />
            <strong>No pause or resume actions logged yet.</strong>
            <span>Use Dashboard, Router, Settings, or the native menu to create log entries.</span>
          </div>
        ) : (
          <table className="data-table logs-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Source</th>
                <th>State</th>
                <th>Reason</th>
                <th>Affected Tasks</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={`${entry.timestamp_ms}-${entry.source}-${entry.new_state}`}>
                  <td>{formatTimestamp(entry.timestamp_ms)}</td>
                  <td>{entry.source}</td>
                  <td>
                    {entry.previous_state} {"->"} {entry.new_state}
                  </td>
                  <td>{entry.reason}</td>
                  <td>{entry.active_tasks_affected.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function EmptyStatePage({ page }: { page: EmptyPage }) {
  return (
    <div className="empty-page">
      <div className="empty-header">
        <span>{page.eyebrow}</span>
        <h1>{page.title}</h1>
        <p>{page.summary}</p>
      </div>
      <div className="empty-grid">
        {page.readiness.map((item) => (
          <div className="empty-card" key={item}>
            <div className="empty-icon">
              <TerminalSquare size={20} />
            </div>
            <strong>{item}</strong>
            <span>Visual shell only. Functional wiring is intentionally deferred.</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
  className = ""
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function SpecRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="spec-rows">
      {rows.map(([label, value]) => (
        <div className="spec-row" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function LoadMeter({
  label,
  value,
  detail,
  warn = false
}: {
  label: string;
  value: number;
  detail: string;
  warn?: boolean;
}) {
  return (
    <div className="load-meter">
      <span>{label}</span>
      <strong>{value}%</strong>
      <div className="meter-track">
        <div className={warn ? "meter-fill warn" : "meter-fill"} style={{ width: `${value}%` }} />
      </div>
      <small>{detail}</small>
    </div>
  );
}

function StatusLine({
  label,
  value,
  tone,
  badge
}: {
  label: string;
  value: string;
  tone?: "green";
  badge?: "good";
}) {
  return (
    <div className="status-line">
      <span>{label}</span>
      <strong>
        {tone ? <span className="dot green" /> : null}
        {badge ? <span className="fit-pill good">{value}</span> : value}
      </strong>
    </div>
  );
}

function RemoteRow({
  name,
  gpu,
  status,
  amber = false
}: {
  name: string;
  gpu: string;
  status: string;
  amber?: boolean;
}) {
  return (
    <div className="remote-row">
      <span className={amber ? "dot amber" : "dot green"} />
      <div>
        <strong>{name}</strong>
        <span>{gpu}</span>
      </div>
      <span className={amber ? "fit-pill tight" : "fit-pill smooth"}>{status}</span>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick
}: {
  icon: typeof Home;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button className="action-button" type="button" onClick={onClick}>
      <Icon size={21} />
      <span>{label}</span>
    </button>
  );
}

function Threshold({ label, value }: { label: string; value: string }) {
  return (
    <div className="threshold-row">
      <span>{label}</span>
      <div className="threshold-control">
        <span className="fake-slider" />
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function SuspendedRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="suspended-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function topBarSource(activePage: PageId): PauseSource {
  if (activePage === "router") return "Router";
  if (activePage === "settings") return "Settings";
  return "Dashboard";
}

function totalSuspended(snapshot: AppStateSnapshot): number {
  const tasks = snapshot.suspended_tasks;
  return (
    tasks.routing_changes +
    tasks.update_checks +
    tasks.model_installs +
    tasks.remote_discovery +
    tasks.health_polling
  );
}

function formatTimestamp(timestampMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(Number(timestampMs)));
}

function hardwareExportFilename(specs: HardwareSpecs, format: HardwareExportFormat): string {
  const extension = format === "Json" ? "json" : format === "Csv" ? "csv" : "md";
  return `${specs.id}-${Date.now()}.${extension}`;
}

function exportMimeType(format: HardwareExportFormat): string {
  if (format === "Json") return "application/json";
  if (format === "Csv") return "text/csv";
  return "text/markdown";
}

function downloadTextFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function copyText(content: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(content);
      return;
    } catch {
      // Fall back for browser previews or webviews that expose clipboard but reject writes.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
