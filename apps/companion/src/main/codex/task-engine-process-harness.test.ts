import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  processCutMarkerTemporaryPath,
  publishProcessCutMarker,
  type ProcessCutMarker,
  waitForProcessCutMarker,
} from "./task-engine-process-cut-marker.test-support.js";

const directories: string[] = [];

async function markerFixture(): Promise<{
  directory: string;
  markerPath: string;
  marker: ProcessCutMarker;
}> {
  const directory = await mkdtemp(join(tmpdir(), "rove-cut-marker-"));
  directories.push(directory);
  return {
    directory,
    markerPath: join(directory, "task-engine-cut.json"),
    marker: {
      point: "after_terminal_change_before_observation",
      commandType: "start_or_steer_codex_turn",
      taskId: "task_exact",
      occurrence: 1,
      desktopPid: process.pid,
    },
  };
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("process cut marker publication", () => {
  it("waits while the canonical marker is absent, then returns the exact payload", async () => {
    const { markerPath, marker } = await markerFixture();
    let settled = false;
    const waiting = waitForProcessCutMarker(markerPath, {
      timeoutMs: 500,
      pollIntervalMs: 5,
    }).finally(() => {
      settled = true;
    });

    await new Promise((resolveTurn) => setImmediate(resolveTurn));
    expect(settled).toBe(false);
    await publishProcessCutMarker(markerPath, marker);

    await expect(waiting).resolves.toEqual(marker);
  });

  it("keeps partial JSON unpublished until atomic rename", async () => {
    const { markerPath, marker } = await markerFixture();
    const temporaryPath = processCutMarkerTemporaryPath(markerPath);
    await writeFile(temporaryPath, '{"point":');
    await expect(access(markerPath)).rejects.toMatchObject({ code: "ENOENT" });
    let settled = false;
    const waiting = waitForProcessCutMarker(markerPath, {
      timeoutMs: 500,
      pollIntervalMs: 5,
    }).finally(() => {
      settled = true;
    });

    await new Promise((resolveTurn) => setImmediate(resolveTurn));
    expect(settled).toBe(false);
    await publishProcessCutMarker(markerPath, marker);

    await expect(waiting).resolves.toEqual(marker);
    expect(JSON.parse(await readFile(markerPath, "utf8"))).toEqual(marker);
    await expect(access(temporaryPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("fails a complete malformed canonical marker", async () => {
    const { markerPath } = await markerFixture();
    await writeFile(markerPath, '{"point":');

    await expect(waitForProcessCutMarker(markerPath)).rejects.toThrow(
      "Process cut marker is malformed",
    );
  });

  it("fails a complete structurally invalid canonical marker", async () => {
    const { markerPath } = await markerFixture();
    await writeFile(markerPath, JSON.stringify({ point: 7 }));

    await expect(waitForProcessCutMarker(markerPath)).rejects.toThrow(
      "Process cut marker is structurally invalid",
    );
  });

  it("keeps an absent-marker timeout bounded", async () => {
    const { markerPath } = await markerFixture();
    const startedAt = Date.now();

    await expect(
      waitForProcessCutMarker(markerPath, {
        timeoutMs: 25,
        pollIntervalMs: 5,
      }),
    ).rejects.toThrow("Timed out waiting for a real process cut point.");
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
