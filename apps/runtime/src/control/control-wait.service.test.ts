import { describe, expect, it } from "vitest";
import type { Observation, ObservationQuery, Session } from "@rove/protocol";
import type { ObservationStore, SessionStore } from "@rove/storage";
import { ObservationService } from "../observation/observation.service.js";
import { SessionService } from "../session/session.service.js";
import { ControlWaitService } from "./control-wait.service.js";

class MemorySessions implements SessionStore {
  readonly items = new Map<string, Session>();
  async create(session: Session) { this.items.set(session.id, session); }
  async get(id: string) { return this.items.get(id) ?? null; }
  async update(session: Session) { this.items.set(session.id, session); }
}

class MemoryObservations implements ObservationStore {
  readonly items: Observation[] = [];
  async append(_sessionId: string, observation: Observation) { this.items.push(observation); }
  async list(_sessionId: string, query: ObservationQuery = {}) {
    return this.items.filter((item) => item.seq > (query.afterSeq ?? 0)).slice(0, query.limit ?? 100);
  }
}

async function setup() {
  const sessionStore = new MemorySessions();
  const session: Session = {
    id: "ses_wait",
    mode: "agent",
    status: "active",
    controller: "agent",
    profile: { mode: "temporary" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  await sessionStore.create(session);
  const sessions = new SessionService(sessionStore);
  const observations = new ObservationService(new MemoryObservations());
  return { sessionStore, sessions, observations, waits: new ControlWaitService(sessions, observations) };
}

describe("ControlWaitService", () => {
  it("returns the earliest already-persisted relevant event", async () => {
    const { observations, waits } = await setup();
    await observations.append("ses_wait", { actor: "agent", type: "agent_clicked", data: {} });
    const requested = await observations.append("ses_wait", { actor: "agent", type: "human_requested", data: { reason: "Help" } });
    await observations.append("ses_wait", { actor: "human", type: "human_took_control", data: { requested: true } });
    await expect(waits.wait("ses_wait", 0, 50)).resolves.toMatchObject({ event: "human_requested", observationSeq: requested.seq });
  });

  it("finds the earliest relevant event beyond one observation page", async () => {
    const { observations, waits } = await setup();
    for (let index = 0; index < 1_001; index += 1) {
      await observations.append("ses_wait", { actor: "agent", type: "agent_clicked", data: { index } });
    }
    const requested = await observations.append("ses_wait", { actor: "agent", type: "human_requested", data: { reason: "Paged" } });
    await expect(waits.wait("ses_wait", 0, 50)).resolves.toMatchObject({ event: "human_requested", observationSeq: requested.seq });
  });

  it("wakes for a future event and returns timeout as a normal result", async () => {
    const { observations, waits } = await setup();
    const pending = waits.wait("ses_wait", 0, 1_000);
    const event = await observations.append("ses_wait", { actor: "human", type: "human_took_control", data: { requested: false } });
    await waits.publish("ses_wait", event);
    await expect(pending).resolves.toMatchObject({ event: "human_took_control", observationSeq: event.seq });
    await expect(waits.wait("ses_wait", event.seq, 20)).resolves.toMatchObject({ event: "timeout", status: "active" });
  });

  it("does not wake for a published event at or before afterSeq", async () => {
    const { observations, waits } = await setup();
    let settled = false;
    const pending = waits.wait("ses_wait", 5, 1_000).finally(() => { settled = true; });
    const older = await observations.append("ses_wait", { actor: "agent", type: "human_requested", data: { reason: "Older" } });
    await waits.publish("ses_wait", older);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    for (let index = 0; index < 4; index += 1) {
      await observations.append("ses_wait", { actor: "agent", type: "agent_clicked", data: { index } });
    }
    const newer = await observations.append("ses_wait", { actor: "human", type: "human_took_control", data: { requested: true } });
    await waits.publish("ses_wait", newer);
    await expect(pending).resolves.toMatchObject({ event: "human_took_control", observationSeq: 6 });
  });

  it("does not lose an event between initial query and waiter registration", async () => {
    const { observations, waits } = await setup();
    waits.setAfterRegisterHookForTest(async () => {
      const event = await observations.append("ses_wait", { actor: "agent", type: "human_requested", data: { reason: "Race" } });
      await waits.publish("ses_wait", event);
    });
    await expect(waits.wait("ses_wait", 0, 1_000)).resolves.toMatchObject({ event: "human_requested", handoff: { reason: "Race" } });
    expect(waits.waiterCount("ses_wait")).toBe(0);
  });

  it("unregisters a cancelled waiter without changing session state", async () => {
    const { waits, sessions } = await setup();
    const abort = new AbortController();
    const pending = waits.wait("ses_wait", 0, 1_000, abort.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    abort.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(waits.waiterCount("ses_wait")).toBe(0);
    expect(await sessions.get("ses_wait")).toMatchObject({ status: "active", controller: "agent" });
  });
});
