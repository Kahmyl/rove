import type { ProductTaskCapabilities } from "./task-coordinator.js";

export interface CustomerTaskCapabilityFacts {
  canSubmit: boolean;
  canStop: boolean;
  canRespond: boolean;
  canTakeControl: boolean;
  canReturnToRove: boolean;
  canRetry: boolean;
  canArchive: boolean;
}

/**
 * Customer controls are a read-side projection. They never authorize an
 * operation and deliberately do not expose Queue or Steer before those
 * product operations exist.
 */
export function customerTaskCapabilities(
  facts: CustomerTaskCapabilityFacts,
): ProductTaskCapabilities {
  return {
    canSubmit: facts.canSubmit,
    canQueue: false,
    canSteer: false,
    canStop: facts.canStop,
    canRespond: facts.canRespond,
    canTakeControl: facts.canTakeControl,
    canReturnToRove: facts.canReturnToRove,
    canRetry: facts.canRetry,
    canArchive: facts.canArchive,
  };
}
