import type { LocalProductSnapshot } from "./codex/local-product-api.js";
export type RuntimeDependencyGateHealth =
  | { state: "ready" }
  | {
      state: "degraded";
      classification: "permanent_configuration" | "transient";
      nextProbeAt: number;
    };

export const RUNTIME_CONFIGURATION_WARNING =
  "Rove's browser service needs attention. Conversation history remains available while browser work is unavailable.";
export const RUNTIME_TRANSIENT_WARNING =
  "Rove's browser service is temporarily unavailable. Conversation history remains available while Rove retries.";

export function runtimeDependencyWarning(
  health: RuntimeDependencyGateHealth,
): string | undefined {
  if (health.state === "ready") return undefined;
  return health.classification === "permanent_configuration"
    ? RUNTIME_CONFIGURATION_WARNING
    : RUNTIME_TRANSIENT_WARNING;
}

export function runtimeDependencyProbeDue(
  health: RuntimeDependencyGateHealth,
  now = Date.now(),
): boolean {
  return health.state === "ready" || now >= health.nextProbeAt;
}

export async function runContainedRuntimeProbe(input: {
  health: RuntimeDependencyGateHealth;
  now?: number;
  probe(): Promise<void>;
  onFailure?(): Promise<void> | void;
}): Promise<"completed" | "failed" | "skipped"> {
  if (!runtimeDependencyProbeDue(input.health, input.now)) return "skipped";
  try {
    await input.probe();
    return "completed";
  } catch {
    try {
      await input.onFailure?.();
    } catch {
      // Background Runtime failures and their publication path stay contained.
    }
    return "failed";
  }
}

export function withRuntimeDependencyWarning(
  product: LocalProductSnapshot | null,
  health: RuntimeDependencyGateHealth,
): LocalProductSnapshot | null {
  if (product === null) return null;
  const warning = runtimeDependencyWarning(health);
  const recoveryWarnings = product.recoveryWarnings.filter(
    (entry) =>
      entry !== RUNTIME_CONFIGURATION_WARNING &&
      entry !== RUNTIME_TRANSIENT_WARNING,
  );
  return {
    ...product,
    recoveryWarnings:
      warning === undefined
        ? recoveryWarnings
        : [...recoveryWarnings, warning].slice(-64),
  };
}
