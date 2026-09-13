import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import Database from "better-sqlite3";

const BACKUP_FORMAT_VERSION = 1 as const;

export type LocalBackupEntryStatus =
  | "included"
  | "missing"
  | "changed_during_export"
  | "excluded_symlink"
  | "excluded_unsupported";

export interface LocalBackupManifestEntry {
  path: string;
  status: LocalBackupEntryStatus;
  sizeBytes?: number;
  sha256?: string;
}

export interface LocalBackupManifest {
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  createdAt: string;
  contents: LocalBackupManifestEntry[];
  exclusions: readonly string[];
  disclosure: string;
  restoreSupported: false;
}

export interface LocalBackupExportResult {
  name: string;
  fileCount: number;
  missingCount: number;
}

export interface LocalBackupExporterOptions {
  home: string;
  now?: () => Date;
  id?: () => string;
}

const DIRECTORY_EXPORTS = [
  "sessions",
  "task-attachments",
  "bootstrap-claims",
  "effect-journal",
] as const;

const EXCLUSIONS = [
  "codex-product/codex-home (Codex credentials and private engine state)",
  "codex-product/task-capability.key (local capability signing key)",
  "browser-workspaces and browser profiles (cookies and browser identity)",
  "task-workspaces (arbitrary local project files)",
  "managed-runtime.json and live process state",
] as const;

const DISCLOSURE =
  "This device-local backup contains task conversations and artifacts that may include sensitive content. It contains no Rove-managed credential or browser-profile stores.";

const ENTRY_STATUSES = new Set<LocalBackupEntryStatus>([
  "included",
  "missing",
  "changed_during_export",
  "excluded_symlink",
  "excluded_unsupported",
]);

function within(parent: string, candidate: string): boolean {
  const child = relative(resolve(parent), resolve(candidate));
  return child === "" || (!child.startsWith(`..${sep}`) && child !== "..");
}

function manifestPath(...parts: string[]): string {
  return parts.join("/");
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new Error(`${label} contains unexpected fields.`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function safeBackupPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 2048 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  )
    throw new Error("Backup manifest path is unsafe.");
  if (
    value !== "data/codex-product/task-process.v1.sqlite3" &&
    !DIRECTORY_EXPORTS.some(
      (directory) =>
        value === `data/${directory}` || value.startsWith(`data/${directory}/`),
    )
  )
    throw new Error("Backup manifest path is outside the export allowlist.");
  return value;
}

async function digest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function existingRealPathWithin(
  home: string,
  source: string,
): Promise<string> {
  const actualHome = await realpath(home);
  const actualSource = await realpath(source);
  if (!within(actualHome, actualSource))
    throw new Error("Backup source escapes Rove local storage.");
  return actualSource;
}

async function copyTree(input: {
  home: string;
  source: string;
  destination: string;
  relativePath: string;
  entries: LocalBackupManifestEntry[];
}): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(input.source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      input.entries.push({ path: input.relativePath, status: "missing" });
      return;
    }
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    input.entries.push({
      path: input.relativePath,
      status: "excluded_symlink",
    });
    return;
  }
  await existingRealPathWithin(input.home, input.source);
  if (metadata.isDirectory()) {
    await mkdir(input.destination, { recursive: true, mode: 0o700 });
    const children = await readdir(input.source, { withFileTypes: true });
    for (const child of children.sort((left, right) =>
      left.name.localeCompare(right.name),
    ))
      await copyTree({
        ...input,
        source: join(input.source, child.name),
        destination: join(input.destination, child.name),
        relativePath: manifestPath(input.relativePath, child.name),
      });
    return;
  }
  if (!metadata.isFile()) {
    input.entries.push({
      path: input.relativePath,
      status: "excluded_unsupported",
    });
    return;
  }
  await mkdir(dirname(input.destination), { recursive: true, mode: 0o700 });
  await copyFile(input.source, input.destination);
  await chmod(input.destination, 0o600);
  const after = await stat(input.source);
  if (
    after.size !== metadata.size ||
    after.mtimeMs !== metadata.mtimeMs ||
    after.ctimeMs !== metadata.ctimeMs
  ) {
    await rm(input.destination, { force: true });
    input.entries.push({
      path: input.relativePath,
      status: "changed_during_export",
    });
    return;
  }
  input.entries.push({
    path: input.relativePath,
    status: "included",
    sizeBytes: after.size,
    sha256: await digest(input.destination),
  });
}

async function listBackupFiles(
  root: string,
  current = root,
): Promise<string[]> {
  const files: string[] = [];
  for (const item of await readdir(current, { withFileTypes: true })) {
    const path = join(current, item.name);
    const relativePath = relative(root, path).split(sep).join("/");
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink())
      throw new Error("Backup contains a symbolic link.");
    if (metadata.isDirectory())
      files.push(...(await listBackupFiles(root, path)));
    else if (metadata.isFile()) files.push(relativePath);
    else throw new Error("Backup contains an unsupported file type.");
  }
  return files.sort();
}

async function addReferencedMissingEntries(
  staging: string,
  entries: LocalBackupManifestEntry[],
): Promise<void> {
  const known = new Set(entries.map((entry) => entry.path));
  const addMissing = (path: string) => {
    safeBackupPath(path);
    if (!known.has(path)) {
      known.add(path);
      entries.push({ path, status: "missing" });
    }
  };
  try {
    const attachmentManifest = record(
      JSON.parse(
        await readFile(
          join(staging, "data", "task-attachments", "manifest.v2.json"),
          "utf8",
        ),
      ),
      "Attachment manifest",
    );
    if (Array.isArray(attachmentManifest.attachments))
      for (const raw of attachmentManifest.attachments) {
        const attachment = record(raw, "Attachment manifest entry");
        if (
          typeof attachment.blobName !== "string" ||
          !/^att_[a-f0-9]{32}\.bin$/.test(attachment.blobName)
        )
          throw new Error("Attachment manifest contains an unsafe blob name.");
        addMissing(`data/task-attachments/${attachment.blobName}`);
      }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  for (const entry of [...entries]) {
    if (
      entry.status !== "included" ||
      !/^data\/sessions\/[^/]+\/recordings\/rec_[a-f0-9]{32}\.json$/.test(
        entry.path,
      )
    )
      continue;
    const metadata = record(
      JSON.parse(
        await readFile(join(staging, ...entry.path.split("/")), "utf8"),
      ),
      "Recording metadata",
    );
    if (metadata.artifact === undefined) continue;
    const artifact = record(metadata.artifact, "Recording artifact");
    if (
      typeof artifact.filename !== "string" ||
      !/^rec_[a-f0-9]{32}(?:\.partial)?\.webm$/.test(artifact.filename)
    )
      throw new Error("Recording metadata contains an unsafe artifact name.");
    addMissing(
      `${entry.path.slice(0, entry.path.lastIndexOf("/") + 1)}${artifact.filename}`,
    );
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
}

export async function validateLocalBackupDirectory(
  root: string,
): Promise<LocalBackupManifest> {
  const manifestValue = record(
    JSON.parse(await readFile(join(root, "manifest.json"), "utf8")),
    "Backup manifest",
  );
  exactKeys(
    manifestValue,
    [
      "formatVersion",
      "createdAt",
      "contents",
      "exclusions",
      "disclosure",
      "restoreSupported",
    ],
    "Backup manifest",
  );
  if (
    manifestValue.formatVersion !== BACKUP_FORMAT_VERSION ||
    typeof manifestValue.createdAt !== "string" ||
    new Date(manifestValue.createdAt).toISOString() !==
      manifestValue.createdAt ||
    !Array.isArray(manifestValue.contents) ||
    !Array.isArray(manifestValue.exclusions) ||
    !manifestValue.exclusions.every((item) => typeof item === "string") ||
    JSON.stringify(manifestValue.exclusions) !== JSON.stringify(EXCLUSIONS) ||
    manifestValue.disclosure !== DISCLOSURE ||
    manifestValue.restoreSupported !== false
  )
    throw new Error("Backup manifest is invalid.");
  const paths = new Set<string>();
  const entries: LocalBackupManifestEntry[] = [];
  for (const raw of manifestValue.contents) {
    const item = record(raw, "Backup manifest entry");
    const status = item.status;
    const included = status === "included";
    exactKeys(
      item,
      included ? ["path", "status", "sizeBytes", "sha256"] : ["path", "status"],
      "Backup manifest entry",
    );
    const path = safeBackupPath(item.path);
    if (paths.has(path)) throw new Error("Backup manifest path is duplicated.");
    paths.add(path);
    if (
      typeof status !== "string" ||
      !ENTRY_STATUSES.has(status as LocalBackupEntryStatus)
    )
      throw new Error("Backup manifest entry status is invalid.");
    if (included) {
      if (
        typeof item.sizeBytes !== "number" ||
        !Number.isSafeInteger(item.sizeBytes) ||
        item.sizeBytes < 0 ||
        typeof item.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(item.sha256)
      )
        throw new Error("Included backup manifest entry is invalid.");
      const file = join(root, ...path.split("/"));
      const actual = await lstat(file);
      if (!actual.isFile() || actual.isSymbolicLink())
        throw new Error("Included backup entry is not a regular file.");
      if (
        actual.size !== item.sizeBytes ||
        (await digest(file)) !== item.sha256
      )
        throw new Error("Backup entry checksum does not match its manifest.");
      entries.push({
        path,
        status: "included",
        sizeBytes: item.sizeBytes,
        sha256: item.sha256,
      });
    } else {
      entries.push({ path, status: status as LocalBackupEntryStatus });
    }
  }
  const expectedFiles = [
    "manifest.json",
    ...entries
      .filter((entry) => entry.status === "included")
      .map((entry) => entry.path),
  ].sort();
  const actualFiles = await listBackupFiles(root);
  if (
    actualFiles.length !== expectedFiles.length ||
    actualFiles.some((path, index) => path !== expectedFiles[index])
  )
    throw new Error("Backup contains files that are absent from its manifest.");
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: manifestValue.createdAt,
    contents: entries,
    exclusions: manifestValue.exclusions as string[],
    disclosure: manifestValue.disclosure,
    restoreSupported: false,
  };
}

export class LocalBackupExporter {
  private readonly now: () => Date;
  private readonly id: () => string;

  constructor(private readonly options: LocalBackupExporterOptions) {
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? randomUUID;
  }

  async exportTo(destinationParent: string): Promise<LocalBackupExportResult> {
    const home = resolve(this.options.home);
    const requestedDestination = resolve(destinationParent);
    await mkdir(requestedDestination, { recursive: true });
    const [actualHome, destination] = await Promise.all([
      realpath(home),
      realpath(requestedDestination),
    ]);
    if (within(actualHome, destination))
      throw new Error("Choose a backup location outside Rove local storage.");
    const createdAt = this.now().toISOString();
    const suffix = this.id()
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 8);
    const name = `Rove Backup ${createdAt.replace(/[:.]/g, "-")} ${suffix}`;
    const staging = join(destination, `.${name}.partial`);
    const published = join(destination, name);
    const entries: LocalBackupManifestEntry[] = [];
    await mkdir(staging, { mode: 0o700 });
    try {
      const sourceDatabase = join(
        home,
        "codex-product",
        "task-process.v1.sqlite3",
      );
      const databaseRelativePath = "data/codex-product/task-process.v1.sqlite3";
      try {
        const sourceMetadata = await lstat(sourceDatabase);
        if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isFile())
          throw new Error("Rove task database is not a regular local file.");
        await existingRealPathWithin(home, sourceDatabase);
        const destinationDatabase = join(staging, databaseRelativePath);
        await mkdir(dirname(destinationDatabase), {
          recursive: true,
          mode: 0o700,
        });
        const source = new Database(sourceDatabase, {
          readonly: true,
          fileMustExist: true,
        });
        try {
          await source.backup(destinationDatabase);
        } finally {
          source.close();
        }
        const snapshot = new Database(destinationDatabase, {
          fileMustExist: true,
        });
        try {
          snapshot.pragma("journal_mode = DELETE");
          const result = snapshot.pragma("integrity_check", {
            simple: true,
          });
          if (result !== "ok") throw new Error("Backup database is invalid.");
        } finally {
          snapshot.close();
        }
        await chmod(destinationDatabase, 0o600);
        const sizeBytes = (await stat(destinationDatabase)).size;
        entries.push({
          path: databaseRelativePath,
          status: "included",
          sizeBytes,
          sha256: await digest(destinationDatabase),
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        entries.push({ path: databaseRelativePath, status: "missing" });
      }

      for (const directory of DIRECTORY_EXPORTS)
        await copyTree({
          home,
          source: join(home, directory),
          destination: join(staging, "data", directory),
          relativePath: manifestPath("data", directory),
          entries,
        });
      await addReferencedMissingEntries(staging, entries);

      const manifest: LocalBackupManifest = {
        formatVersion: BACKUP_FORMAT_VERSION,
        createdAt,
        contents: entries,
        exclusions: EXCLUSIONS,
        disclosure: DISCLOSURE,
        restoreSupported: false,
      };
      await writeFile(
        join(staging, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { mode: 0o600, flag: "wx" },
      );
      await validateLocalBackupDirectory(staging);
      await rename(staging, published);
      return {
        name: basename(published),
        fileCount: entries.filter((entry) => entry.status === "included")
          .length,
        missingCount: entries.filter((entry) => entry.status !== "included")
          .length,
      };
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }
}
