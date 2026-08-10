export interface RuntimeReadinessOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  fetchImpl?: typeof fetch;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function waitForRuntimeReady(
  baseUrl: string,
  options: RuntimeReadinessOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const fetchImpl = options.fetchImpl ?? fetch;
  const healthUrl = `${baseUrl.replace(/\/+$/, "")}/health`;

  const startedAt = Date.now();
  let lastFailure = "Runtime did not respond.";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetchImpl(healthUrl);

      if (response.ok) {
        const body = (await response.json()) as {
          ok?: unknown;
        };

        if (body.ok === true) {
          return;
        }

        lastFailure = "Runtime health response did not report ok.";
      } else {
        lastFailure = `Runtime health returned HTTP ${response.status}.`;
      }
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }

    await delay(pollIntervalMs);
  }

  throw new Error(
    `Rove Runtime did not become ready within ${timeoutMs}ms: ${lastFailure}`,
  );
}
