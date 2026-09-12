import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSessionStore } from "@rove/storage";
import type { Session } from "@rove/protocol";
import { SessionService } from "./session.service.js";

const homes: string[] = [];
async function home(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "rove-bootstrap-"));
  homes.push(value);
  return value;
}
afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("atomic Runtime bootstrap", () => {
  it("lists every persisted session in deterministic identity order", async () => {
    const store = new FileSessionStore(await home());
    const session = (id: string): Session => ({
      id,
      mode: "agent",
      status: "active",
      controller: "agent",
      profile: { mode: "temporary" },
      createdAt: "2026-09-07T00:00:00.000Z",
      updatedAt: "2026-09-07T00:00:00.000Z",
    });
    await store.create(session("ses_b"));
    await store.create(session("ses_a"));
    await expect(store.list()).resolves.toEqual([
      session("ses_a"),
      session("ses_b"),
    ]);
  });

  it("preserves the stable active-handoff generation across a store restart", async () => {
    const root = await home();
    const stored: Session = {
      id: "ses_handoff",
      mode: "agent",
      status: "active",
      controller: "human",
      ownershipGeneration: 9,
      activeHandoffId: "handoff_11111111111111111111111111111111",
      activeHandoffGeneration: 8,
      handoff: {
        reason: "Complete sign in.",
        requestedAt: "2026-09-07T00:01:00.000Z",
      },
      profile: { mode: "temporary" },
      createdAt: "2026-09-07T00:00:00.000Z",
      updatedAt: "2026-09-07T00:01:00.000Z",
    };
    await new FileSessionStore(root).create(stored);

    await expect(new FileSessionStore(root).get(stored.id)).resolves.toEqual(
      stored,
    );
  });

  it("fails the whole inventory closed when a persisted session is invalid", async () => {
    const root = await home();
    await mkdir(join(root, "sessions", "ses_invalid"), { recursive: true });
    await writeFile(
      join(root, "sessions", "ses_invalid", "session.json"),
      JSON.stringify({ id: "ses_invalid", status: "active" }),
    );
    await expect(new FileSessionStore(root).list()).rejects.toThrow();
  });

  it("returns one session for simultaneous production-store starts", async () => {
    const store = new FileSessionStore(await home());
    const service = new SessionService(store);
    const request = {
      bootstrapId: "boot_11111111111111111111111111111111",
      mode: "agent" as const,
      browser: { mode: "temporary" as const },
    };
    const identity = { profile: { mode: "temporary" as const } };
    const results = await Promise.all(
      Array.from({ length: 12 }, () => service.start(request, identity)),
    );
    expect(new Set(results.map((entry) => entry.id)).size).toBe(1);
    await expect(
      store.findByBootstrapId(request.bootstrapId),
    ).resolves.toMatchObject({ id: results[0]!.id });
  });

  it("materializes a durable claim after a claim/session crash cut", async () => {
    const root = await home();
    const bootstrapId = "boot_22222222222222222222222222222222";
    const claimed: Session = {
      id: "ses_claimed",
      bootstrapId,
      mode: "agent",
      status: "starting",
      controller: "agent",
      profile: { mode: "temporary" },
      createdAt: "2026-09-07T00:00:00.000Z",
      updatedAt: "2026-09-07T00:00:00.000Z",
    };
    await mkdir(join(root, "bootstrap-claims"), { recursive: true });
    await writeFile(
      join(root, "bootstrap-claims", `${bootstrapId}.json`),
      JSON.stringify(claimed),
    );
    const restarted = new FileSessionStore(root);
    await expect(restarted.findByBootstrapId(bootstrapId)).resolves.toEqual(
      claimed,
    );
    await expect(restarted.get(claimed.id)).resolves.toEqual(claimed);
  });

  it("rejects a conflicting launch identity for an existing claim", async () => {
    const store = new FileSessionStore(await home());
    const service = new SessionService(store);
    const bootstrapId = "boot_33333333333333333333333333333333";
    await service.start(
      { bootstrapId, mode: "agent", browser: { mode: "temporary" } },
      { profile: { mode: "temporary" } },
    );
    await expect(
      service.start(
        { bootstrapId, mode: "capture", browser: { mode: "temporary" } },
        { profile: { mode: "temporary" } },
      ),
    ).rejects.toThrow(/collision/);
  });
});
