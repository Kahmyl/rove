import { Injectable } from "@nestjs/common";
import { RoveError, type Actor, type Session } from "@rove/protocol";

@Injectable()
export class ControlService {
  assertCanMutate(session: Session, actor: Actor): void {
    if ((actor !== "agent" && actor !== "human") || session.controller !== actor) {
      throw new RoveError({
        code: "CONTROL_NOT_OWNED",
        message: `The browser is currently controlled by ${session.controller ?? "no one"}.`,
        details: { controller: session.controller },
      });
    }
  }

  assertCanRequestHuman(session: Session): void {
    this.assertNonTerminal(session);
    if (session.status === "awaiting_human" && session.controller === null) return;
    if (session.status === "active" && session.controller === "agent") return;
    throw new RoveError({ code: "CONTROL_NOT_OWNED", message: "The agent does not own browser control." });
  }

  assertCanTakeHuman(session: Session): void {
    this.assertNonTerminal(session);
    if (session.controller === "human") return;
    if (session.status === "awaiting_human" && session.controller === null && session.handoff !== undefined) return;
    if (session.mode === "companion" && session.status === "active" && session.controller === "agent") return;
    if (session.mode === "agent" && session.status === "active" && session.controller === "agent") {
      throw new RoveError({ code: "HUMAN_CONTROL_REQUIRED", message: "Agent Mode requires an explicit human handoff request." });
    }
    throw new RoveError({ code: "CONTROL_NOT_OWNED", message: "Human control cannot be taken from the current state." });
  }

  assertCanReturnAgent(session: Session): void {
    this.assertNonTerminal(session);
    if (session.mode === "capture") {
      throw new RoveError({ code: "CONTROL_NOT_OWNED", message: "Capture Mode remains human-controlled." });
    }
    if (session.status === "active" && session.controller === "agent" && session.handoff === undefined) return;
    if (session.status === "active" && session.controller === "human") return;
    throw new RoveError({ code: "CONTROL_NOT_OWNED", message: "Human control is not currently owned." });
  }

  private assertNonTerminal(session: Session): void {
    if (session.status === "completed" || session.status === "failed") {
      throw new RoveError({ code: "SESSION_NOT_ACTIVE", message: "Rove session is not active." });
    }
  }
}
