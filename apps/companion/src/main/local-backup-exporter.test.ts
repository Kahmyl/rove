import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  LocalBackupExporter,
  type LocalBackupManifest,
  validateLocalBackupDirectory,
} from "./local-backup-exporter.js";

async function fixture(): Promise<{ home: string; destination: string }> {
  return {
    home: await mkdtemp(join(tmpdir(), "rove-local-backup-home-")),
    destination: await mkdtemp(join(tmpdir(), "rove-local-backup-output-")),
  };
}

describe("LocalBackupExporter", () => {
  it("uses an online SQLite snapshot and exports only allowlisted local history", async () => {
    const { home, destination } = await fixture();
    const databasePath = join(home, "codex-product", "task-process.v1.sqlite3");
    await mkdir(join(home, "codex-product", "codex-home"), {
      recursive: true,
    });
    const database = new Database(databasePath);
    database.pragma("journal_mode = WAL");
    database.exec("CREATE TABLE task (id TEXT PRIMARY KEY, title TEXT)");
    database.prepare("INSERT INTO task VALUES (?, ?)").run("task_1", "Work");
    await writeFile(
      join(home, "codex-product", "codex-home", "auth.json"),
      "credential-secret",
    );
    await writeFile(
      join(home, "codex-product", "task-capability.key"),
      "capability-secret",
    );
    await mkdir(join(home, "sessions", "ses_1"), { recursive: true });
    await writeFile(
      join(home, "sessions", "ses_1", "session.json"),
      '{"id":"ses_1"}\n',
    );
    const recordingId = `rec_${"e".repeat(32)}`;
    await mkdir(join(home, "sessions", "ses_1", "recordings"), {
      recursive: true,
    });
    await writeFile(
      join(home, "sessions", "ses_1", "recordings", `${recordingId}.json`),
      JSON.stringify({ artifact: { filename: `${recordingId}.webm` } }),
    );
    await mkdir(join(home, "task-attachments"), { recursive: true });
    await writeFile(join(home, "task-attachments", "file.bin"), "artifact");
    await writeFile(
      join(home, "task-attachments", "manifest.v2.json"),
      JSON.stringify({
        version: 2,
        attachments: [{ blobName: `att_${"f".repeat(32)}.bin` }],
        attention: [],
      }),
    );
    await mkdir(join(home, "task-workspaces", "task_1"), { recursive: true });
    await writeFile(join(home, "task-workspaces", "task_1", "secret"), "no");

    const result = await new LocalBackupExporter({
      home,
      now: () => new Date("2026-09-13T12:00:00.000Z"),
      id: () => "12345678-0000-0000-0000-000000000000",
    }).exportTo(destination);
    database.close();

    const root = join(destination, result.name);
    const snapshot = new Database(
      join(root, "data", "codex-product", "task-process.v1.sqlite3"),
      { readonly: true },
    );
    expect(snapshot.prepare("SELECT * FROM task").get()).toEqual({
      id: "task_1",
      title: "Work",
    });
    snapshot.close();
    const manifest = JSON.parse(
      await readFile(join(root, "manifest.json"), "utf8"),
    ) as LocalBackupManifest;
    expect(manifest.restoreSupported).toBe(false);
    await expect(validateLocalBackupDirectory(root)).resolves.toEqual(manifest);
    expect(manifest.contents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "data/sessions/ses_1/session.json",
          status: "included",
        }),
        expect.objectContaining({
          path: "data/task-attachments/file.bin",
          status: "included",
        }),
        {
          path: `data/task-attachments/att_${"f".repeat(32)}.bin`,
          status: "missing",
        },
        {
          path: `data/sessions/ses_1/recordings/${recordingId}.webm`,
          status: "missing",
        },
        { path: "data/bootstrap-claims", status: "missing" },
        { path: "data/effect-journal", status: "missing" },
      ]),
    );
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain("credential-secret");
    await expect(
      readFile(join(root, "data", "codex-product", "codex-home", "auth.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(root, "data", "task-workspaces", "task_1", "secret")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("records symlinks as excluded without following them", async () => {
    const { home, destination } = await fixture();
    await mkdir(join(home, "sessions"), { recursive: true });
    const outside = join(destination, "outside-secret.txt");
    await writeFile(outside, "outside-secret");
    await symlink(outside, join(home, "sessions", "escape"));

    const result = await new LocalBackupExporter({
      home,
      id: () => "abcdef12-0000-0000-0000-000000000000",
    }).exportTo(destination);
    const manifest = JSON.parse(
      await readFile(join(destination, result.name, "manifest.json"), "utf8"),
    ) as LocalBackupManifest;
    expect(manifest.contents).toContainEqual({
      path: "data/sessions/escape",
      status: "excluded_symlink",
    });
    expect(JSON.stringify(manifest)).not.toContain("outside-secret");
  });

  it("refuses to place a backup inside Rove local storage", async () => {
    const { home } = await fixture();
    await expect(
      new LocalBackupExporter({ home }).exportTo(join(home, "exports")),
    ).rejects.toThrow(/outside Rove local storage/);
  });

  it("refuses an outside-looking destination symlinked into local storage", async () => {
    const { home, destination } = await fixture();
    const sessions = join(home, "sessions");
    await mkdir(sessions, { recursive: true });
    const link = join(destination, "backup-link");
    await symlink(sessions, link);
    await expect(
      new LocalBackupExporter({ home }).exportTo(link),
    ).rejects.toThrow(/outside Rove local storage/);
  });

  it("rejects tampered bytes and unsafe manifest paths", async () => {
    const { home, destination } = await fixture();
    await mkdir(join(home, "sessions"), { recursive: true });
    await writeFile(join(home, "sessions", "history.json"), "history");
    const result = await new LocalBackupExporter({ home }).exportTo(
      destination,
    );
    const root = join(destination, result.name);
    await writeFile(join(root, "data", "sessions", "history.json"), "changed");
    await expect(validateLocalBackupDirectory(root)).rejects.toThrow(
      /checksum/,
    );

    const manifestPath = join(root, "manifest.json");
    const manifest = JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as LocalBackupManifest;
    manifest.contents[0] = { path: "../outside", status: "missing" };
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    await expect(validateLocalBackupDirectory(root)).rejects.toThrow(/unsafe/);
  });

  it("rejects an unsafe recording artifact name before publication", async () => {
    const { home, destination } = await fixture();
    const recordingId = `rec_${"d".repeat(32)}`;
    const recordings = join(home, "sessions", "ses_1", "recordings");
    await mkdir(recordings, { recursive: true });
    await writeFile(
      join(recordings, `${recordingId}.json`),
      JSON.stringify({ artifact: { filename: "../../credential.webm" } }),
    );
    await expect(
      new LocalBackupExporter({ home }).exportTo(destination),
    ).rejects.toThrow(/unsafe artifact name/);
  });
});
