import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalFileGrantAuthority } from "./local-file-grant.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("Companion local file grants", () => {
  it("materializes only picker-selected bytes without returning the path", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-file-grant-"));
    roots.push(root);
    const path = join(root, "report.txt");
    await writeFile(path, "selected by the user");
    const authority = createLocalFileGrantAuthority({
      selectPaths: async () => [path],
    });

    const selection = await authority.requestLocalFileGrant!({
      reason: "Upload the report",
      allowMultiple: false,
    });

    expect(selection).toHaveLength(1);
    expect(selection![0]).toMatchObject({
      filename: "report.txt",
      mimeType: "text/plain",
    });
    expect(new TextDecoder().decode(selection![0]!.bytes)).toBe(
      "selected by the user",
    );
    expect(JSON.stringify(selection)).not.toContain(root);
  });

  it("preserves a cancelled picker as a null grant", async () => {
    const authority = createLocalFileGrantAuthority({
      selectPaths: async () => null,
    });
    await expect(
      authority.requestLocalFileGrant!({
        reason: "Upload the report",
        allowMultiple: false,
      }),
    ).resolves.toBeNull();
  });

  it("rejects symbolic links instead of following picker paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-file-grant-"));
    roots.push(root);
    const target = join(root, "target.txt");
    const link = join(root, "selected.txt");
    await writeFile(target, "secret");
    await symlink(target, link);
    const authority = createLocalFileGrantAuthority({
      selectPaths: async () => [link],
    });
    await expect(
      authority.requestLocalFileGrant!({
        reason: "Upload the report",
        allowMultiple: false,
      }),
    ).rejects.toThrow("not a regular file");
  });
});
