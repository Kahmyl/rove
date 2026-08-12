import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createManagedDownloadDirectory } from "./managed-downloads.js";

export interface ResolvedDownloadRuntime {
  root: string;
  directory: string;
  temporary: boolean;
}

export async function resolveSessionDownloadRuntime(
  sessionId: string,
  profileUserDataDir?: string,
): Promise<ResolvedDownloadRuntime> {
  const temporary = profileUserDataDir === undefined;
  const root = temporary
    ? await mkdtemp(join(tmpdir(), "rove-browser-downloads-"))
    : profileUserDataDir;
  const directory = await createManagedDownloadDirectory(root, sessionId);

  return {
    root,
    directory,
    temporary,
  };
}
