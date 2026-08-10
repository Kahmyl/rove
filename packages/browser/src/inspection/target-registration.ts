import type { Page } from "playwright";

import {
  TargetRegistry,
  type RegisteredTarget,
} from "../targets/target-registry.js";
import type { IdentifiedTargetCandidate } from "./target-identity-builder.js";

export interface TargetHandle {
  marker: string;
}

export interface RegisteredInspectionTarget {
  candidate: IdentifiedTargetCandidate;
  registered: RegisteredTarget<TargetHandle>;
}

export class PageTargetRegistryStore {
  private readonly registries = new Map<
    string,
    TargetRegistry<TargetHandle>
  >();

  beginInspection(
    pageId: string,
    revision: number,
  ): TargetRegistry<TargetHandle> {
    const registry = new TargetRegistry<TargetHandle>(
      pageId,
      revision,
    );

    this.registries.set(pageId, registry);

    return registry;
  }

  get(pageId: string): TargetRegistry<TargetHandle> | undefined {
    return this.registries.get(pageId);
  }

  delete(pageId: string): void {
    this.registries.delete(pageId);
  }

  clear(): void {
    this.registries.clear();
  }
}

export function registerIdentifiedTargets(
  page: Page,
  registry: TargetRegistry<TargetHandle>,
  candidates: IdentifiedTargetCandidate[],
): RegisteredInspectionTarget[] {
  return candidates.map((candidate) => {
    const registered = registry.register(candidate.identity, {
      marker: candidate.marker,
    });

    return {
      candidate,
      registered,
    };
  });
}
