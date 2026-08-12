import { access, mkdir } from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";

import type { Download } from "playwright";
import { RoveError } from "@rove/protocol";

export interface ManagedDownload {
  directory: string;
  filename: string;
  path: string;
}

const SAFE_SCOPE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const RESERVED_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

export async function createManagedDownloadDirectory(
  root: string,
  scope: string,
): Promise<string> {
  if (!SAFE_SCOPE.test(scope)) {
    throw new RoveError({
      code: "INVALID_CONFIGURATION",
      message: "Invalid download scope.",
    });
  }

  const directory = pathWithin(resolve(root), "downloads", scope);
  await mkdir(directory, {
    recursive: true,
  });
  return directory;
}

export function sanitizeDownloadFilename(filename: string): string {
  const safeBasename = basename(filename)
    .replace(RESERVED_CHARS, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");

  return safeBasename === "" ? "download" : safeBasename.slice(0, 180);
}

export async function saveManagedDownload(
  download: Download,
  directory: string,
): Promise<ManagedDownload> {
  await mkdir(directory, {
    recursive: true,
  });

  const filename = await nextAvailableFilename(
    directory,
    sanitizeDownloadFilename(download.suggestedFilename()),
  );
  const path = pathWithin(directory, filename);
  await download.saveAs(path);

  return {
    directory,
    filename,
    path,
  };
}

async function nextAvailableFilename(
  directory: string,
  filename: string,
): Promise<string> {
  let candidate = filename;
  const extension = extname(filename);
  const stem = extension === "" ? filename : filename.slice(0, -extension.length);

  for (let index = 1; await exists(pathWithin(directory, candidate)); index += 1) {
    candidate = `${stem} (${index})${extension}`;
  }

  return candidate;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function pathWithin(root: string, ...segments: string[]): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, ...segments);
  if (target === resolvedRoot || target.startsWith(`${resolvedRoot}${sep}`)) {
    return target;
  }

  throw new RoveError({
    code: "INVALID_CONFIGURATION",
    message: "Download path escaped the managed directory.",
  });
}
