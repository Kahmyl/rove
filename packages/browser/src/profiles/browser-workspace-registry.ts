import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import {
  RoveError,
  type BrowserWorkspace,
  type BrowserWorkspaceStatus,
} from "@rove/protocol";

interface BrowserWorkspaceCatalog {
  schemaVersion: 1;
  selectedWorkspaceId?: string;
  workspaces: BrowserWorkspace[];
}

interface StoredBrowserWorkspace extends Omit<
  BrowserWorkspace,
  "storageLayout"
> {
  /** Optional only so catalogs written by the Experiment B prototype migrate. */
  storageLayout?: BrowserWorkspace["storageLayout"];
}

interface StoredBrowserWorkspaceCatalog {
  schemaVersion: 1;
  selectedWorkspaceId?: string;
  workspaces: StoredBrowserWorkspace[];
}

export interface CreateBrowserWorkspaceRequest {
  displayName: string;
  browser?: BrowserWorkspace["browser"];
}

const CATALOG_FILE = "browser-workspaces.json";
const WORKSPACES_DIRECTORY = "browser-workspaces";
const LEGACY_PROFILES_DIRECTORY = "profiles";
const WORKSPACE_ID = /^wrk_[a-f0-9-]{36}$/;
const LEGACY_PROFILE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function basicWorkspace(value: unknown): value is StoredBrowserWorkspace {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<StoredBrowserWorkspace>;
  return (
    typeof item.id === "string" &&
    WORKSPACE_ID.test(item.id) &&
    typeof item.displayName === "string" &&
    item.displayName.trim().length > 0 &&
    item.displayName.length <= 80 &&
    (item.browser === "chrome" || item.browser === "chromium") &&
    typeof item.userDataDir === "string" &&
    (item.storageLayout === undefined ||
      item.storageLayout === "workspace" ||
      item.storageLayout === "legacy_profile") &&
    validTimestamp(item.createdAt) &&
    validTimestamp(item.lastUsedAt)
  );
}

function parseStoredCatalog(
  value: string,
): StoredBrowserWorkspaceCatalog | undefined {
  try {
    const item = JSON.parse(value) as Partial<StoredBrowserWorkspaceCatalog>;
    if (
      item.schemaVersion !== 1 ||
      !Array.isArray(item.workspaces) ||
      !item.workspaces.every(basicWorkspace) ||
      (item.selectedWorkspaceId !== undefined &&
        typeof item.selectedWorkspaceId !== "string")
    ) {
      return undefined;
    }
    return item as StoredBrowserWorkspaceCatalog;
  } catch {
    return undefined;
  }
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/**
 * Durable, user-owned browser identities.
 *
 * Catalog migration is metadata-only: existing Chrome data is registered in
 * place and is never copied, moved, or rewritten. Logical task sessions may
 * resolve an existing workspace but cannot create one as a side effect.
 */
export class BrowserWorkspaceRegistry {
  private readonly catalogPath: string;
  private readonly workspacesRoot: string;
  private readonly legacyProfilesRoot: string;
  private initialization: Promise<void> | undefined;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly home: string) {
    this.catalogPath = resolve(home, CATALOG_FILE);
    this.workspacesRoot = resolve(home, WORKSPACES_DIRECTORY);
    this.legacyProfilesRoot = resolve(home, LEGACY_PROFILES_DIRECTORY);
  }

  async initialize(): Promise<void> {
    this.initialization ??= this.initializeOnce();
    return this.initialization;
  }

  async status(): Promise<BrowserWorkspaceStatus> {
    await this.initialize();
    const catalog = await this.readCatalog();
    return {
      ...(catalog.selectedWorkspaceId === undefined
        ? {}
        : { selectedWorkspaceId: catalog.selectedWorkspaceId }),
      workspaces: catalog.workspaces.map((workspace) => ({ ...workspace })),
    };
  }

  async list(): Promise<BrowserWorkspace[]> {
    return (await this.status()).workspaces;
  }

  async selected(): Promise<BrowserWorkspace | undefined> {
    const status = await this.status();
    const workspace = status.workspaces.find(
      (item) => item.id === status.selectedWorkspaceId,
    );
    return workspace === undefined ? undefined : { ...workspace };
  }

  async create(
    request: CreateBrowserWorkspaceRequest,
  ): Promise<BrowserWorkspace> {
    await this.initialize();
    const displayName = request.displayName.trim();
    if (displayName.length === 0 || displayName.length > 80) {
      throw new RoveError({
        code: "INVALID_PROFILE_NAME",
        message: "Browser workspace display name must be 1 to 80 characters.",
      });
    }

    return this.mutate(async (catalog) => {
      const id = `wrk_${randomUUID()}`;
      const userDataDir = this.managedUserDataPath(id);
      await mkdir(userDataDir, { recursive: true });

      const now = new Date().toISOString();
      const workspace: BrowserWorkspace = {
        id,
        displayName,
        browser: request.browser ?? "chrome",
        userDataDir,
        storageLayout: "workspace",
        createdAt: now,
        lastUsedAt: now,
      };
      catalog.workspaces.push(workspace);
      catalog.selectedWorkspaceId ??= workspace.id;
      return { ...workspace };
    });
  }

  async select(workspaceId: string): Promise<BrowserWorkspace> {
    await this.initialize();
    return this.mutate(async (catalog) => {
      const workspace = this.requireWorkspace(catalog, workspaceId);
      catalog.selectedWorkspaceId = workspace.id;
      return { ...workspace };
    });
  }

  async rename(
    workspaceId: string,
    requestedDisplayName: string,
  ): Promise<BrowserWorkspace> {
    await this.initialize();
    const displayName = requestedDisplayName.trim();
    if (displayName.length === 0 || displayName.length > 80) {
      throw new RoveError({
        code: "INVALID_PROFILE_NAME",
        message: "Browser profile name must be 1 to 80 characters.",
      });
    }
    return this.mutate(async (catalog) => {
      const workspace = this.requireWorkspace(catalog, workspaceId);
      workspace.displayName = displayName;
      return { ...workspace };
    });
  }

  async delete(workspaceId: string): Promise<BrowserWorkspaceStatus> {
    await this.initialize();
    const workspace = await this.mutate(async (catalog) => {
      const existing = this.requireWorkspace(catalog, workspaceId);
      catalog.workspaces = catalog.workspaces.filter(
        (item) => item.id !== workspaceId,
      );
      if (catalog.selectedWorkspaceId === workspaceId) {
        const replacement = catalog.workspaces[0];
        if (replacement === undefined) delete catalog.selectedWorkspaceId;
        else catalog.selectedWorkspaceId = replacement.id;
      }
      return { ...existing };
    });
    await rm(workspace.userDataDir, { recursive: true, force: true });
    return this.status();
  }

  /** Resolve an already-created identity for a logical task session. */
  async resolveForSession(workspaceId?: string): Promise<BrowserWorkspace> {
    await this.initialize();
    return this.mutate(async (catalog) => {
      const requested = workspaceId ?? catalog.selectedWorkspaceId;
      if (requested === undefined) {
        throw new RoveError({
          code: "PROFILE_NOT_FOUND",
          message:
            "No browser workspace is selected. Create and select one in Rove before starting a browser task.",
        });
      }
      const workspace = this.requireWorkspace(catalog, requested);
      workspace.lastUsedAt = new Date().toISOString();
      return { ...workspace };
    });
  }

  private async initializeOnce(): Promise<void> {
    const stored = await this.readStoredCatalog();
    if (stored !== undefined) {
      this.normalizeAndValidate(stored);
      return;
    }

    const migrated = await this.discoverLegacyProfiles();
    const selected = migrated.find((item) => item.displayName === "Default");
    await this.writeCatalog({
      schemaVersion: 1,
      ...(selected === undefined ? {} : { selectedWorkspaceId: selected.id }),
      workspaces: migrated,
    });
  }

  private async discoverLegacyProfiles(): Promise<BrowserWorkspace[]> {
    let entries;
    try {
      entries = await readdir(this.legacyProfilesRoot, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }

    const workspaces: BrowserWorkspace[] = [];
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (!entry.isDirectory() || !LEGACY_PROFILE_NAME.test(entry.name))
        continue;
      const directory = resolve(this.legacyProfilesRoot, entry.name);
      try {
        const metadata = JSON.parse(
          await readFile(resolve(directory, "profile.json"), "utf8"),
        ) as Record<string, unknown>;
        if (
          metadata.name !== entry.name ||
          !validTimestamp(metadata.createdAt) ||
          !validTimestamp(metadata.lastUsedAt) ||
          (metadata.browserDistribution !== "chrome" &&
            metadata.browserDistribution !== "chromium")
        ) {
          continue;
        }
        workspaces.push({
          id: `wrk_${randomUUID()}`,
          displayName: entry.name === "default" ? "Default" : entry.name,
          browser: metadata.browserDistribution,
          userDataDir: directory,
          storageLayout: "legacy_profile",
          createdAt: metadata.createdAt,
          lastUsedAt: metadata.lastUsedAt,
        });
      } catch (error) {
        if (!isMissing(error) && !(error instanceof SyntaxError)) throw error;
      }
    }
    return workspaces;
  }

  private requireWorkspace(
    catalog: BrowserWorkspaceCatalog,
    workspaceId: string,
  ): BrowserWorkspace {
    const workspace = catalog.workspaces.find(
      (item) => item.id === workspaceId,
    );
    if (workspace !== undefined) return workspace;
    throw new RoveError({
      code: "PROFILE_NOT_FOUND",
      message: "The requested browser workspace does not exist.",
      details: { workspaceId },
    });
  }

  private managedUserDataPath(workspaceId: string): string {
    if (!WORKSPACE_ID.test(workspaceId)) {
      throw new RoveError({
        code: "INVALID_PROFILE_NAME",
        message: "Invalid browser workspace id.",
      });
    }
    const target = resolve(this.workspacesRoot, workspaceId, "chrome-data");
    if (target.startsWith(`${this.workspacesRoot}${sep}`)) return target;
    throw new RoveError({
      code: "INVALID_CONFIGURATION",
      message: "Browser workspace path escaped the Rove workspace directory.",
    });
  }

  private normalizeAndValidate(
    stored: StoredBrowserWorkspaceCatalog,
  ): BrowserWorkspaceCatalog {
    const seenIds = new Set<string>();
    const seenDirectories = new Set<string>();
    const workspaces = stored.workspaces.map((item) => {
      const userDataDir = resolve(item.userDataDir);
      const managed = userDataDir === this.managedUserDataPath(item.id);
      const legacyRelative = relative(this.legacyProfilesRoot, userDataDir);
      const legacy =
        legacyRelative.length > 0 &&
        !legacyRelative.startsWith(`..${sep}`) &&
        legacyRelative !== ".." &&
        !legacyRelative.includes(sep) &&
        LEGACY_PROFILE_NAME.test(legacyRelative);
      const storageLayout =
        item.storageLayout ?? (managed ? "workspace" : "legacy_profile");
      if (
        seenIds.has(item.id) ||
        seenDirectories.has(userDataDir) ||
        (storageLayout === "workspace" ? !managed : !legacy)
      ) {
        throw new RoveError({
          code: "INVALID_CONFIGURATION",
          message: "The browser workspace catalog is invalid.",
        });
      }
      seenIds.add(item.id);
      seenDirectories.add(userDataDir);
      return { ...item, userDataDir, storageLayout };
    });
    if (
      stored.selectedWorkspaceId !== undefined &&
      !seenIds.has(stored.selectedWorkspaceId)
    ) {
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "The browser workspace catalog is invalid.",
      });
    }
    return {
      schemaVersion: 1,
      ...(stored.selectedWorkspaceId === undefined
        ? {}
        : { selectedWorkspaceId: stored.selectedWorkspaceId }),
      workspaces,
    };
  }

  private async readStoredCatalog(): Promise<
    StoredBrowserWorkspaceCatalog | undefined
  > {
    try {
      const catalog = parseStoredCatalog(
        await readFile(this.catalogPath, "utf8"),
      );
      if (catalog === undefined) {
        throw new RoveError({
          code: "INVALID_CONFIGURATION",
          message: "The browser workspace catalog is invalid.",
        });
      }
      return catalog;
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  private async readCatalog(): Promise<BrowserWorkspaceCatalog> {
    const stored = await this.readStoredCatalog();
    if (stored === undefined) {
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "The browser workspace catalog was not initialized.",
      });
    }
    return this.normalizeAndValidate(stored);
  }

  private async mutate<T>(
    operation: (catalog: BrowserWorkspaceCatalog) => Promise<T>,
  ): Promise<T> {
    let resolveResult!: (value: T | PromiseLike<T>) => void;
    let rejectResult!: (reason?: unknown) => void;
    const result = new Promise<T>(
      (resolveResultPromise, rejectResultPromise) => {
        resolveResult = resolveResultPromise;
        rejectResult = rejectResultPromise;
      },
    );
    this.mutationQueue = this.mutationQueue
      .then(async () => {
        const catalog = await this.readCatalog();
        const value = await operation(catalog);
        await this.writeCatalog(catalog);
        resolveResult(value);
      })
      .catch((error) => {
        rejectResult(error);
      });
    return result;
  }

  private async writeCatalog(catalog: BrowserWorkspaceCatalog): Promise<void> {
    await mkdir(this.home, { recursive: true });
    const temporary = `${this.catalogPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.catalogPath);
  }
}
