import {
  ROVE_PROTOCOL_VERSION,
  componentCompatibilityError,
  componentInstanceIdentitySchema,
  type ComponentCompatibilityRequirement,
  type ActionResult,
  type ControlStatus,
  type ControlWaitRequest,
  type ControlWaitResult,
  type Evidence,
  type EvidenceReadResult,
  type InspectOptions,
  type NavigateRequest,
  type ObservationPage,
  type ObservationQuery,
  type PageInspection,
  type PressRequest,
  type ScreenshotOptions,
  type SessionSnapshot,
  type StartSessionRequest,
  type TargetReference,
  type TypeRequest,
  type ActionReceipt,
  type TargetResolution,
  type TargetResolutionRequest,
  type VerifiedInteractionRequest,
} from "@rove/protocol";
import { RuntimeClientError } from "./runtime-client.error.js";
import type {
  RuntimeClient,
  SaveRecordInput,
  ScrollInput,
} from "./runtime-client.types.js";

const DEFAULT_TIMEOUT_MS = 30_000;

export class RuntimeHttpClient implements RuntimeClient {
  private readonly runtimeUrl: URL;

  constructor(
    runtimeUrl: string,
    private readonly runtimeToken?: string,
    private readonly expectedRuntime: ComponentCompatibilityRequirement = {
      runtimeApi: ROVE_PROTOCOL_VERSION,
    },
  ) {
    this.runtimeUrl = new URL(runtimeUrl);
  }

  async healthCheck(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    const health = await this.request<unknown>(
      "GET",
      "/health",
      undefined,
      timeoutMs,
      true,
    );
    const record =
      typeof health === "object" && health !== null
        ? (health as Record<string, unknown>)
        : {};
    let runtime;
    try {
      runtime = componentInstanceIdentitySchema.parse(record.runtime);
      if (runtime.component !== "runtime") {
        throw new Error("component kind mismatch");
      }
    } catch {
      throw new RuntimeClientError(
        "RUNTIME_PROVENANCE_MISMATCH",
        "Runtime health did not provide valid component provenance.",
        false,
      );
    }
    const mismatch = componentCompatibilityError(runtime, this.expectedRuntime);
    if (mismatch !== undefined) {
      throw new RuntimeClientError(
        "RUNTIME_PROVENANCE_MISMATCH",
        "Runtime does not satisfy the configured compatibility requirement.",
        false,
        { reason: mismatch },
      );
    }
    return health;
  }

  async startSession(input: StartSessionRequest): Promise<SessionSnapshot> {
    await this.healthCheck(Math.min(DEFAULT_TIMEOUT_MS, 2_000));
    return this.request("POST", "/sessions", input);
  }

  getSession(sessionId: string): Promise<SessionSnapshot> {
    return this.request("GET", `/sessions/${encodeURIComponent(sessionId)}`);
  }

  endSession(sessionId: string): Promise<SessionSnapshot> {
    return this.request(
      "POST",
      `/sessions/${encodeURIComponent(sessionId)}/end`,
    );
  }

  getObservations(
    sessionId: string,
    input: ObservationQuery,
  ): Promise<ObservationPage> {
    const query = new URLSearchParams();
    query.set("afterSeq", String(input.afterSeq ?? 0));
    query.set("limit", String(input.limit ?? 100));
    return this.request(
      "GET",
      `/sessions/${encodeURIComponent(sessionId)}/observations?${query.toString()}`,
    );
  }

  navigate(sessionId: string, input: NavigateRequest): Promise<ActionResult> {
    return this.request(
      "POST",
      `/sessions/${encodeURIComponent(sessionId)}/browser/navigate`,
      input,
    );
  }

  inspect(sessionId: string, input: InspectOptions): Promise<PageInspection> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) query.set(key, String(value));
    }
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    return this.request(
      "GET",
      `/sessions/${encodeURIComponent(sessionId)}/browser/inspect${suffix}`,
    );
  }

  resolveTarget(
    sessionId: string,
    input: TargetResolutionRequest,
  ): Promise<TargetResolution> {
    return this.request(
      "POST",
      `/sessions/${encodeURIComponent(sessionId)}/browser/resolve-target`,
      input,
    );
  }

  interact(
    sessionId: string,
    input: VerifiedInteractionRequest,
  ): Promise<ActionReceipt> {
    return this.request(
      "POST",
      `/sessions/${encodeURIComponent(sessionId)}/browser/interact`,
      input,
    );
  }

  click(
    sessionId: string,
    input: { target: TargetReference },
  ): Promise<ActionResult> {
    return this.request(
      "POST",
      `/sessions/${encodeURIComponent(sessionId)}/browser/click`,
      input,
    );
  }

  type(sessionId: string, input: TypeRequest): Promise<ActionResult> {
    return this.request(
      "POST",
      `/sessions/${encodeURIComponent(sessionId)}/browser/type`,
      input,
    );
  }

  press(sessionId: string, input: PressRequest): Promise<ActionResult> {
    return this.request(
      "POST",
      `/sessions/${encodeURIComponent(sessionId)}/browser/press`,
      input,
    );
  }

  scroll(sessionId: string, input: ScrollInput): Promise<ActionResult> {
    return this.request(
      "POST",
      `/sessions/${encodeURIComponent(sessionId)}/browser/scroll`,
      input,
    );
  }

  back(sessionId: string): Promise<ActionResult> {
    return this.request(
      "POST",
      `/sessions/${encodeURIComponent(sessionId)}/browser/back`,
    );
  }

  forward(sessionId: string): Promise<ActionResult> {
    return this.request(
      "POST",
      `/sessions/${encodeURIComponent(sessionId)}/browser/forward`,
    );
  }

  screenshot(sessionId: string, input: ScreenshotOptions): Promise<Evidence> {
    return this.request(
      "POST",
      `/sessions/${encodeURIComponent(sessionId)}/browser/screenshot`,
      input,
    );
  }

  saveRecord(sessionId: string, input: SaveRecordInput): Promise<Evidence> {
    return this.request(
      "POST",
      `/sessions/${encodeURIComponent(sessionId)}/evidence`,
      {
        type: "record",
        label: input.label,
        payload: input.record,
      },
    );
  }

  listEvidence(sessionId: string): Promise<Evidence[]> {
    return this.request(
      "GET",
      `/sessions/${encodeURIComponent(sessionId)}/evidence`,
    );
  }

  readEvidence(
    sessionId: string,
    evidenceId: string,
  ): Promise<EvidenceReadResult> {
    return this.request(
      "GET",
      `/sessions/${encodeURIComponent(sessionId)}/evidence/${encodeURIComponent(evidenceId)}`,
    );
  }

  getControlStatus(sessionId: string): Promise<ControlStatus> {
    return this.request(
      "GET",
      `/sessions/${encodeURIComponent(sessionId)}/control`,
    );
  }

  requestHuman(sessionId: string, reason: string): Promise<ControlStatus> {
    return this.request(
      "POST",
      `/sessions/${encodeURIComponent(sessionId)}/control/request-human`,
      { reason },
    );
  }

  waitForControl(
    sessionId: string,
    input: ControlWaitRequest,
    signal?: AbortSignal,
  ): Promise<ControlWaitResult> {
    const query = new URLSearchParams();
    if (input.afterSeq !== undefined)
      query.set("afterSeq", String(input.afterSeq));
    if (input.timeoutMs !== undefined)
      query.set("timeoutMs", String(input.timeoutMs));
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    const runtimeWaitMs = input.timeoutMs ?? 30_000;
    return this.request(
      "GET",
      `/sessions/${encodeURIComponent(sessionId)}/control/wait${suffix}`,
      undefined,
      runtimeWaitMs + 5_000,
      false,
      signal,
    );
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    allowEmpty = false,
    signal?: AbortSignal,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.runtimeUrl), {
        method,
        headers: {
          "content-type": "application/json",
          ...(this.runtimeToken === undefined
            ? {}
            : { authorization: `Bearer ${this.runtimeToken}` }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal:
          signal === undefined
            ? AbortSignal.timeout(timeoutMs)
            : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new RuntimeClientError(
          "RUNTIME_TIMEOUT",
          "Runtime API request timed out.",
          true,
        );
      }
      throw new RuntimeClientError(
        "RUNTIME_UNAVAILABLE",
        "Runtime API is unavailable.",
        true,
      );
    }

    const text = await response.text();
    if (!response.ok) {
      throw parseRuntimeError(text, response.status);
    }
    if (allowEmpty && text.length === 0) return undefined as T;
    try {
      return (text.length === 0 ? undefined : JSON.parse(text)) as T;
    } catch {
      throw new RuntimeClientError(
        "RUNTIME_PROTOCOL_ERROR",
        "Runtime API returned malformed JSON.",
        false,
      );
    }
  }
}

function parseRuntimeError(
  text: string,
  httpStatus: number,
): RuntimeClientError {
  try {
    const parsed = JSON.parse(text) as {
      error?: {
        code?: string;
        message?: string;
        retryable?: boolean;
        details?: unknown;
      };
      message?: string | string[];
    };
    const error = parsed.error;
    if (error?.code !== undefined && error.message !== undefined) {
      return new RuntimeClientError(
        error.code,
        error.message,
        error.retryable ?? false,
        error.details,
        httpStatus,
      );
    }
    const message = Array.isArray(parsed.message)
      ? parsed.message.join("; ")
      : parsed.message;
    return new RuntimeClientError(
      "RUNTIME_PROTOCOL_ERROR",
      message ?? `Runtime API failed with HTTP ${httpStatus}.`,
      false,
      undefined,
      httpStatus,
    );
  } catch {
    return new RuntimeClientError(
      "RUNTIME_PROTOCOL_ERROR",
      `Runtime API failed with HTTP ${httpStatus}.`,
      false,
      undefined,
      httpStatus,
    );
  }
}
