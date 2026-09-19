import { RoveError } from "@rove/protocol";

export class ConsequenceReplayFence {
  private readonly unresolved = new Map<string, Set<string>>();

  assertAvailable(sessionId: string, consequenceKey: string): void {
    if (this.unresolved.get(sessionId)?.has(consequenceKey)) {
      throw new RoveError({
        code: "CONSEQUENTIAL_ACTION_UNRESOLVED",
        message:
          "A consequential action with this consequence key has an unresolved prior outcome.",
        retryable: false,
      });
    }
  }

  recordUnknown(sessionId: string, consequenceKey: string): void {
    const current = this.unresolved.get(sessionId) ?? new Set<string>();

    current.add(consequenceKey);

    this.unresolved.set(sessionId, current);
  }

  clear(sessionId: string, consequenceKey: string): void {
    const current = this.unresolved.get(sessionId);
    if (!current) return;
    current.delete(consequenceKey);
    if (current.size === 0) this.unresolved.delete(sessionId);
  }

  clearSession(sessionId: string): void {
    this.unresolved.delete(sessionId);
  }
}
