import { hubCommandResultSchema } from "@rove/protocol";
import type {
  ActionResult,
  ControlStatus,
  ControlWaitRequest,
  ControlWaitResult,
  Evidence,
  EvidenceReadResult,
  HubCommandResult,
  HubOperation,
  InspectOptions,
  NavigateRequest,
  ObservationPage,
  ObservationQuery,
  PageInspection,
  PressRequest,
  ScreenshotOptions,
  SessionSnapshot,
  StartSessionRequest,
  TargetReference,
  TypeRequest,
} from "@rove/protocol";

import { RuntimeClientError } from "./runtime-client.error.js";
import type {
  RuntimeClient,
  SaveRecordInput,
  ScrollInput,
} from "./runtime-client.types.js";

export interface ControlPlaneRuntimeClientOptions {
  controlPlaneUrl: string;
  deviceId: string;
  serviceToken: string;
}

export class ControlPlaneRuntimeClient implements RuntimeClient {
  private readonly controlPlaneUrl: URL;

  constructor(private readonly options: ControlPlaneRuntimeClientOptions) {
    this.controlPlaneUrl = new URL(options.controlPlaneUrl);
  }

  async healthCheck(timeoutMs = 10_000): Promise<void> {
    await this.call("runtime.health", {}, timeoutMs);
  }

  startSession(input: StartSessionRequest): Promise<SessionSnapshot> {
    return this.call("session.start", input);
  }

  getSession(sessionId: string): Promise<SessionSnapshot> {
    return this.call("session.status", { sessionId });
  }

  endSession(sessionId: string): Promise<SessionSnapshot> {
    return this.call("session.end", { sessionId });
  }

  getObservations(sessionId: string, input: ObservationQuery): Promise<ObservationPage> {
    return this.call("session.observations", { sessionId, input });
  }

  navigate(sessionId: string, input: NavigateRequest): Promise<ActionResult> {
    return this.call("browser.navigate", { sessionId, input });
  }

  inspect(sessionId: string, input: InspectOptions): Promise<PageInspection> {
    return this.call("browser.inspect", { sessionId, input });
  }

  click(sessionId: string, input: { target: TargetReference }): Promise<ActionResult> {
    return this.call("browser.click", { sessionId, input });
  }

  type(sessionId: string, input: TypeRequest): Promise<ActionResult> {
    return this.call("browser.type", { sessionId, input });
  }

  press(sessionId: string, input: PressRequest): Promise<ActionResult> {
    return this.call("browser.press", { sessionId, input });
  }

  scroll(sessionId: string, input: ScrollInput): Promise<ActionResult> {
    return this.call("browser.scroll", { sessionId, input });
  }

  back(sessionId: string): Promise<ActionResult> {
    return this.call("browser.back", { sessionId });
  }

  forward(sessionId: string): Promise<ActionResult> {
    return this.call("browser.forward", { sessionId });
  }

  screenshot(sessionId: string, input: ScreenshotOptions): Promise<Evidence> {
    return this.call("browser.screenshot", { sessionId, input });
  }

  saveRecord(sessionId: string, input: SaveRecordInput): Promise<Evidence> {
    return this.call("evidence.save_record", { sessionId, input });
  }

  listEvidence(sessionId: string): Promise<Evidence[]> {
    return this.call("evidence.list", { sessionId });
  }

  readEvidence(sessionId: string, evidenceId: string): Promise<EvidenceReadResult> {
    return this.call("evidence.read", { sessionId, evidenceId });
  }

  getControlStatus(sessionId: string): Promise<ControlStatus> {
    return this.call("control.status", { sessionId });
  }

  requestHuman(sessionId: string, reason: string): Promise<ControlStatus> {
    return this.call("control.request_human", { sessionId, reason });
  }

  waitForControl(
    sessionId: string,
    input: ControlWaitRequest,
    signal?: AbortSignal,
  ): Promise<ControlWaitResult> {
    const timeoutMs = (input.timeoutMs ?? 30_000) + 10_000;
    return this.call("control.wait", { sessionId, input }, timeoutMs, signal);
  }

  private async call<T>(
    operation: HubOperation,
    payload: unknown,
    timeoutMs = 40_000,
    signal?: AbortSignal,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(
        new URL(
          `/v1/devices/${encodeURIComponent(this.options.deviceId)}/commands`,
          this.controlPlaneUrl,
        ),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.options.serviceToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ operation, payload, timeoutMs: Math.min(timeoutMs - 1_000, 300_000) }),
          signal:
            signal === undefined
              ? AbortSignal.timeout(timeoutMs)
              : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        },
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new RuntimeClientError("CONTROL_PLANE_TIMEOUT", "Control-plane command timed out.", true);
      }
      throw new RuntimeClientError("CONTROL_PLANE_UNAVAILABLE", "Control plane is unavailable.", true);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new RuntimeClientError("CONTROL_PLANE_PROTOCOL_ERROR", `Control plane failed with HTTP ${response.status}.`, response.status >= 500);
    }

    let result: HubCommandResult;
    try {
      result = hubCommandResultSchema.parse(JSON.parse(text));
    } catch {
      throw new RuntimeClientError("CONTROL_PLANE_PROTOCOL_ERROR", "Control plane returned malformed JSON.", false);
    }
    if (!result.ok) {
      throw new RuntimeClientError(
        result.error.code,
        result.error.message,
        result.error.retryable,
        result.error.details,
      );
    }
    return result.result as T;
  }
}
