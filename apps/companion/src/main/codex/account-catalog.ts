import type {
  CodexRpcPort,
  CodexServerEvent,
  GetAccountRateLimitsResponse,
  GetAccountTokenUsageResponse,
  LoginAccountResponse,
  ModelListResponse,
  RateLimitSnapshot,
} from "./protocol.js";
import { parseCodexServerEvent } from "./protocol.js";

export interface CodexAccountProjection {
  status: "unavailable" | "logged_out" | "logged_in";
  authMode?: "apiKey" | "chatgpt" | "amazonBedrock";
  planType?: string;
  requiresOpenaiAuth?: boolean;
  error?: string;
}
export interface CodexModelProjection {
  id: string;
  model: string;
  displayName: string;
  description: string;
  efforts: readonly string[];
  defaultEffort: string;
  isDefault: boolean;
  inputModalities: readonly string[];
  supportsPersonality: boolean;
  defaultServiceTier: string | null;
}
export interface RateLimitProjection {
  limitId: string | null;
  limitName: string | null;
  usedPercent: number | null;
  resetsAt: number | null;
  windowDurationMins: number | null;
  planType: string | null;
}
export interface UsageProjection {
  summary: Readonly<Record<string, number | string | null>>;
  dailyUsageBuckets:
    readonly { startDate: string; tokens: number | string }[] | null;
}
export interface CodexCatalogSnapshot {
  account: CodexAccountProjection;
  /** A bounded renderer-safe projection of an App Server login in progress. */
  login?: LoginProjection;
  models: readonly CodexModelProjection[];
  rateLimits: readonly RateLimitProjection[] | null;
  usage: UsageProjection | null;
  refreshedAt: string;
}
export type LoginProjection =
  | { type: "chatgpt"; loginId: string }
  | {
      type: "chatgptDeviceCode";
      loginId: string;
      userCode: string;
    };
type ActiveLogin =
  | (Extract<LoginProjection, { type: "chatgpt" }> & { authUrl: string })
  | (Extract<LoginProjection, { type: "chatgptDeviceCode" }> & {
      verificationUrl: string;
    });

export interface CodexAccountCatalogPort {
  snapshot(): CodexCatalogSnapshot;
  trustedLoginUrl(loginId: string): string;
  refresh(refreshToken?: boolean): Promise<CodexCatalogSnapshot>;
  refreshManagedToken(): Promise<CodexCatalogSnapshot>;
  login(type: "chatgpt" | "deviceCode"): Promise<LoginProjection>;
  cancelLogin(loginId: string): Promise<{ status: string }>;
  logout(): Promise<void>;
}

const MAX_MODELS = 100;
const MAX_MODEL_EFFORTS = 16;
const MAX_MODEL_MODALITIES = 8;
const MAX_RATE_LIMITS = 64;
const MAX_USAGE_SUMMARY_FIELDS = 32;
const MAX_USAGE_BUCKETS = 90;
const LOGIN_FAILURE_MESSAGE =
  "Rove sign-in did not complete. Try again or use device code.";
const bounded = (value: string, maximum = 500) => value.slice(0, maximum);
const exactOpaque = (value: string, maximum: number, label: string) => {
  if (value.length === 0 || value.length > maximum)
    throw new Error(`Invalid ${label}.`);
  return value;
};
const exactHttpsUrl = (value: string, label: string) => {
  const exact = exactOpaque(value, 8_192, label);
  let parsed: URL;
  try {
    parsed = new URL(exact);
  } catch {
    throw new Error(`Invalid ${label}.`);
  }
  if (parsed.protocol !== "https:") throw new Error(`Invalid ${label}.`);
  return exact;
};

function projectAccount(
  value: Awaited<ReturnType<CodexRpcPort["request"]>>,
): CodexAccountProjection {
  const result = value as {
    account: { type: string; planType?: string } | null;
    requiresOpenaiAuth: boolean;
  };
  if (result.account === null)
    return {
      status: "logged_out",
      requiresOpenaiAuth: result.requiresOpenaiAuth,
    };
  const authMode = result.account.type;
  if (
    authMode !== "apiKey" &&
    authMode !== "chatgpt" &&
    authMode !== "amazonBedrock"
  )
    throw new Error("Unsupported Codex account mode.");
  return {
    status: "logged_in",
    authMode,
    ...(typeof result.account.planType === "string"
      ? { planType: bounded(result.account.planType, 80) }
      : {}),
    requiresOpenaiAuth: result.requiresOpenaiAuth,
  };
}
function projectModels(value: ModelListResponse): CodexModelProjection[] {
  return value.data
    .filter((model) => !model.hidden)
    .slice(0, MAX_MODELS)
    .map((model) => ({
      id: exactOpaque(model.id, 256, "model id"),
      model: exactOpaque(model.model, 256, "model value"),
      displayName: bounded(model.displayName, 120),
      description: bounded(model.description),
      efforts: model.supportedReasoningEfforts
        .map((entry) => entry.reasoningEffort)
        .slice(0, MAX_MODEL_EFFORTS)
        .map((entry) => exactOpaque(entry, 128, "reasoning effort")),
      defaultEffort: exactOpaque(
        model.defaultReasoningEffort,
        128,
        "default reasoning effort",
      ),
      isDefault: model.isDefault,
      inputModalities: model.inputModalities
        .slice(0, MAX_MODEL_MODALITIES)
        .map((entry) => exactOpaque(entry, 128, "input modality")),
      supportsPersonality: model.supportsPersonality,
      defaultServiceTier:
        model.defaultServiceTier === null
          ? null
          : exactOpaque(model.defaultServiceTier, 128, "service tier"),
    }));
}
function projectLimit(limit: RateLimitSnapshot): RateLimitProjection {
  const window = limit.primary ?? limit.secondary;
  return {
    limitId:
      limit.limitId === null
        ? null
        : exactOpaque(limit.limitId, 256, "rate limit id"),
    limitName: limit.limitName === null ? null : bounded(limit.limitName, 120),
    usedPercent: window?.usedPercent ?? null,
    resetsAt: window?.resetsAt ?? null,
    windowDurationMins: window?.windowDurationMins ?? null,
    planType: limit.planType === null ? null : bounded(limit.planType, 80),
  };
}
function projectLimits(
  value: GetAccountRateLimitsResponse,
): RateLimitProjection[] {
  const byId = value.rateLimitsByLimitId;
  return byId === null
    ? [projectLimit(value.rateLimits)]
    : Object.values(byId).slice(0, MAX_RATE_LIMITS).map(projectLimit);
}
function projectUsage(value: GetAccountTokenUsageResponse): UsageProjection {
  const buckets =
    value.dailyUsageBuckets
      ?.flatMap((raw) => {
        if (raw === null || typeof raw !== "object" || Array.isArray(raw))
          return [];
        const item = raw as Record<string, unknown>;
        return typeof item.startDate === "string" &&
          (typeof item.tokens === "number" || typeof item.tokens === "string")
          ? [
              {
                startDate: bounded(item.startDate, 40),
                tokens:
                  typeof item.tokens === "string"
                    ? bounded(item.tokens, 80)
                    : item.tokens,
              },
            ]
          : [];
      })
      .slice(0, MAX_USAGE_BUCKETS) ?? null;
  const summary = Object.fromEntries(
    Object.entries(value.summary)
      .slice(0, MAX_USAGE_SUMMARY_FIELDS)
      .map(([key, item]) => [
        bounded(key, 80),
        typeof item === "string" ? bounded(item, 80) : item,
      ]),
  );
  return { summary, dailyUsageBuckets: buckets };
}
function projectLogin(value: LoginAccountResponse): ActiveLogin {
  return value.type === "chatgpt"
    ? {
        type: value.type,
        loginId: exactOpaque(value.loginId, 256, "login id"),
        authUrl: exactHttpsUrl(value.authUrl, "login URL"),
      }
    : {
        type: value.type,
        loginId: exactOpaque(value.loginId, 256, "login id"),
        verificationUrl: exactHttpsUrl(
          value.verificationUrl,
          "verification URL",
        ),
        userCode: bounded(value.userCode, 80),
      };
}
function rendererLogin(value: ActiveLogin): LoginProjection {
  return value.type === "chatgpt"
    ? { type: value.type, loginId: value.loginId }
    : { type: value.type, loginId: value.loginId, userCode: value.userCode };
}

interface AccountLoginCompletion {
  loginId: string | null;
  success: boolean;
  error: string | null;
  onboardingEntrypoint: "life_sciences" | null;
}

function accountLoginCompletion(
  event: CodexServerEvent,
): AccountLoginCompletion {
  const parsed = parseCodexServerEvent(event.method, event.params);
  if (parsed?.method !== "account/login/completed") {
    throw new Error("Invalid account login completion event.");
  }
  return parsed.params as unknown as AccountLoginCompletion;
}

export class CodexAccountCatalogService implements CodexAccountCatalogPort {
  private snapshotValue: CodexCatalogSnapshot = {
    account: { status: "unavailable" },
    models: [],
    rateLimits: null,
    usage: null,
    refreshedAt: new Date(0).toISOString(),
  };
  private unsubscribe: (() => void) | undefined;
  private refreshGeneration = 0;
  private mutationGeneration = 0;
  private activeLoginId: string | undefined;
  private activeLogin: ActiveLogin | undefined;
  private loginError: string | undefined;

  constructor(
    private readonly rpc: CodexRpcPort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}
  start(): void {
    this.unsubscribe ??= this.rpc.onEvent((event) => this.onEvent(event));
  }
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
  snapshot(): CodexCatalogSnapshot {
    return structuredClone(this.snapshotValue);
  }
  trustedLoginUrl(loginId: string): string {
    if (this.activeLoginId !== loginId || this.activeLogin === undefined)
      throw new Error("Stale or unknown Codex login URL.");
    return this.activeLogin.type === "chatgpt"
      ? this.activeLogin.authUrl
      : this.activeLogin.verificationUrl;
  }

  async refresh(refreshToken = false): Promise<CodexCatalogSnapshot> {
    const generation = ++this.refreshGeneration;
    const results = await Promise.allSettled([
      this.rpc.request("account/read", { refreshToken }),
      this.rpc.request("model/list", { includeHidden: true, limit: 100 }),
      this.rpc.request("account/rateLimits/read", undefined),
      this.rpc.request("account/usage/read", undefined),
    ]);
    if (generation !== this.refreshGeneration) return this.snapshot();
    const [account, models, limits, usage] = results;
    const projectedAccount: CodexAccountProjection =
      account?.status === "fulfilled"
        ? projectAccount(account.value)
        : {
            status: "unavailable",
            error:
              account?.reason instanceof Error
                ? bounded(account.reason.message)
                : "Unavailable",
          };
    if (projectedAccount.status === "logged_in") this.loginError = undefined;
    this.snapshotValue = {
      account:
        this.loginError === undefined || projectedAccount.status === "logged_in"
          ? projectedAccount
          : { ...projectedAccount, error: this.loginError },
      models: models?.status === "fulfilled" ? projectModels(models.value) : [],
      rateLimits:
        limits?.status === "fulfilled" ? projectLimits(limits.value) : null,
      usage: usage?.status === "fulfilled" ? projectUsage(usage.value) : null,
      ...(this.activeLogin === undefined
        ? {}
        : { login: rendererLogin(this.activeLogin) }),
      refreshedAt: bounded(this.now(), 40),
    };
    return this.snapshot();
  }
  refreshManagedToken(): Promise<CodexCatalogSnapshot> {
    return this.refresh(true);
  }
  async login(type: "chatgpt" | "deviceCode"): Promise<LoginProjection> {
    const generation = ++this.mutationGeneration;
    const projected = projectLogin(
      await this.rpc.request(
        "account/login/start",
        type === "deviceCode"
          ? { type: "chatgptDeviceCode" }
          : {
              type: "chatgpt",
              useHostedLoginSuccessPage: true,
              appBrand: "chatgpt",
            },
      ),
    );
    if (generation !== this.mutationGeneration)
      throw new Error("Superseded Codex login operation.");
    this.activeLoginId = projected.loginId;
    this.activeLogin = projected;
    this.loginError = undefined;
    const renderer = rendererLogin(projected);
    this.snapshotValue = { ...this.snapshotValue, login: renderer };
    return renderer;
  }
  async cancelLogin(loginId: string): Promise<{ status: string }> {
    if (this.activeLoginId !== loginId)
      throw new Error("Stale or unknown Codex login.");
    const generation = ++this.mutationGeneration;
    const result = await this.rpc.request("account/login/cancel", { loginId });
    if (
      generation !== this.mutationGeneration ||
      this.activeLoginId !== loginId
    ) {
      throw new Error("Superseded Codex login cancellation.");
    }
    ++this.mutationGeneration;
    this.activeLoginId = undefined;
    this.activeLogin = undefined;
    this.loginError = undefined;
    const snapshot = { ...this.snapshotValue };
    delete snapshot.login;
    this.snapshotValue = snapshot;
    return { status: result.status };
  }
  async logout(): Promise<void> {
    ++this.mutationGeneration;
    ++this.refreshGeneration;
    this.activeLoginId = undefined;
    this.activeLogin = undefined;
    this.loginError = undefined;
    await this.rpc.request("account/logout", undefined);
    ++this.mutationGeneration;
    ++this.refreshGeneration;
    this.snapshotValue = {
      account: { status: "logged_out" },
      models: [],
      rateLimits: null,
      usage: null,
      refreshedAt: bounded(this.now(), 40),
    };
  }
  private onEvent(event: CodexServerEvent): void {
    if (event.method === "account/login/completed") {
      const completion = accountLoginCompletion(event);
      if (
        completion.loginId !== null &&
        completion.loginId === this.activeLoginId
      ) {
        this.activeLoginId = undefined;
        this.activeLogin = undefined;
        this.loginError = completion.success
          ? undefined
          : bounded(LOGIN_FAILURE_MESSAGE, 160);
        const snapshot = { ...this.snapshotValue };
        delete snapshot.login;
        snapshot.account =
          this.loginError === undefined
            ? snapshot.account
            : {
                ...snapshot.account,
                status: "logged_out",
                error: this.loginError,
              };
        this.snapshotValue = snapshot;
      }
    }
    if (
      event.method === "account/updated" ||
      event.method === "account/login/completed" ||
      event.method === "account/rateLimits/updated"
    )
      void this.refresh();
  }
}
