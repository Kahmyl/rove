import { Inject, Injectable } from "@nestjs/common";
import {
  RoveError,
  startSessionRequestSchema,
  type Session,
  type StartSessionRequest,
  type BrowserProfileConfig,
  type BrowserWorkspace,
} from "@rove/protocol";
import type { SessionStore } from "@rove/storage";
import { randomUUID } from "node:crypto";
import { SESSION_STORE } from "../tokens.js";

@Injectable()
export class SessionService {
  constructor(@Inject(SESSION_STORE) private readonly sessions: SessionStore) {}

  async start(
    request: StartSessionRequest,
    identity: {
      profile: BrowserProfileConfig;
      workspace?: BrowserWorkspace;
    },
  ): Promise<Session> {
    const input = startSessionRequestSchema.parse(request);
    const existing =
      input.bootstrapId === undefined
        ? null
        : await this.sessions.findByBootstrapId?.(input.bootstrapId);
    if (existing !== null && existing !== undefined) {
      if (
        existing.mode !== input.mode ||
        (input.browser.mode === "workspace" &&
          "workspaceId" in input.browser &&
          input.browser.workspaceId !== undefined &&
          existing.workspace?.id !== input.browser.workspaceId) ||
        (input.browser.mode === "temporary" &&
          existing.profile.mode !== "temporary")
      )
        throw new Error("Runtime bootstrap identity collision.");
      return existing;
    }
    const now = new Date().toISOString();
    const session: Session = {
      id: `ses_${randomUUID().replaceAll("-", "")}`,
      ...(input.bootstrapId === undefined
        ? {}
        : { bootstrapId: input.bootstrapId }),
      mode: input.mode,
      status: "starting",
      controller: input.mode === "capture" ? "human" : "agent",
      ownershipGeneration: 1,
      profile: identity.profile,
      ...(identity.workspace === undefined
        ? {}
        : { workspace: identity.workspace }),
      createdAt: now,
      updatedAt: now,
    };
    if (
      input.bootstrapId !== undefined &&
      this.sessions.createOrReturnByBootstrap !== undefined
    ) {
      const claimed = await this.sessions.createOrReturnByBootstrap(session);
      if (
        claimed.mode !== input.mode ||
        JSON.stringify(claimed.profile) !== JSON.stringify(identity.profile) ||
        JSON.stringify(claimed.workspace) !== JSON.stringify(identity.workspace)
      )
        throw new Error("Runtime bootstrap identity collision.");
      return claimed;
    }
    await this.sessions.create(session);
    return session;
  }

  async get(sessionId: string): Promise<Session> {
    const session = await this.sessions.get(sessionId);
    if (!session) {
      throw new RoveError({
        code: "SESSION_NOT_FOUND",
        message: "Rove session was not found.",
      });
    }
    return session;
  }

  list(): Promise<Session[]> {
    return this.sessions.list();
  }

  async update(session: Session): Promise<Session> {
    const updated = { ...session, updatedAt: new Date().toISOString() };
    await this.sessions.update(updated);
    return updated;
  }

  async end(sessionId: string): Promise<Session> {
    const session = await this.get(sessionId);
    if (session.status === "completed" || session.status === "failed") {
      return session;
    }
    const now = new Date().toISOString();
    const ended: Session = {
      ...session,
      status: "completed",
      controller: null,
      updatedAt: now,
      endedAt: now,
    };
    delete ended.handoff;
    await this.sessions.update(ended);
    return ended;
  }

  assertActive(session: Session): void {
    if (session.status !== "active" && session.status !== "awaiting_human") {
      throw new RoveError({
        code: "SESSION_NOT_ACTIVE",
        message: "Rove session is not active.",
      });
    }
  }
}
