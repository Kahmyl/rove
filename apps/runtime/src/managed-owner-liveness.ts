export interface ManagedOwnerLivenessOptions {
  managed: boolean;
  ownerProcessId?: number;
  currentParentProcessId?: () => number;
  pollIntervalMs?: number;
  terminate(): Promise<void> | void;
}

export function managedOwnerProcessId(
  runtimeInstanceId: string | undefined,
  value: string | undefined,
): number | undefined {
  if (runtimeInstanceId === undefined) return undefined;
  const processId = Number(value);
  if (!Number.isSafeInteger(processId) || processId <= 1)
    throw new Error("Managed Runtime owner process ID is invalid.");
  return processId;
}

/**
 * A managed Runtime is detached so Desktop can terminate its whole process
 * group. Detachment also means an abruptly terminated Desktop will not take
 * Runtime with it, so Runtime must observe re-parenting and close itself.
 */
export function startManagedOwnerLivenessMonitor(
  options: ManagedOwnerLivenessOptions,
): () => void {
  if (!options.managed) return () => undefined;

  const ownerProcessId = options.ownerProcessId ?? process.ppid;
  const currentParentProcessId =
    options.currentParentProcessId ?? (() => process.ppid);
  let terminating = false;
  const timer = setInterval(() => {
    if (terminating || currentParentProcessId() === ownerProcessId) return;
    terminating = true;
    clearInterval(timer);
    void Promise.resolve(options.terminate());
  }, options.pollIntervalMs ?? 500);
  timer.unref();

  return () => clearInterval(timer);
}
