import type {
  BrowserHostIdentity,
  BrowserWindowState,
  BrowserWorkspace,
  BrowserWorkspaceStatus,
  ControlStatus,
  Evidence,
  ObservationPage,
  RuntimeSessionInventory,
  Session,
  StartSessionRequest,
  TaskResultActionPlan,
  Recording,
  StartRecordingRequest,
} from "@rove/protocol";
import { createHash, randomUUID } from "node:crypto";

export interface RuntimeCompanionSnapshot {
  session: Session;
  observationCount: number;
  evidenceCount: number;
  browserOpen: boolean;
}

export interface CompanionRuntimeClientOptions {
  baseUrl: string;
  token?: string;
  sessionId?: string;
  fetchImpl?: typeof fetch;
}

export interface RuntimeConsequentialEffect {
  effectId: string;
  state:
    | "planned"
    | "authorized"
    | "prepared"
    | "applied"
    | "not_applied"
    | "unresolved";
  consequenceKey: string;
  observationId?: string;
  evidenceId?: string;
  taskResultPlan?: TaskResultActionPlan;
}

export interface ExactControlAuthority {
  ownershipGeneration: number;
  handoffId?: string;
  handoffGeneration?: number;
}

export class CompanionRuntimeClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly explicitSessionId: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CompanionRuntimeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.explicitSessionId = options.sessionId;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getActiveSession(): Promise<Session | null> {
    return this.resolveSession();
  }

  startSession(request: StartSessionRequest): Promise<Session> {
    return this.request<Session>("/sessions", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  listSessions(): Promise<Session[]> {
    return this.request<Session[]>("/sessions");
  }

  listSessionInventory(): Promise<RuntimeSessionInventory[]> {
    return this.request<RuntimeSessionInventory[]>("/sessions/inventory");
  }

  recoverSession(sessionId: string): Promise<RuntimeSessionInventory> {
    return this.request<RuntimeSessionInventory>(
      `/sessions/${encodeURIComponent(sessionId)}/recover`,
      { method: "POST" },
    );
  }

  async acknowledgeLegacyEffectScope(sessionId: string): Promise<void> {
    await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/effects/acknowledge-legacy`,
      { method: "POST" },
    );
  }

  authorizeEffectRepetition(
    sessionId: string,
    effectId: string,
    authorizationId = `effect_repeat_${randomUUID()}`,
  ): Promise<{
    effectId: string;
    authorizationId: string;
    authorizedAt: string;
  }> {
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/effects/authorize-repeat`,
      {
        method: "POST",
        body: JSON.stringify({ effectId, authorizationId }),
      },
    );
  }

  consequentialEffect(
    sessionId: string,
    consequenceKey: string,
  ): Promise<RuntimeConsequentialEffect | null> {
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/effects/consequential?consequenceKey=${encodeURIComponent(consequenceKey)}`,
    );
  }

  authorizeTaskResultAction(
    sessionId: string,
    consequenceKey: string,
    materialDigest: string,
    planId: string,
  ): Promise<{
    effectId: string;
    state: "authorized";
    consequenceKey: string;
  }> {
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/effects/authorize-task-result`,
      {
        method: "POST",
        body: JSON.stringify({ consequenceKey, materialDigest, planId }),
      },
    );
  }

  getSession(sessionId: string): Promise<Session> {
    return this.request<Session>(`/sessions/${encodeURIComponent(sessionId)}`);
  }

  startRecording(
    sessionId: string,
    request: StartRecordingRequest,
  ): Promise<Recording> {
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/recordings`,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    );
  }

  stopRecording(sessionId: string, recordingId: string): Promise<Recording> {
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/recordings/${encodeURIComponent(recordingId)}/stop`,
      { method: "POST" },
    );
  }

  listRecordings(sessionId: string): Promise<Recording[]> {
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/recordings`,
    );
  }

  inspect(sessionId: string): Promise<unknown> {
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/browser/inspect`,
    );
  }

  getControlStatus(sessionId: string): Promise<ControlStatus> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/control`);
  }

  acknowledgeDurableHandoff(
    sessionId: string,
    identity: { handoffId: string; handoffGeneration: number },
  ): Promise<ControlStatus> {
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/control/acknowledge-durable-handoff`,
      { method: "POST", body: JSON.stringify(identity) },
    );
  }

  endSession(sessionId: string): Promise<Session> {
    return this.request<Session>(
      `/sessions/${encodeURIComponent(sessionId)}/end`,
      {
        method: "POST",
      },
    );
  }

  async materializeUserFile(input: {
    taskId: string;
    sessionId: string;
    grantId: string;
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<Evidence> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/sessions/${encodeURIComponent(input.sessionId)}/evidence/files`,
      {
        method: "POST",
        headers: {
          ...(this.token === undefined
            ? {}
            : { authorization: `Bearer ${this.token}` }),
          "content-type": input.mimeType,
          "x-rove-file-name": Buffer.from(input.filename, "utf8").toString(
            "base64url",
          ),
          "x-rove-file-source": "user_file_grant",
          "x-rove-grant-id": input.grantId,
          "x-rove-task-id": input.taskId,
        },
        body: Buffer.from(input.bytes),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const text = await response.text();
    if (!response.ok)
      throw new Error(
        `Runtime file materialization failed (${response.status}).`,
      );
    const parsed = JSON.parse(text) as Evidence;
    if (
      parsed.id === undefined ||
      !/^ev_[A-Za-z0-9_-]+$/.test(parsed.id) ||
      parsed.sessionId !== input.sessionId ||
      parsed.type !== "file" ||
      parsed.label !== input.filename ||
      parsed.metadata?.filename !== input.filename ||
      parsed.metadata?.mimeType !== input.mimeType ||
      parsed.metadata?.sizeBytes !== input.bytes.byteLength ||
      parsed.metadata?.sha256 !==
        createHash("sha256").update(input.bytes).digest("hex") ||
      parsed.metadata?.source !== "user_file_grant" ||
      parsed.metadata?.grantId !== input.grantId
    )
      throw new Error("Runtime returned invalid file evidence metadata.");
    return parsed;
  }

  listEvidence(sessionId: string): Promise<Evidence[]> {
    return this.request<Evidence[]>(
      `/sessions/${encodeURIComponent(sessionId)}/evidence`,
    );
  }

  async cleanupUserFileGrant(
    sessionId: string,
    grantId: string,
  ): Promise<void> {
    await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/evidence/files/grants/${encodeURIComponent(grantId)}`,
      { method: "DELETE" },
    );
  }

  getBrowserWorkspaceStatus(): Promise<BrowserWorkspaceStatus> {
    return this.request<BrowserWorkspaceStatus>("/browser-workspaces");
  }

  createBrowserWorkspace(displayName: string): Promise<BrowserWorkspace> {
    return this.request<BrowserWorkspace>("/browser-workspaces", {
      method: "POST",
      body: JSON.stringify({ displayName }),
    });
  }

  selectBrowserWorkspace(workspaceId: string): Promise<BrowserWorkspaceStatus> {
    return this.request<BrowserWorkspaceStatus>(
      `/browser-workspaces/${encodeURIComponent(workspaceId)}/select`,
      { method: "POST" },
    );
  }

  renameBrowserWorkspace(
    workspaceId: string,
    displayName: string,
  ): Promise<BrowserWorkspaceStatus> {
    return this.request<BrowserWorkspaceStatus>(
      `/browser-workspaces/${encodeURIComponent(workspaceId)}`,
      { method: "PATCH", body: JSON.stringify({ displayName }) },
    );
  }

  deleteBrowserWorkspace(workspaceId: string): Promise<BrowserWorkspaceStatus> {
    return this.request<BrowserWorkspaceStatus>(
      `/browser-workspaces/${encodeURIComponent(workspaceId)}`,
      { method: "DELETE" },
    );
  }

  async getBrowserHostIdentity(
    sessionId: string,
  ): Promise<BrowserHostIdentity | null> {
    return this.request<BrowserHostIdentity | null>(
      `/sessions/${encodeURIComponent(sessionId)}/browser/host`,
    );
  }

  async getBrowserWindowState(
    sessionId: string,
    signal: AbortSignal,
  ): Promise<BrowserWindowState | null> {
    return this.request<BrowserWindowState | null>(
      `/sessions/${encodeURIComponent(sessionId)}/browser/window`,
      {
        signal,
      },
    );
  }

  async showBrowserForSession(
    sessionId: string,
    authority: ExactControlAuthority,
  ): Promise<boolean> {
    return this.request<boolean>(
      `/sessions/${encodeURIComponent(sessionId)}/browser/show`,
      { method: "POST", body: JSON.stringify(authority) },
    );
  }

  async getSnapshot(): Promise<RuntimeCompanionSnapshot | null> {
    const session = await this.resolveSession();

    if (session === null) {
      return null;
    }

    const [observationCount, evidence, browserWindow] = await Promise.all([
      this.countObservations(session.id),
      this.request<Evidence[]>(`/sessions/${session.id}/evidence`),
      this.getBrowserWindowState(session.id, AbortSignal.timeout(1_000)).catch(
        () => null,
      ),
    ]);

    return {
      session,
      observationCount,
      evidenceCount: evidence.length,
      browserOpen: browserWindow !== null,
    };
  }

  async takeControlForSession(
    sessionId: string,
    authority: ExactControlAuthority,
  ): Promise<RuntimeCompanionSnapshot> {
    await this.request(`/sessions/${sessionId}/control/take`, {
      method: "POST",
      body: JSON.stringify(authority),
    });
    return this.getSnapshotForSession(sessionId);
  }

  async returnControlForSession(
    sessionId: string,
    authority: ExactControlAuthority,
  ): Promise<RuntimeCompanionSnapshot> {
    const returned = await this.request<ControlStatus>(
      `/sessions/${encodeURIComponent(sessionId)}/control/return`,
      {
        method: "POST",
        body: JSON.stringify(authority),
      },
    );
    if (returned.sessionId !== sessionId)
      throw new Error("Runtime returned a mismatched control session.");
    const session = await this.getSession(sessionId);
    const [observationCount, evidence, browserWindow] = await Promise.all([
      this.countObservations(sessionId),
      this.request<Evidence[]>(
        `/sessions/${encodeURIComponent(sessionId)}/evidence`,
      ),
      this.getBrowserWindowState(sessionId, AbortSignal.timeout(1_000)).catch(
        () => null,
      ),
    ]);
    return {
      session,
      observationCount,
      evidenceCount: evidence.length,
      browserOpen: browserWindow !== null,
    };
  }

  async pauseSessionForSession(
    sessionId: string,
    authority: ExactControlAuthority,
  ): Promise<RuntimeCompanionSnapshot> {
    await this.request(`/sessions/${sessionId}/control/pause`, {
      method: "POST",
      body: JSON.stringify(authority),
    });
    return this.getSnapshotForSession(sessionId);
  }

  private async resolveSession(): Promise<Session | null> {
    if (this.explicitSessionId !== undefined) {
      return this.request<Session>(
        `/sessions/${encodeURIComponent(this.explicitSessionId)}`,
      );
    }

    const [agentSessions, companionSessions, captureSessions] =
      await Promise.all([
        this.request<Session[]>("/sessions?mode=agent"),
        this.request<Session[]>("/sessions?mode=companion"),
        this.request<Session[]>("/sessions?mode=capture"),
      ]);

    const sessions = [
      ...agentSessions,
      ...companionSessions,
      ...captureSessions,
    ].filter((entry) => !["completed", "failed"].includes(entry.status));

    if (sessions.length === 0) {
      return null;
    }

    return [...sessions].sort((left, right) => {
      const leftHuman =
        left.controller === "human" || left.status === "awaiting_human" ? 1 : 0;
      const rightHuman =
        right.controller === "human" || right.status === "awaiting_human"
          ? 1
          : 0;
      return (
        rightHuman - leftHuman ||
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
      );
    })[0]!;
  }

  private async getSnapshotForSession(
    sessionId: string,
  ): Promise<RuntimeCompanionSnapshot> {
    const session = await this.getSession(sessionId);
    const [observationCount, evidence, browserWindow] = await Promise.all([
      this.countObservations(sessionId),
      this.request<Evidence[]>(
        `/sessions/${encodeURIComponent(sessionId)}/evidence`,
      ),
      this.getBrowserWindowState(sessionId, AbortSignal.timeout(1_000)).catch(
        () => null,
      ),
    ]);
    return {
      session,
      observationCount,
      evidenceCount: evidence.length,
      browserOpen: browserWindow !== null,
    };
  }

  private async countObservations(sessionId: string): Promise<number> {
    let afterSeq = 0;
    let total = 0;

    while (true) {
      const page = await this.request<ObservationPage>(
        `/sessions/${sessionId}/observations?afterSeq=${afterSeq}&limit=1000`,
      );

      total += page.items.length;

      if (page.items.length < 1000) {
        return total;
      }

      const nextSeq = page.items.at(-1)?.seq;

      if (nextSeq === undefined || nextSeq <= afterSeq) {
        return total;
      }

      afterSeq = nextSeq;
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);

    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    if (this.token !== undefined) {
      headers.set("authorization", `Bearer ${this.token}`);
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      let detail = response.statusText;

      try {
        const body = (await response.json()) as {
          error?: {
            code?: string;
            message?: string;
          };
          message?: string;
        };

        detail =
          body.error?.code ?? body.error?.message ?? body.message ?? detail;
      } catch {
        // Response body is optional for transport failures.
      }

      throw new Error(
        `Rove runtime request failed (${response.status}): ${detail}`,
      );
    }

    return (await response.json()) as T;
  }
}
