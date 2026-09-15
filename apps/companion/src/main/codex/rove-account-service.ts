import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createClient,
  type Session,
  type SupabaseClient,
  type SupportedStorage,
} from "@supabase/supabase-js";

import {
  invalidProviderResponse,
  providerFailure,
  validateSupabaseRpcResponse,
} from "./supabase-workflow-provider.js";

export interface RoveAccountConfiguration {
  url: string;
  publishableKey: string;
  redirectUrl: string;
}

export type RoveAccountSnapshot =
  | { status: "unconfigured"; syncAvailable: false }
  | {
      status: "signed_out";
      syncAvailable: true;
      sessionPersistence: "encrypted" | "memory_only";
    }
  | {
      status: "email_code_sent";
      syncAvailable: true;
      email: string;
      sessionPersistence: "encrypted" | "memory_only";
    }
  | {
      status: "signed_in";
      syncAvailable: true;
      ownerId: string;
      email: string | null;
      sessionPersistence: "encrypted" | "memory_only";
    }
  | {
      status: "error";
      syncAvailable: true;
      message: string;
      sessionPersistence: "encrypted" | "memory_only";
    };

export interface SessionCipher {
  available(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

export class InvalidCloudAuthStorageError extends Error {
  constructor() {
    super("Rove could not read its encrypted account session.");
    this.name = "InvalidCloudAuthStorageError";
  }
}

export class EncryptedFileAuthStorage implements SupportedStorage {
  private readonly memory = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();
  readonly persistence: "encrypted" | "memory_only";

  constructor(
    private readonly path: string,
    private readonly cipher: SessionCipher,
  ) {
    this.persistence = cipher.available() ? "encrypted" : "memory_only";
  }

  private async contents(): Promise<Record<string, string>> {
    if (this.persistence === "memory_only")
      return Object.fromEntries(this.memory);
    try {
      const encrypted = await readFile(this.path);
      const parsed = JSON.parse(this.cipher.decrypt(encrypted)) as unknown;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed) ||
        Object.values(parsed).some((value) => typeof value !== "string")
      )
        throw new Error("invalid session storage");
      return parsed as Record<string, string>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new InvalidCloudAuthStorageError();
    }
  }

  private async save(values: Record<string, string>): Promise<void> {
    if (this.persistence === "memory_only") {
      this.memory.clear();
      Object.entries(values).forEach(([key, value]) =>
        this.memory.set(key, value),
      );
      return;
    }
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, this.cipher.encrypt(JSON.stringify(values)), {
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async getItem(key: string): Promise<string | null> {
    return this.serialized(async () => (await this.contents())[key] ?? null);
  }
  async setItem(key: string, value: string): Promise<void> {
    await this.serialized(async () =>
      this.save({ ...(await this.contents()), [key]: value }),
    );
  }
  async removeItem(key: string): Promise<void> {
    await this.serialized(async () => {
      if (this.persistence === "memory_only") {
        this.memory.delete(key);
        return;
      }
      const values = await this.contents();
      delete values[key];
      if (Object.keys(values).length === 0) {
        await unlink(this.path).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
        return;
      }
      await this.save(values);
    });
  }

  async clearInvalidState(): Promise<void> {
    await this.serialized(async () => {
      this.memory.clear();
      if (this.persistence === "encrypted")
        await unlink(this.path).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
    });
  }
}

export class RoveAccountService {
  readonly client: SupabaseClient | null;
  private snapshotValue: RoveAccountSnapshot;
  private pendingEmail: string | null = null;
  private readonly redirectUrl: string | null;
  private authEpochValue = 0;

  constructor(
    configuration: RoveAccountConfiguration | null,
    private readonly storage: EncryptedFileAuthStorage,
    private readonly onChanged: () => Promise<void> | void = () => undefined,
    clientOverride?: SupabaseClient,
  ) {
    this.redirectUrl = configuration?.redirectUrl ?? null;
    this.client =
      configuration === null
        ? null
        : (clientOverride ??
          createClient(configuration.url, configuration.publishableKey, {
            auth: {
              flowType: "pkce",
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: false,
              storage,
            },
          }));
    this.snapshotValue =
      this.client === null
        ? { status: "unconfigured", syncAvailable: false }
        : {
            status: "signed_out",
            syncAvailable: true,
            sessionPersistence: storage.persistence,
          };
    this.client?.auth.onAuthStateChange((_event, session) => {
      this.applySession(session);
    });
  }

  private applySession(session: Session | null): void {
    this.authEpochValue += 1;
    const activeSession =
      session?.user &&
      typeof session.expires_at === "number" &&
      session.expires_at > Math.floor(Date.now() / 1000)
        ? session
        : null;
    this.snapshotValue = activeSession
      ? {
          status: "signed_in",
          syncAvailable: true,
          ownerId: `owner_${activeSession.user.id.replaceAll("-", "")}`,
          email: activeSession.user.email ?? null,
          sessionPersistence: this.storage.persistence,
        }
      : {
          status: "signed_out",
          syncAvailable: true,
          sessionPersistence: this.storage.persistence,
        };
    void this.onChanged();
  }

  async start(): Promise<void> {
    if (!this.client) return;
    try {
      const { data, error } = await this.client.auth.getSession();
      if (error) this.recordError(error.message);
      else this.applySession(data.session);
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      if (error instanceof InvalidCloudAuthStorageError) {
        try {
          await this.storage.clearInvalidState();
        } catch {
          message = `${message} Invalid cloud-auth state could not be cleared.`;
        }
      }
      this.recordError(message);
    }
  }

  snapshot(): RoveAccountSnapshot {
    return this.snapshotValue;
  }
  ownerId(): string | null {
    return this.snapshotValue.status === "signed_in"
      ? this.snapshotValue.ownerId
      : null;
  }
  authEpoch(): number {
    return this.authEpochValue;
  }

  private required(): SupabaseClient {
    if (!this.client)
      throw new Error("Workflow sync is not configured on this build.");
    return this.client;
  }

  private recordError(message: string): void {
    this.authEpochValue += 1;
    this.snapshotValue = {
      status: "error",
      syncAvailable: true,
      message,
      sessionPersistence: this.storage.persistence,
    };
    void this.onChanged();
  }

  private fail(message: string): never {
    this.recordError(message);
    throw new Error(message);
  }

  private failProvider(error: Error): never {
    this.recordError(error.message);
    throw error;
  }

  async sendEmailCode(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ||
      normalized.length > 254
    )
      throw new Error("Enter a valid email address.");
    const { error } = await this.required().auth.signInWithOtp({
      email: normalized,
      options: { shouldCreateUser: true },
    });
    if (error) this.fail(error.message);
    this.pendingEmail = normalized;
    this.snapshotValue = {
      status: "email_code_sent",
      syncAvailable: true,
      email: normalized,
      sessionPersistence: this.storage.persistence,
    };
    await this.onChanged();
  }

  async verifyEmailCode(code: string): Promise<void> {
    if (!this.pendingEmail) throw new Error("Request a new email code first.");
    if (!/^\d{6}$/.test(code))
      throw new Error("Enter the six-digit email code.");
    const { data, error } = await this.required().auth.verifyOtp({
      email: this.pendingEmail,
      token: code,
      type: "email",
    });
    if (error) this.fail(error.message);
    this.pendingEmail = null;
    this.applySession(data.session);
  }

  async googleAuthorizationUrl(): Promise<string> {
    const { data, error } = await this.required().auth.signInWithOAuth({
      provider: "google",
      options: {
        skipBrowserRedirect: true,
        ...(this.redirectUrl ? { redirectTo: this.redirectUrl } : {}),
      },
    });
    if (error || !data.url)
      this.fail(
        error?.message ?? "Google sign-in did not return an authorization URL.",
      );
    await this.storage.setItem("rove.oauth.pending", "1");
    return data.url;
  }

  async acceptOAuthCallback(callbackUrl: string): Promise<void> {
    if ((await this.storage.getItem("rove.oauth.pending")) !== "1")
      throw new Error("Rove rejected an unsolicited sign-in callback.");
    const url = new URL(callbackUrl);
    if (
      url.protocol !== "rove:" ||
      url.hostname !== "auth" ||
      url.pathname !== "/callback"
    )
      throw new Error("Rove rejected an invalid sign-in callback.");
    const code = url.searchParams.get("code");
    if (!code)
      throw new Error(
        "The sign-in callback did not include an authorization code.",
      );
    const { data, error } =
      await this.required().auth.exchangeCodeForSession(code);
    if (error) this.fail(error.message);
    await this.storage.removeItem("rove.oauth.pending");
    this.applySession(data.session);
  }

  async signOut(): Promise<void> {
    const { error } = await this.required().auth.signOut({ scope: "local" });
    if (error) this.fail(error.message);
    this.pendingEmail = null;
    await this.storage.removeItem("rove.oauth.pending");
    this.applySession(null);
  }

  async deleteCloudAccount(): Promise<void> {
    let response;
    try {
      response = validateSupabaseRpcResponse(
        await this.required().rpc("rove_delete_account"),
        "account deletion",
      );
    } catch (error) {
      this.failProvider(providerFailure(error, true));
    }
    if (response.error)
      this.failProvider(providerFailure(response.error, true));
    if (response.data !== null)
      this.failProvider(
        invalidProviderResponse(
          "Supabase account deletion returned an invalid result.",
        ),
      );
    await this.required().auth.signOut({ scope: "local" });
    this.pendingEmail = null;
    this.applySession(null);
  }
}

export function restoreRoveAccountSessionInBackground(
  account: RoveAccountService,
): void {
  void account.start();
}

export function readRoveAccountConfiguration(
  environment: NodeJS.ProcessEnv,
): RoveAccountConfiguration | null {
  const url = environment.ROVE_SUPABASE_URL?.trim();
  const publishableKey = environment.ROVE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url && !publishableKey) return null;
  if (!url || !publishableKey)
    throw new Error(
      "Rove Workflow sync requires both ROVE_SUPABASE_URL and ROVE_SUPABASE_PUBLISHABLE_KEY.",
    );
  const parsed = new URL(url);
  if (parsed.protocol !== "https:")
    throw new Error("Rove Workflow sync requires an HTTPS Supabase URL.");
  return {
    url: parsed.toString().replace(/\/$/, ""),
    publishableKey,
    redirectUrl: "rove://auth/callback",
  };
}
