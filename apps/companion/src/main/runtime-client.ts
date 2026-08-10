import type {
  Evidence,
  ObservationPage,
  Session,
} from "@rove/protocol";

import type { CompanionSnapshot } from "../shared/desktop-api.js";

export interface CompanionRuntimeClientOptions {
  baseUrl: string;
  token?: string;
  sessionId?: string;
  fetchImpl?: typeof fetch;
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

  async getSnapshot(): Promise<CompanionSnapshot | null> {
    const session = await this.resolveSession();

    if (session === null) {
      return null;
    }

    const [observationCount, evidence] = await Promise.all([
      this.countObservations(session.id),
      this.request<Evidence[]>(
        `/sessions/${session.id}/evidence`,
      ),
    ]);

    return {
      session,
      observationCount,
      evidenceCount: evidence.length,
    };
  }

  async takeControl(): Promise<CompanionSnapshot | null> {
    const sessionId = await this.requireSessionId();

    await this.request(
      `/sessions/${sessionId}/control/take`,
      {
        method: "POST",
      },
    );

    return this.getSnapshot();
  }

  async returnControl(): Promise<CompanionSnapshot | null> {
    const sessionId = await this.requireSessionId();

    await this.request(
      `/sessions/${sessionId}/control/return`,
      {
        method: "POST",
      },
    );

    return this.getSnapshot();
  }

  async finishSession(): Promise<CompanionSnapshot | null> {
    const sessionId = await this.requireSessionId();

    await this.request(
      `/sessions/${sessionId}/end`,
      {
        method: "POST",
      },
    );

    return this.getSnapshot();
  }

  private async resolveSession(): Promise<Session | null> {
    if (this.explicitSessionId !== undefined) {
      return this.request<Session>(
        `/sessions/${encodeURIComponent(this.explicitSessionId)}`,
      );
    }

    const sessions = await this.request<Session[]>(
      "/sessions?mode=companion",
    );

    if (sessions.length === 0) {
      return null;
    }

    return [...sessions].sort(
      (left, right) =>
        Date.parse(right.createdAt) -
        Date.parse(left.createdAt),
    )[0]!;
  }

  private async requireSessionId(): Promise<string> {
    const session = await this.resolveSession();

    if (session === null) {
      throw new Error(
        "No active Companion Mode session is available.",
      );
    }

    return session.id;
  }

  private async countObservations(
    sessionId: string,
  ): Promise<number> {
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

      if (
        nextSeq === undefined ||
        nextSeq <= afterSeq
      ) {
        return total;
      }

      afterSeq = nextSeq;
    }
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);

    if (
      init.body !== undefined &&
      !headers.has("content-type")
    ) {
      headers.set("content-type", "application/json");
    }

    if (this.token !== undefined) {
      headers.set(
        "authorization",
        `Bearer ${this.token}`,
      );
    }

    const response = await this.fetchImpl(
      `${this.baseUrl}${path}`,
      {
        ...init,
        headers,
      },
    );

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
          body.error?.code ??
          body.error?.message ??
          body.message ??
          detail;
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
