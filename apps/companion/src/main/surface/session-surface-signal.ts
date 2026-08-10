import type { Session } from "@rove/protocol";

export type CompanionSurfaceAction = "show" | "attention";

export interface CompanionSurfaceSignal {
  key: string;
  action: CompanionSurfaceAction;
}

export function toCompanionSurfaceSignal(
  session: Session | null,
): CompanionSurfaceSignal | null {
  if (session === null) {
    return null;
  }

  const live =
    session.status === "active" || session.status === "awaiting_human";

  if (!live) {
    return null;
  }

  if (
    session.status === "awaiting_human" &&
    session.controller === null &&
    session.handoff !== undefined
  ) {
    return {
      key: `handoff:${session.id}:` + session.handoff.requestedAt,
      action: "attention",
    };
  }

  if (session.mode === "capture") {
    return {
      key: `capture:${session.id}`,
      action: "show",
    };
  }

  return null;
}
