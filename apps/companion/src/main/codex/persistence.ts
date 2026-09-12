import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

export interface VersionedState<T> {
  schemaVersion: number;
  revision: number;
  value: T;
}

export interface StateRepository<T> {
  read(): Promise<VersionedState<T> | undefined>;
  write(expectedRevision: number, value: T): Promise<VersionedState<T>>;
}

export class FileStateRepository<T> implements StateRepository<T> {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly schemaVersion: number,
    private readonly migrate?: (
      state: VersionedState<unknown>,
    ) => T | undefined,
  ) {}

  async read(): Promise<VersionedState<T> | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as Record<
        string,
        unknown
      >;
      if (
        parsed === null ||
        Array.isArray(parsed) ||
        Object.keys(parsed).some(
          (key) => !["schemaVersion", "revision", "value"].includes(key),
        ) ||
        !Number.isInteger(parsed.schemaVersion) ||
        !Number.isInteger(parsed.revision) ||
        Number(parsed.revision) < 0 ||
        !("value" in parsed)
      )
        throw new Error("Invalid persisted state envelope.");
      if (parsed.schemaVersion !== this.schemaVersion) {
        const value = this.migrate?.(
          parsed as unknown as VersionedState<unknown>,
        );
        if (value === undefined)
          throw new Error(
            `State migration required: ${String(parsed.schemaVersion)} -> ${this.schemaVersion}.`,
          );
        const migrated: VersionedState<T> = {
          schemaVersion: this.schemaVersion,
          revision: Number(parsed.revision) + 1,
          value,
        };
        await mkdir(dirname(this.path), { recursive: true });
        await writeFile(`${this.path}.tmp`, `${JSON.stringify(migrated)}\n`, {
          mode: 0o600,
        });
        await rename(`${this.path}.tmp`, this.path);
        return migrated;
      }
      return parsed as unknown as VersionedState<T>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async write(expectedRevision: number, value: T): Promise<VersionedState<T>> {
    let written!: VersionedState<T>;
    const operation = this.queue.then(async () => {
      const current = await this.read();
      if ((current?.revision ?? 0) !== expectedRevision) {
        throw new Error("State revision conflict.");
      }
      written = {
        schemaVersion: this.schemaVersion,
        revision: expectedRevision + 1,
        value,
      };
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, `${JSON.stringify(written)}\n`, {
        mode: 0o600,
      });
      await rename(temporary, this.path);
    });
    this.queue = operation.catch(() => undefined);
    await operation;
    return written;
  }
}

export class MemoryStateRepository<T> implements StateRepository<T> {
  private state?: VersionedState<T>;
  async read(): Promise<VersionedState<T> | undefined> {
    return this.state === undefined ? undefined : structuredClone(this.state);
  }
  async write(expectedRevision: number, value: T): Promise<VersionedState<T>> {
    if ((this.state?.revision ?? 0) !== expectedRevision) {
      throw new Error("State revision conflict.");
    }
    this.state = {
      schemaVersion: 1,
      revision: expectedRevision + 1,
      value: structuredClone(value),
    };
    return structuredClone(this.state);
  }
}

export async function loadOrCreateDeviceSecret(path: string): Promise<Buffer> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    const value = Buffer.from(
      (await readFile(path, "utf8")).trim(),
      "base64url",
    );
    if (value.byteLength !== 32)
      throw new Error("Device secret has invalid length.");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const created = randomBytes(32);
  try {
    await writeFile(path, `${created.toString("base64url")}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    return created;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const value = Buffer.from(
      (await readFile(path, "utf8")).trim(),
      "base64url",
    );
    if (value.byteLength !== 32)
      throw new Error("Device secret has invalid length.");
    return value;
  }
}
