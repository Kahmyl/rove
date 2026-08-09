import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Evidence, SaveEvidenceRequest } from "@rove/protocol";
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
    await this.evidence.save(item, request.payload);
    return item;
  }
}
