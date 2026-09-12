import type { ActionResult } from "@rove/protocol";

export class InteractionNotDispatchedError extends Error {
  readonly dispatched = false as const;
  readonly code: unknown;
  readonly retryable: unknown;
  readonly details: unknown;

  constructor(readonly original: unknown) {
    super(
      original instanceof Error
        ? original.message
        : "Browser interaction was rejected before dispatch.",
    );

    this.name = "InteractionNotDispatchedError";
    this.code =
      typeof original === "object" && original !== null && "code" in original
        ? original.code
        : undefined;
    this.retryable =
      typeof original === "object" &&
      original !== null &&
      "retryable" in original
        ? original.retryable
        : undefined;
    this.details =
      typeof original === "object" && original !== null && "details" in original
        ? original.details
        : undefined;
  }
}

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
