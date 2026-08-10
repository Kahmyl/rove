export interface McpReadinessOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  fetchImpl?: typeof fetch;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function waitForMcpReady(
  baseUrl: string,
  options: McpReadinessOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const fetchImpl = options.fetchImpl ?? fetch;
  const healthUrl = `${baseUrl.replace(/\/+$/, "")}/health`;

  const startedAt = Date.now();
  let lastFailure = "MCP did not respond.";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetchImpl(healthUrl);

      if (response.ok) {
        const body = (await response.json()) as {
          status?: unknown;
          service?: unknown;
        };

        if (body.status === "ok" && body.service === "rove-mcp") {
          return;
        }

        lastFailure = "MCP health response did not report ready.";
      } else {
        lastFailure = `MCP health returned HTTP ${response.status}.`;
      }
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }

    await delay(pollIntervalMs);
  }

  throw new Error(
    `Rove MCP did not become ready within ${timeoutMs}ms: ${lastFailure}`,
  );
}
