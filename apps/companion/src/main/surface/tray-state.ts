import type { Session } from "@rove/protocol";

export function toTrayStatusLabel(session: Session | null): string {
  if (session === null) {
    return "Ready";
  }

  if (session.status === "awaiting_human" && session.controller === null) {
    return "Your turn";
  }

  if (session.mode === "capture") {
    return "Capture mode";
  }

  if (session.controller === "human") {
    return "You're in control";
  }

  return "Agent working";
}
