import type {
  ObservationPage,
  ObservationQuery,
  RoveRuntime,
  SessionSnapshot,
  StartSessionRequest,
} from "@rove/protocol";

export class RuntimeHttpClient implements Pick<RoveRuntime, "startSession" | "getSession" | "endSession" | "getObservations"> {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
  ) {}

  startSession(request: StartSessionRequest): Promise<SessionSnapshot> {
    return this.request("POST", "/sessions", request);
  }

  getSession(sessionId: string): Promise<SessionSnapshot> {
    return this.request("GET", `/sessions/${encodeURIComponent(sessionId)}`);
  }

  endSession(sessionId: string): Promise<SessionSnapshot> {
    return this.request("POST", `/sessions/${encodeURIComponent(sessionId)}/end`);
  }

  getObservations(sessionId: string, query?: ObservationQuery): Promise<ObservationPage> {
    const search = new URLSearchParams();
    if (query?.afterSeq !== undefined) search.set("afterSeq", String(query.afterSeq));
    if (query?.limit !== undefined) search.set("limit", String(query.limit));
    const suffix = search.size === 0 ? "" : `?${search.toString()}`;
    return this.request("GET", `/sessions/${encodeURIComponent(sessionId)}/observations${suffix}`);
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Runtime request failed with HTTP ${response.status}.`);
    return (await response.json()) as T;
  }
}
