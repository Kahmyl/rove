import { describe, expect, it, vi } from "vitest";

import { CodexAccountCatalogService } from "./account-catalog.js";

describe("Codex account catalog renderer bounds", () => {
  it("bounds every catalog collection and renderer-facing string", async () => {
    const huge = "x".repeat(4_000);
    const request = vi.fn(async (method: string) => {
      if (method === "account/read")
        return {
          account: { type: "chatgpt", planType: huge },
          requiresOpenaiAuth: true,
        };
      if (method === "model/list")
        return {
          data: Array.from({ length: 140 }, (_, index) => ({
            id: `model_${index}_${"i".repeat(220)}`,
            model: `launch_${index}_${"m".repeat(218)}`,
            displayName: huge,
            description: huge,
            supportedReasoningEfforts: Array.from({ length: 30 }, () => ({
              reasoningEffort: `effort_${index}`,
            })),
            defaultReasoningEffort: `effort_${index}`,
            isDefault: index === 0,
            hidden: false,
            inputModalities: Array.from({ length: 20 }, () => "text"),
            supportsPersonality: false,
            defaultServiceTier: "priority",
          })),
        };
      if (method === "account/rateLimits/read")
        return {
          rateLimits: {
            limitId: "fallback",
            limitName: "Fallback",
            planType: null,
            primary: null,
            secondary: null,
          },
          rateLimitsByLimitId: Object.fromEntries(
            Array.from({ length: 90 }, (_, index) => [
              `limit_${index}`,
              {
                limitId: `limit_${index}_${"l".repeat(220)}`,
                limitName: huge,
                planType: huge,
                primary: {
                  usedPercent: 10,
                  resetsAt: 1,
                  windowDurationMins: 300,
                },
                secondary: null,
              },
            ]),
          ),
        };
      if (method === "account/usage/read")
        return {
          summary: Object.fromEntries(
            Array.from({ length: 50 }, (_, index) => [`${index}${huge}`, huge]),
          ),
          dailyUsageBuckets: Array.from({ length: 120 }, () => ({
            startDate: huge,
            tokens: huge,
          })),
        };
      throw new Error(`Unexpected method ${method}`);
    });
    const service = new CodexAccountCatalogService(
      { request, onEvent: vi.fn(() => () => undefined) } as never,
      () => huge,
    );
    const snapshot = await service.refresh();
    expect(snapshot.models).toHaveLength(100);
    expect(snapshot.models[0]!.efforts).toHaveLength(16);
    expect(snapshot.models[0]!.inputModalities).toHaveLength(8);
    expect(snapshot.models[0]!.description).toHaveLength(500);
    expect(snapshot.models[0]!.id).toBe(`model_0_${"i".repeat(220)}`);
    expect(snapshot.models[0]!.model).toBe(`launch_0_${"m".repeat(218)}`);
    expect(snapshot.rateLimits).toHaveLength(64);
    expect(Object.keys(snapshot.usage!.summary)).toHaveLength(32);
    expect(snapshot.usage!.dailyUsageBuckets).toHaveLength(90);
    expect(snapshot.usage!.dailyUsageBuckets![0]!.startDate).toHaveLength(40);
    expect(snapshot.usage!.dailyUsageBuckets![0]!.tokens).toHaveLength(80);
    expect(snapshot.account.planType).toHaveLength(80);
    expect(snapshot.refreshedAt).toHaveLength(40);
  });

  it("preserves accepted login identities and URLs byte-for-byte", async () => {
    const loginId = `login_${"x".repeat(240)}`;
    const authUrl = `https://auth.example/connect?opaque=${"z".repeat(3000)}`;
    const request = vi.fn(async (method: string) => {
      if (method === "account/login/start")
        return { type: "chatgpt", loginId, authUrl };
      throw new Error(`Unexpected method ${method}`);
    });
    const service = new CodexAccountCatalogService({
      request,
      onEvent: vi.fn(() => () => undefined),
    } as never);
    await expect(service.login("chatgpt")).resolves.toEqual({
      type: "chatgpt",
      loginId,
    });
    expect(service.trustedLoginUrl(loginId)).toBe(authUrl);
    await expect(
      service.cancelLogin(`${loginId.slice(0, 200)}different`),
    ).rejects.toThrow(/Stale/);
  });
});
