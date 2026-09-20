import type { ProductTaskCapabilities } from "./task-coordinator.js";

export interface CustomerTaskCapabilityFacts {
  canSubmit: boolean;
  canQueue: boolean;
  canSteer: boolean;
  canStop: boolean;
  canRespond: boolean;
  canTakeControl: boolean;
  canReturnToRove: boolean;
  canRetry: boolean;
  canArchive: boolean;
}

/**
 * Customer controls are a read-side projection. They never authorize an
 * operation. Command handlers independently revalidate the exact Task and
 * active-turn authority before accepting Queue or Steer.
 */
export function customerTaskCapabilities(
  facts: CustomerTaskCapabilityFacts,
): ProductTaskCapabilities {
  return {
    canSubmit: facts.canSubmit,
    canQueue: facts.canQueue,
    canSteer: facts.canSteer,
    canStop: facts.canStop,
    canRespond: facts.canRespond,
    canTakeControl: facts.canTakeControl,
    canReturnToRove: facts.canReturnToRove,
    canRetry: facts.canRetry,
    canArchive: facts.canArchive,
  };
}
