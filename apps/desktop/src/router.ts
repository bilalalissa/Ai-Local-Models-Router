import { invoke } from "@tauri-apps/api/core";
import type { HardwareSpecs } from "./hardware";
import type { CompatibilityLabel, PreferenceTag, ProviderKind, UseCase } from "./modelCatalog";
import { scoreModels } from "./modelCatalog";
import type { ProviderChatResponse, ProviderStatus } from "./providers";
import { sendProviderTestChat } from "./providers";

export type RouterMode = "Auto" | "Manual" | "Forced" | "LocalOnly" | "RemotePreferred" | "RemoteOnly" | "Paused";

export type RouterThresholds = {
  min_score: number;
  max_cpu_percent: number;
  max_memory_percent: number;
  max_gpu_percent: number;
  max_latency_ms: number;
  upgrade_score_margin: number;
};

export type RouterDecisionRequest = {
  hardware: HardwareSpecs;
  provider_statuses: ProviderStatus[];
  remote_candidates: RouteCandidate[];
  mode: RouterMode;
  use_case: UseCase;
  preference_tags: PreferenceTag[];
  manual_model_id: string | null;
  forced_model_id: string | null;
  installed_only: boolean;
  app_paused: boolean;
  thresholds: RouterThresholds;
};

export type RouteCandidate = {
  model_id: string;
  model_name: string;
  provider: ProviderKind;
  provider_id: string;
  provider_name: string;
  score: number;
  label: CompatibilityLabel;
  latency_ms: number | null;
  installed: boolean;
  reasons: string[];
  blockers: string[];
};

export type RouterDecision = {
  mode: RouterMode;
  selected: RouteCandidate | null;
  fallback_chain: RouteCandidate[];
  rejected: RouteCandidate[];
  reasons: string[];
  suspended: boolean;
  can_execute: boolean;
};

export type RouterTestRequest = {
  decision: RouterDecision;
  prompt: string;
};

export type RouterTestResult = {
  decision: RouterDecision;
  response: ProviderChatResponse | null;
  message: string;
};

export const defaultRouterThresholds: RouterThresholds = {
  min_score: 70,
  max_cpu_percent: 80,
  max_memory_percent: 85,
  max_gpu_percent: 90,
  max_latency_ms: 1500,
  upgrade_score_margin: 8
};

export async function decideRouterRoute(request: RouterDecisionRequest): Promise<RouterDecision> {
  if (isTauriRuntime()) return invoke<RouterDecision>("decide_router_route_with_background", { request });
  return fallbackDecision(request);
}

export async function runRouterTestPrompt(request: RouterTestRequest): Promise<RouterTestResult> {
  if (isTauriRuntime()) return invoke<RouterTestResult>("run_router_test_prompt", { request });
  if (!request.decision.selected) {
    return { decision: request.decision, response: null, message: "No selected route to test." };
  }
  if (!request.decision.can_execute) {
    return {
      decision: request.decision,
      response: null,
      message: "Router decision is not executable in the current mode."
    };
  }
  try {
    const response = await sendProviderTestChat({
      provider_id: request.decision.selected.provider_id,
      model_id: request.decision.selected.model_id,
      prompt: request.prompt
    });
    return { decision: request.decision, response, message: "Router test prompt completed." };
  } catch (err) {
    return {
      decision: request.decision,
      response: null,
      message: `Router test prompt failed: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

async function fallbackDecision(request: RouterDecisionRequest): Promise<RouterDecision> {
  const suspended = request.app_paused || request.mode === "Paused";
  const scored = await scoreModels({
    hardware: request.hardware,
    use_case: request.use_case,
    preferred_provider: null,
    preference_tags: request.preference_tags,
    installed_only: request.installed_only,
    app_paused: suspended
  });
  const localCandidates = scored.flatMap((result) =>
    result.model.providers.flatMap((providerKind) => {
      const provider = request.provider_statuses.find((status) =>
        status.definition.kind === providerKind &&
        status.running &&
        !status.paused &&
        ["Healthy", "Degraded"].includes(status.health)
      );
      if (!provider) return [];
      return [{
        model_id: result.model.id,
        model_name: result.model.display_name,
        provider: providerKind,
        provider_id: provider.definition.id,
        provider_name: provider.definition.name,
        score: result.score,
        label: result.label,
        latency_ms: provider.latency_ms,
        installed: result.model.installed,
        reasons: result.reasons,
        blockers: result.blockers
      } satisfies RouteCandidate];
    })
  ).sort((a, b) => b.score - a.score || (a.latency_ms ?? 999999) - (b.latency_ms ?? 999999));
  const remoteCandidates = [...request.remote_candidates].sort((a, b) => b.score - a.score || (a.latency_ms ?? 999999) - (b.latency_ms ?? 999999));
  const localOverloaded =
    request.hardware.load.cpu_percent > request.thresholds.max_cpu_percent ||
    request.hardware.load.memory_percent > request.thresholds.max_memory_percent ||
    (request.hardware.load.gpu_percent ?? 0) > request.thresholds.max_gpu_percent;
  const pool = candidatePool(request, localCandidates, remoteCandidates, localOverloaded);
  const rejected = [...localCandidates, ...remoteCandidates].filter((candidate) =>
    candidate.score < request.thresholds.min_score ||
    candidate.label === "Avoid" ||
    candidate.blockers.length > 0 ||
    (candidate.latency_ms ?? 0) > request.thresholds.max_latency_ms
  );
  const eligible = pool.filter((candidate) => !rejected.includes(candidate));
  const selected = selectCandidate(request, eligible, [...localCandidates, ...remoteCandidates]);
  const reasons = [
    ...(suspended ? ["Router is paused; no executable routing change will be made."] : []),
    ...(request.mode === "RemotePreferred"
      ? [remoteCandidates.length ? "Remote preferred is using paired remote candidates first." : "Remote preferred has no available remote candidates; local fallback is allowed."]
      : []),
    ...(request.mode === "RemoteOnly" && remoteCandidates.length === 0 ? ["Remote only has no available remote candidates from paired devices."] : []),
    ...(request.mode === "Auto" && localOverloaded && remoteCandidates.length ? ["Local load exceeds routing thresholds; Auto mode prefers remote fallback."] : []),
    ...(request.mode === "LocalOnly" ? ["Local only mode excludes remote candidates."] : []),
    ...(remoteCandidates.length ? [`${remoteCandidates.length} remote model candidates are available from paired Windows broker devices.`] : []),
    selected
      ? `Selected ${selected.model_name} on ${selected.provider_name} with score ${selected.score}.`
      : "No executable candidate met routing thresholds."
  ];
  return {
    mode: request.mode,
    selected,
    fallback_chain: eligible.filter((candidate) => candidate !== selected).slice(0, 5),
    rejected,
    reasons,
    suspended,
    can_execute: !!selected && !suspended
  };
}

function candidatePool(
  request: RouterDecisionRequest,
  localCandidates: RouteCandidate[],
  remoteCandidates: RouteCandidate[],
  localOverloaded: boolean
): RouteCandidate[] {
  if (request.mode === "LocalOnly") return localCandidates;
  if (request.mode === "RemoteOnly") return remoteCandidates;
  if (request.mode === "RemotePreferred") return [...remoteCandidates, ...localCandidates];
  if (request.mode === "Auto" && (localOverloaded || localCandidates.length === 0) && remoteCandidates.length) {
    return [...remoteCandidates, ...localCandidates];
  }
  return [...localCandidates, ...remoteCandidates];
}

function selectCandidate(
  request: RouterDecisionRequest,
  eligible: RouteCandidate[],
  allCandidates: RouteCandidate[]
): RouteCandidate | null {
  if (request.mode === "Paused") return null;
  if (request.mode === "Manual") {
    return eligible.find((candidate) => candidate.model_id === request.manual_model_id) ?? eligible[0] ?? null;
  }
  if (request.mode === "Forced") {
    return allCandidates.find((candidate) => candidate.model_id === request.forced_model_id) ?? null;
  }
  return eligible[0] ?? null;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
