import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname } from "node:path";

import {
  recordingSchema,
  type Recording,
  type RecordingArtifact,
} from "@rove/protocol";

import { assertSafeSegment, pathWithin } from "./paths.js";
import type { RecordingStore } from "./recording-store.js";

const transitions: Readonly<
  Record<Recording["state"], readonly Recording["state"][]>
> = {
  requested: ["recording", "failed"],
  recording: ["finalizing", "failed"],
  finalizing: ["available", "failed"],
  available: [],
  failed: [],
};

async function atomicWrite(path: string, value: Recording): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
}

export class FileRecordingStore implements RecordingStore {
  private readonly updateTails = new Map<string, Promise<void>>();

  constructor(private readonly home: string) {}

  private sessionDirectory(sessionId: string): string {
    return pathWithin(
      this.home,
      "sessions",
      assertSafeSegment(sessionId, "session ID"),
      "recordings",
    );
  }

  private metadataPath(sessionId: string, recordingId: string): string {
    return pathWithin(
      this.sessionDirectory(sessionId),
      `${assertSafeSegment(recordingId, "recording ID")}.json`,
    );
  }

  async create(recording: Recording): Promise<Recording> {
    const parsed = recordingSchema.parse(recording);
    const path = this.metadataPath(parsed.sessionId, parsed.id);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const file = await open(path, "wx", 0o600).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error("Recording identity already exists.");
      throw error;
    });
    try {
      await file.writeFile(`${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    return parsed;
  }

  async update(
    sessionId: string,
    recordingId: string,
    expectedState: Recording["state"],
    next: Recording,
  ): Promise<Recording> {
    const key = `${sessionId}\0${recordingId}`;
    return this.serialize(key, async () => {
      const current = await this.get(sessionId, recordingId);
      if (current === null || current.state !== expectedState)
        throw new Error("Recording state conflict.");
      const parsed = recordingSchema.parse(next);
      if (
        parsed.id !== current.id ||
        parsed.taskId !== current.taskId ||
        parsed.sessionId !== current.sessionId ||
        parsed.mode !== current.mode ||
        JSON.stringify(parsed.scope) !== JSON.stringify(current.scope) ||
        parsed.sensitiveDataPolicy !== current.sensitiveDataPolicy ||
        parsed.includesAudio !== current.includesAudio ||
        parsed.coverage !== current.coverage ||
        JSON.stringify(parsed.exclusions) !==
          JSON.stringify(current.exclusions) ||
        parsed.requestedAt !== current.requestedAt ||
        !transitions[current.state].includes(parsed.state)
      )
        throw new Error("Recording transition is invalid.");
      await atomicWrite(this.metadataPath(sessionId, recordingId), parsed);
      return parsed;
    });
  }

  async get(sessionId: string, recordingId: string): Promise<Recording | null> {
    try {
      return recordingSchema.parse(
        JSON.parse(
          await readFile(this.metadataPath(sessionId, recordingId), "utf8"),
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async list(sessionId: string): Promise<Recording[]> {
    const directory = this.sessionDirectory(sessionId);
    try {
      const names = await readdir(directory);
      const recordings = await Promise.all(
        names
          .filter((name) => /^rec_[a-f0-9]{32}\.json$/u.test(name))
          .map((name) => this.get(sessionId, name.slice(0, -".json".length))),
      );
      return recordings
        .filter((value): value is Recording => value !== null)
        .sort((left, right) =>
          left.requestedAt.localeCompare(right.requestedAt),
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async listAll(): Promise<Recording[]> {
    const sessions = pathWithin(this.home, "sessions");
    try {
      const entries = await readdir(sessions, { withFileTypes: true });
      const groups = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => this.list(entry.name)),
      );
      return groups.flat();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async stagingPath(sessionId: string, recordingId: string): Promise<string> {
    const directory = pathWithin(this.sessionDirectory(sessionId), "staging");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return pathWithin(
      directory,
      `${assertSafeSegment(recordingId, "recording ID")}.partial.webm`,
    );
  }

  async finalizeArtifact(
    sessionId: string,
    recordingId: string,
  ): Promise<RecordingArtifact> {
    const staging = await this.stagingPath(sessionId, recordingId);
    const finalPath = await this.artifactPath(sessionId, recordingId, false);
    const metadata = await this.inspectArtifact(staging, recordingId, false);
    await rename(staging, finalPath);
    await chmod(finalPath, 0o600);
    return metadata;
  }

  async preservePartialArtifact(
    sessionId: string,
    recordingId: string,
  ): Promise<RecordingArtifact | null> {
    const staging = await this.stagingPath(sessionId, recordingId);
    try {
      const size = (await stat(staging)).size;
      if (size <= 0) return null;
      const sha256 = await this.sha256(staging);
      const partialPath = await this.artifactPath(sessionId, recordingId, true);
      await rename(staging, partialPath);
      await chmod(partialPath, 0o600);
      return {
        artifactId: recordingId,
        filename: `${recordingId}.partial.webm`,
        mimeType: "video/webm",
        sizeBytes: size,
        sha256,
        playable: false,
        partial: true,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async artifactPath(
    sessionId: string,
    recordingId: string,
    partial: boolean,
  ): Promise<string> {
    const directory = this.sessionDirectory(sessionId);
    const id = assertSafeSegment(recordingId, "recording ID");
    return pathWithin(directory, `${id}${partial ? ".partial" : ""}.webm`);
  }

  private async inspectArtifact(
    path: string,
    recordingId: string,
    partial: boolean,
  ): Promise<RecordingArtifact> {
    const file = await open(path, "r");
    let magic: Buffer;
    try {
      magic = Buffer.alloc(4);
      await file.read(magic, 0, 4, 0);
    } finally {
      await file.close();
    }
    const size = (await stat(path)).size;
    if (size < 128 || magic.toString("hex") !== "1a45dfa3")
      throw new Error("Recording artifact is not a finalized WebM file.");
    return {
      artifactId: recordingId,
      filename: `${recordingId}${partial ? ".partial" : ""}.webm`,
      mimeType: "video/webm",
      sizeBytes: size,
      sha256: await this.sha256(path),
      playable: !partial,
      partial,
    };
  }

  private async sha256(path: string): Promise<string> {
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(path)) digest.update(chunk);
    return digest.digest("hex");
  }

  private serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.updateTails.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.updateTails.set(key, tail);
    return result.finally(() => {
      if (this.updateTails.get(key) === tail) this.updateTails.delete(key);
    });
  }
}
