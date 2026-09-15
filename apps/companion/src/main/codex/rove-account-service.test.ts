import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EncryptedFileAuthStorage,
  RoveAccountService,
  readRoveAccountConfiguration,
} from "./rove-account-service.js";
import { WorkflowProviderError } from "./workflow-portability.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function rpcSuccess<T>(data: T) {
  return {
    success: true,
    data,
    error: null,
    count: null,
    status: 200,
    statusText: "OK",
  } as const;
}

function rpcFailure(error: { message: string; code: string }, status: number) {
  return {
    success: false,
    data: null,
    error,
    count: null,
    status,
    statusText: "Error",
  } as const;
}

describe("Rove account boundary", () => {
  const configuration = {
    url: "https://example.supabase.co",
    publishableKey: "publishable",
    redirectUrl: "rove://auth/callback",
  };

  function fakeClient(getSession: () => Promise<unknown>): SupabaseClient {
    return {
      auth: {
        getSession,
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe() {} } },
        }),
      },
    } as unknown as SupabaseClient;
  }

  async function accountForDeletion(
    rpc: () => Promise<unknown>,
  ): Promise<{ account: RoveAccountService; signOuts: string[] }> {
    const directory = await mkdtemp(join(tmpdir(), "rove-auth-"));
    directories.push(directory);
    const storage = new EncryptedFileAuthStorage(
      join(directory, "session.enc"),
      {
        available: () => false,
        encrypt: (value) => Buffer.from(value),
        decrypt: (value) => value.toString(),
      },
    );
    const signOuts: string[] = [];
    const client = {
      rpc,
      auth: {
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe() {} } },
        }),
        async signOut({ scope }: { scope: string }) {
          signOuts.push(scope);
          return { error: null };
        },
      },
    } as unknown as SupabaseClient;
    return {
      account: new RoveAccountService(
        configuration,
        storage,
        () => undefined,
        client,
      ),
      signOuts,
    };
  }

  it("persists sessions only through the supplied secure-storage cipher", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rove-auth-"));
    directories.push(directory);
    const path = join(directory, "identity", "session.enc");
    const storage = new EncryptedFileAuthStorage(path, {
      available: () => true,
      encrypt: (value) => Buffer.from(value.split("").reverse().join("")),
      decrypt: (value) => value.toString().split("").reverse().join(""),
    });
    await Promise.all([
      storage.setItem("session", "refresh-token-secret"),
      storage.setItem("pkce", "verifier-secret"),
    ]);
    const bytes = await readFile(path, "utf8");
    expect(bytes).not.toContain("refresh-token-secret");
    expect(await storage.getItem("session")).toBe("refresh-token-secret");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("uses memory only when secure encryption is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rove-auth-"));
    directories.push(directory);
    const path = join(directory, "session.enc");
    const storage = new EncryptedFileAuthStorage(path, {
      available: () => false,
      encrypt: () => {
        throw new Error("must not encrypt");
      },
      decrypt: () => {
        throw new Error("must not decrypt");
      },
    });
    await storage.setItem("session", "secret");
    expect(storage.persistence).toBe("memory_only");
    expect(await storage.getItem("session")).toBe("secret");
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires a complete HTTPS publishable configuration", () => {
    expect(readRoveAccountConfiguration({})).toBeNull();
    expect(() =>
      readRoveAccountConfiguration({
        ROVE_SUPABASE_URL: "https://example.supabase.co",
      }),
    ).toThrow(/requires both/);
    expect(() =>
      readRoveAccountConfiguration({
        ROVE_SUPABASE_URL: "http://example.test",
        ROVE_SUPABASE_PUBLISHABLE_KEY: "key",
      }),
    ).toThrow(/HTTPS/);
  });

  it("quarantines corrupt encrypted cloud auth without failing local startup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rove-auth-"));
    directories.push(directory);
    const path = join(directory, "session.enc");
    await writeFile(path, "not encrypted session data");
    const storage = new EncryptedFileAuthStorage(path, {
      available: () => true,
      encrypt: (value) => Buffer.from(value),
      decrypt: () => "not-json",
    });
    const account = new RoveAccountService(
      configuration,
      storage,
      () => undefined,
      fakeClient(async () => {
        await storage.getItem("supabase.auth.token");
        throw new Error("unreachable");
      }),
    );
    await expect(account.start()).resolves.toBeUndefined();
    expect(account.snapshot()).toMatchObject({ status: "error" });
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    [
      "provider outage",
      { data: { session: null }, error: { message: "provider unavailable" } },
      "error",
    ],
    [
      "revoked account",
      { data: { session: null }, error: { message: "user not found" } },
      "error",
    ],
    ["expired session", { data: { session: null }, error: null }, "signed_out"],
    [
      "expired cached session object",
      {
        data: {
          session: {
            access_token: "expired-access-token",
            refresh_token: "expired-refresh-token",
            token_type: "bearer",
            expires_in: 3600,
            expires_at: 1,
            user: {
              id: "11111111-1111-4111-8111-111111111111",
              aud: "authenticated",
              role: "authenticated",
              email: "person@example.com",
              app_metadata: {},
              user_metadata: {},
              created_at: "2026-09-13T00:00:00.000Z",
            },
          },
        },
        error: null,
      },
      "signed_out",
    ],
  ])(
    "keeps local startup available for %s",
    async (_label, response, status) => {
      const directory = await mkdtemp(join(tmpdir(), "rove-auth-"));
      directories.push(directory);
      const storage = new EncryptedFileAuthStorage(
        join(directory, "session.enc"),
        {
          available: () => false,
          encrypt: (value) => Buffer.from(value),
          decrypt: (value) => value.toString(),
        },
      );
      const account = new RoveAccountService(
        configuration,
        storage,
        () => undefined,
        fakeClient(async () => response),
      );
      await expect(account.start()).resolves.toBeUndefined();
      expect(account.snapshot().status).toBe(status);
      expect(account.ownerId()).toBeNull();
    },
  );

  it("classifies a malformed successful account deletion as definitive", async () => {
    const { account, signOuts } = await accountForDeletion(async () =>
      rpcSuccess({ deleted: true }),
    );
    const failure = await account
      .deleteCloudAccount()
      .catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(WorkflowProviderError);
    expect((failure as WorkflowProviderError).code).toBe("definitive");
    expect(account.snapshot()).toMatchObject({ status: "error" });
    expect(signOuts).toEqual([]);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["primitive", 42],
    ["array", []],
    ["missing fields", {}],
    [
      "contradictory success",
      {
        success: true,
        data: null,
        error: { message: "unexpected error" },
        count: null,
        status: 200,
        statusText: "OK",
      },
    ],
  ] as const)(
    "classifies a fulfilled account deletion with a %s envelope as definitive",
    async (_label, envelope) => {
      const { account, signOuts } = await accountForDeletion(
        async () => envelope,
      );
      const caught = await account
        .deleteCloudAccount()
        .catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(WorkflowProviderError);
      expect(caught).not.toBeInstanceOf(TypeError);
      expect((caught as WorkflowProviderError).code).toBe("definitive");
      expect(account.snapshot()).toMatchObject({ status: "error" });
      expect(signOuts).toEqual([]);
    },
  );

  it("classifies a rejected account-deletion transport as uncertain", async () => {
    const { account, signOuts } = await accountForDeletion(async () => {
      throw new Error("connection closed after request");
    });
    const failure = await account
      .deleteCloudAccount()
      .catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(WorkflowProviderError);
    expect((failure as WorkflowProviderError).code).toBe("transport_uncertain");
    expect(account.snapshot()).toMatchObject({ status: "error" });
    expect(signOuts).toEqual([]);
  });

  it("classifies the installed client's fulfilled account-deletion fetch failure as uncertain", async () => {
    const { account, signOuts } = await accountForDeletion(async () =>
      rpcFailure({ code: "", message: "TypeError: fetch failed" }, 0),
    );
    const caught = await account
      .deleteCloudAccount()
      .catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(WorkflowProviderError);
    expect((caught as WorkflowProviderError).code).toBe("transport_uncertain");
    expect(account.snapshot()).toMatchObject({ status: "error" });
    expect(signOuts).toEqual([]);
  });
});
