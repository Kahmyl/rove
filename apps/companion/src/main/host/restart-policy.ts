export interface RestartPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const defaultRestartPolicy: RestartPolicy = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 2_000,
};

export function restartDelayMs(
  attempt: number,
  policy: RestartPolicy = defaultRestartPolicy,
): number | null {
  if (
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    attempt > policy.maxAttempts
  ) {
    return null;
  }

  return Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
}
