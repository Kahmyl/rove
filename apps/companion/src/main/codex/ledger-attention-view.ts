import type { TaskEngineStore } from "@rove/protocol";

import type { AttentionRequest } from "./attention.js";
import type { ProductAttentionPort } from "./local-product-api.js";

/** Read-only product view over aggregate attention truth. It cannot resolve,
 * cancel, flush or otherwise advance lifecycle state. */
export class LedgerAttentionView implements ProductAttentionPort {
  private entries: AttentionRequest[] = [];

  constructor(private readonly store: TaskEngineStore) {}

  async refresh(): Promise<void> {
    const projections = await this.store.projections();
    this.entries = projections.flatMap((projection) =>
      projection.attentions.map(
        (attention, index) =>
          ({
            authority: attention.authority,
            kind: attention.kind,
            requestId: attention.requestId,
            taskId: attention.taskId,
            ...(attention.threadId ? { threadId: attention.threadId } : {}),
            ...(attention.turnId ? { turnId: attention.turnId } : {}),
            ...(attention.itemId ? { itemId: attention.itemId } : {}),
            generation: attention.generation,
            status: attention.status,
            sequence: index,
            payload: structuredClone(attention.responseFields ?? {}),
            ...(attention.method ? { method: attention.method } : {}),
          }) as AttentionRequest,
      ),
    );
  }

  list(): AttentionRequest[] {
    return structuredClone(this.entries);
  }

  requireExact(
    identity: Parameters<ProductAttentionPort["requireExact"]>[0],
  ): AttentionRequest {
    const found = this.entries.find(
      (entry) =>
        entry.authority === identity.authority &&
        entry.requestId === identity.requestId &&
        entry.taskId === identity.taskId &&
        entry.generation === identity.generation &&
        (identity.threadId === undefined ||
          entry.threadId === identity.threadId) &&
        (identity.turnId === undefined || entry.turnId === identity.turnId) &&
        (identity.itemId === undefined || entry.itemId === identity.itemId),
    );
    if (!found) throw new Error("Stale or mismatched attention response.");
    return structuredClone(found);
  }
}
