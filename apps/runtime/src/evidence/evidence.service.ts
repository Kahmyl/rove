import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import {
  RoveError,
  type Artifact,
  type Evidence,
  type EvidencePayload,
  type EvidenceReadResult,
  type SaveEvidenceRequest,
  type ScreenshotOptions,
} from "@rove/protocol";
import type { EvidenceStore } from "@rove/storage";
import { EVIDENCE_STORE } from "../tokens.js";

@Injectable()
export class EvidenceService {
  constructor(
    @Inject(EVIDENCE_STORE) private readonly evidence: EvidenceStore,
  ) {}

  async save(
    sessionId: string,
    request: SaveEvidenceRequest,
  ): Promise<Evidence> {
    return this.savePayload(sessionId, request, request.payload);
  }

  async savePayload(
    sessionId: string,
    request: Omit<SaveEvidenceRequest, "payload">,
    payload: EvidencePayload,
  ): Promise<Evidence> {
    const item: Evidence = {
      id: `ev_${randomUUID().replaceAll("-", "")}`,
      sessionId,
      type: request.type,
      createdAt: new Date().toISOString(),
      ...(request.label === undefined ? {} : { label: request.label }),
      ...(request.pageId === undefined ? {} : { pageId: request.pageId }),
      ...(request.pageRevision === undefined
        ? {}
        : { pageRevision: request.pageRevision }),
      ...(request.url === undefined ? {} : { url: request.url }),
      ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
    };
    await this.persist(item, payload);
    return item;
  }

  async saveScreenshot(
    sessionId: string,
    artifact: Artifact,
    options: ScreenshotOptions = {},
  ): Promise<Evidence> {
    const metadata = artifact.metadata ?? {};

    const item: Evidence = {
      id: `ev_${randomUUID().replaceAll("-", "")}`,
      sessionId,
      type: "screenshot",
      createdAt:
        typeof metadata.timestamp === "string"
          ? metadata.timestamp
          : new Date().toISOString(),
      ...(options.label === undefined ? {} : { label: options.label }),
      ...(typeof metadata.pageId === "string"
        ? { pageId: metadata.pageId }
        : {}),
      ...(typeof metadata.revision === "number"
        ? {
            pageRevision: metadata.revision,
          }
        : {}),
      ...(typeof metadata.url === "string" ? { url: metadata.url } : {}),
      metadata: {
        mimeType: artifact.mimeType,
        mode: options.mode ?? "viewport",
        ...(typeof metadata.observationId === "string"
          ? {
              observationId: metadata.observationId,
            }
          : {}),
        ...(metadata.viewport === undefined
          ? {}
          : {
              viewport: metadata.viewport,
            }),
        ...(metadata.region === undefined
          ? {}
          : {
              region: metadata.region,
            }),
        ...(metadata.targetBounds === undefined
          ? {}
          : {
              targetBounds: metadata.targetBounds,
            }),
      },
    };

    await this.persist(item, artifact.bytes);

    return item;
  }

  async saveFileArtifact(
    sessionId: string,
    input: {
      filename: string;
      mimeType: string;
      bytes: Uint8Array;
      source: "agent_generated" | "user_file_grant";
      grantId?: string;
    },
  ): Promise<Evidence> {
    return this.savePayload(
      sessionId,
      {
        type: "file",
        label: input.filename,
        metadata: {
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: input.bytes.byteLength,
          sha256: createHash("sha256").update(input.bytes).digest("hex"),
          source: input.source,
          ...(input.grantId === undefined ? {} : { grantId: input.grantId }),
        },
      },
      input.bytes,
    );
  }

  list(sessionId: string): Promise<Evidence[]> {
    return this.evidence.list(sessionId);
  }

  async deleteGrant(sessionId: string, grantId: string): Promise<number> {
    if (!/^grant_[a-f0-9]{32}$/u.test(grantId))
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "File grant identity is invalid.",
      });
    if (!this.evidence.delete)
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "Evidence cleanup is unavailable.",
      });
    const matches = (await this.evidence.list(sessionId)).filter(
      (item) =>
        item.type === "file" &&
        item.metadata?.source === "user_file_grant" &&
        item.metadata.grantId === grantId,
    );
    for (const item of matches) await this.evidence.delete(sessionId, item.id);
    return matches.length;
  }

  async metadata(sessionId: string, evidenceId: string): Promise<Evidence> {
    const item = (await this.evidence.list(sessionId)).find(
      (candidate) => candidate.id === evidenceId,
    );
    if (!item)
      throw new RoveError({
        code: "EVIDENCE_NOT_FOUND",
        message: "Evidence was not found.",
      });
    return item;
  }

  async read(
    sessionId: string,
    evidenceId: string,
  ): Promise<EvidenceReadResult> {
    const item = await this.metadata(sessionId, evidenceId);
    const payload = await this.evidence.read(sessionId, evidenceId);
    if (payload instanceof Uint8Array) {
      return { ...item, binary: { available: true, encoding: "external" } };
    }
    return { ...item, content: payload };
  }

  async readFilePayload(
    sessionId: string,
    evidenceId: string,
  ): Promise<{
    filename: string;
    bytes: Uint8Array;
  }> {
    const item = await this.metadata(sessionId, evidenceId);

    if (item.type !== "file") {
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "Upload source evidence must be a Rove file artifact.",
      });
    }

    const payload = await this.evidence.read(sessionId, evidenceId);

    if (!(payload instanceof Uint8Array)) {
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "Upload source evidence does not contain binary file payload.",
      });
    }

    const metadataName =
      typeof item.metadata?.filename === "string"
        ? item.metadata.filename
        : undefined;

    const candidate = metadataName ?? item.label ?? "upload.bin";

    const filename =
      candidate
        .replace(/[\\/]/g, "_")
        .replace(/[^\P{Cc}\t\n\r]/gu, "")
        .trim()
        .slice(0, 200) || "upload.bin";

    return {
      filename,
      bytes: payload,
    };
  }

  private async persist(
    item: Evidence,
    payload: EvidencePayload,
  ): Promise<void> {
    try {
      await this.evidence.save(item, payload);
    } catch (error) {
      if (error instanceof RoveError) throw error;
      throw new RoveError({
        code: "EVIDENCE_WRITE_FAILED",
        message: "Evidence could not be persisted.",
      });
    }
  }
}
