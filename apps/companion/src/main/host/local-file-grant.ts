import { RoveError, MAX_GRANTED_FILE_BYTES } from "@rove/protocol";
import { lstat, readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import type {
  HubCommandAuthority,
  LocalFileGrantSelection,
} from "./hub-command-executor.js";

export interface LocalFileGrantPicker {
  selectPaths(input: {
    reason: string;
    allowMultiple: boolean;
  }): Promise<string[] | null>;
}

export function createLocalFileGrantAuthority(
  picker: LocalFileGrantPicker,
): HubCommandAuthority {
  return {
    async requestLocalFileGrant(request) {
      const paths = await picker.selectPaths(request);
      if (paths === null || paths.length === 0) return null;
      if (!request.allowMultiple && paths.length !== 1) {
        throw new RoveError({
          code: "INVALID_CONFIGURATION",
          message:
            "The file picker returned multiple files for a single-file grant.",
        });
      }
      if (paths.length > 100) {
        throw new RoveError({
          code: "INVALID_CONFIGURATION",
          message: "A local file grant cannot contain more than 100 files.",
        });
      }

      const selections: LocalFileGrantSelection[] = [];
      for (const path of paths) {
        const before = await lstat(path);
        if (!before.isFile() || before.isSymbolicLink()) {
          throw new RoveError({
            code: "INVALID_CONFIGURATION",
            message: "The selected grant entry is not a regular file.",
          });
        }
        if (before.size > MAX_GRANTED_FILE_BYTES) {
          throw new RoveError({
            code: "FILE_ARTIFACT_TOO_LARGE",
            message: "A selected file exceeds the 64 MiB grant limit.",
            details: { limitBytes: MAX_GRANTED_FILE_BYTES },
          });
        }
        const bytes = await readFile(path);
        const after = await lstat(path);
        if (
          !after.isFile() ||
          after.isSymbolicLink() ||
          before.dev !== after.dev ||
          before.ino !== after.ino ||
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          bytes.byteLength !== after.size
        )
          throw new RoveError({
            code: "INVALID_CONFIGURATION",
            message: "The selected file changed while it was being granted.",
          });
        selections.push({
          filename: safeLeafName(path),
          mimeType: mimeType(path),
          bytes,
        });
      }
      return selections;
    },
  };
}

function safeLeafName(path: string): string {
  const cleaned = [...basename(path)]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127 ? "_" : character;
    })
    .join("")
    .trim()
    .slice(0, 200);
  return cleaned || "selected-file";
}

function mimeType(path: string): string {
  return (
    {
      ".csv": "text/csv",
      ".gif": "image/gif",
      ".htm": "text/html",
      ".html": "text/html",
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".json": "application/json",
      ".md": "text/markdown",
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".txt": "text/plain",
      ".webp": "image/webp",
      ".xlsx":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".zip": "application/zip",
    }[extname(path).toLowerCase()] ?? "application/octet-stream"
  );
}
