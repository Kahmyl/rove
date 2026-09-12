export interface DesktopShutdownOptions {
  stopHub(): Promise<void>;
  stopExecutionCore(): Promise<void>;
  stopDesktopHost(): Promise<void>;
  cooperativeTimeoutMs?: number;
  report(stage: "hub" | "execution_core" | "desktop_host", error: Error): void;
}

async function settleCooperativeStop(
  stage: "hub" | "execution_core",
  operation: () => Promise<void>,
  timeoutMs: number,
  report: DesktopShutdownOptions["report"],
): Promise<void> {
  let cancelTimeout: (() => void) | undefined;
  let timedOut = false;
  try {
    await Promise.race([
      Promise.resolve()
        .then(operation)
        .catch((error) => {
          report(
            stage,
            error instanceof Error ? error : new Error(String(error)),
          );
        }),
      new Promise<void>((resolve) => {
        const timer = globalThis.setTimeout(() => {
          timedOut = true;
          resolve();
        }, timeoutMs);
        cancelTimeout = () => globalThis.clearTimeout(timer);
      }),
    ]);
  } finally {
    cancelTimeout?.();
  }
  if (timedOut) {
    report(stage, new Error(`Desktop shutdown ${stage} stop timed out.`));
  }
}

export async function stopDesktopComponents(
  options: DesktopShutdownOptions,
): Promise<void> {
  const timeoutMs = options.cooperativeTimeoutMs ?? 5_000;
  await settleCooperativeStop(
    "hub",
    options.stopHub,
    timeoutMs,
    options.report,
  );
  await settleCooperativeStop(
    "execution_core",
    options.stopExecutionCore,
    timeoutMs,
    options.report,
  );
  try {
    await options.stopDesktopHost();
  } catch (error) {
    options.report(
      "desktop_host",
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}
