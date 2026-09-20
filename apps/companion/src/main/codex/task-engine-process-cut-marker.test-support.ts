import { readFile, rename, rm, writeFile } from "node:fs/promises";

export interface ProcessCutMarker extends Record<string, unknown> {
  point: string;
  occurrence: number;
  desktopPid: number;
  commandType?: string;
  taskId?: string;
}

export function processCutMarkerTemporaryPath(markerPath: string): string {
  return `${markerPath}.tmp`;
}

function parseProcessCutMarker(
  serialized: string,
  markerPath: string,
): ProcessCutMarker {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new Error(
      `Process cut marker is malformed at ${markerPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).point !== "string" ||
    (value as Record<string, unknown>).point === "" ||
    !Number.isSafeInteger((value as Record<string, unknown>).occurrence) ||
    Number((value as Record<string, unknown>).occurrence) < 1 ||
    !Number.isSafeInteger((value as Record<string, unknown>).desktopPid) ||
    Number((value as Record<string, unknown>).desktopPid) < 1 ||
    ((value as Record<string, unknown>).commandType !== undefined &&
      typeof (value as Record<string, unknown>).commandType !== "string") ||
    ((value as Record<string, unknown>).taskId !== undefined &&
      typeof (value as Record<string, unknown>).taskId !== "string")
  )
    throw new Error(
      `Process cut marker is structurally invalid at ${markerPath}.`,
    );
  return value as ProcessCutMarker;
}

export async function publishProcessCutMarker(
  markerPath: string,
  marker: ProcessCutMarker,
): Promise<void> {
  const temporaryPath = processCutMarkerTemporaryPath(markerPath);
  await rm(temporaryPath, { force: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(marker)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, markerPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function waitForProcessCutMarker(
  markerPath: string,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<ProcessCutMarker> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return parseProcessCutMarker(
        await readFile(markerPath, "utf8"),
        markerPath,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, pollIntervalMs));
  }
  throw new Error("Timed out waiting for a real process cut point.");
}
