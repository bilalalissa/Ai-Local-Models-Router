use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum InstallPlatform {
    AppleSilicon,
    IntelMac,
    WindowsX64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum InstallRunStatus {
    Idle,
    NeedsConsent,
    Running,
    Paused,
    Canceled,
    Completed,
    Error,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum CommandHookKind {
    ShellCommand,
    ManualStep,
    DownloadPlaceholder,
    ProviderProbe,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CommandHook {
    pub id: String,
    pub label: String,
    pub kind: CommandHookKind,
    pub program: String,
    pub args: Vec<String>,
    pub working_dir: String,
    pub env: Vec<(String, String)>,
    pub dry_run_only: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct InstallPlan {
    pub id: String,
    pub name: String,
    pub platform: InstallPlatform,
    pub summary: String,
    pub runtime_dir: String,
    pub model_dir: String,
    pub cache_dir: String,
    pub commands: Vec<CommandHook>,
    pub consent_items: Vec<String>,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct InstallLogEntry {
    pub timestamp_ms: u128,
    pub level: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct InstallRunState {
    pub status: InstallRunStatus,
    pub selected_plan_id: Option<String>,
    pub dry_run: bool,
    pub consent_granted: bool,
    pub current_step: usize,
    pub total_steps: usize,
    pub progress_percent: u8,
    pub runtime_dir: String,
    pub model_dir: String,
    pub active_command: Option<CommandHook>,
    pub logs: Vec<InstallLogEntry>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StartInstallRequest {
    pub plan_id: String,
    pub dry_run: bool,
    pub consent_granted: bool,
}

#[derive(Debug)]
pub struct InstallerManager {
    plans: Vec<InstallPlan>,
    state: InstallRunState,
}

impl InstallerManager {
    pub fn seeded(app_data_dir: PathBuf) -> Self {
        let plans = install_plans(&app_data_dir);
        Self {
            state: idle_state(&app_data_dir),
            plans,
        }
    }

    pub fn plans(&self) -> Vec<InstallPlan> {
        self.plans.clone()
    }

    pub fn state(&self) -> InstallRunState {
        self.state.clone()
    }

    pub fn start(&mut self, request: StartInstallRequest) -> Result<InstallRunState, String> {
        let plan = self.plan(&request.plan_id)?.clone();
        if !request.consent_granted {
            self.state = InstallRunState {
                status: InstallRunStatus::NeedsConsent,
                selected_plan_id: Some(plan.id.clone()),
                dry_run: request.dry_run,
                consent_granted: false,
                current_step: 0,
                total_steps: plan.commands.len(),
                progress_percent: 0,
                runtime_dir: plan.runtime_dir.clone(),
                model_dir: plan.model_dir.clone(),
                active_command: plan.commands.first().cloned(),
                logs: vec![log(
                    "warn",
                    "Install consent is required before preparing commands.",
                )],
            };
            return Ok(self.state());
        }
        if !request.dry_run {
            return Err("Stage 7 only supports dry-run installer execution.".to_string());
        }
        self.state = InstallRunState {
            status: InstallRunStatus::Running,
            selected_plan_id: Some(plan.id.clone()),
            dry_run: true,
            consent_granted: true,
            current_step: 0,
            total_steps: plan.commands.len(),
            progress_percent: 0,
            runtime_dir: plan.runtime_dir.clone(),
            model_dir: plan.model_dir.clone(),
            active_command: plan.commands.first().cloned(),
            logs: vec![
                log("info", &format!("Dry-run installer started: {}", plan.name)),
                log(
                    "info",
                    "No commands will execute and no model weights will download.",
                ),
                log(
                    "info",
                    &format!(
                        "App-managed folders: {} and {}",
                        plan.runtime_dir, plan.model_dir
                    ),
                ),
            ],
        };
        Ok(self.state())
    }

    pub fn advance(&mut self) -> Result<InstallRunState, String> {
        match self.state.status {
            InstallRunStatus::Running => {}
            InstallRunStatus::Completed => return Ok(self.state()),
            InstallRunStatus::Paused => return Err("installer is paused".to_string()),
            InstallRunStatus::Canceled => return Err("installer was canceled".to_string()),
            _ => return Err("installer is not running".to_string()),
        }

        let plan_id = self
            .state
            .selected_plan_id
            .clone()
            .ok_or_else(|| "no selected install plan".to_string())?;
        let plan = self.plan(&plan_id)?.clone();
        if self.state.current_step >= plan.commands.len() {
            self.state.status = InstallRunStatus::Completed;
            self.state.progress_percent = 100;
            self.state.active_command = None;
            self.push_log("info", "Dry-run installer completed.");
            return Ok(self.state());
        }

        let command = plan.commands[self.state.current_step].clone();
        self.push_log("info", &format!("Dry-run checked: {}", command.label));
        self.push_log(
            "debug",
            &format!("Command hook: {}", render_command(&command)),
        );
        self.state.current_step += 1;
        self.state.progress_percent = progress(self.state.current_step, self.state.total_steps);
        self.state.active_command = plan.commands.get(self.state.current_step).cloned();
        if self.state.current_step >= self.state.total_steps {
            self.state.status = InstallRunStatus::Completed;
            self.state.active_command = None;
            self.push_log("info", "Dry-run installer completed.");
        }
        Ok(self.state())
    }

    pub fn pause(&mut self) -> Result<InstallRunState, String> {
        if self.state.status != InstallRunStatus::Running {
            return Err("only a running installer can be paused".to_string());
        }
        self.state.status = InstallRunStatus::Paused;
        self.push_log("info", "Installer dry-run paused.");
        Ok(self.state())
    }

    pub fn resume(&mut self) -> Result<InstallRunState, String> {
        if self.state.status != InstallRunStatus::Paused {
            return Err("only a paused installer can be resumed".to_string());
        }
        self.state.status = InstallRunStatus::Running;
        self.push_log("info", "Installer dry-run resumed.");
        Ok(self.state())
    }

    pub fn cancel(&mut self) -> Result<InstallRunState, String> {
        if matches!(
            self.state.status,
            InstallRunStatus::Completed | InstallRunStatus::Idle
        ) {
            return Err("no active installer run to cancel".to_string());
        }
        self.state.status = InstallRunStatus::Canceled;
        self.state.active_command = None;
        self.push_log("warn", "Installer dry-run canceled.");
        Ok(self.state())
    }

    fn plan(&self, plan_id: &str) -> Result<&InstallPlan, String> {
        self.plans
            .iter()
            .find(|plan| plan.id == plan_id)
            .ok_or_else(|| format!("unknown install plan: {plan_id}"))
    }

    fn push_log(&mut self, level: &str, message: &str) {
        self.state.logs.insert(0, log(level, message));
    }
}

fn install_plans(app_data_dir: &Path) -> Vec<InstallPlan> {
    vec![
        plan(
            app_data_dir,
            "apple-silicon-recommended",
            "Apple Silicon Recommended Setup",
            InstallPlatform::AppleSilicon,
            "MLX-LM runtime plus Ollama fallback for Apple Silicon Macs.",
            "mlx-lm",
            "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
            vec![
                hook(
                    "create-runtime-dir",
                    "Create app runtime folder",
                    CommandHookKind::ManualStep,
                    "mkdir",
                    &["-p", "{runtime_dir}"],
                ),
                hook(
                    "create-model-dir",
                    "Create app model folder",
                    CommandHookKind::ManualStep,
                    "mkdir",
                    &["-p", "{model_dir}"],
                ),
                hook(
                    "venv",
                    "Prepare MLX-LM virtual environment",
                    CommandHookKind::ShellCommand,
                    "python3",
                    &["-m", "venv", "{runtime_dir}/mlx-lm-venv"],
                ),
                hook(
                    "install-mlx",
                    "Install MLX-LM package",
                    CommandHookKind::ShellCommand,
                    "{runtime_dir}/mlx-lm-venv/bin/pip",
                    &["install", "mlx-lm"],
                ),
                hook(
                    "model-placeholder",
                    "Reserve MLX model download target",
                    CommandHookKind::DownloadPlaceholder,
                    "huggingface-cli",
                    &[
                        "download",
                        "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
                        "--local-dir",
                        "{model_dir}/qwen2.5-coder-mlx",
                    ],
                ),
                hook(
                    "probe",
                    "Probe MLX-LM endpoint",
                    CommandHookKind::ProviderProbe,
                    "curl",
                    &["http://127.0.0.1:8080/v1/models"],
                ),
            ],
        ),
        plan(
            app_data_dir,
            "intel-mac-recommended",
            "Intel Mac Recommended Setup",
            InstallPlatform::IntelMac,
            "Ollama with compact GGUF models for Intel Macs.",
            "ollama",
            "phi3.5:latest",
            vec![
                hook(
                    "create-runtime-dir",
                    "Create app runtime folder",
                    CommandHookKind::ManualStep,
                    "mkdir",
                    &["-p", "{runtime_dir}"],
                ),
                hook(
                    "create-model-dir",
                    "Create app model folder",
                    CommandHookKind::ManualStep,
                    "mkdir",
                    &["-p", "{model_dir}"],
                ),
                hook(
                    "install-ollama",
                    "Install Ollama runtime",
                    CommandHookKind::ShellCommand,
                    "brew",
                    &["install", "ollama"],
                ),
                hook(
                    "serve",
                    "Start Ollama service hook",
                    CommandHookKind::ShellCommand,
                    "ollama",
                    &["serve"],
                ),
                hook(
                    "model-placeholder",
                    "Reserve Ollama model pull",
                    CommandHookKind::DownloadPlaceholder,
                    "ollama",
                    &["pull", "phi3.5:latest"],
                ),
                hook(
                    "probe",
                    "Probe Ollama tags endpoint",
                    CommandHookKind::ProviderProbe,
                    "curl",
                    &["http://127.0.0.1:11434/api/tags"],
                ),
            ],
        ),
        plan(
            app_data_dir,
            "windows-gtx-recommended",
            "Windows GTX Recommended Setup",
            InstallPlatform::WindowsX64,
            "llama.cpp server with CUDA-capable GGUF models for Windows x64.",
            "llama-cpp",
            "mistral-7b-instruct-q4.gguf",
            vec![
                hook(
                    "create-runtime-dir",
                    "Create app runtime folder",
                    CommandHookKind::ManualStep,
                    "powershell",
                    &[
                        "New-Item",
                        "-ItemType",
                        "Directory",
                        "-Force",
                        "{runtime_dir}",
                    ],
                ),
                hook(
                    "create-model-dir",
                    "Create app model folder",
                    CommandHookKind::ManualStep,
                    "powershell",
                    &[
                        "New-Item",
                        "-ItemType",
                        "Directory",
                        "-Force",
                        "{model_dir}",
                    ],
                ),
                hook(
                    "download-runtime",
                    "Reserve llama.cpp release download",
                    CommandHookKind::DownloadPlaceholder,
                    "powershell",
                    &[
                        "Invoke-WebRequest",
                        "-OutFile",
                        "{runtime_dir}\\llama.cpp.zip",
                    ],
                ),
                hook(
                    "model-placeholder",
                    "Reserve GGUF model download",
                    CommandHookKind::DownloadPlaceholder,
                    "powershell",
                    &[
                        "Invoke-WebRequest",
                        "-OutFile",
                        "{model_dir}\\mistral-7b-instruct-q4.gguf",
                    ],
                ),
                hook(
                    "server",
                    "Prepare llama-server command hook",
                    CommandHookKind::ShellCommand,
                    "{runtime_dir}\\llama-server.exe",
                    &[
                        "-m",
                        "{model_dir}\\mistral-7b-instruct-q4.gguf",
                        "--host",
                        "127.0.0.1",
                        "--port",
                        "8081",
                    ],
                ),
                hook(
                    "probe",
                    "Probe llama.cpp models endpoint",
                    CommandHookKind::ProviderProbe,
                    "curl",
                    &["http://127.0.0.1:8081/v1/models"],
                ),
            ],
        ),
    ]
}

fn plan(
    app_data_dir: &Path,
    id: &str,
    name: &str,
    platform: InstallPlatform,
    summary: &str,
    runtime_slug: &str,
    model_slug: &str,
    commands: Vec<CommandHook>,
) -> InstallPlan {
    let runtime_dir = app_data_dir.join("runtimes").join(runtime_slug);
    let model_dir = app_data_dir.join("models").join(model_slug);
    let cache_dir = app_data_dir.join("install-cache").join(runtime_slug);
    let runtime_text = path_text(&runtime_dir);
    let model_text = path_text(&model_dir);
    let cache_text = path_text(&cache_dir);
    let commands = commands
        .into_iter()
        .map(|command| expand_hook(command, &runtime_text, &model_text, &cache_text))
        .collect();

    InstallPlan {
        id: id.to_string(),
        name: name.to_string(),
        platform,
        summary: summary.to_string(),
        runtime_dir: runtime_text,
        model_dir: model_text,
        cache_dir: cache_text,
        commands,
        consent_items: vec![
            "Run in dry-run mode for Stage 7.".to_string(),
            "Show command hooks before any future execution.".to_string(),
            "Use app-managed runtime and model folders.".to_string(),
            "Do not download model weights during tests.".to_string(),
        ],
        notes: vec![
            "Stage 7 records real command hooks but does not execute them.".to_string(),
            "Pause and cancel affect the dry-run workflow state only.".to_string(),
        ],
    }
}

fn hook(id: &str, label: &str, kind: CommandHookKind, program: &str, args: &[&str]) -> CommandHook {
    CommandHook {
        id: id.to_string(),
        label: label.to_string(),
        kind,
        program: program.to_string(),
        args: args.iter().map(|arg| (*arg).to_string()).collect(),
        working_dir: "{runtime_dir}".to_string(),
        env: Vec::new(),
        dry_run_only: true,
    }
}

fn expand_hook(
    mut command: CommandHook,
    runtime_dir: &str,
    model_dir: &str,
    cache_dir: &str,
) -> CommandHook {
    command.program = expand(&command.program, runtime_dir, model_dir, cache_dir);
    command.args = command
        .args
        .into_iter()
        .map(|arg| expand(&arg, runtime_dir, model_dir, cache_dir))
        .collect();
    command.working_dir = expand(&command.working_dir, runtime_dir, model_dir, cache_dir);
    command
}

fn expand(input: &str, runtime_dir: &str, model_dir: &str, cache_dir: &str) -> String {
    input
        .replace("{runtime_dir}", runtime_dir)
        .replace("{model_dir}", model_dir)
        .replace("{cache_dir}", cache_dir)
}

fn render_command(command: &CommandHook) -> String {
    std::iter::once(command.program.as_str())
        .chain(command.args.iter().map(String::as_str))
        .collect::<Vec<_>>()
        .join(" ")
}

fn idle_state(app_data_dir: &Path) -> InstallRunState {
    InstallRunState {
        status: InstallRunStatus::Idle,
        selected_plan_id: None,
        dry_run: true,
        consent_granted: false,
        current_step: 0,
        total_steps: 0,
        progress_percent: 0,
        runtime_dir: path_text(&app_data_dir.join("runtimes")),
        model_dir: path_text(&app_data_dir.join("models")),
        active_command: None,
        logs: vec![log("info", "Installer ready in dry-run mode.")],
    }
}

fn progress(current_step: usize, total_steps: usize) -> u8 {
    if total_steps == 0 {
        0
    } else {
        ((current_step * 100) / total_steps).min(100) as u8
    }
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn log(level: &str, message: &str) -> InstallLogEntry {
    InstallLogEntry {
        timestamp_ms: now_ms(),
        level: level.to_string(),
        message: message.to_string(),
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manager() -> InstallerManager {
        InstallerManager::seeded(PathBuf::from("/tmp/local-ai-router-test"))
    }

    #[test]
    fn seeded_plans_cover_required_platforms_and_app_folders() {
        let manager = manager();
        let plans = manager.plans();

        assert_eq!(plans.len(), 3);
        assert!(plans
            .iter()
            .any(|plan| plan.platform == InstallPlatform::AppleSilicon));
        assert!(plans
            .iter()
            .any(|plan| plan.platform == InstallPlatform::IntelMac));
        assert!(plans
            .iter()
            .any(|plan| plan.platform == InstallPlatform::WindowsX64));
        assert!(plans
            .iter()
            .all(|plan| plan.runtime_dir.contains("runtimes")));
        assert!(plans.iter().all(|plan| plan.model_dir.contains("models")));
        assert!(plans
            .iter()
            .all(|plan| plan.commands.iter().all(|command| command.dry_run_only)));
    }

    #[test]
    fn consent_is_required_before_starting() {
        let mut manager = manager();
        let state = manager
            .start(StartInstallRequest {
                plan_id: "apple-silicon-recommended".to_string(),
                dry_run: true,
                consent_granted: false,
            })
            .expect("consent state should return");

        assert_eq!(state.status, InstallRunStatus::NeedsConsent);
        assert_eq!(state.progress_percent, 0);
    }

    #[test]
    fn dry_run_advances_to_completion_without_real_execution() {
        let mut manager = manager();
        manager
            .start(StartInstallRequest {
                plan_id: "intel-mac-recommended".to_string(),
                dry_run: true,
                consent_granted: true,
            })
            .expect("dry run starts");
        for _ in 0..6 {
            manager.advance().expect("advance succeeds");
        }
        let state = manager.state();

        assert_eq!(state.status, InstallRunStatus::Completed);
        assert_eq!(state.progress_percent, 100);
        assert!(state
            .logs
            .iter()
            .any(|entry| entry.message.contains("Dry-run checked")));
    }

    #[test]
    fn pause_blocks_advance_until_resume() {
        let mut manager = manager();
        manager
            .start(StartInstallRequest {
                plan_id: "windows-gtx-recommended".to_string(),
                dry_run: true,
                consent_granted: true,
            })
            .expect("dry run starts");
        manager.pause().expect("pause succeeds");
        let blocked = manager.advance();
        manager.resume().expect("resume succeeds");
        let state = manager.advance().expect("advance succeeds");

        assert!(blocked
            .expect_err("paused advance fails")
            .contains("paused"));
        assert_eq!(state.current_step, 1);
    }

    #[test]
    fn cancel_stops_active_run() {
        let mut manager = manager();
        manager
            .start(StartInstallRequest {
                plan_id: "apple-silicon-recommended".to_string(),
                dry_run: true,
                consent_granted: true,
            })
            .expect("dry run starts");
        let canceled = manager.cancel().expect("cancel succeeds");

        assert_eq!(canceled.status, InstallRunStatus::Canceled);
        assert!(canceled.active_command.is_none());
    }
}
