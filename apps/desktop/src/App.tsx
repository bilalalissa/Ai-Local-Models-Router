import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Ban,
  Bell,
  Bot,
  Clock,
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
  type BackgroundSettings,
  type BackgroundSnapshot,
  type NotificationEvent,
  getBackgroundSnapshot,
  presentNativeNotification,
  runBackgroundTick,
  sendTestNotification,
  subscribeBackgroundSnapshot,
  subscribeNotificationEvents,
  updateBackgroundSettings
} from "./background";
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
import {
  type CommandHook,
  type InstallPlan,
  type InstallRunState,
  advanceInstallRun,
  cancelInstallRun,
  getInstallState,
  listInstallPlans,
  pauseInstallRun,
  resumeInstallRun,
  startInstallRun,
  subscribeInstallProgress
} from "./installer";
import {
  type CompatibilityResult,
  type PreferenceTag,
  type ProviderKind,
  type UseCase,
  getModelCatalog,
  preferenceOptions,
  providerOptions,
  scoreModels,
  useCaseOptions
} from "./modelCatalog";
import {
  type ProviderChatResponse,
  type ProviderInstallPlan,
  type ProviderLogEntry,
  type ProviderModel,
  type ProviderSettings,
  type ProviderStatus,
  getProviderFolder,
  getProviderLogs,
  getProviderSettings,
  listProviderModels,
  listProviderStatuses,
  pauseAllProviders,
  pauseProviderTasks,
  previewProviderInstallPlan,
  refreshProviderHealth,
  resumeAllProviders,
  resumeProviderTasks,
  sendProviderTestChat,
  startProvider,
  stopProvider,
  subscribeProviderHealth,
  updateProviderSettings
} from "./providers";
import {
  type RouteCandidate,
  type RouterDecision,
  type RouterMode,
  type RouterTestResult,
  defaultRouterThresholds,
  decideRouterRoute,
  runRouterTestPrompt
} from "./router";
import {
  type RemoteClientDevice,
  type RemoteClientSettings,
  type RemoteClientSnapshot,
  discoverRemoteClients,
  getRemoteClientSnapshot,
  getRemoteRouteCandidates,
  pairDiscoveredRemoteClient,
  pairManualRemoteClient,
  refreshRemoteClients,
  removeRemoteClient,
  subscribeRemoteClientSnapshot,
  updateRemoteClientSettings
} from "./remoteClient";
import {
  type BrokerEndpointRequest,
  type BrokerPausePolicy,
  type RemoteBrokerSettings,
  type RemoteBrokerSnapshot,
  type RemoteBrokerStatus,
  type RemoteDevice,
  createRemotePairingCode,
  getRemoteBrokerSnapshot,
  previewRemoteBrokerEndpoint,
  registerRemoteBrokerClient,
  revokeRemoteBrokerClient,
  startRemoteBroker,
  stopRemoteBroker,
  subscribeRemoteBrokerSnapshot,
  updateRemoteBrokerSettings
} from "./remoteBroker";
import {
  type MetadataSourceKind,
  type UpdateActionKind,
  type UpdateCandidate,
  type UpdaterSettings,
  type UpdaterSnapshot,
  applyUpdateAction,
  checkUpdatesNow,
  getUpdaterSnapshot,
  subscribeUpdaterSnapshot,
  updateUpdaterSettings
} from "./updater";

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
  Exclude<
    PageId,
    "dashboard" | "machine-specs" | "model-fit-map" | "providers" | "router" | "remote-pcs" | "settings" | "logs"
  >,
  EmptyPage
> = {
  models: {
    title: "Models",
    eyebrow: "Stage 1 page shell",
    summary:
      "Install, uninstall, force, and switch model actions are intentionally inactive until later stages.",
    readiness: ["Installed model list", "Detail pane", "Manual action area"]
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
  const [latestNotification, setLatestNotification] = useState<NotificationEvent | null>(null);
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
    let unlistenNotifications: (() => void) | undefined;

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
    subscribeNotificationEvents((event) => {
      setLatestNotification(event);
      presentNativeNotification(event).catch(() => undefined);
    }).then((unsubscribe) => {
      unlistenNotifications = unsubscribe;
    });

    return () => {
      ignore = true;
      unlisten?.();
      unlistenNotifications?.();
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
          latestNotification={latestNotification}
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
            <Dashboard
              appState={appState}
              onNavigate={setActivePage}
              onPause={handlePause}
              onResume={handleResume}
            />
          ) : activePage === "machine-specs" ? (
            <MachineSpecsPage />
          ) : activePage === "model-fit-map" ? (
            <ModelFitMapPage appState={appState} />
          ) : activePage === "providers" ? (
            <ProvidersPage appState={appState} />
          ) : activePage === "models" ? (
            <InstallerPage />
          ) : activePage === "updates" ? (
            <UpdatesPage appState={appState} />
          ) : activePage === "router" ? (
            <RouterShell appState={appState} onPause={handlePause} onResume={handleResume} />
          ) : activePage === "remote-pcs" ? (
            <RemoteBrokerPage appState={appState} />
          ) : activePage === "settings" ? (
            <SettingsPage
              appState={appState}
              onPause={handlePause}
              onResume={handleResume}
              onSettingsChange={handleSettingsChange}
            />
          ) : activePage === "logs" ? (
            <LogsPage appState={appState} latestNotification={latestNotification} />
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
              {item.id === "updates" || item.id === "remote-pcs" ? <span className="count-badge">2</span> : null}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <div className="status-dot-row">
          <span className="dot green" />
          <span>Stage 14 final build</span>
        </div>
        <span className="version">v0.1.0</span>
      </div>
    </aside>
  );
}

function TopBar({
  appState,
  activeLabel,
  latestNotification,
  onPause,
  onResume
}: {
  appState: AppStateSnapshot;
  activeLabel: string;
  latestNotification: NotificationEvent | null;
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
        <button
          className={`icon-button ${latestNotification ? "has-notification" : ""}`}
          aria-label={latestNotification ? `Notifications: ${latestNotification.title}` : "Notifications"}
          title={latestNotification?.title ?? "Notifications"}
          type="button"
        >
          <Bell size={19} />
        </button>
      </div>
    </header>
  );
}

function Dashboard({
  appState,
  onNavigate,
  onPause,
  onResume
}: {
  appState: AppStateSnapshot;
  onNavigate: (id: PageId) => void;
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
          <ActionButton
            icon={Download}
            label="Install recommended setup"
            onClick={() => {
              window.location.hash = "updates";
              onNavigate("updates");
            }}
          />
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
            Live load values remain conservative until a later telemetry pass replaces the
            placeholder probe inputs.
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

function ModelFitMapPage({ appState }: { appState: AppStateSnapshot }) {
  const [hardware, setHardware] = useState<HardwareSpecs | null>(null);
  const [fixtures, setFixtures] = useState<HardwareFixtureSummary[]>([]);
  const [selectedHardware, setSelectedHardware] = useState("__live");
  const [useCase, setUseCase] = useState<UseCase>("GeneralChat");
  const [preferredProvider, setPreferredProvider] = useState<ProviderKind | "">("");
  const [preferences, setPreferences] = useState<PreferenceTag[]>(["Balanced"]);
  const [installedOnly, setInstalledOnly] = useState(false);
  const [results, setResults] = useState<CompatibilityResult[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading model fit map...");
  const [error, setError] = useState<string | null>(null);
  const appPaused = appState.lifecycle_state === "Paused";

  useEffect(() => {
    let ignore = false;
    Promise.all([refreshHardwareSpecs(), listHardwareFixtures()])
      .then(([nextHardware, nextFixtures]) => {
        if (ignore) return;
        setHardware(nextHardware);
        setFixtures(nextFixtures);
        setStatus("Live hardware profile loaded.");
      })
      .catch((err) => {
        if (ignore) return;
        setError(errorMessage(err));
        setStatus("Live hardware profile failed. Use a fixture profile.");
        listHardwareFixtures()
          .then((nextFixtures) => {
            if (!ignore) setFixtures(nextFixtures);
          })
          .catch(() => undefined);
      });

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!hardware) return;
    let ignore = false;
    scoreModels({
      hardware,
      use_case: useCase,
      preferred_provider: preferredProvider || null,
      preference_tags: preferences,
      installed_only: installedOnly,
      app_paused: appPaused
    })
      .then((nextResults) => {
        if (ignore) return;
        setResults(nextResults);
        setSelectedModelId((current) => current ?? nextResults[0]?.model.id ?? null);
        setStatus(`${nextResults.length} model fits scored for ${hardware.name}.`);
      })
      .catch((err) => {
        if (ignore) return;
        setError(errorMessage(err));
        setStatus("Model scoring failed.");
      });

    return () => {
      ignore = true;
    };
  }, [hardware, useCase, preferredProvider, preferences, installedOnly, appPaused]);

  const selectedResult = useMemo(
    () => results.find((result) => result.model.id === selectedModelId) ?? results[0] ?? null,
    [results, selectedModelId]
  );

  const handleHardwareChange = useCallback(async (hardwareId: string) => {
    setSelectedHardware(hardwareId);
    setError(null);
    try {
      const nextHardware =
        hardwareId === "__live" ? await refreshHardwareSpecs() : await loadHardwareFixture(hardwareId);
      setHardware(nextHardware);
      setSelectedModelId(null);
      setStatus(`${hardwareId === "__live" ? "Live" : "Fixture"} hardware profile loaded.`);
    } catch (err) {
      setError(errorMessage(err));
      setStatus("Could not load hardware profile.");
    }
  }, []);

  const togglePreference = useCallback((tag: PreferenceTag) => {
    setPreferences((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
    );
  }, []);

  if (!hardware) {
    return (
      <div className="model-fit-page">
        <Panel title="Model Fit Map">
          <div className="loading-state">
            <FileBarChart size={22} />
            <strong>{status}</strong>
            {error ? <span>{error}</span> : <span>Preparing hardware and model catalog data.</span>}
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="model-fit-page">
      <Panel title="Model Fit Map">
        <div className="fit-toolbar">
          <div className="hardware-title">
            <FileBarChart size={24} />
            <div>
              <strong>{hardware.name}</strong>
              <span>
                {hardware.platform.family} / {formatBytesGb(hardware.memory.total_bytes)} memory
              </span>
            </div>
          </div>
          <select
            aria-label="Fit hardware profile"
            onChange={(event) => handleHardwareChange(event.target.value)}
            value={selectedHardware}
          >
            <option value="__live">Live machine</option>
            {fixtures.map((fixture) => (
              <option key={fixture.id} value={fixture.id}>
                {fixture.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Fit use case"
            onChange={(event) => setUseCase(event.target.value as UseCase)}
            value={useCase}
          >
            {useCaseOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Preferred provider"
            onChange={(event) => setPreferredProvider(event.target.value as ProviderKind | "")}
            value={preferredProvider}
          >
            {providerOptions.map((option) => (
              <option key={option.value || "any"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="fit-filter-row">
          <div className="preference-chips" aria-label="Preference filters">
            {preferenceOptions.map((option) => (
              <button
                className={preferences.includes(option.value) ? "chip active" : "chip"}
                key={option.value}
                onClick={() => togglePreference(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="compact-check">
            <input
              checked={installedOnly}
              onChange={(event) => setInstalledOnly(event.target.checked)}
              type="checkbox"
            />
            Installed only
          </label>
        </div>
        <div className="probe-status-row">
          <span className={appPaused ? "fit-pill tight" : "fit-pill smooth"}>
            {appPaused ? "Paused scoring" : "Live scoring"}
          </span>
          <span>{status}</span>
          {error ? <strong>{error}</strong> : null}
        </div>
      </Panel>

      <div className="fit-summary-grid">
        {(["Smooth", "Good", "Tight", "Avoid"] as const).map((label) => (
          <div className={`fit-legend-card ${label.toLowerCase()}`} key={label}>
            <strong>{results.filter((result) => result.label === label).length}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="fit-content-grid">
        <Panel title="Compatibility Results" className="fit-table-panel">
          <table className="data-table fit-results-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Fit</th>
                <th>Score</th>
                <th>Provider</th>
                <th>Format</th>
                <th>Size</th>
                <th>Installed</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr
                  className={selectedResult?.model.id === result.model.id ? "selected-row" : ""}
                  key={result.model.id}
                  onClick={() => setSelectedModelId(result.model.id)}
                >
                  <td>
                    <strong>{result.model.display_name}</strong>
                    <span>{result.model.family}</span>
                  </td>
                  <td>
                    <span className={`fit-pill ${result.label.toLowerCase()}`}>
                      {result.label}
                    </span>
                  </td>
                  <td>{result.score}</td>
                  <td>{result.model.providers.join(", ")}</td>
                  <td>
                    {result.model.format} / {result.model.quantization}
                  </td>
                  <td>{formatBytesGb(result.model.size_bytes)}</td>
                  <td>{result.model.installed ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Score Breakdown">
          {selectedResult ? (
            <div className="score-breakdown">
              <div className="score-heading">
                <strong>{selectedResult.model.display_name}</strong>
                <span className={`fit-pill ${selectedResult.label.toLowerCase()}`}>
                  {selectedResult.label} {selectedResult.score}
                </span>
              </div>
              {Object.entries(selectedResult.inputs).map(([name, value]) => (
                <ScoreInputBar key={name} label={scoreInputLabel(name)} value={Number(value)} />
              ))}
              {selectedResult.blockers.length > 0 ? (
                <div className="blocker-list">
                  <strong>Blockers</strong>
                  {selectedResult.blockers.map((blocker) => (
                    <span key={blocker}>{blocker}</span>
                  ))}
                </div>
              ) : null}
              <div className="reason-list">
                <strong>Reasons</strong>
                {selectedResult.reasons.slice(0, 6).map((reason) => (
                  <span key={reason}>{reason}</span>
                ))}
              </div>
            </div>
          ) : (
            <span className="fine-print">No model result selected.</span>
          )}
        </Panel>
      </div>
    </div>
  );
}

function ProvidersPage({ appState }: { appState: AppStateSnapshot }) {
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [logs, setLogs] = useState<ProviderLogEntry[]>([]);
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<ProviderSettings | null>(null);
  const [installPlan, setInstallPlan] = useState<ProviderInstallPlan | null>(null);
  const [folder, setFolder] = useState("");
  const [prompt, setPrompt] = useState("Say ready from the local provider.");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [chatResponse, setChatResponse] = useState<ProviderChatResponse | null>(null);
  const [statusMessage, setStatusMessage] = useState("Loading local providers...");
  const [error, setError] = useState<string | null>(null);
  const appPaused = appState.lifecycle_state === "Paused";

  useEffect(() => {
    let ignore = false;
    let unlisten: (() => void) | undefined;
    listProviderStatuses()
      .then((nextStatuses) => {
        if (ignore) return;
        setStatuses(nextStatuses);
        setSelectedProviderId((current) => current ?? nextStatuses[0]?.definition.id ?? null);
        setStatusMessage(`${nextStatuses.length} local provider adapters loaded.`);
      })
      .catch((err) => {
        if (ignore) return;
        setError(errorMessage(err));
        setStatusMessage("Provider status load failed.");
      });

    subscribeProviderHealth((status) => {
      setStatuses((current) => upsertProviderStatus(current, status));
    }).then((unsubscribe) => {
      unlisten = unsubscribe;
      if (ignore) {
        unsubscribe();
      }
    });

    return () => {
      ignore = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!selectedProviderId) return;
    let ignore = false;
    Promise.all([
      listProviderModels(selectedProviderId),
      getProviderLogs(selectedProviderId),
      getProviderFolder(selectedProviderId),
      getProviderSettings(selectedProviderId)
    ])
      .then(([nextModels, nextLogs, nextFolder, nextSettings]) => {
        if (ignore) return;
        setModels(nextModels);
        setLogs(nextLogs);
        setFolder(nextFolder);
        setSettings(nextSettings);
        setSettingsDraft(nextSettings);
        setInstallPlan(null);
        setSelectedModelId((current) => current ?? nextModels[0]?.id ?? null);
      })
      .catch((err) => {
        if (ignore) return;
        setError(errorMessage(err));
      });

    return () => {
      ignore = true;
    };
  }, [selectedProviderId]);

  useEffect(() => {
    if (statuses.length === 0) return;
    const update = appPaused
      ? pauseAllProviders("App paused")
      : resumeAllProviders();
    update
      .then((nextStatuses) => {
        setStatuses(nextStatuses);
        setStatusMessage(appPaused ? "Provider tasks paused by app state." : "Provider tasks resumed by app state.");
      })
      .catch(() => undefined);
  }, [appPaused, statuses.length]);

  const selectedStatus = useMemo(
    () => statuses.find((status) => status.definition.id === selectedProviderId) ?? statuses[0] ?? null,
    [statuses, selectedProviderId]
  );

  const updateOneStatus = useCallback((status: ProviderStatus) => {
    setStatuses((current) => upsertProviderStatus(current, status));
    setSelectedProviderId(status.definition.id);
    setStatusMessage(status.message);
  }, []);

  const handleRefresh = useCallback(async () => {
    setError(null);
    const nextStatuses = await refreshProviderHealth();
    setStatuses(nextStatuses);
    setStatusMessage("Provider health checks refreshed.");
  }, []);

  const handleStartStop = useCallback(async () => {
    if (!selectedStatus) return;
    setError(null);
    const nextStatus = selectedStatus.running
      ? await stopProvider(selectedStatus.definition.id)
      : await startProvider(selectedStatus.definition.id);
    updateOneStatus(nextStatus);
  }, [selectedStatus, updateOneStatus]);

  const handlePauseResume = useCallback(async () => {
    if (!selectedStatus) return;
    setError(null);
    const shouldResume = selectedStatus.paused;
    const nextStatus = selectedStatus.paused
      ? await resumeProviderTasks(selectedStatus.definition.id)
      : await pauseProviderTasks(selectedStatus.definition.id, "Manual provider pause");
    updateOneStatus(nextStatus);
    setStatusMessage(shouldResume ? "Provider tasks resumed." : "Provider tasks paused.");
  }, [selectedStatus, updateOneStatus]);

  const handleTestChat = useCallback(async () => {
    if (!selectedStatus) return;
    setError(null);
    setChatResponse(null);
    try {
      const response = await sendProviderTestChat({
        provider_id: selectedStatus.definition.id,
        model_id: selectedModelId,
        prompt
      });
      setChatResponse(response);
      setLogs(await getProviderLogs(selectedStatus.definition.id));
      setStatusMessage("Local provider test chat completed.");
    } catch (err) {
      setError(errorMessage(err));
      setLogs(await getProviderLogs(selectedStatus.definition.id));
      setStatusMessage("Local provider test chat rejected.");
    }
  }, [prompt, selectedModelId, selectedStatus]);

  const handleSaveSettings = useCallback(async () => {
    if (!settingsDraft) return;
    setError(null);
    setInstallPlan(null);
    try {
      const nextStatus = await updateProviderSettings({
        provider_id: settingsDraft.provider_id,
        enabled: settingsDraft.enabled,
        base_url: settingsDraft.base_url,
        folder: settingsDraft.folder,
        launch_command: settingsDraft.launch_command
      });
      updateOneStatus(nextStatus);
      const nextSettings = await getProviderSettings(settingsDraft.provider_id);
      setSettings(nextSettings);
      setSettingsDraft(nextSettings);
      setFolder(nextSettings.folder);
      setStatusMessage("Provider settings saved.");
    } catch (err) {
      setError(errorMessage(err));
      setStatusMessage("Provider settings save failed.");
    }
  }, [settingsDraft, updateOneStatus]);

  const handlePreviewInstallPlan = useCallback(async () => {
    if (!selectedStatus) return;
    setError(null);
    try {
      const plan = await previewProviderInstallPlan(selectedStatus.definition.id);
      setInstallPlan(plan);
      setStatusMessage("Dry-run install plan generated.");
    } catch (err) {
      setError(errorMessage(err));
      setStatusMessage("Dry-run install plan failed.");
    }
  }, [selectedStatus]);

  if (statuses.length === 0) {
    return (
      <div className="providers-page">
        <Panel title="Providers">
          <div className="loading-state">
            <Cloud size={22} />
            <strong>{statusMessage}</strong>
            {error ? <span>{error}</span> : <span>Preparing local provider adapters.</span>}
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="providers-page">
      <Panel title="Local Provider Adapters">
        <div className="provider-toolbar">
          <div className="hardware-title">
            <Cloud size={24} />
            <div>
              <strong>{selectedStatus?.definition.name ?? "Local providers"}</strong>
              <span>{statusMessage}</span>
            </div>
          </div>
          <button className="secondary-button" onClick={handleRefresh} type="button">
            <RefreshCw size={16} />
            Refresh health
          </button>
          <span className={appPaused ? "fit-pill tight" : "fit-pill smooth"}>
            {appPaused ? "App paused" : "App running"}
          </span>
        </div>
        {error ? <div className="inline-error">{error}</div> : null}
      </Panel>

      <div className="provider-card-grid">
        {statuses.map((status) => (
          <button
            className={
              selectedStatus?.definition.id === status.definition.id
                ? "provider-card active"
                : "provider-card"
            }
            key={status.definition.id}
            onClick={() => {
              setSelectedProviderId(status.definition.id);
              setSelectedModelId(null);
              setChatResponse(null);
              setError(null);
            }}
            type="button"
          >
            <div className="provider-card-heading">
              <strong>{status.definition.name}</strong>
              <span className={`health-pill ${status.health.toLowerCase()}`}>
                {status.health}
              </span>
            </div>
            <span>{status.definition.kind}</span>
            <span>{status.definition.base_url}</span>
            <div className="provider-card-meta">
              <span>{status.model_count} models</span>
              <span>{status.latency_ms ? `${status.latency_ms} ms` : "No latency"}</span>
            </div>
          </button>
        ))}
      </div>

      {selectedStatus ? (
        <div className="provider-detail-grid">
          <Panel title="Provider Status">
            <SpecRows
              rows={[
                ["Health", selectedStatus.health],
                ["Running", selectedStatus.running ? "Yes" : "No"],
                ["Paused", selectedStatus.paused ? "Yes" : "No"],
                ["Active Model", selectedStatus.active_model ?? "None"],
                ["Latency", selectedStatus.latency_ms ? `${selectedStatus.latency_ms} ms` : "Not available"],
                ["Endpoint", selectedStatus.definition.base_url],
                ["Folder", folder]
              ]}
            />
            <div className="provider-actions">
              <button className="secondary-button" onClick={handleStartStop} type="button">
                {selectedStatus.running ? "Stop provider" : "Start provider"}
              </button>
              <button
                className={selectedStatus.paused ? "resume-button" : "secondary-button"}
                disabled={!selectedStatus.running}
                onClick={handlePauseResume}
                type="button"
              >
                {selectedStatus.paused ? "Resume tasks" : "Pause tasks"}
              </button>
            </div>
          </Panel>

          <Panel title="Provider Settings" className="provider-settings-panel">
            {settingsDraft ? (
              <div className="provider-settings-form">
                <label className="compact-check">
                  <input
                    checked={settingsDraft.enabled}
                    onChange={(event) =>
                      setSettingsDraft((current) =>
                        current ? { ...current, enabled: event.target.checked } : current
                      )
                    }
                    type="checkbox"
                  />
                  Enabled
                </label>
                <label>
                  <span>Base URL</span>
                  <input
                    aria-label="Provider base URL"
                    onChange={(event) =>
                      setSettingsDraft((current) =>
                        current ? { ...current, base_url: event.target.value } : current
                      )
                    }
                    value={settingsDraft.base_url}
                  />
                </label>
                <label>
                  <span>Provider folder</span>
                  <input
                    aria-label="Provider folder"
                    onChange={(event) =>
                      setSettingsDraft((current) =>
                        current ? { ...current, folder: event.target.value } : current
                      )
                    }
                    value={settingsDraft.folder}
                  />
                </label>
                <label>
                  <span>Launch command</span>
                  <input
                    aria-label="Provider launch command"
                    onChange={(event) =>
                      setSettingsDraft((current) =>
                        current ? { ...current, launch_command: event.target.value || null } : current
                      )
                    }
                    placeholder="Stage 7 process hook"
                    value={settingsDraft.launch_command ?? ""}
                  />
                </label>
                <p className="fine-print">
                  {settings?.notes ?? "Local adapter settings are loaded for the selected provider."}
                </p>
                <div className="provider-actions">
                  <button className="secondary-button" onClick={handleSaveSettings} type="button">
                    <Settings size={16} />
                    Save settings
                  </button>
                  <button className="secondary-button" onClick={handlePreviewInstallPlan} type="button">
                    <TerminalSquare size={16} />
                    Dry-run install plan
                  </button>
                </div>
              </div>
            ) : (
              <p className="fine-print">Select a provider to edit local endpoint settings.</p>
            )}
          </Panel>

          <Panel title="Model Listing">
            <table className="data-table provider-model-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Format</th>
                  <th>Size</th>
                  <th>Installed</th>
                </tr>
              </thead>
              <tbody>
                {models.map((model) => (
                  <tr
                    className={selectedModelId === model.id ? "selected-row" : ""}
                    key={model.id}
                    onClick={() => setSelectedModelId(model.id)}
                  >
                    <td>{model.display_name}</td>
                    <td>{model.format}</td>
                    <td>{formatBytesGb(model.size_bytes)}</td>
                    <td>{model.installed ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Local Test Chat" className="provider-chat-panel">
            <div className="provider-chat-form">
              <select
                aria-label="Provider test model"
                onChange={(event) => setSelectedModelId(event.target.value)}
                value={selectedModelId ?? models[0]?.id ?? ""}
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.display_name}
                  </option>
                ))}
              </select>
              <textarea
                aria-label="Provider test prompt"
                onChange={(event) => setPrompt(event.target.value)}
                value={prompt}
              />
              <button
                className="secondary-button"
                disabled={!selectedStatus.running || selectedStatus.paused}
                onClick={handleTestChat}
                type="button"
              >
                <MessageSquare size={16} />
                Test local chat
              </button>
            </div>
            {chatResponse ? (
              <div className="chat-response">
                <strong>Response</strong>
                <span>{chatResponse.response}</span>
                <small>
                  {chatResponse.tokens_in} in / {chatResponse.tokens_out} out / {chatResponse.latency_ms} ms
                </small>
              </div>
            ) : (
              <p className="fine-print">
                In Tauri, this sends a tiny request to the selected local endpoint. Browser mode uses
                a simulated fallback. Chat is blocked when the provider is disabled or tasks are paused.
              </p>
            )}
          </Panel>

          {installPlan ? (
            <Panel title="Dry-Run Install Plan" className="provider-plan-panel">
              <div className="install-plan">
                <div className="plan-heading">
                  <strong>{installPlan.summary}</strong>
                  <span className="fit-pill tight">{installPlan.dry_run ? "Dry run" : "Runnable"}</span>
                </div>
                <div className="command-list">
                  {installPlan.commands.map((command) => (
                    <code key={command}>{command}</code>
                  ))}
                </div>
                <div className="reason-list">
                  {installPlan.notes.map((note) => (
                    <span key={note}>{note}</span>
                  ))}
                </div>
              </div>
            </Panel>
          ) : null}

          <Panel title="Provider Logs">
            <div className="provider-log-list">
              {logs.slice(0, 8).map((entry, index) => (
                <div className="provider-log-row" key={`${entry.timestamp_ms}-${index}-${entry.message}`}>
                  <span>{formatTimestamp(entry.timestamp_ms)}</span>
                  <strong>{entry.level}</strong>
                  <span>{entry.message}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}

function RemoteBrokerPage({ appState }: { appState: AppStateSnapshot }) {
  const [snapshot, setSnapshot] = useState<RemoteBrokerSnapshot | null>(null);
  const [clientSnapshot, setClientSnapshot] = useState<RemoteClientSnapshot | null>(null);
  const [statusMessage, setStatusMessage] = useState("Loading remote PC controls...");
  const [error, setError] = useState<string | null>(null);
  const [clientName, setClientName] = useState("MacBook client");
  const [clientAddress, setClientAddress] = useState("192.168.1.40");
  const [pairingCode, setPairingCode] = useState("");
  const [lastToken, setLastToken] = useState("");
  const [previewToken, setPreviewToken] = useState("");
  const [previewEndpoint, setPreviewEndpoint] = useState("/api/health");
  const [previewResponse, setPreviewResponse] = useState<unknown>(null);
  const [manualRemoteName, setManualRemoteName] = useState("Studio-Win11 Broker");
  const [manualRemoteUrl, setManualRemoteUrl] = useState("fixture://studio-win11");
  const [manualRemoteToken, setManualRemoteToken] = useState("lar_stage12_fixture_token");
  const [discoveredToken, setDiscoveredToken] = useState("lar_stage12_fixture_token");
  const [fixedRemoteToken, setFixedRemoteToken] = useState("lar_fixed_broker_token");
  const isPaused = appState.lifecycle_state === "Paused";

  useEffect(() => {
    let ignore = false;
    const unsubscribeBroker = subscribeRemoteBrokerSnapshot((nextSnapshot) => {
      setSnapshot(nextSnapshot);
      setStatusMessage(nextSnapshot.message);
    });
    const unsubscribeClient = subscribeRemoteClientSnapshot((nextSnapshot) => {
      setClientSnapshot(nextSnapshot);
      setStatusMessage(nextSnapshot.message);
    });
    Promise.all([getRemoteBrokerSnapshot(), getRemoteClientSnapshot()])
      .then(([nextSnapshot, nextClientSnapshot]) => {
        if (ignore) return;
        setSnapshot(nextSnapshot);
        setClientSnapshot(nextClientSnapshot);
        setStatusMessage(nextClientSnapshot.message);
      })
      .catch((err) => {
        if (ignore) return;
        setError(errorMessage(err));
        setStatusMessage("Remote PC controls failed to load.");
      });
    return () => {
      ignore = true;
      unsubscribeBroker();
      unsubscribeClient();
    };
  }, []);

  const updateSetting = useCallback(
    async (key: keyof RemoteBrokerSettings, value: boolean | number | string | BrokerPausePolicy) => {
      if (!snapshot) return;
      setError(null);
      try {
        const nextSnapshot = await updateRemoteBrokerSettings({
          ...snapshot.settings,
          [key]: value
        });
        setSnapshot(nextSnapshot);
        setStatusMessage(nextSnapshot.message);
      } catch (err) {
        setError(errorMessage(err));
        setStatusMessage("Broker settings failed to save.");
      }
    },
    [snapshot]
  );

  const updateClientSetting = useCallback(
    async (key: keyof RemoteClientSettings, value: boolean | string) => {
      if (!clientSnapshot) return;
      setError(null);
      try {
        const nextSnapshot = await updateRemoteClientSettings({
          ...clientSnapshot.settings,
          [key]: value
        });
        setClientSnapshot(nextSnapshot);
        setStatusMessage(nextSnapshot.message);
      } catch (err) {
        setError(errorMessage(err));
        setStatusMessage("Remote client settings failed to save.");
      }
    },
    [clientSnapshot]
  );

  const runClientAction = useCallback(
    async (action: "discover" | "refresh") => {
      setError(null);
      try {
        const nextSnapshot = action === "discover" ? await discoverRemoteClients() : await refreshRemoteClients();
        setClientSnapshot(nextSnapshot);
        setStatusMessage(nextSnapshot.message);
      } catch (err) {
        setError(errorMessage(err));
        setStatusMessage("Remote client action failed.");
      }
    },
    []
  );

  const pairManualRemote = useCallback(async () => {
    setError(null);
    try {
      const nextSnapshot = await pairManualRemoteClient({
        name: manualRemoteName.trim() || "Remote Windows broker",
        base_url: manualRemoteUrl.trim(),
        token: manualRemoteToken.trim()
      });
      setClientSnapshot(nextSnapshot);
      setStatusMessage(nextSnapshot.message);
    } catch (err) {
      setError(errorMessage(err));
      setStatusMessage("Manual remote pairing failed.");
    }
  }, [manualRemoteName, manualRemoteToken, manualRemoteUrl]);

  const pairFixedRemote = useCallback(async () => {
    if (!clientSnapshot) return;
    setError(null);
    try {
      const nextSnapshot = await pairManualRemoteClient({
        name: clientSnapshot.settings.fixed_broker_name.trim() || "Fixed Windows Broker",
        base_url: clientSnapshot.settings.fixed_broker_base_url.trim(),
        token: fixedRemoteToken.trim()
      });
      setClientSnapshot(nextSnapshot);
      setStatusMessage("Fixed broker address paired.");
    } catch (err) {
      setError(errorMessage(err));
      setStatusMessage("Fixed broker pairing failed.");
    }
  }, [clientSnapshot, fixedRemoteToken]);

  const pairFirstDiscovery = useCallback(async () => {
    const discovery = clientSnapshot?.discovered[0];
    if (!discovery) return;
    setError(null);
    try {
      const nextSnapshot = await pairDiscoveredRemoteClient({
        discovery_id: discovery.id,
        token: discoveredToken.trim()
      });
      setClientSnapshot(nextSnapshot);
      setStatusMessage(nextSnapshot.message);
    } catch (err) {
      setError(errorMessage(err));
      setStatusMessage("Discovered remote pairing failed.");
    }
  }, [clientSnapshot?.discovered, discoveredToken]);

  const removeRemote = useCallback(async (device: RemoteClientDevice) => {
    setError(null);
    try {
      const nextSnapshot = await removeRemoteClient(device.id);
      setClientSnapshot(nextSnapshot);
      setStatusMessage(`${device.name} removed.`);
    } catch (err) {
      setError(errorMessage(err));
      setStatusMessage("Remote client remove failed.");
    }
  }, []);

  const runBrokerAction = useCallback(
    async (action: "start" | "stop" | "pair") => {
      setError(null);
      try {
        if (action === "start") {
          const nextSnapshot = await startRemoteBroker();
          setSnapshot(nextSnapshot);
          setStatusMessage(nextSnapshot.message);
          return;
        }
        if (action === "stop") {
          const nextSnapshot = await stopRemoteBroker();
          setSnapshot(nextSnapshot);
          setStatusMessage(nextSnapshot.message);
          return;
        }
        const result = await createRemotePairingCode();
        setSnapshot(result.snapshot);
        setPairingCode(result.session.code);
        setStatusMessage(`Pairing code ${result.session.code} is active.`);
      } catch (err) {
        setError(errorMessage(err));
        setStatusMessage("Broker action failed.");
      }
    },
    []
  );

  const registerClient = useCallback(async () => {
    if (!pairingCode.trim()) return;
    setError(null);
    try {
      const registration = await registerRemoteBrokerClient({
        code: pairingCode.trim(),
        client_name: clientName.trim() || "Remote client",
        address: clientAddress.trim() || "unknown"
      });
      setSnapshot(registration.snapshot);
      setLastToken(registration.token);
      setPreviewToken(registration.token);
      setStatusMessage(`${registration.device.name} paired. Copy the token now; it is shown once.`);
    } catch (err) {
      setError(errorMessage(err));
      setStatusMessage("Client pairing failed.");
    }
  }, [clientAddress, clientName, pairingCode]);

  const revokeClient = useCallback(async (device: RemoteDevice) => {
    setError(null);
    try {
      const nextSnapshot = await revokeRemoteBrokerClient(device.id);
      setSnapshot(nextSnapshot);
      setStatusMessage(`${device.name} revoked.`);
    } catch (err) {
      setError(errorMessage(err));
      setStatusMessage("Client revoke failed.");
    }
  }, []);

  const runEndpointPreview = useCallback(async () => {
    const endpoint = snapshot?.endpoints.find((item) => item.path === previewEndpoint);
    if (!endpoint) return;
    setError(null);
    try {
      const request: BrokerEndpointRequest = {
        method: endpoint.method,
        path: endpoint.path,
        bearer_token: previewToken || null,
        body:
          endpoint.path === "/v1/chat/completions"
            ? { model: "local-model", messages: [{ role: "user", content: "health check" }] }
            : null
      };
      const response = await previewRemoteBrokerEndpoint(request);
      setPreviewResponse(response);
      setStatusMessage(`Endpoint preview returned HTTP ${response.status_code}.`);
    } catch (err) {
      setError(errorMessage(err));
      setStatusMessage("Endpoint preview failed.");
    }
  }, [previewEndpoint, previewToken, snapshot?.endpoints]);

  if (!snapshot || !clientSnapshot) {
    return (
      <div className="remote-broker-page">
        <Panel title="Remote PCs">
          <div className="loading-state">
            <Network size={22} />
            <strong>{statusMessage}</strong>
            {error ? <span>{error}</span> : <span>Preparing broker and remote client state.</span>}
          </div>
        </Panel>
      </div>
    );
  }

  const running = snapshot.status === "Running" || snapshot.status === "PausedOnline";
  const activeSession = snapshot.pairing_sessions.find((session) => session.status === "Active");
  const liveEndpoint = snapshot.endpoints.find((endpoint) => endpoint.path === previewEndpoint);
  const firstDiscovery = clientSnapshot.discovered[0];

  return (
    <div className="remote-broker-page">
      <Panel title="Mac Remote Client">
        <div className="remote-broker-toolbar">
          <div className="hardware-title">
            <Monitor size={24} />
            <div>
              <strong>{remoteClientStatusLabel(clientSnapshot.status)}</strong>
              <span>{statusMessage}</span>
            </div>
          </div>
          <button className="secondary-button" disabled={isPaused} onClick={() => runClientAction("discover")} type="button">
            <Network size={16} />
            Discover
          </button>
          <button className="secondary-button" disabled={isPaused} onClick={() => runClientAction("refresh")} type="button">
            <RefreshCw size={16} />
            Refresh remotes
          </button>
        </div>
        {error ? <div className="inline-error">{error}</div> : null}
      </Panel>

      <div className="remote-broker-grid">
        <Panel title="Client Discovery">
          <div className="settings-list">
            <SettingToggle
              checked={clientSnapshot.settings.discovery_enabled}
              description="Use Bonjour/mDNS service lookup for Windows brokers."
              label="Bonjour discovery"
              onChange={(checked) => updateClientSetting("discovery_enabled", checked)}
            />
            <SettingToggle
              checked={clientSnapshot.settings.include_fixture_discovery}
              description="Keep the fixture broker available for local testing and browser preview."
              label="Fixture broker"
              onChange={(checked) => updateClientSetting("include_fixture_discovery", checked)}
            />
            <SettingToggle
              checked={clientSnapshot.settings.allow_router_remote_models}
              description="Allow Router modes to select paired Windows remote models."
              label="Router can use remotes"
              onChange={(checked) => updateClientSetting("allow_router_remote_models", checked)}
            />
          </div>
          <div className="broker-form-grid single">
            <label>
              <span>mDNS service</span>
              <input
                value={clientSnapshot.settings.mdns_service}
                onChange={(event) => updateClientSetting("mdns_service", event.target.value)}
              />
            </label>
          </div>
        </Panel>

        <Panel title="Manual Pairing">
          <div className="broker-form-grid single">
            <label>
              <span>Remote name</span>
              <input value={manualRemoteName} onChange={(event) => setManualRemoteName(event.target.value)} />
            </label>
            <label>
              <span>Broker URL</span>
              <input value={manualRemoteUrl} onChange={(event) => setManualRemoteUrl(event.target.value)} />
            </label>
            <label>
              <span>Pairing token</span>
              <input value={manualRemoteToken} onChange={(event) => setManualRemoteToken(event.target.value)} />
            </label>
          </div>
          <div className="remote-broker-actions">
            <button className="secondary-button" disabled={isPaused} onClick={pairManualRemote} type="button">
              <ShieldCheck size={16} />
              Pair manual broker
            </button>
          </div>
        </Panel>

        <Panel title="Fixed Broker Address">
          <div className="settings-list">
            <SettingToggle
              checked={clientSnapshot.settings.fixed_broker_enabled}
              description="Pin a stable broker URL inside Local AI Router. This does not assign a static OS or router IP."
              label="Use fixed broker address"
              onChange={(checked) => updateClientSetting("fixed_broker_enabled", checked)}
            />
            <SettingToggle
              checked={clientSnapshot.settings.prefer_fixed_broker_over_mdns}
              description="List the fixed broker before Bonjour and fixture discovery results."
              label="Prefer fixed address over Bonjour"
              onChange={(checked) => updateClientSetting("prefer_fixed_broker_over_mdns", checked)}
            />
          </div>
          <div className="broker-form-grid single">
            <label>
              <span>Fixed broker name</span>
              <input
                value={clientSnapshot.settings.fixed_broker_name}
                onChange={(event) => updateClientSetting("fixed_broker_name", event.target.value)}
              />
            </label>
            <label>
              <span>Fixed broker URL</span>
              <input
                placeholder="http://192.168.1.50:17640"
                value={clientSnapshot.settings.fixed_broker_base_url}
                onChange={(event) => updateClientSetting("fixed_broker_base_url", event.target.value)}
              />
            </label>
            <label>
              <span>Pairing token</span>
              <input value={fixedRemoteToken} onChange={(event) => setFixedRemoteToken(event.target.value)} />
            </label>
          </div>
          <p className="fine-print">
            For best stability, reserve the Windows broker IP in your router or set a static IP in Windows,
            then pin that URL here.
          </p>
          <div className="remote-broker-actions">
            <button className="secondary-button" disabled={isPaused} onClick={pairFixedRemote} type="button">
              <ShieldCheck size={16} />
              Pair fixed address
            </button>
          </div>
        </Panel>
      </div>

      <div className="remote-broker-grid">
        <Panel title="Discovered Brokers">
          {clientSnapshot.discovered.length === 0 ? (
            <div className="empty-log-state compact">
              <Network size={20} />
              <strong>No brokers discovered.</strong>
              <span>Run Discover to query {clientSnapshot.settings.mdns_service} and fixture sources.</span>
            </div>
          ) : (
            <div className="remote-device-grid">
              {clientSnapshot.discovered.map((device) => (
                <article className="remote-device-card" key={device.id}>
                  <div>
                    <strong>{device.name}</strong>
                    <span>{device.source} / {device.service_type}</span>
                  </div>
                  <span>{device.base_url}</span>
                  <span>{device.latency_ms ? `${device.latency_ms} ms` : "Latency pending"}</span>
                </article>
              ))}
            </div>
          )}
          <div className="broker-form-grid single">
            <label>
              <span>Token for first discovered broker</span>
              <input value={discoveredToken} onChange={(event) => setDiscoveredToken(event.target.value)} />
            </label>
          </div>
          <div className="remote-broker-actions">
            <button className="secondary-button" disabled={!firstDiscovery || isPaused} onClick={pairFirstDiscovery} type="button">
              <ShieldCheck size={16} />
              Pair first discovery
            </button>
          </div>
        </Panel>

        <Panel title="Remote Routing Summary">
          <div className="state-summary">
            <StatusLine label="Paired devices" value={String(clientSnapshot.paired_devices.length)} />
            <StatusLine label="Route candidates" value={String(clientSnapshot.route_candidates.length)} />
            <StatusLine label="Token storage" value={clientSnapshot.token_storage} />
            <StatusLine
              label="Last discovery"
              value={clientSnapshot.last_discovery_ms ? formatTimestamp(clientSnapshot.last_discovery_ms) : "Not run"}
            />
            <StatusLine label="Pause gate" value={isPaused ? "Discovery suspended" : "Open"} />
          </div>
        </Panel>
      </div>

      <Panel title="Paired Remote Devices">
        {clientSnapshot.paired_devices.length === 0 ? (
          <div className="empty-log-state">
            <Monitor size={22} />
            <strong>No remote devices paired.</strong>
            <span>Use Bonjour discovery or manual IP:port pairing to connect a Windows broker.</span>
          </div>
        ) : (
          <div className="remote-device-grid">
            {clientSnapshot.paired_devices.map((device) => (
              <RemoteDeviceCard device={device} key={device.id} onRemove={removeRemote} />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Windows Remote Provider Broker">
        <div className="remote-broker-toolbar">
          <div className="hardware-title">
            <Network size={24} />
            <div>
              <strong>{remoteBrokerStatusLabel(snapshot.status)}</strong>
              <span>{statusMessage}</span>
            </div>
          </div>
          <button
            className="secondary-button"
            disabled={running || snapshot.status === "PlatformBlocked"}
            onClick={() => runBrokerAction("start")}
            type="button"
          >
            <Play size={16} />
            Start broker
          </button>
          <button className="secondary-button" disabled={!running} onClick={() => runBrokerAction("stop")} type="button">
            <Pause size={16} />
            Stop broker
          </button>
          <button className="secondary-button" disabled={!running} onClick={() => runBrokerAction("pair")} type="button">
            <ShieldCheck size={16} />
            New pairing code
          </button>
        </div>
        {error ? <div className="inline-error">{error}</div> : null}
      </Panel>

      <div className="remote-broker-grid">
        <Panel title="Broker Settings">
          <div className="settings-list">
            <SettingToggle
              checked={snapshot.settings.lan_sharing_enabled}
              description="Opt in before exposing broker endpoints on a trusted LAN."
              label="LAN sharing"
              onChange={(checked) => updateSetting("lan_sharing_enabled", checked)}
            />
            <SettingToggle
              checked={snapshot.settings.advertise_mdns}
              description="Advertise the broker for trusted Mac client discovery."
              label="mDNS advertisement"
              onChange={(checked) => updateSetting("advertise_mdns", checked)}
            />
            <SettingToggle
              checked={snapshot.settings.require_bearer_token}
              description="Require paired-client bearer tokens for all broker endpoints."
              label="Bearer token required"
              onChange={(checked) => updateSetting("require_bearer_token", checked)}
            />
          </div>
          <div className="broker-form-grid">
            <label>
              <span>Bind host</span>
              <input
                value={snapshot.settings.bind_host}
                onChange={(event) => updateSetting("bind_host", event.target.value)}
              />
            </label>
            <label>
              <span>Port</span>
              <input
                min={1}
                max={65535}
                type="number"
                value={snapshot.settings.port}
                onChange={(event) => updateSetting("port", Number(event.target.value))}
              />
            </label>
            <label>
              <span>Pause policy</span>
              <select
                value={snapshot.settings.pause_policy}
                onChange={(event) => updateSetting("pause_policy", event.target.value as BrokerPausePolicy)}
              >
                <option value="KeepOnline">Keep online</option>
                <option value="RejectNewRequests">Reject new requests</option>
                <option value="StopUntilResume">Stop until resume</option>
              </select>
            </label>
          </div>
        </Panel>

        <Panel title="Broker Summary">
          <div className="state-summary">
            <StatusLine label="Platform" value={snapshot.platform === "WindowsX64" ? "Windows x64" : "Preview only"} />
            <StatusLine label="Listen URL" value={snapshot.listen_url ?? "Not listening"} />
            <StatusLine label="Pause state" value={isPaused ? pausePolicyLabel(snapshot.settings.pause_policy) : "Running gate open"} />
            <StatusLine
              label="Active clients"
              value={String(snapshot.connected_clients.filter((device) => !device.revoked).length)}
            />
            <StatusLine label="Auth" value={snapshot.settings.require_bearer_token ? "Required" : "Disabled"} />
          </div>
        </Panel>
      </div>

      <div className="remote-broker-grid">
        <Panel title="Pairing">
          <div className="pairing-code-box">
            <span>Active code</span>
            <strong>{pairingCode || activeSession?.code || "No active code"}</strong>
            <small>
              {activeSession
                ? `Expires ${formatTimestamp(activeSession.expires_at_ms)}`
                : pairingCode
                  ? "Code has been consumed by a paired client."
                  : "Start broker, then create a code."}
            </small>
          </div>
          <div className="broker-form-grid">
            <label>
              <span>Client name</span>
              <input value={clientName} onChange={(event) => setClientName(event.target.value)} />
            </label>
            <label>
              <span>Client address</span>
              <input value={clientAddress} onChange={(event) => setClientAddress(event.target.value)} />
            </label>
          </div>
          <div className="remote-broker-actions">
            <button className="secondary-button" disabled={!pairingCode && !activeSession} onClick={registerClient} type="button">
              <ShieldCheck size={16} />
              Register paired client
            </button>
            {lastToken ? (
              <button className="secondary-button" onClick={() => copyText(lastToken)} type="button">
                <Clipboard size={16} />
                Copy token
              </button>
            ) : null}
          </div>
          {lastToken ? (
            <div className="token-box">
              <span>One-time token</span>
              <code>{lastToken}</code>
            </div>
          ) : null}
        </Panel>

        <Panel title="Security and Firewall">
          <div className="warning-list">
            {snapshot.security_warnings.map((warning) => (
              <div className="warning-row" key={warning}>
                <ShieldCheck size={16} />
                <span>{warning}</span>
              </div>
            ))}
          </div>
          <div className="reason-list">
            {snapshot.firewall_guidance.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Connected Clients">
        {snapshot.connected_clients.length === 0 ? (
          <div className="empty-log-state">
            <Monitor size={22} />
            <strong>No paired clients yet.</strong>
            <span>Create a pairing code and register a client to issue a bearer token.</span>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table remote-client-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Address</th>
                  <th>Token</th>
                  <th>Last Seen</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.connected_clients.map((device) => (
                  <RemoteClientRow device={device} key={device.id} onRevoke={revokeClient} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="remote-broker-grid">
        <Panel title="Authenticated Endpoints">
          <div className="table-scroll">
            <table className="data-table endpoint-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Path</th>
                  <th>Auth</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.endpoints.map((endpoint) => (
                  <tr key={`${endpoint.method}-${endpoint.path}`}>
                    <td>{endpoint.method}</td>
                    <td>
                      <code>{endpoint.path}</code>
                    </td>
                    <td>{endpoint.auth_required ? "Bearer" : "Open"}</td>
                    <td>{endpoint.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Endpoint Preview">
          <div className="broker-form-grid single">
            <label>
              <span>Endpoint</span>
              <select value={previewEndpoint} onChange={(event) => setPreviewEndpoint(event.target.value)}>
                {snapshot.endpoints.map((endpoint) => (
                  <option value={endpoint.path} key={endpoint.path}>
                    {endpoint.method} {endpoint.path}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Bearer token</span>
              <input
                value={previewToken}
                onChange={(event) => setPreviewToken(event.target.value)}
                placeholder="Paste paired-client token"
              />
            </label>
          </div>
          <div className="remote-broker-actions">
            <button className="secondary-button" disabled={!liveEndpoint} onClick={runEndpointPreview} type="button">
              <RefreshCw size={16} />
              Preview endpoint
            </button>
          </div>
          {previewResponse ? (
            <pre className="json-preview">{JSON.stringify(previewResponse, null, 2)}</pre>
          ) : (
            <div className="empty-log-state compact">
              <TerminalSquare size={20} />
              <strong>No endpoint preview yet.</strong>
              <span>Register a client, paste its token, then preview a broker route.</span>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function RemoteClientRow({
  device,
  onRevoke
}: {
  device: RemoteDevice;
  onRevoke: (device: RemoteDevice) => void;
}) {
  return (
    <tr>
      <td>{device.name}</td>
      <td>{device.address}</td>
      <td>{device.token_fingerprint}</td>
      <td>{formatTimestamp(device.last_seen_ms)}</td>
      <td>
        <span className={`health-pill ${device.revoked ? "error" : "healthy"}`}>
          {device.revoked ? "Revoked" : "Paired"}
        </span>
      </td>
      <td>
        <button className="secondary-button table-action" disabled={device.revoked} onClick={() => onRevoke(device)} type="button">
          Revoke
        </button>
      </td>
    </tr>
  );
}

function RemoteDeviceCard({
  device,
  onRemove
}: {
  device: RemoteClientDevice;
  onRemove: (device: RemoteClientDevice) => void;
}) {
  const gpu = device.specs?.gpus[0];
  return (
    <article className="remote-device-card paired">
      <div className="remote-device-card-heading">
        <div>
          <strong>{device.name}</strong>
          <span>{device.base_url}</span>
        </div>
        <span className={`health-pill ${remoteClientHealthClass(device.status)}`}>{remoteClientStatusLabel(device.status)}</span>
      </div>
      <div className="state-summary">
        <StatusLine label="Platform" value={device.specs?.platform.os ?? "Unknown"} />
        <StatusLine label="GPU" value={gpu ? `${gpu.name} (${gpu.vendor})` : "Unknown"} />
        <StatusLine label="Memory" value={device.specs ? formatBytesGb(device.specs.memory.total_bytes) : "Unknown"} />
        <StatusLine label="Load" value={device.specs ? `${device.specs.load.memory_percent}% memory` : "Pending"} />
        <StatusLine label="Latency" value={device.latency_ms ? `${device.latency_ms} ms` : "Pending"} />
        <StatusLine label="Models" value={String(device.models.length)} />
      </div>
      <div className="reason-list">
        {device.models.slice(0, 4).map((model) => (
          <span key={model.id}>{model.display_name}</span>
        ))}
        <strong>{device.message}</strong>
      </div>
      <div className="remote-broker-actions">
        <button className="secondary-button" onClick={() => onRemove(device)} type="button">
          Remove
        </button>
      </div>
    </article>
  );
}

function UpdatesPage({ appState }: { appState: AppStateSnapshot }) {
  const [snapshot, setSnapshot] = useState<UpdaterSnapshot | null>(null);
  const [hardware, setHardware] = useState<HardwareSpecs | null>(null);
  const [statusMessage, setStatusMessage] = useState("Loading update metadata settings...");
  const [error, setError] = useState<string | null>(null);
  const isPaused = appState.lifecycle_state === "Paused";

  useEffect(() => {
    let ignore = false;
    let unlisten: (() => void) | undefined;
    Promise.all([getUpdaterSnapshot(), refreshHardwareSpecs()])
      .then(([nextSnapshot, nextHardware]) => {
        if (ignore) return;
        setSnapshot(nextSnapshot);
        setHardware(nextHardware);
        setStatusMessage(nextSnapshot.message);
      })
      .catch((err) => {
        if (ignore) return;
        setError(errorMessage(err));
        setStatusMessage("Update metadata failed to load.");
      });
    subscribeUpdaterSnapshot((nextSnapshot) => {
      setSnapshot(nextSnapshot);
      setStatusMessage(nextSnapshot.message);
    }).then((unsubscribe) => {
      unlisten = unsubscribe;
      if (ignore) unsubscribe();
    });

    return () => {
      ignore = true;
      unlisten?.();
    };
  }, []);

  const runCheck = useCallback(
    async (manual: boolean) => {
      if (!hardware) return;
      setError(null);
      try {
        const nextSnapshot = await checkUpdatesNow({
          hardware,
          app_paused: isPaused,
          manual
        });
        setSnapshot(nextSnapshot);
        setStatusMessage(nextSnapshot.message);
      } catch (err) {
        setError(errorMessage(err));
        setStatusMessage("Update check failed.");
      }
    },
    [hardware, isPaused]
  );

  const updateSetting = useCallback(
    async (key: keyof UpdaterSettings, value: boolean | number) => {
      if (!snapshot) return;
      setError(null);
      try {
        const nextSnapshot = await updateUpdaterSettings({
          ...snapshot.settings,
          [key]: value
        });
        setSnapshot(nextSnapshot);
        setStatusMessage(nextSnapshot.message);
      } catch (err) {
        setError(errorMessage(err));
        setStatusMessage("Update settings failed to save.");
      }
    },
    [snapshot]
  );

  const runUpdateAction = useCallback(
    async (candidate: UpdateCandidate, action: UpdateActionKind) => {
      setError(null);
      try {
        const nextSnapshot = await applyUpdateAction({
          candidate_id: candidate.id,
          action
        });
        setSnapshot(nextSnapshot);
        setStatusMessage(`${candidate.model_name}: ${actionStatusLabel(action)}.`);
      } catch (err) {
        setError(errorMessage(err));
        setStatusMessage("Update action failed.");
      }
    },
    []
  );

  if (!snapshot || !hardware) {
    return (
      <div className="updates-page">
        <Panel title="Model Updates">
          <div className="loading-state">
            <Download size={22} />
            <strong>{statusMessage}</strong>
            {error ? <span>{error}</span> : <span>Preparing fixture metadata sources.</span>}
          </div>
        </Panel>
      </div>
    );
  }

  const availableCandidates = snapshot.candidates.filter((candidate) => !candidate.ignored);

  return (
    <div className="updates-page">
      <Panel title="Model Update Metadata">
        <div className="updates-toolbar">
          <div className="hardware-title">
            <Download size={24} />
            <div>
              <strong>{snapshot.status}</strong>
              <span>{statusMessage}</span>
            </div>
          </div>
          <button
            className="secondary-button"
            disabled={snapshot.settings.privacy_mode_enabled}
            onClick={() => runCheck(true)}
            type="button"
          >
            <RefreshCw size={16} />
            Check now
          </button>
          <button
            className="secondary-button"
            disabled={snapshot.settings.privacy_mode_enabled || isPaused}
            onClick={() => runCheck(false)}
            type="button"
          >
            <Clock size={16} />
            Scheduled check
          </button>
        </div>
        {error ? <div className="inline-error">{error}</div> : null}
      </Panel>

      <div className="updates-grid">
        <Panel title="Metadata Sources">
          <div className="settings-list">
            <SettingToggle
              checked={!snapshot.settings.privacy_mode_enabled}
              description="Disabling privacy mode allows local fixture metadata checks."
              label="Metadata checks"
              onChange={(checked) => updateSetting("privacy_mode_enabled", !checked)}
            />
            <SettingToggle
              checked={snapshot.settings.scheduled_checks_enabled}
              description={isPaused ? "Scheduled checks are suspended while paused." : "Allow background update checks when the app is running."}
              label="Scheduled checks"
              onChange={(checked) => updateSetting("scheduled_checks_enabled", checked)}
            />
            <SettingToggle
              checked={snapshot.settings.include_ollama}
              description="Read the Ollama metadata fixture."
              label="Ollama metadata"
              onChange={(checked) => updateSetting("include_ollama", checked)}
            />
            <SettingToggle
              checked={snapshot.settings.include_mlx_huggingface}
              description="Read the MLX/Hugging Face metadata fixture."
              label="MLX/Hugging Face metadata"
              onChange={(checked) => updateSetting("include_mlx_huggingface", checked)}
            />
            <SettingToggle
              checked={snapshot.settings.include_custom_json}
              description="Read the custom JSON catalog fixture."
              label="Custom JSON catalog"
              onChange={(checked) => updateSetting("include_custom_json", checked)}
            />
          </div>
        </Panel>

        <Panel title="Update Summary">
          <div className="state-summary">
            <StatusLine label="Candidates" value={String(availableCandidates.length)} />
            <StatusLine label="Ignored" value={String(snapshot.candidates.length - availableCandidates.length)} />
            <StatusLine
              label="Last checked"
              value={snapshot.last_checked_ms ? formatTimestamp(snapshot.last_checked_ms) : "Not checked"}
            />
            <StatusLine label="Privacy mode" value={snapshot.settings.privacy_mode_enabled ? "On" : "Off"} />
            <StatusLine label="Pause gate" value={isPaused ? "Scheduled checks suspended" : "Open"} />
          </div>
          <div className="reminder-row">
            <span>Remind later</span>
            <input
              aria-label="Remind later hours"
              min={1}
              max={168}
              onChange={(event) => updateSetting("remind_later_hours", Number(event.target.value))}
              type="number"
              value={snapshot.settings.remind_later_hours}
            />
            <strong>hours</strong>
          </div>
        </Panel>
      </div>

      <Panel title="Available Updates">
        {snapshot.settings.privacy_mode_enabled ? (
          <div className="empty-log-state">
            <ShieldCheck size={22} />
            <strong>Privacy mode is on.</strong>
            <span>Metadata checks are disabled.</span>
          </div>
        ) : availableCandidates.length === 0 ? (
          <div className="empty-log-state">
            <Download size={22} />
            <strong>No update candidates loaded.</strong>
            <span>Run Check now to load fixture metadata.</span>
          </div>
        ) : (
          <div className="update-card-grid">
            {availableCandidates.map((candidate) => (
              <UpdateCard candidate={candidate} key={candidate.id} onAction={runUpdateAction} />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Update History">
        {snapshot.history.length === 0 ? (
          <div className="empty-log-state">
            <Clock size={22} />
            <strong>No update actions recorded yet.</strong>
            <span>Use an update card action to add history.</span>
          </div>
        ) : (
          <table className="data-table logs-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Candidate</th>
                <th>Action</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.history.map((entry) => (
                <tr key={`${entry.timestamp_ms}-${entry.candidate_id}-${entry.action}`}>
                  <td>{formatTimestamp(entry.timestamp_ms)}</td>
                  <td>{entry.candidate_id}</td>
                  <td>{entry.action}</td>
                  <td>{entry.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function UpdateCard({
  candidate,
  onAction
}: {
  candidate: UpdateCandidate;
  onAction: (candidate: UpdateCandidate, action: UpdateActionKind) => void;
}) {
  return (
    <article className="update-card">
      <div className="update-card-heading">
        <div>
          <strong>{candidate.model_name}</strong>
          <span>{sourceKindLabel(candidate.source_kind)}</span>
        </div>
        <span className={`fit-pill ${candidate.compatibility_label.toLowerCase()}`}>
          {candidate.compatibility_label} {candidate.compatibility_score}
        </span>
      </div>
      <div className="version-row">
        <span>{candidate.current_version}</span>
        <strong>{"->"}</strong>
        <span>{candidate.latest_version}</span>
      </div>
      <p>{candidate.release_notes}</p>
      <div className="reason-list">
        <span>{candidate.source_name}</span>
        {candidate.blocked_reasons.length > 0 ? (
          <strong>{candidate.blocked_reasons.join(", ")}</strong>
        ) : (
          <span>{candidate.compatibility_notes[0] ?? "Compatibility fixture scored successfully."}</span>
        )}
        {candidate.remind_after_ms ? <span>Reminder: {formatTimestamp(candidate.remind_after_ms)}</span> : null}
        <span>Status: {candidate.action_status}</span>
      </div>
      <div className="update-actions">
        <button className="secondary-button" onClick={() => onAction(candidate, "Install")} type="button">
          <Download size={15} />
          Install
        </button>
        <button className="secondary-button" onClick={() => onAction(candidate, "InstallAndSwitch")} type="button">
          <RefreshCw size={15} />
          Install and switch
        </button>
        <button className="secondary-button" onClick={() => onAction(candidate, "RemindLater")} type="button">
          <Clock size={15} />
          Remind later
        </button>
        <button className="ghost-button" onClick={() => onAction(candidate, "Ignore")} type="button">
          <Ban size={15} />
          Ignore
        </button>
      </div>
    </article>
  );
}

function InstallerPage() {
  const [plans, setPlans] = useState<InstallPlan[]>([]);
  const [state, setState] = useState<InstallRunState | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [consentGranted, setConsentGranted] = useState(false);
  const [installMode, setInstallMode] = useState<"dry" | "live">("dry");
  const [statusMessage, setStatusMessage] = useState("Loading install plans...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    let unlisten: (() => void) | undefined;
    Promise.all([listInstallPlans(), getInstallState()])
      .then(([nextPlans, nextState]) => {
        if (ignore) return;
        setPlans(nextPlans);
        setState(nextState);
        setSelectedPlanId(nextState.selected_plan_id ?? nextPlans[0]?.id ?? "");
        setStatusMessage(`${nextPlans.length} recommended install plans ready.`);
      })
      .catch((err) => {
        if (ignore) return;
        setError(errorMessage(err));
        setStatusMessage("Install plans failed to load.");
      });

    subscribeInstallProgress((nextState) => {
      setState(nextState);
      setSelectedPlanId((current) => nextState.selected_plan_id ?? current);
    }).then((unsubscribe) => {
      unlisten = unsubscribe;
      if (ignore) unsubscribe();
    });

    return () => {
      ignore = true;
      unlisten?.();
    };
  }, []);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? plans[0] ?? null,
    [plans, selectedPlanId]
  );

  const runAction = useCallback(
    async (action: () => Promise<InstallRunState>, message: string) => {
      setError(null);
      try {
        const nextState = await action();
        setState(nextState);
        setStatusMessage(message);
      } catch (err) {
        setError(errorMessage(err));
      }
    },
    []
  );

  const handleStart = useCallback(() => {
    if (!selectedPlan) return;
    runAction(
      () =>
        startInstallRun({
          plan_id: selectedPlan.id,
          dry_run: installMode === "dry",
          consent_granted: consentGranted
        }),
      consentGranted
        ? installMode === "dry"
          ? "Dry-run installer started."
          : "Live installer started."
        : "Consent required before install."
    );
  }, [consentGranted, installMode, runAction, selectedPlan]);

  if (!selectedPlan || !state) {
    return (
      <div className="installer-page">
        <Panel title="Runtime Installer">
          <div className="loading-state">
            <Download size={22} />
            <strong>{statusMessage}</strong>
            {error ? <span>{error}</span> : <span>Preparing runtime and model install plans.</span>}
          </div>
        </Panel>
      </div>
    );
  }

  const isRunning = state.status === "Running";
  const isPaused = state.status === "Paused";
  const activePlan = plans.find((plan) => plan.id === state.selected_plan_id) ?? selectedPlan;

  return (
    <div className="installer-page">
      <Panel title="Runtime and Model Installation">
        <div className="installer-toolbar">
          <div className="hardware-title">
            <Download size={24} />
            <div>
              <strong>{activePlan.name}</strong>
              <span>{statusMessage}</span>
            </div>
          </div>
          <select
            aria-label="Install plan"
            disabled={isRunning || isPaused}
            onChange={(event) => {
              setSelectedPlanId(event.target.value);
              setConsentGranted(false);
              setInstallMode("dry");
              setStatusMessage("Install plan selected.");
            }}
            value={selectedPlanId}
          >
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
          <span className={`health-pill ${installStatusClass(state.status)}`}>{state.status}</span>
        </div>
        {error ? <div className="inline-error">{error}</div> : null}
      </Panel>

      <div className="installer-grid">
        <Panel title="Recommended Setup">
          <SpecRows
            rows={[
              ["Platform", platformLabel(selectedPlan.platform)],
              ["Runtime Folder", selectedPlan.runtime_dir],
              ["Model Folder", selectedPlan.model_dir],
              ["Cache Folder", selectedPlan.cache_dir],
              ["Mode", installMode === "dry" ? "Dry run preview" : "Live install and run"]
            ]}
          />
          <p className="fine-print">{selectedPlan.summary}</p>
          <div className="install-mode-grid" role="radiogroup" aria-label="Install mode">
            <button
              className={installMode === "dry" ? "mode-card active" : "mode-card"}
              disabled={isRunning || isPaused}
              onClick={() => setInstallMode("dry")}
              type="button"
            >
              <FileText size={20} />
              <span>Dry run</span>
            </button>
            <button
              className={installMode === "live" ? "mode-card active" : "mode-card"}
              disabled={isRunning || isPaused}
              onClick={() => setInstallMode("live")}
              type="button"
            >
              <TerminalSquare size={20} />
              <span>Live install and run</span>
            </button>
          </div>
          <div className="consent-box">
            <strong>Consent</strong>
            {selectedPlan.consent_items.map((item) => (
              <span key={item}>{item}</span>
            ))}
            <label className="compact-check">
              <input
                checked={consentGranted}
                onChange={(event) => setConsentGranted(event.target.checked)}
                type="checkbox"
              />
              {installMode === "dry"
                ? "I understand this is a dry run and no commands will execute."
                : "I approve live installation, provider startup, and model downloads for this plan."}
            </label>
          </div>
          <div className="provider-actions">
            <button className="secondary-button" disabled={isRunning} onClick={handleStart} type="button">
              <Download size={16} />
              {installMode === "dry" ? "Preview recommended setup" : "Start live install"}
            </button>
            <button
              className="secondary-button"
              disabled={!isRunning}
              onClick={() =>
                runAction(
                  advanceInstallRun,
                  state.dry_run ? "Dry-run advanced one step." : "Live install advanced one step."
                )
              }
              type="button"
            >
              <Play size={16} />
              {state.dry_run ? "Advance dry run" : "Run next step"}
            </button>
            <button
              className="secondary-button"
              disabled={!isRunning}
              onClick={() => runAction(pauseInstallRun, "Installer paused.")}
              type="button"
            >
              <Pause size={16} />
              Pause install
            </button>
            <button
              className="resume-button"
              disabled={!isPaused}
              onClick={() => runAction(resumeInstallRun, "Installer resumed.")}
              type="button"
            >
              <Play size={16} />
              Resume install
            </button>
            <button
              className="secondary-button"
              disabled={!["Running", "Paused", "NeedsConsent"].includes(state.status)}
              onClick={() => runAction(cancelInstallRun, "Installer canceled.")}
              type="button"
            >
              Cancel
            </button>
          </div>
        </Panel>

        <Panel title="Progress">
          <div className="install-progress">
            <div className="progress-heading">
              <strong>{state.progress_percent}%</strong>
              <span>
                Step {Math.min(state.current_step + 1, Math.max(state.total_steps, 1))} of {state.total_steps}
              </span>
            </div>
            <div className="progress-track" aria-label="Install progress">
              <span style={{ width: `${state.progress_percent}%` }} />
            </div>
            {state.active_command ? (
              <CommandDetail command={state.active_command} />
            ) : (
              <p className="fine-print">
                No active command. Completed, canceled, or idle runs have no pending hook.
              </p>
            )}
          </div>
        </Panel>

        <Panel title="Command Details" className="installer-command-panel">
          <div className="command-list">
            {selectedPlan.commands.map((command, index) => (
              <div className="command-row" key={command.id}>
                <span>{index + 1}</span>
                <div>
                  <strong>{command.label}</strong>
                  <code>{renderInstallCommand(command)}</code>
                </div>
                <span className={`fit-pill ${command.dry_run_only ? "tight" : "smooth"}`}>
                  {command.dry_run_only ? "Preview only" : "Runnable"}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Install Logs">
          <div className="provider-log-list">
            {state.logs.slice(0, 10).map((entry, index) => (
              <div className="provider-log-row" key={`${entry.timestamp_ms}-${index}-${entry.message}`}>
                <span>{formatTimestamp(entry.timestamp_ms)}</span>
                <strong>{entry.level}</strong>
                <span>{entry.message}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function CommandDetail({ command }: { command: CommandHook }) {
  return (
    <div className="active-command">
      <strong>{command.label}</strong>
      <code>{renderInstallCommand(command)}</code>
      <span>{command.dry_run_only ? "Dry-run hook only" : "Executable hook"}</span>
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
  const [hardware, setHardware] = useState<HardwareSpecs | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [models, setModels] = useState<Array<{ id: string; display_name: string }>>([]);
  const [remoteCandidates, setRemoteCandidates] = useState<RouteCandidate[]>([]);
  const [mode, setMode] = useState<RouterMode>("Auto");
  const [useCase, setUseCase] = useState<UseCase>("GeneralChat");
  const [manualModelId, setManualModelId] = useState("phi-3-5-mini-q4");
  const [forcedModelId, setForcedModelId] = useState("qwen2-5-coder-7b-mlx");
  const [installedOnly, setInstalledOnly] = useState(false);
  const [thresholds, setThresholds] = useState(defaultRouterThresholds);
  const [decision, setDecision] = useState<RouterDecision | null>(null);
  const [testPrompt, setTestPrompt] = useState("Explain how transformers work in large language models.");
  const [testResult, setTestResult] = useState<RouterTestResult | null>(null);
  const [statusMessage, setStatusMessage] = useState("Loading router inputs...");
  const [error, setError] = useState<string | null>(null);
  const isPaused = appState.lifecycle_state === "Paused";

  useEffect(() => {
    let ignore = false;
    const unsubscribe = subscribeRemoteClientSnapshot((snapshot) => {
      setRemoteCandidates(snapshot.route_candidates);
      setModels((current) => mergeModelOptions(current, snapshot.route_candidates));
    });
    Promise.all([refreshHardwareSpecs(), refreshProviderHealth(), getModelCatalog(), getRemoteRouteCandidates()])
      .then(([nextHardware, nextProviders, nextModels, nextRemoteCandidates]) => {
        if (ignore) return;
        setHardware(nextHardware);
        setProviders(nextProviders);
        setRemoteCandidates(nextRemoteCandidates);
        setModels(mergeModelOptions(
          nextModels.map((model) => ({ id: model.id, display_name: model.display_name })),
          nextRemoteCandidates
        ));
        setStatusMessage("Router inputs loaded.");
      })
      .catch((err) => {
        if (ignore) return;
        setError(errorMessage(err));
        setStatusMessage("Router inputs failed to load.");
      });

    return () => {
      ignore = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!hardware || providers.length === 0) return;
    let ignore = false;
    decideRouterRoute({
      hardware,
      provider_statuses: providers,
      remote_candidates: remoteCandidates,
      mode: isPaused ? "Paused" : mode,
      use_case: useCase,
      preference_tags: ["Balanced"],
      manual_model_id: manualModelId || null,
      forced_model_id: forcedModelId || null,
      installed_only: installedOnly,
      app_paused: isPaused,
      thresholds
    })
      .then((nextDecision) => {
        if (ignore) return;
        setDecision(nextDecision);
        setStatusMessage(nextDecision.selected ? "Router decision updated." : "No executable route selected.");
      })
      .catch((err) => {
        if (ignore) return;
        setError(errorMessage(err));
        setStatusMessage("Router decision failed.");
      });

    return () => {
      ignore = true;
    };
  }, [forcedModelId, hardware, installedOnly, isPaused, manualModelId, mode, providers, remoteCandidates, thresholds, useCase]);

  const modeCards: Array<[RouterMode, string, typeof Route]> = [
    ["Auto", "Auto", Route],
    ["Manual", "Manual", SlidersHorizontal],
    ["Forced", "Forced", ShieldCheck],
    ["RemotePreferred", "Remote preferred", Network],
    ["LocalOnly", "Local only", Monitor],
    ["RemoteOnly", "Remote only", Cloud],
    ["Paused", "Paused", Pause]
  ];

  const activeMode = isPaused ? "Paused" : mode;
  const selected = decision?.selected;
  const selectedProvider = selected
    ? providers.find((provider) => provider.definition.id === selected.provider_id)
    : null;
  const routerConfigJson = useMemo(
    () => buildRouterConfigJson(decision, providers),
    [decision, providers]
  );

  const handleThresholdChange = useCallback((name: keyof typeof defaultRouterThresholds, value: number) => {
    setThresholds((current) => ({ ...current, [name]: value }));
  }, []);

  const handleRunPrompt = useCallback(async () => {
    if (!decision) return;
    setError(null);
    try {
      const result = await runRouterTestPrompt({ decision, prompt: testPrompt });
      setTestResult(result);
      setStatusMessage(result.message);
    } catch (err) {
      setError(errorMessage(err));
      setStatusMessage("Router test prompt failed.");
    }
  }, [decision, testPrompt]);

  const handleCopyRouterConfig = useCallback(async () => {
    await copyText(routerConfigJson);
    setStatusMessage("Router configuration JSON copied.");
  }, [routerConfigJson]);

  const handleExportRouterConfig = useCallback(() => {
    downloadTextFile(routerConfigJson, "local-ai-router-config.json", "application/json");
    setStatusMessage("Router configuration JSON exported.");
  }, [routerConfigJson]);

  if (!hardware || providers.length === 0 || !decision) {
    return (
      <div className="router-shell">
        <Panel title="Router">
          <div className="loading-state">
            <Route size={22} />
            <strong>{statusMessage}</strong>
            {error ? <span>{error}</span> : <span>Preparing hardware, providers, and model scores.</span>}
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="router-shell">
      <div className="paused-banner">
        <div className="pause-emblem">
          <Pause size={24} />
        </div>
        <div>
          <strong>
            {isPaused ? "Local AI Router is paused." : "Router control plane is running."}
          </strong>
          <span>
            {isPaused
              ? "Automation, update checks, routing changes, and remote discovery are suspended."
              : statusMessage}
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
          {modeCards.map(([value, label, Icon]) => (
            <button
              className={activeMode === value ? "mode-card active" : "mode-card"}
              disabled={isPaused && value !== "Paused"}
              key={value}
              onClick={() => setMode(value)}
              type="button"
            >
              <Icon size={22} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="router-control-row">
          <select aria-label="Router use case" onChange={(event) => setUseCase(event.target.value as UseCase)} value={useCase}>
            {useCaseOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select aria-label="Manual model" onChange={(event) => setManualModelId(event.target.value)} value={manualModelId}>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.display_name}
              </option>
            ))}
          </select>
          <select aria-label="Forced model" onChange={(event) => setForcedModelId(event.target.value)} value={forcedModelId}>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.display_name}
              </option>
            ))}
          </select>
          <label className="compact-check">
            <input checked={installedOnly} onChange={(event) => setInstalledOnly(event.target.checked)} type="checkbox" />
            Installed only
          </label>
        </div>
        {error ? <div className="inline-error">{error}</div> : null}
      </Panel>

      <div className="router-columns">
        <Panel title="Active decision">
          <StatusLine label="Selected model" value={selected?.model_name ?? "No route"} />
          <StatusLine label="Provider" value={selected?.provider_name ?? "None"} tone={selected ? "green" : undefined} />
          <StatusLine label="Mode" value={decision.mode} />
          <StatusLine label="Score" value={selected ? `${selected.score} / ${selected.label}` : "Not available"} />
          <StatusLine label="Executable" value={decision.can_execute ? "Yes" : "No"} />
          <StatusLine
            label="Provider runtime"
            value={selectedProvider?.running ? `${selectedProvider.health} at ${selectedProvider.definition.base_url}` : "Waiting for a local provider"}
          />
          <StatusLine label="Remote candidates" value={String(remoteCandidates.length)} />
          <div className="fallback-list">
            <span>Fallback candidates</span>
            {decision.fallback_chain.length > 0 ? (
              <ol>
                {decision.fallback_chain.slice(0, 4).map((candidate) => (
                  <li key={`${candidate.provider_id}-${candidate.model_id}`}>
                    {candidate.model_name} ({candidate.provider_name}, {candidate.score})
                  </li>
                ))}
              </ol>
            ) : (
              <strong>No fallback candidates</strong>
            )}
          </div>
        </Panel>

        <Panel title="Router thresholds">
          <RouterSlider label="Minimum score" max={100} min={0} onChange={(value) => handleThresholdChange("min_score", value)} suffix="" value={thresholds.min_score} />
          <RouterSlider label="CPU max" max={100} min={0} onChange={(value) => handleThresholdChange("max_cpu_percent", value)} suffix="%" value={thresholds.max_cpu_percent} />
          <RouterSlider label="Memory max" max={100} min={0} onChange={(value) => handleThresholdChange("max_memory_percent", value)} suffix="%" value={thresholds.max_memory_percent} />
          <RouterSlider label="GPU max" max={100} min={0} onChange={(value) => handleThresholdChange("max_gpu_percent", value)} suffix="%" value={thresholds.max_gpu_percent} />
          <RouterSlider label="Latency max" max={3000} min={100} onChange={(value) => handleThresholdChange("max_latency_ms", value)} suffix=" ms" value={thresholds.max_latency_ms} />
        </Panel>

        <Panel title="Decision reasons">
          <div className="reason-list">
            {decision.reasons.map((reason) => (
              <span key={reason}>{reason}</span>
            ))}
          </div>
          <div className="blocker-list">
            <strong>Rejected candidates</strong>
            <span>{decision.rejected.length} below thresholds, blocked, or too slow.</span>
          </div>
        </Panel>
      </div>

      <Panel title="Manual configuration JSON" className="router-config-panel">
        <div className="router-config-actions">
          <button className="secondary-button" onClick={handleCopyRouterConfig} type="button">
            <Clipboard size={16} />
            Copy JSON
          </button>
          <button className="secondary-button" onClick={handleExportRouterConfig} type="button">
            <Download size={16} />
            Export JSON
          </button>
        </div>
        <pre>{routerConfigJson}</pre>
      </Panel>

      <Panel title="Test prompt">
        <div className="test-prompt-shell">
          <textarea
            aria-label="Router test prompt"
            onChange={(event) => setTestPrompt(event.target.value)}
            value={testPrompt}
          />
          <div className="test-actions">
            <button
              className="secondary-button"
              disabled={!decision.can_execute}
              onClick={handleRunPrompt}
              type="button"
            >
              <MessageSquare size={16} />
              Run routed test
            </button>
            {isPaused ? (
              <button className="resume-button" type="button" onClick={() => onResume("Router")}>
                <Play size={16} />
                Resume router
              </button>
            ) : null}
          </div>
        </div>
        {testResult ? (
          <div className="chat-response">
            <strong>{testResult.message}</strong>
            <span>{testResult.response?.response ?? "No provider response."}</span>
          </div>
        ) : null}
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

      <BackgroundControlCenter appState={appState} />
    </div>
  );
}

function BackgroundControlCenter({ appState }: { appState: AppStateSnapshot }) {
  const [snapshot, setSnapshot] = useState<BackgroundSnapshot | null>(null);
  const [statusMessage, setStatusMessage] = useState("Loading background controls...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    let unlisten: (() => void) | undefined;
    getBackgroundSnapshot()
      .then((nextSnapshot) => {
        if (ignore) return;
        setSnapshot(nextSnapshot);
        setStatusMessage("Background controls loaded.");
      })
      .catch((err) => {
        if (ignore) return;
        setError(errorMessage(err));
        setStatusMessage("Background controls failed to load.");
      });
    subscribeBackgroundSnapshot((nextSnapshot) => setSnapshot(nextSnapshot)).then((unsubscribe) => {
      unlisten = unsubscribe;
      if (ignore) unsubscribe();
    });
    return () => {
      ignore = true;
      unlisten?.();
    };
  }, []);

  const updateSetting = useCallback(
    async (key: keyof BackgroundSettings, value: boolean) => {
      if (!snapshot) return;
      setError(null);
      try {
        const nextSnapshot = await updateBackgroundSettings({
          ...snapshot.settings,
          [key]: value
        });
        setSnapshot(nextSnapshot);
        setStatusMessage("Background settings saved.");
      } catch (err) {
        setError(errorMessage(err));
        setStatusMessage("Background settings failed to save.");
      }
    },
    [snapshot]
  );

  const handleTick = useCallback(async () => {
    setError(null);
    try {
      const nextSnapshot = await runBackgroundTick();
      setSnapshot(nextSnapshot);
      setStatusMessage("Background task check completed.");
    } catch (err) {
      setError(errorMessage(err));
      setStatusMessage("Background task check failed.");
    }
  }, []);

  const handleTestNotification = useCallback(async () => {
    setError(null);
    try {
      const event = await sendTestNotification();
      await presentNativeNotification(event);
      const nextSnapshot = await getBackgroundSnapshot();
      setSnapshot(nextSnapshot);
      setStatusMessage("Test notification queued.");
    } catch (err) {
      setError(errorMessage(err));
      setStatusMessage("Test notification failed.");
    }
  }, []);

  if (!snapshot) {
    return (
      <Panel title="Notifications & Background" className="settings-wide">
        <div className="loading-state">
          <Bell size={22} />
          <strong>{statusMessage}</strong>
          {error ? <span>{error}</span> : <span>Preparing notification and background task settings.</span>}
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Notifications & Background" className="settings-wide">
      <div className="background-settings-grid">
        <div className="settings-list">
          <SettingToggle
            checked={snapshot.settings.native_notifications_enabled}
            description="Use the desktop notification bridge for eligible events."
            label="Native notifications"
            onChange={(checked) => updateSetting("native_notifications_enabled", checked)}
          />
          <SettingToggle
            checked={snapshot.settings.notify_provider_crash}
            description="Notify when a provider health check reports an error."
            label="Provider crash alerts"
            onChange={(checked) => updateSetting("notify_provider_crash", checked)}
          />
          <SettingToggle
            checked={snapshot.settings.notify_model_install_complete}
            description="Notify when a runtime or model install flow completes."
            label="Install completion alerts"
            onChange={(checked) => updateSetting("notify_model_install_complete", checked)}
          />
          <SettingToggle
            checked={snapshot.settings.notify_router_changes}
            description="Notify when the router degrades or upgrades its route."
            label="Router change alerts"
            onChange={(checked) => updateSetting("notify_router_changes", checked)}
          />
          <SettingToggle
            checked={snapshot.settings.notify_forced_model_pressure}
            description="Warn when forced mode is above configured memory thresholds."
            label="Forced-model pressure alerts"
            onChange={(checked) => updateSetting("notify_forced_model_pressure", checked)}
          />
        </div>

        <div className="settings-list">
          <SettingToggle
            checked={snapshot.settings.tray_menu_enabled}
            description={snapshot.tray_available ? "Native tray/menu controls are installed." : "Menu controls are installed; tray icon depends on OS support."}
            label="Tray/menu mode"
            onChange={(checked) => updateSetting("tray_menu_enabled", checked)}
          />
          <SettingToggle
            checked={snapshot.settings.launch_at_login_enabled}
            description={`Autostart status: ${snapshot.autostart_status}`}
            label="Launch at login"
            onChange={(checked) => updateSetting("launch_at_login_enabled", checked)}
          />
          <SettingToggle
            checked={snapshot.settings.start_providers_at_login}
            description="Start enabled provider adapters after app startup."
            label="Start providers at login"
            onChange={(checked) => updateSetting("start_providers_at_login", checked)}
          />
          <SettingToggle
            checked={snapshot.settings.background_health_polling_enabled}
            description="Allow scheduled provider health polling while the app is running."
            label="Background health polling"
            onChange={(checked) => updateSetting("background_health_polling_enabled", checked)}
          />
        </div>
      </div>

      <div className="background-actions">
        <button className="secondary-button" type="button" onClick={handleTick}>
          <Activity size={16} />
          Run background check
        </button>
        <button className="secondary-button" type="button" onClick={handleTestNotification}>
          <Bell size={16} />
          Send test notification
        </button>
        <span>{statusMessage}</span>
        {error ? <span className="inline-text-error">{error}</span> : null}
      </div>

      <table className="data-table background-task-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Status</th>
            <th>Pause Gate</th>
            <th>Last Run</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.tasks.map((task) => (
            <tr key={task.kind}>
              <td>{task.label}</td>
              <td>
                <span className={`health-pill ${task.status.toLowerCase()}`}>{task.status}</span>
              </td>
              <td>{task.suspended_by_pause || appState.lifecycle_state === "Paused" ? "Suspended" : "Open"}</td>
              <td>{task.last_run_ms ? formatTimestamp(task.last_run_ms) : "Not run"}</td>
              <td>{task.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function SettingToggle({
  checked,
  description,
  label,
  onChange
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="setting-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function LogsPage({
  appState,
  latestNotification
}: {
  appState: AppStateSnapshot;
  latestNotification: NotificationEvent | null;
}) {
  const history = [...appState.pause_history].reverse();
  const [backgroundSnapshot, setBackgroundSnapshot] = useState<BackgroundSnapshot | null>(null);

  useEffect(() => {
    let ignore = false;
    let unlisten: (() => void) | undefined;
    getBackgroundSnapshot().then((snapshot) => {
      if (!ignore) setBackgroundSnapshot(snapshot);
    });
    subscribeBackgroundSnapshot((snapshot) => setBackgroundSnapshot(snapshot)).then((unsubscribe) => {
      unlisten = unsubscribe;
      if (ignore) unsubscribe();
    });
    return () => {
      ignore = true;
      unlisten?.();
    };
  }, [latestNotification]);

  return (
    <div className="logs-page">
      <Panel title="Notification Events">
        {backgroundSnapshot?.notifications.length ? (
          <table className="data-table logs-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Kind</th>
                <th>Severity</th>
                <th>Delivery</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {backgroundSnapshot.notifications.slice(0, 20).map((entry) => (
                <tr key={`${entry.id}-${entry.kind}`}>
                  <td>{formatTimestamp(entry.timestamp_ms)}</td>
                  <td>{entry.kind}</td>
                  <td>{entry.severity}</td>
                  <td>{entry.delivery}</td>
                  <td>
                    <strong>{entry.title}</strong>
                    <br />
                    {entry.body}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-log-state">
            <Bell size={22} />
            <strong>No notification events logged yet.</strong>
            <span>Use Settings to send a test notification or trigger pause/resume.</span>
          </div>
        )}
      </Panel>

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

function ScoreInputBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="score-input-row">
      <span>{label}</span>
      <div className="score-input-meter">
        <span style={{ width: `${value}%` }} />
      </div>
      <strong>{value}</strong>
    </div>
  );
}

function RouterSlider({
  label,
  value,
  min,
  max,
  suffix,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="router-slider">
      <span>{label}</span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        type="range"
        value={value}
      />
      <strong>
        {value}
        {suffix}
      </strong>
    </label>
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

function platformLabel(platform: InstallPlan["platform"]) {
  switch (platform) {
    case "AppleSilicon":
      return "macOS Apple Silicon";
    case "IntelMac":
      return "macOS Intel";
    case "WindowsX64":
      return "Windows x64";
  }
}

function sourceKindLabel(kind: MetadataSourceKind) {
  switch (kind) {
    case "Ollama":
      return "Ollama";
    case "MlxHuggingFace":
      return "MLX / Hugging Face";
    case "CustomJson":
      return "Custom JSON";
  }
}

function remoteBrokerStatusLabel(status: RemoteBrokerStatus) {
  switch (status) {
    case "Running":
      return "Running";
    case "SharingDisabled":
      return "Sharing disabled";
    case "PlatformBlocked":
      return "Windows only";
    case "PausedOnline":
      return "Paused, online";
    case "PausedRejectingRequests":
      return "Paused, rejecting";
    case "StoppedByPause":
      return "Stopped by pause";
    case "Stopped":
      return "Stopped";
  }
}

function remoteClientStatusLabel(status: RemoteClientSnapshot["status"] | RemoteClientDevice["status"]) {
  switch (status) {
    case "Discovered":
      return "Discovered";
    case "Paired":
      return "Paired";
    case "Online":
      return "Online";
    case "Offline":
      return "Offline";
    case "AuthFailed":
      return "Auth failed";
    case "Paused":
      return "Paused";
    case "Error":
      return "Error";
  }
}

function remoteClientHealthClass(status: RemoteClientDevice["status"]) {
  switch (status) {
    case "Online":
    case "Paired":
      return "healthy";
    case "Paused":
      return "paused";
    case "Offline":
      return "stopped";
    case "AuthFailed":
    case "Error":
      return "error";
    case "Discovered":
      return "degraded";
  }
}

function pausePolicyLabel(policy: BrokerPausePolicy) {
  switch (policy) {
    case "KeepOnline":
      return "Keep broker online";
    case "RejectNewRequests":
      return "Reject new requests";
    case "StopUntilResume":
      return "Stop until resume";
  }
}

function actionStatusLabel(action: UpdateActionKind) {
  switch (action) {
    case "Ignore":
      return "ignored";
    case "RemindLater":
      return "reminder scheduled";
    case "Install":
      return "dry-run install queued";
    case "InstallAndSwitch":
      return "dry-run install-and-switch queued";
  }
}

function installStatusClass(status: InstallRunState["status"]) {
  switch (status) {
    case "Running":
    case "Completed":
      return "healthy";
    case "Paused":
    case "NeedsConsent":
      return "paused";
    case "Canceled":
    case "Error":
      return "error";
    case "Idle":
      return "stopped";
  }
}

function renderInstallCommand(command: CommandHook) {
  return [command.program, ...command.args].join(" ");
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

function buildRouterConfigJson(decision: RouterDecision | null, providers: ProviderStatus[]): string {
  if (!decision) {
    return JSON.stringify(
      {
        app: "Local AI Router",
        status: "loading",
        local_integration: {
          base_url: "http://127.0.0.1:17640",
          openai_compatible_base_url: "http://127.0.0.1:17640/v1",
          auth_method: "none"
        }
      },
      null,
      2
    );
  }
  const selected = decision.selected;
  const selectedProvider = selected
    ? providers.find((provider) => provider.definition.id === selected.provider_id)
    : null;
  const ready = decision.can_execute && !!selectedProvider?.running && !selectedProvider.paused;
  return JSON.stringify(
    {
      app: "Local AI Router",
      status: ready ? "ready" : "waiting_for_provider",
      generated_at: new Date().toISOString(),
      local_integration: {
        base_url: "http://127.0.0.1:17640",
        openai_compatible_base_url: "http://127.0.0.1:17640/v1",
        health_url: "http://127.0.0.1:17640/api/health",
        models_url: "http://127.0.0.1:17640/v1/models",
        chat_completions_url: "http://127.0.0.1:17640/v1/chat/completions",
        auth_method: "none",
        scope: "localhost-only"
      },
      learning_boost_env: {
        DEFAULT_AI_PROVIDER: "openai_compat",
        DEFAULT_AI_MODEL: selected?.model_id ?? "local-model",
        OPENAI_COMPAT_BASE_URL: "http://127.0.0.1:17640/v1",
        OPENAI_COMPAT_AUTH_METHOD: "none",
        LOCAL_AI_ROUTER_BASE_URL: "http://127.0.0.1:17640",
        LOCAL_AI_ROUTER_AUTOSTART: "true",
        LOCAL_AI_ROUTER_AUTO_APPLY: "true",
        LOCAL_AI_ROUTER_AUTO_START_PROVIDER: "true",
        LOCAL_AI_ROUTER_AUTO_INSTALL: "false"
      },
      selected_route: selected
        ? {
            model_id: selected.model_id,
            model_name: selected.model_name,
            provider_id: selected.provider_id,
            provider_name: selected.provider_name,
            provider_kind: selected.provider,
            score: selected.score,
            label: selected.label,
            latency_ms: selected.latency_ms
          }
        : null,
      provider_runtime: selectedProvider
        ? {
            provider_id: selectedProvider.definition.id,
            provider_name: selectedProvider.definition.name,
            provider_kind: selectedProvider.definition.kind,
            base_url: selectedProvider.definition.base_url,
            running: selectedProvider.running,
            paused: selectedProvider.paused,
            health: selectedProvider.health,
            active_model: selectedProvider.active_model,
            model_count: selectedProvider.model_count,
            latency_ms: selectedProvider.latency_ms,
            message: selectedProvider.message
          }
        : null,
      router_decision: {
        mode: decision.mode,
        can_execute: decision.can_execute,
        suspended: decision.suspended,
        reasons: decision.reasons
      },
      note: ready
        ? "Use openai_compatible_base_url from a local OpenAI-compatible client."
        : "The router API can be running while the model runtime is not. Start or install a provider such as Ollama, LM Studio, MLX-LM, or llama.cpp before expecting chat responses."
    },
    null,
    2
  );
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

function scoreInputLabel(name: string): string {
  const labels: Record<string, string> = {
    ram: "RAM",
    vram: "VRAM",
    cpu_load: "CPU load",
    gpu_load: "GPU load",
    provider_support: "Provider",
    disk: "Disk",
    platform: "Platform",
    use_case: "Use case",
    preference: "Preference",
    installed_status: "Installed",
    pause_state: "Pause state"
  };
  return labels[name] ?? name;
}

function upsertProviderStatus(statuses: ProviderStatus[], nextStatus: ProviderStatus): ProviderStatus[] {
  const exists = statuses.some((status) => status.definition.id === nextStatus.definition.id);
  if (!exists) {
    return [...statuses, nextStatus];
  }
  return statuses.map((status) =>
    status.definition.id === nextStatus.definition.id ? nextStatus : status
  );
}

function mergeModelOptions(
  models: Array<{ id: string; display_name: string }>,
  remoteCandidates: RouteCandidate[]
): Array<{ id: string; display_name: string }> {
  const merged = [...models];
  for (const candidate of remoteCandidates) {
    if (!merged.some((model) => model.id === candidate.model_id)) {
      merged.push({
        id: candidate.model_id,
        display_name: `${candidate.model_name} (${candidate.provider_name})`
      });
    }
  }
  return merged;
}
