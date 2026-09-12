import {
  reduceTaskLifecycle,
  type NativeLifecycleInput,
  type NativeLifecycleOutput,
} from "@rove/protocol";

/**
 * Production entry point for the accepted P5.9 lifecycle contract.
 * The implementation is shared verbatim with the locked L0 oracle so the
 * product cannot drift into a second lifecycle model.
 */
export function reduceProductionTaskLifecycle(
  input: NativeLifecycleInput,
): NativeLifecycleOutput {
  return reduceTaskLifecycle(input);
}

export type ProductionLifecycleOutput = NativeLifecycleOutput;
