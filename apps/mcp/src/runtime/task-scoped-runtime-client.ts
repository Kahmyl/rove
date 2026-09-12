import type { StartSessionRequest } from "@rove/protocol";
import { createHmac, timingSafeEqual } from "node:crypto";

import type { RuntimeClient } from "./runtime-client.types.js";

export interface TaskRuntimeScope {
  taskId: string;
  bootstrapId?: string;
  sessionId?: string;
  capability: string;
  executionMode: "agent" | "companion" | "capture";
  browserIdentity?:
    { mode: "temporary" } | { mode: "workspace"; workspaceId: string };
}

interface CapabilityClaims {
  taskId: string;
  bootstrapId?: string;
  sessionId?: string;
  executionMode: TaskRuntimeScope["executionMode"];
  browserIdentity?: TaskRuntimeScope["browserIdentity"];
  nonce: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validBrowserIdentity(
  value: unknown,
): value is TaskRuntimeScope["browserIdentity"] {
  if (!isRecord(value)) return false;
  if (value.mode === "temporary")
    return Object.keys(value).every((key) => key === "mode");
  return (
    value.mode === "workspace" &&
    Object.keys(value).every(
      (key) => key === "mode" || key === "workspaceId",
    ) &&
    typeof value.workspaceId === "string" &&
    /^wrk_[a-f0-9-]{36}$/.test(value.workspaceId)
  );
}

function matchesBoundStart(
  input: StartSessionRequest,
  scope: TaskRuntimeScope,
): boolean {
  if (!isRecord(input) || input.mode !== scope.executionMode) return false;
  if (
    Object.keys(input).some(
      (key) => key !== "mode" && key !== "browser" && key !== "startUrl",
    ) ||
    (input.startUrl !== undefined && typeof input.startUrl !== "string")
  )
    return false;
  const browser = input.browser;
  if (scope.browserIdentity?.mode === "temporary")
    return (
      isRecord(browser) &&
      browser.mode === "temporary" &&
      Object.keys(browser).every((key) => key === "mode")
    );
  if (scope.browserIdentity === undefined) return browser === undefined;
  if (browser === undefined) return true;
  if (
    !isRecord(browser) ||
    browser.mode !== "workspace" ||
    Object.keys(browser).some((key) => key !== "mode" && key !== "workspaceId")
  )
    return false;
  return (
    browser.workspaceId === undefined ||
    browser.workspaceId === scope.browserIdentity.workspaceId
  );
}

function parseCapability(token: string, verifier: string): CapabilityClaims {
  const match = /^rtcap_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (match?.[1] === undefined || match[2] === undefined)
    throw new Error("Invalid task capability encoding.");
  const key = Buffer.from(verifier, "base64url");
  if (key.byteLength !== 32)
    throw new Error("Invalid task capability verifier.");
  const expected = createHmac("sha256", key).update(match[1]).digest();
  const actual = Buffer.from(match[2], "base64url");
  if (
    expected.byteLength !== actual.byteLength ||
    !timingSafeEqual(expected, actual)
  )
    throw new Error("Invalid task capability signature.");
  const claims = JSON.parse(
    Buffer.from(match[1], "base64url").toString("utf8"),
  ) as Partial<CapabilityClaims>;
  if (
    typeof claims.taskId !== "string" ||
    (typeof claims.bootstrapId !== "string" &&
      typeof claims.sessionId !== "string") ||
    (claims.bootstrapId !== undefined && claims.sessionId !== undefined) ||
    typeof claims.nonce !== "string" ||
    (claims.executionMode !== "agent" &&
      claims.executionMode !== "companion" &&
      claims.executionMode !== "capture") ||
    (claims.bootstrapId !== undefined &&
      !/^boot_[a-f0-9]{32}$/.test(claims.bootstrapId)) ||
    (claims.browserIdentity !== undefined &&
      !validBrowserIdentity(claims.browserIdentity))
  )
    throw new Error("Invalid task capability claims.");
  return claims as CapabilityClaims;
}

export function taskRuntimeScopeFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): TaskRuntimeScope | undefined {
  const taskId = environment.ROVE_TASK_ID;
  const bootstrapId = environment.ROVE_TASK_BOOTSTRAP_ID;
  const sessionId = environment.ROVE_TASK_SESSION_ID;
  const capability = environment.ROVE_TASK_CAPABILITY;
  const executionMode = environment.ROVE_TASK_EXECUTION_MODE;
  const identity = environment.ROVE_TASK_BROWSER_IDENTITY;
  const verifier = environment.ROVE_TASK_CAPABILITY_VERIFIER;
  if (
    [taskId, bootstrapId, sessionId, capability, executionMode, identity].every(
      (value) => value === undefined,
    )
  ) {
    if (verifier !== undefined)
      throw new Error("Incomplete task-scoped MCP environment.");
    return undefined;
  }
  if (
    taskId === undefined ||
    (bootstrapId === undefined && sessionId === undefined) ||
    capability === undefined ||
    verifier === undefined ||
    (executionMode !== "agent" &&
      executionMode !== "companion" &&
      executionMode !== "capture") ||
    (bootstrapId !== undefined && !/^boot_[a-f0-9]{32}$/.test(bootstrapId))
  ) {
    throw new Error("Incomplete or invalid task-scoped MCP environment.");
  }
  const browserIdentity =
    identity === undefined
      ? undefined
      : (JSON.parse(identity) as TaskRuntimeScope["browserIdentity"]);
  if (browserIdentity !== undefined && !validBrowserIdentity(browserIdentity)) {
    throw new Error("Invalid scoped browser identity.");
  }
  const claims = parseCapability(capability, verifier);
  if (
    claims.taskId !== taskId ||
    (claims.bootstrapId !== undefined && claims.bootstrapId !== bootstrapId) ||
    (claims.sessionId !== undefined && claims.sessionId !== sessionId) ||
    claims.executionMode !== executionMode ||
    JSON.stringify(claims.browserIdentity) !== JSON.stringify(browserIdentity)
  )
    throw new Error("Task capability scope mismatch.");
  return {
    taskId,
    ...(bootstrapId ? { bootstrapId } : {}),
    ...(sessionId ? { sessionId } : {}),
    capability,
    executionMode,
    ...(browserIdentity ? { browserIdentity } : {}),
  };
}

/** Prevents a task-bound MCP process from addressing or creating another session. */
export function scopeRuntimeClient(
  runtime: RuntimeClient,
  scope: TaskRuntimeScope,
): RuntimeClient {
  let attachedSessionId = scope.sessionId;
  const verifySession = (sessionId: unknown) => {
    if (!attachedSessionId || sessionId !== attachedSessionId)
      throw new Error("Task capability session mismatch.");
  };
  return new Proxy(runtime, {
    get(target, property, receiver) {
      if (property === "startSession") {
        return async (input: StartSessionRequest) => {
          if (!matchesBoundStart(input, scope)) {
            throw new Error("Task capability launch context mismatch.");
          }
          if (attachedSessionId) {
            if (input.startUrl !== undefined)
              await target.navigate(attachedSessionId, { url: input.startUrl });
            return target.getSession(attachedSessionId);
          }
          if (!scope.bootstrapId)
            throw new Error("Task capability lacks a Runtime bootstrap scope.");
          const session = await target.startSession({
            ...input,
            bootstrapId: scope.bootstrapId,
            ...(scope.browserIdentity
              ? { browser: scope.browserIdentity }
              : {}),
          });
          if (session.bootstrapId !== scope.bootstrapId)
            throw new Error("Task capability Runtime receipt mismatch.");
          attachedSessionId = session.id;
          return session;
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function" || property === "healthCheck")
        return value;
      return async (...args: unknown[]) => {
        verifySession(args[0]);
        return (value as (...inner: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}
