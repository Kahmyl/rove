import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createManagedDownloadDirectory,
  sanitizeDownloadFilename,
} from "./managed-downloads.js";

const directories: string[] = [];

async function tempRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rove-managed-downloads-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  while (directories.length > 0) {
    await rm(directories.pop()!, {
      recursive: true,
      force: true,
    });
  }
});

describe("managed downloads", () => {
  it("sanitizes unsafe suggested filenames", () => {
    expect(sanitizeDownloadFilename("../secret:file?.txt")).toBe("secret_file_.txt");
    expect(sanitizeDownloadFilename("...")).toBe("download");
    expect(sanitizeDownloadFilename(" report  final .pdf ")).toBe("report final .pdf");
  });

  it("creates scoped managed download directories", async () => {
    const root = await tempRoot();
    const directory = await createManagedDownloadDirectory(root, "ses_123");

    await writeFile(join(directory, "marker.txt"), "ok", "utf8");

    await expect(readFile(join(root, "downloads", "ses_123", "marker.txt"), "utf8"))
      .resolves.toBe("ok");
  });

  it("rejects unsafe download scopes", async () => {
    await expect(
      createManagedDownloadDirectory(await tempRoot(), "../escape"),
    ).rejects.toMatchObject({
      code: "INVALID_CONFIGURATION",
    });
  });
});
