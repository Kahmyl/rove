import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RoveError, type Evidence, type EvidencePayload, type EvidenceReadResult, type SaveEvidenceRequest } from "@rove/protocol";
import type { EvidenceStore } from "@rove/storage";
import { EVIDENCE_STORE } from "../tokens.js";

@Injectable()
export class EvidenceService {
  constructor(@Inject(EVIDENCE_STORE) private readonly evidence: EvidenceStore) {}

  async save(sessionId: string, request: SaveEvidenceRequest): Promise<Evidence> {
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
      ...(request.pageRevision === undefined ? {} : { pageRevision: request.pageRevision }),
      ...(request.url === undefined ? {} : { url: request.url }),
      ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
    };
    await this.evidence.save(item, payload);
    return item;
  }

  list(sessionId: string): Promise<Evidence[]> {
    return this.evidence.list(sessionId);
  }

  async read(sessionId: string, evidenceId: string): Promise<EvidenceReadResult> {
    const evidence = (await this.evidence.list(sessionId)).find((item) => item.id === evidenceId);
    if (evidence === undefined) {
      throw new RoveError({ code: "EVIDENCE_NOT_FOUND", message: "Evidence was not found." });
    }
    return this.toReadResult(evidence, await this.evidence.read(sessionId, evidenceId));
  }

  private toReadResult(evidence: Evidence, payload: EvidencePayload): EvidenceReadResult {
    if (payload instanceof Uint8Array) {
      return { evidence, binary: { available: true, encoding: "external" } };
    }
    return { evidence, content: payload };
  }
}
