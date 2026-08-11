import type { HubCommand, HubCommandError } from "@rove/protocol";

export interface LocalRuntimeConnection {
  baseUrl: string;
  token: string;
}

export async function executeHubCommand(
  command: HubCommand,
  runtime: LocalRuntimeConnection,
): Promise<unknown> {
  const payload = asRecord(command.payload);
  const sessionId = optionalString(payload.sessionId);
  const input = payload.input;

  switch (command.operation) {
    case "runtime.health":
      return runtimeRequest(runtime, "GET", "/health", undefined, 5_000);
    case "session.start":
      return runtimeRequest(runtime, "POST", "/sessions", command.payload);
    case "session.status":
      return runtimeRequest(runtime, "GET", sessionPath(sessionId));
    case "session.end":
      return runtimeRequest(runtime, "POST", `${sessionPath(sessionId)}/end`);
    case "session.observations": {
      const query = new URLSearchParams();
      const options = asRecord(input);
      if (options.afterSeq !== undefined) query.set("afterSeq", String(options.afterSeq));
      if (options.limit !== undefined) query.set("limit", String(options.limit));
      return runtimeRequest(runtime, "GET", `${sessionPath(sessionId)}/observations?${query.toString()}`);
    }
    case "browser.navigate":
    case "browser.click":
    case "browser.type":
    case "browser.press":
    case "browser.scroll":
    case "browser.screenshot":
      return runtimeRequest(runtime, "POST", `${sessionPath(sessionId)}/browser/${command.operation.split(".")[1]}`, input);
    case "browser.inspect":
      return runtimeRequest(runtime, "POST", `${sessionPath(sessionId)}/browser/inspect`, input);
    case "browser.back":
    case "browser.forward":
      return runtimeRequest(runtime, "POST", `${sessionPath(sessionId)}/browser/${command.operation.split(".")[1]}`);
    case "evidence.save_record": {
      const recordInput = asRecord(input);
      return runtimeRequest(runtime, "POST", `${sessionPath(sessionId)}/evidence`, {
        type: "record",
        label: recordInput.label,
        payload: recordInput.record,
      });
    }
    case "evidence.list":
      return runtimeRequest(runtime, "GET", `${sessionPath(sessionId)}/evidence`);
    case "evidence.read":
      return runtimeRequest(runtime, "GET", `${sessionPath(sessionId)}/evidence/${encodeURIComponent(requiredString(payload.evidenceId, "evidenceId"))}`);
    case "control.status":
      return runtimeRequest(runtime, "GET", `${sessionPath(sessionId)}/control`);
    case "control.request_human":
      return runtimeRequest(runtime, "POST", `${sessionPath(sessionId)}/control/request-human`, {
        reason: requiredString(payload.reason, "reason"),
      });
    case "control.wait": {
      const options = asRecord(input);
      const query = new URLSearchParams();
      if (options.afterSeq !== undefined) query.set("afterSeq", String(options.afterSeq));
      if (options.timeoutMs !== undefined) query.set("timeoutMs", String(options.timeoutMs));
      const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs + 5_000 : 35_000;
      return runtimeRequest(runtime, "GET", `${sessionPath(sessionId)}/control/wait?${query.toString()}`, undefined, timeoutMs);
    }
  }
}

export function toHubCommandError(error: unknown): HubCommandError {
  if (isRuntimeFailure(error)) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  return {
    code: "HUB_EXECUTION_FAILED",
    message: error instanceof Error ? error.message : "Hub command execution failed.",
    retryable: false,
  };
}

interface RuntimeFailure {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

async function runtimeRequest(
  runtime: LocalRuntimeConnection,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  timeoutMs = 30_000,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(new URL(path, runtime.baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${runtime.token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw {
      code: error instanceof DOMException && error.name === "TimeoutError" ? "RUNTIME_TIMEOUT" : "RUNTIME_UNAVAILABLE",
      message: error instanceof DOMException && error.name === "TimeoutError" ? "Runtime request timed out." : "Local Runtime is unavailable.",
      retryable: true,
    } satisfies RuntimeFailure;
  }

  const text = await response.text();
  if (!response.ok) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const record = asRecord(parsed);
    const nested = asRecord(record.error);
    throw {
      code: typeof nested.code === "string" ? nested.code : "RUNTIME_PROTOCOL_ERROR",
      message: typeof nested.message === "string" ? nested.message : `Runtime failed with HTTP ${response.status}.`,
      retryable: nested.retryable === true,
      ...(nested.details === undefined ? {} : { details: nested.details }),
    } satisfies RuntimeFailure;
  }
  if (text.length === 0) return undefined;
  return JSON.parse(text) as unknown;
}

function sessionPath(sessionId: string | undefined): string {
  return `/sessions/${encodeURIComponent(requiredString(sessionId, "sessionId"))}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Hub command is missing ${name}.`);
  return value;
}

function isRuntimeFailure(value: unknown): value is RuntimeFailure {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.code === "string" && typeof record.message === "string" && typeof record.retryable === "boolean";
}
