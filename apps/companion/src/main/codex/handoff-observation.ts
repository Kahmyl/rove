export interface CompletedHandoffObservation {
  handoffId: string;
  generation: number;
  observationSeq?: number;
}

export interface RuntimeHandoffObservation {
  activeHandoffId?: string;
  activeHandoffGeneration?: number;
  lastReturnedHandoffId?: string;
  observationSeq?: number;
}

export function authoritativePreHandoffObservationSeq(input: {
  result: CompletedHandoffObservation;
  runtime: RuntimeHandoffObservation;
}): number {
  const { result, runtime } = input;

  const activeMatch = runtime.activeHandoffId === result.handoffId;
  const returnedMatch = runtime.lastReturnedHandoffId === result.handoffId;

  if (!activeMatch && !returnedMatch)
    throw new Error(
      "Completed handoff is not corroborated by authoritative Runtime control truth.",
    );

  if (activeMatch && runtime.activeHandoffGeneration !== result.generation)
    throw new Error(
      "Completed handoff generation disagrees with authoritative Runtime control truth.",
    );

  const runtimeObservationSeq = runtime.observationSeq;

  if (
    !Number.isSafeInteger(runtimeObservationSeq) ||
    (runtimeObservationSeq as number) < 0
  )
    throw new Error(
      "Completed handoff lacks an authoritative Runtime observation sequence.",
    );
  const authoritativeRuntimeObservationSeq = runtimeObservationSeq as number;

  if (
    result.observationSeq !== undefined &&
    (!Number.isSafeInteger(result.observationSeq) ||
      result.observationSeq < 0 ||
      result.observationSeq > authoritativeRuntimeObservationSeq)
  )
    throw new Error(
      "Completed handoff observation sequence disagrees with authoritative Runtime control truth.",
    );

  return result.observationSeq ?? authoritativeRuntimeObservationSeq;
}
