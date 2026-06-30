import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type InstallPlatform = "AppleSilicon" | "IntelMac" | "WindowsX64";
export type InstallRunStatus = "Idle" | "NeedsConsent" | "Running" | "Paused" | "Canceled" | "Completed" | "Error";
export type CommandHookKind = "ShellCommand" | "ManualStep" | "DownloadPlaceholder" | "ProviderProbe";

export type CommandHook = {
  id: string;
  label: string;
  kind: CommandHookKind;
  program: string;
  args: string[];
  working_dir: string;
  env: Array<[string, string]>;
  dry_run_only: boolean;
};

export type InstallPlan = {
  id: string;
  name: string;
  platform: InstallPlatform;
  summary: string;
  runtime_dir: string;
  model_dir: string;
  cache_dir: string;
  commands: CommandHook[];
  consent_items: string[];
  notes: string[];
};

export type InstallLogEntry = {
  timestamp_ms: number;
  level: string;
  message: string;
};

export type InstallRunState = {
  status: InstallRunStatus;
  selected_plan_id: string | null;
  dry_run: boolean;
  consent_granted: boolean;
  current_step: number;
  total_steps: number;
  progress_percent: number;
  runtime_dir: string;
  model_dir: string;
  active_command: CommandHook | null;
  logs: InstallLogEntry[];
};

export type StartInstallRequest = {
  plan_id: string;
  dry_run: boolean;
  consent_granted: boolean;
};

const storageKey = "local-ai-router:stage7-installer-state";
const root = "~/Library/Application Support/Local AI Router";

const fallbackPlans: InstallPlan[] = [
  plan("apple-silicon-recommended", "Apple Silicon Recommended Setup", "AppleSilicon", "MLX-LM runtime plus Ollama fallback for Apple Silicon Macs.", "mlx-lm", "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit", [
    hook("create-runtime-dir", "Create app runtime folder", "ManualStep", "mkdir", ["-p", "{runtime_dir}"]),
    hook("create-model-dir", "Create app model folder", "ManualStep", "mkdir", ["-p", "{model_dir}"]),
    hook("venv", "Prepare MLX-LM virtual environment", "ShellCommand", "python3", ["-m", "venv", "{runtime_dir}/mlx-lm-venv"]),
    hook("install-mlx", "Install MLX-LM package", "ShellCommand", "{runtime_dir}/mlx-lm-venv/bin/pip", ["install", "mlx-lm"]),
    hook("model-placeholder", "Reserve MLX model download target", "DownloadPlaceholder", "huggingface-cli", ["download", "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit", "--local-dir", "{model_dir}/qwen2.5-coder-mlx"]),
    hook("probe", "Probe MLX-LM endpoint", "ProviderProbe", "curl", ["http://127.0.0.1:8080/v1/models"])
  ]),
  plan("intel-mac-recommended", "Intel Mac Recommended Setup", "IntelMac", "Ollama with compact GGUF models for Intel Macs.", "ollama", "phi3.5:latest", [
    hook("create-runtime-dir", "Create app runtime folder", "ManualStep", "mkdir", ["-p", "{runtime_dir}"]),
    hook("create-model-dir", "Create app model folder", "ManualStep", "mkdir", ["-p", "{model_dir}"]),
    hook("install-ollama", "Install Ollama runtime", "ShellCommand", "brew", ["install", "ollama"]),
    hook("serve", "Start Ollama service hook", "ShellCommand", "ollama", ["serve"]),
    hook("model-placeholder", "Reserve Ollama model pull", "DownloadPlaceholder", "ollama", ["pull", "phi3.5:latest"]),
    hook("probe", "Probe Ollama tags endpoint", "ProviderProbe", "curl", ["http://127.0.0.1:11434/api/tags"])
  ]),
  plan("windows-gtx-recommended", "Windows GTX Recommended Setup", "WindowsX64", "llama.cpp server with CUDA-capable GGUF models for Windows x64.", "llama-cpp", "mistral-7b-instruct-q4.gguf", [
    hook("create-runtime-dir", "Create app runtime folder", "ManualStep", "powershell", ["New-Item", "-ItemType", "Directory", "-Force", "{runtime_dir}"]),
    hook("create-model-dir", "Create app model folder", "ManualStep", "powershell", ["New-Item", "-ItemType", "Directory", "-Force", "{model_dir}"]),
    hook("download-runtime", "Reserve llama.cpp release download", "DownloadPlaceholder", "powershell", ["Invoke-WebRequest", "-OutFile", "{runtime_dir}\\llama.cpp.zip"]),
    hook("model-placeholder", "Reserve GGUF model download", "DownloadPlaceholder", "powershell", ["Invoke-WebRequest", "-OutFile", "{model_dir}\\mistral-7b-instruct-q4.gguf"]),
    hook("server", "Prepare llama-server command hook", "ShellCommand", "{runtime_dir}\\llama-server.exe", ["-m", "{model_dir}\\mistral-7b-instruct-q4.gguf", "--host", "127.0.0.1", "--port", "8081"]),
    hook("probe", "Probe llama.cpp models endpoint", "ProviderProbe", "curl", ["http://127.0.0.1:8081/v1/models"])
  ])
];

export async function listInstallPlans(): Promise<InstallPlan[]> {
  if (isTauriRuntime()) return invoke<InstallPlan[]>("list_install_plans");
  return fallbackPlans;
}

export async function getInstallState(): Promise<InstallRunState> {
  if (isTauriRuntime()) return invoke<InstallRunState>("get_install_state");
  return readState();
}

export async function startInstallRun(request: StartInstallRequest): Promise<InstallRunState> {
  if (isTauriRuntime()) return invoke<InstallRunState>("start_install_run", { request });
  const selectedPlan = planById(request.plan_id);
  if (!request.consent_granted) {
    return writeState({
      ...stateForPlan(selectedPlan),
      status: "NeedsConsent",
      dry_run: request.dry_run,
      consent_granted: false,
      logs: [logEntry("warn", "Install consent is required before preparing commands.")]
    });
  }
  if (!request.dry_run) throw new Error("Stage 7 only supports dry-run installer execution.");
  return writeState({
    ...stateForPlan(selectedPlan),
    status: "Running",
    dry_run: true,
    consent_granted: true,
    logs: [
      logEntry("info", `Dry-run installer started: ${selectedPlan.name}`),
      logEntry("info", "No commands will execute and no model weights will download."),
      logEntry("info", `App-managed folders: ${selectedPlan.runtime_dir} and ${selectedPlan.model_dir}`)
    ]
  });
}

export async function advanceInstallRun(): Promise<InstallRunState> {
  if (isTauriRuntime()) return invoke<InstallRunState>("advance_install_run");
  const state = readState();
  if (state.status === "Paused") throw new Error("installer is paused");
  if (state.status !== "Running") throw new Error("installer is not running");
  const selectedPlan = planById(state.selected_plan_id ?? "");
  const command = selectedPlan.commands[state.current_step];
  const nextStep = state.current_step + 1;
  const completed = nextStep >= state.total_steps;
  return writeState({
    ...state,
    status: completed ? "Completed" : "Running",
    current_step: nextStep,
    progress_percent: Math.min(100, Math.floor((nextStep * 100) / state.total_steps)),
    active_command: completed ? null : selectedPlan.commands[nextStep],
    logs: [
      ...(completed ? [logEntry("info", "Dry-run installer completed.")] : []),
      logEntry("debug", `Command hook: ${renderCommand(command)}`),
      logEntry("info", `Dry-run checked: ${command.label}`),
      ...state.logs
    ]
  });
}

export async function pauseInstallRun(): Promise<InstallRunState> {
  if (isTauriRuntime()) return invoke<InstallRunState>("pause_install_run");
  const state = readState();
  if (state.status !== "Running") throw new Error("only a running installer can be paused");
  return writeState({ ...state, status: "Paused", logs: [logEntry("info", "Installer dry-run paused."), ...state.logs] });
}

export async function resumeInstallRun(): Promise<InstallRunState> {
  if (isTauriRuntime()) return invoke<InstallRunState>("resume_install_run");
  const state = readState();
  if (state.status !== "Paused") throw new Error("only a paused installer can be resumed");
  return writeState({ ...state, status: "Running", logs: [logEntry("info", "Installer dry-run resumed."), ...state.logs] });
}

export async function cancelInstallRun(): Promise<InstallRunState> {
  if (isTauriRuntime()) return invoke<InstallRunState>("cancel_install_run");
  const state = readState();
  if (state.status === "Idle" || state.status === "Completed") throw new Error("no active installer run to cancel");
  return writeState({ ...state, status: "Canceled", active_command: null, logs: [logEntry("warn", "Installer dry-run canceled."), ...state.logs] });
}

export async function subscribeInstallProgress(onChange: (state: InstallRunState) => void): Promise<UnlistenFn> {
  if (isTauriRuntime()) {
    return listen<InstallRunState>("install-progress-changed", (event) => onChange(event.payload));
  }
  const handler = (event: Event) => onChange((event as CustomEvent<InstallRunState>).detail);
  window.addEventListener("local-ai-router:install-progress-changed", handler);
  return () => window.removeEventListener("local-ai-router:install-progress-changed", handler);
}

function readState(): InstallRunState {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return idleState();
  try {
    return JSON.parse(raw);
  } catch {
    return idleState();
  }
}

function writeState(state: InstallRunState): InstallRunState {
  window.localStorage.setItem(storageKey, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("local-ai-router:install-progress-changed", { detail: state }));
  return state;
}

function idleState(): InstallRunState {
  return {
    status: "Idle",
    selected_plan_id: null,
    dry_run: true,
    consent_granted: false,
    current_step: 0,
    total_steps: 0,
    progress_percent: 0,
    runtime_dir: `${root}/runtimes`,
    model_dir: `${root}/models`,
    active_command: null,
    logs: [logEntry("info", "Installer ready in dry-run mode.")]
  };
}

function stateForPlan(selectedPlan: InstallPlan): InstallRunState {
  return {
    status: "Idle",
    selected_plan_id: selectedPlan.id,
    dry_run: true,
    consent_granted: false,
    current_step: 0,
    total_steps: selectedPlan.commands.length,
    progress_percent: 0,
    runtime_dir: selectedPlan.runtime_dir,
    model_dir: selectedPlan.model_dir,
    active_command: selectedPlan.commands[0] ?? null,
    logs: []
  };
}

function planById(planId: string): InstallPlan {
  const selectedPlan = fallbackPlans.find((item) => item.id === planId);
  if (!selectedPlan) throw new Error(`unknown install plan: ${planId}`);
  return selectedPlan;
}

function plan(id: string, name: string, platform: InstallPlatform, summary: string, runtimeSlug: string, modelSlug: string, commands: CommandHook[]): InstallPlan {
  const runtimeDir = `${root}/runtimes/${runtimeSlug}`;
  const modelDir = `${root}/models/${modelSlug}`;
  const cacheDir = `${root}/install-cache/${runtimeSlug}`;
  return {
    id,
    name,
    platform,
    summary,
    runtime_dir: runtimeDir,
    model_dir: modelDir,
    cache_dir: cacheDir,
    commands: commands.map((command) => expandHook(command, runtimeDir, modelDir, cacheDir)),
    consent_items: [
      "Run in dry-run mode for Stage 7.",
      "Show command hooks before any future execution.",
      "Use app-managed runtime and model folders.",
      "Do not download model weights during tests."
    ],
    notes: [
      "Stage 7 records real command hooks but does not execute them.",
      "Pause and cancel affect the dry-run workflow state only."
    ]
  };
}

function hook(id: string, label: string, kind: CommandHookKind, program: string, args: string[]): CommandHook {
  return {
    id,
    label,
    kind,
    program,
    args,
    working_dir: "{runtime_dir}",
    env: [],
    dry_run_only: true
  };
}

function expandHook(command: CommandHook, runtimeDir: string, modelDir: string, cacheDir: string): CommandHook {
  return {
    ...command,
    program: expand(command.program, runtimeDir, modelDir, cacheDir),
    args: command.args.map((arg) => expand(arg, runtimeDir, modelDir, cacheDir)),
    working_dir: expand(command.working_dir, runtimeDir, modelDir, cacheDir)
  };
}

function expand(input: string, runtimeDir: string, modelDir: string, cacheDir: string): string {
  return input
    .replace(/\{runtime_dir\}/g, runtimeDir)
    .replace(/\{model_dir\}/g, modelDir)
    .replace(/\{cache_dir\}/g, cacheDir);
}

function renderCommand(command: CommandHook): string {
  return [command.program, ...command.args].join(" ");
}

function logEntry(level: string, message: string): InstallLogEntry {
  return {
    timestamp_ms: Date.now(),
    level,
    message
  };
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
