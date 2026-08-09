import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Actor, Observation, ObservationPage, ObservationQuery } from "@rove/protocol";
import type { ObservationStore } from "@rove/storage";
import { OBSERVATION_STORE } from "../tokens.js";

export interface AppendObservationInput {
  actor: Actor;
  type: string;
  data: unknown;
  pageId?: string;
  pageRevision?: number;
}

@Injectable()
export class ObservationService {
  private readonly sequences = new Map<string, number>();

  constructor(@Inject(OBSERVATION_STORE) private readonly observations: ObservationStore) {}

  async append(sessionId: string, input: AppendObservationInput): Promise<Observation> {
    const seq = await this.nextSeq(sessionId);
    const observation: Observation = {
      id: `obs_${randomUUID().replaceAll("-", "")}`,
      seq,
      timestamp: new Date().toISOString(),
      actor: input.actor,
      type: input.type,
      data: input.data,
      ...(input.pageId === undefined ? {} : { pageId: input.pageId }),
      ...(input.pageRevision === undefined ? {} : { pageRevision: input.pageRevision }),
    };
    await this.observations.append(sessionId, observation);
    return observation;
  }

  async list(sessionId: string, query?: ObservationQuery): Promise<ObservationPage> {
    const items = await this.observations.list(sessionId, query);
    const last = items.at(-1);
    return { items, ...(last === undefined ? {} : { nextSeq: last.seq }) };
  }

  private async nextSeq(sessionId: string): Promise<number> {
    const cached = this.sequences.get(sessionId);
    if (cached !== undefined) {
      this.sequences.set(sessionId, cached + 1);
      return cached + 1;
    }
    const existing = await this.observations.list(sessionId, { limit: 1_000 });
    const next = (existing.at(-1)?.seq ?? 0) + 1;
    this.sequences.set(sessionId, next);
    return next;
  }
}
