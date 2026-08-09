import { Injectable } from "@nestjs/common";
import { RoveError, type Actor, type ControlState, type Controller, type Session } from "@rove/protocol";

@Injectable()
export class ControlService {
  assertCanMutate(session: Session, actor: Actor): void {
    if (actor !== "agent" && actor !== "human") {
      throw new RoveError({ code: "CONTROL_NOT_OWNED", message: "Actor cannot control the browser." });
    }
    if (session.controller !== actor) {
      throw new RoveError({
        code: "CONTROL_NOT_OWNED",
        message: `The browser is currently controlled by ${session.controller ?? "no one"}.`,
        details: { controller: session.controller },
      });
    }
  }

  nextState(controller: Controller, reason?: string): ControlState {
    return {
      controller,
      since: new Date().toISOString(),
      ...(reason === undefined ? {} : { reason }),
    };
  }
}
