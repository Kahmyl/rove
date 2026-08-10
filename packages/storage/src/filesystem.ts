import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  evidenceSchema,
  observationSchema,
  RoveError,
  sessionSchema,
  type Evidence,
  type EvidencePayload,
  type Observation,
  type ObservationQuery,
  type Session,
} from "@rove/protocol";
import type { EvidenceStore, ObservationStore, SessionStore } from "./interfaces.js";
import { assertSafeSegment, pathWithin } from "./paths.js";

async function atomicJsonWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function sessionDirectory(home: string, sessionId: string): string {
  return pathWithin(home, "sessions", assertSafeSegment(sessionId, "session ID"));
}

export class FileSessionStore implements SessionStore {
  constructor(private readonly home: string) {}

  async create(session: Session): Promise<void> {
    await atomicJsonWrite(pathWithin(sessionDirectory(this.home, session.id), "session.json"), session);
  }

  async get(id: string): Promise<Session | null> {
    try {
      const raw = await readFile(pathWithin(sessionDirectory(this.home, id), "session.json"), "utf8");
      return sessionSchema.parse(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async update(session: Session): Promise<void> {
    await this.create(session);
  }
}

export class FileObservationStore implements ObservationStore {
  constructor(private readonly home: string) {}

  async append(sessionId: string, observation: Observation): Promise<void> {
    const path = pathWithin(sessionDirectory(this.home, sessionId), "observations.jsonl");
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(observationSchema.parse(observation))}\n`, { mode: 0o600 });
  }

  async list(sessionId: string, query: ObservationQuery = {}): Promise<Observation[]> {
    const parsedQuery = { afterSeq: query.afterSeq ?? 0, limit: query.limit ?? 100 };
    try {
      const raw = await readFile(
        pathWithin(sessionDirectory(this.home, sessionId), "observations.jsonl"),
        "utf8",
      );
      return raw
        .split("\n")
        .filter(Boolean)
        .map((line) => observationSchema.parse(JSON.parse(line)))
        .filter((item) => item.seq > parsedQuery.afterSeq)
        .slice(0, parsedQuery.limit);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}

export class FileEvidenceStore implements EvidenceStore {
  constructor(private readonly home: string) {}

  async save(evidence: Evidence, payload: EvidencePayload): Promise<void> {
    const subdirectory = {
      screenshot: "screenshots",
      record: "records",
      page: "pages",
      file: "files",
      text: "records",
    }[evidence.type];
    const directory = pathWithin(sessionDirectory(this.home, evidence.sessionId), "evidence", subdirectory);
    const id = assertSafeSegment(evidence.id, "evidence ID");
    await mkdir(directory, { recursive: true });
    if (payload instanceof Uint8Array) {
      const extension = evidence.type === "screenshot" ? ".png" : ".bin";
      await writeFile(pathWithin(directory, `${id}${extension}`), payload, { mode: 0o600 });
    } else if (typeof payload === "string") {
      await writeFile(pathWithin(directory, `${id}.txt`), payload, { mode: 0o600 });
    } else {
      await atomicJsonWrite(pathWithin(directory, `${id}.json`), payload);
    }
    await atomicJsonWrite(pathWithin(directory, `${id}.metadata.json`), evidenceSchema.parse(evidence));
  }

  async list(sessionId: string): Promise<Evidence[]> {
    const root = pathWithin(sessionDirectory(this.home, sessionId), "evidence");
    const directories = ["screenshots", "records", "pages", "files"];
    const groups = await Promise.all(directories.map(async (subdirectory) => {
      const directory = pathWithin(root, subdirectory);
      try {
        const names = await readdir(directory);
        return Promise.all(names
          .filter((name) => name.endsWith(".metadata.json"))
          .map(async (name) => {
            const raw = await readFile(pathWithin(directory, name), "utf8");
            return evidenceSchema.parse(JSON.parse(raw));
          }));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    }));
    return groups.flat().sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async read(sessionId: string, evidenceId: string): Promise<EvidencePayload> {
    const id = assertSafeSegment(evidenceId, "evidence ID");
    for (const subdirectory of ["screenshots", "records", "pages", "files"]) {
      const directory = pathWithin(sessionDirectory(this.home, sessionId), "evidence", subdirectory);
      for (const extension of [".json", ".txt", ".bin", ".png"] as const) {
        try {
          const payload = await readFile(pathWithin(directory, `${id}${extension}`));
          if (extension === ".json") return JSON.parse(payload.toString("utf8")) as Record<string, unknown>;
          if (extension === ".txt") return payload.toString("utf8");
          return new Uint8Array(payload);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
    throw new RoveError({ code: "EVIDENCE_NOT_FOUND", message: "Evidence payload was not found." });
  }
}
