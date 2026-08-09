import { Inject, Injectable } from "@nestjs/common";
import {
  RoveError,
  startSessionRequestSchema,
  type Session,
  type StartSessionRequest,
} from "@rove/protocol";
import type { SessionStore } from "@rove/storage";
import { randomUUID } from "node:crypto";
import { SESSION_STORE } from "../tokens.js";

@Injectable()
export class SessionService {
  constructor(@Inject(SESSION_STORE) private readonly sessions: SessionStore) {}

  async start(request: StartSessionRequest): Promise<Session> {
    const input = startSessionRequestSchema.parse(request);
    const now = new Date().toISOString();
    const session: Session = {
      id: `ses_${randomUUID().replaceAll("-", "")}`,
      mode: input.mode,
      status: "active",
      controller: input.mode === "capture" ? "human" : "agent",
      profile: input.profile,
      createdAt: now,
      updatedAt: now,
    };
    await this.sessions.create(session);
    return session;
  }

  async get(sessionId: string): Promise<Session> {
    const session = await this.sessions.get(sessionId);
    if (!session) {
      throw new RoveError({ code: "SESSION_NOT_FOUND", message: "Rove session was not found." });
    }
    return session;
  }

  async update(session: Session): Promise<Session> {
    const updated = { ...session, updatedAt: new Date().toISOString() };
    await this.sessions.update(updated);
    return updated;
  }

  async end(sessionId: string): Promise<Session> {
    const session = await this.get(sessionId);
    if (session.status === "completed" || session.status === "failed") {
      throw new RoveError({
        code: "SESSION_ALREADY_ENDED",
        message: "Rove session has already ended.",
      });
    }
    const now = new Date().toISOString();
    const ended: Session = {
      ...session,
      status: "completed",
      controller: null,
      updatedAt: now,
      endedAt: now,
    };
    await this.sessions.update(ended);
    return ended;
  }

  assertActive(session: Session): void {
    if (session.status !== "active" && session.status !== "awaiting_human") {
      throw new RoveError({ code: "SESSION_NOT_ACTIVE", message: "Rove session is not active." });
    }
  }
}
