import { type ReactNode, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  Bot,
  Cloud,
  Cpu,
  Download,
  FileBarChart,
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
  TerminalSquare
} from "lucide-react";

type AppState = "Running" | "Paused";
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

const pageContent: Record<Exclude<PageId, "dashboard" | "router">, EmptyPage> = {
  "machine-specs": {
    title: "Machine Specs",
    eyebrow: "Stage 1 page shell",
    summary:
      "Hardware probing, raw specs JSON, export controls, and copy actions land in Stage 3.",
    readiness: ["Readable spec groups", "Raw JSON area", "Export action row"]
  },
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
  },
  settings: {
    title: "Settings",
    eyebrow: "Stage 1 page shell",
    summary:
      "Launch-at-login, notification, privacy, storage, and pause behavior settings are wired in later stages.",
    readiness: ["Startup toggles", "Storage path row", "Notification preference row"]
  },
  logs: {
    title: "Logs",
    eyebrow: "Stage 1 page shell",
    summary:
      "Structured app, provider, install, and pause/resume logs are implemented as native state arrives.",
    readiness: ["Log stream frame", "Filter controls", "Export action"]
  }
};

const installedModels = [
  { name: "Qwen3 8B", size: "8.0B", format: "Q4_K_M", fit: "Good", lastUsed: "Now" },
  { name: "Llama 3.1 8B", size: "8.0B", format: "Q4_K_M", fit: "Good", lastUsed: "2h ago" },
  { name: "Phi-3.5 Mini", size: "3.8B", format: "Q4_K_M", fit: "Smooth", lastUsed: "2d ago" }
];

export default function App() {
  const [activePage, setActivePage] = useState<PageId>(() => pageFromHash());
  const [appState] = useState<AppState>("Running");
  const activeLabel = useMemo(
    () => navItems.find((item) => item.id === activePage)?.label ?? "Dashboard",
    [activePage]
  );

  return (
    <div className="app-shell">
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <main className="main-shell">
        <TopBar appState={appState} activeLabel={activeLabel} />
        <section className="page-surface">
          {activePage === "dashboard" ? (
            <Dashboard />
          ) : activePage === "router" ? (
            <RouterShell />
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
          <span>Stage 1 shell</span>
        </div>
        <span className="version">v0.1.0</span>
      </div>
    </aside>
  );
}

function TopBar({ appState, activeLabel }: { appState: AppState; activeLabel: string }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-button" aria-label="Menu" type="button">
          <Menu size={20} />
        </button>
        <span className="active-page-label">{activeLabel}</span>
      </div>
      <div className="topbar-status">
        <span className="state-pill running">
          <span className="dot green" />
          {appState}
        </span>
        <button className="pause-button" type="button" aria-label="Pause placeholder">
          <Pause size={16} />
          Pause
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

function Dashboard() {
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
        <p className="fine-print">Static Stage 1 sample values; real detection begins in Stage 3.</p>
      </Panel>

      <Panel title="Active Provider" className="provider-panel">
        <StatusLine label="Provider" value="MLX-LM Server" tone="green" />
        <StatusLine label="Base URL" value="http://127.0.0.1:8080" />
        <StatusLine label="Active Model" value="Qwen3 8B" />
        <StatusLine label="Compatibility" value="Good" badge="good" />
        <StatusLine label="Router Mode" value="Auto (Local preferred)" />
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
          <ActionButton icon={Pause} label="Pause app" />
          <ActionButton icon={Download} label="Install recommended setup" />
          <ActionButton icon={Play} label="Start provider" />
          <ActionButton icon={MessageSquare} label="Test chat" />
          <ActionButton icon={FileText} label="Export specs" />
          <ActionButton icon={Settings} label="Open settings" />
        </div>
      </Panel>
    </div>
  );
}

function RouterShell() {
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
          <strong>Pause controls arrive in Stage 2.</strong>
          <span>
            This Stage 1 screen preserves the accepted paused layout without changing app state.
          </span>
        </div>
        <button className="secondary-button" type="button">
          Pause settings
        </button>
        <button className="secondary-button" type="button">
          View suspended tasks
        </button>
      </div>

      <Panel title="Routing mode">
        <div className="mode-grid">
          {modes.map(([label, Icon]) => (
            <button className={label === "Auto" ? "mode-card active" : "mode-card"} key={label} type="button">
              <Icon size={22} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <p className="fine-print">Routing controls are non-functional until Stage 8.</p>
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
          <SuspendedRow label="Pending routing changes" value="0" />
          <SuspendedRow label="Update checks" value="0" />
          <SuspendedRow label="Model pulls / updates" value="0" />
          <SuspendedRow label="Remote discovery" value="0" />
          <SuspendedRow label="Metric collection" value="0" />
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
            <button className="ghost-button" disabled type="button">
              Resume to run
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

function ActionButton({ icon: Icon, label }: { icon: typeof Home; label: string }) {
  return (
    <button className="action-button" type="button">
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
