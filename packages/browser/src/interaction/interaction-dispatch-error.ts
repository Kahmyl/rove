import type { ActionResult } from "@rove/protocol";

export class InteractionDispatchError extends Error {
  readonly dispatched = true as const;

  constructor(
    readonly original: unknown,
    readonly result?: ActionResult,
    readonly stage: "dispatch" | "post_action_synchronization" = "dispatch",
  ) {
    super(
      original instanceof Error
        ? original.message
        : "Browser interaction failed after dispatch began.",
    );

    this.name = "InteractionDispatchError";
  }
}
