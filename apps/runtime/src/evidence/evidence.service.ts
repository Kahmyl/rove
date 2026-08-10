import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RoveError, type Artifact, type Evidence, type SaveEvidenceRequest, type ScreenshotOptions } from "@rove/protocol";
import type { EvidenceStore } from "@rove/storage";
import { EVIDENCE_STORE } from "../tokens.js";

@Injectable()
export class EvidenceService {
  constructor(@Inject(EVIDENCE_STORE) private readonly evidence: EvidenceStore) {}

  async save(sessionId: string, request: SaveEvidenceRequest): Promise<Evidence> {
    const item: Evidence = {
      id: `ev_${randomUUID().replaceAll("-", "")}`,
      sessionId,
      type: request.type,
      createdAt: new Date().toISOString(),
      ...(request.label === undefined ? {} : { label: request.label }),
      ...(request.pageId === undefined ? {} : { pageId: request.pageId }),
      ...(request.pageRevision === undefined ? {} : { pageRevision: request.pageRevision }),
      ...(request.url === undefined ? {} : { url: request.url }),
      ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
    };
    await this.persist(item, request.payload);
    return item;
  }

  async saveScreenshot(sessionId: string, artifact: Artifact, options: ScreenshotOptions = {}): Promise<Evidence> {
    const metadata = artifact.metadata ?? {};
    const item: Evidence = {
      id: `ev_${randomUUID().replaceAll("-", "")}`,
      sessionId,
      type: "screenshot",
      createdAt: typeof metadata.timestamp === "string" ? metadata.timestamp : new Date().toISOString(),
      ...(typeof metadata.pageId === "string" ? { pageId: metadata.pageId } : {}),
      ...(typeof metadata.revision === "number" ? { pageRevision: metadata.revision } : {}),
      ...(typeof metadata.url === "string" ? { url: metadata.url } : {}),
      metadata: { mimeType: "image/png", mode: options.mode ?? "viewport" },
    };
    await this.persist(item, artifact.bytes);
    return item;
  }

  list(sessionId: string): Promise<Evidence[]> {
    return this.evidence.list(sessionId);
  }

  async metadata(sessionId: string, evidenceId: string): Promise<Evidence> {
    const item = (await this.evidence.list(sessionId)).find((candidate) => candidate.id === evidenceId);
    if (!item) throw new RoveError({ code: "EVIDENCE_NOT_FOUND", message: "Evidence was not found." });
    return item;
  }

  private async persist(item: Evidence, payload: SaveEvidenceRequest["payload"] | Uint8Array): Promise<void> {
    try {
      await this.evidence.save(item, payload);
    } catch (error) {
      if (error instanceof RoveError) throw error;
      throw new RoveError({ code: "EVIDENCE_WRITE_FAILED", message: "Evidence could not be persisted." });
    }
  }
}
