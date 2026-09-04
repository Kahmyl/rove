import type { ActionResult } from "@rove/protocol";

export class InteractionDispatchError extends Error {
  readonly dispatched = true as const;

  constructor(
    readonly original: unknown,
    readonly result?: ActionResult,
  ) {
    super(
      original instanceof Error
        ? original.message
        : "Browser interaction failed after dispatch began.",
    );

    this.name = "InteractionDispatchError";
  }
}
