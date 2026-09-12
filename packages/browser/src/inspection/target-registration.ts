import type { Frame } from "playwright";

import {
  TargetRegistry,
  type RegisteredTarget,
} from "../targets/target-registry.js";
import type { IdentifiedTargetCandidate } from "./target-identity-builder.js";
import type { TargetSnapshot } from "./perceived-control.js";

export interface TargetHandle {
  marker: string;
  frameIndex: number;
  frameUrl: string;
  frame?: Frame;
  snapshot?: TargetSnapshot;
  semanticRole?: string;
}

export interface RegisteredInspectionTarget {
  candidate: IdentifiedTargetCandidate;
  registered: RegisteredTarget<TargetHandle>;
}

export interface FramedIdentifiedTargetCandidate {
  candidate: IdentifiedTargetCandidate;
  frame: {
    index: number;
    url: string;
    instance?: Frame;
  };
  snapshot?: TargetSnapshot;
}

export class PageTargetRegistryStore {
  private readonly registries = new Map<string, TargetRegistry<TargetHandle>>();

  beginInspection(
    pageId: string,
    revision: number,
  ): TargetRegistry<TargetHandle> {
    const registry = new TargetRegistry<TargetHandle>(pageId, revision);

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
  registry: TargetRegistry<TargetHandle>,
  candidates: FramedIdentifiedTargetCandidate[],
): RegisteredInspectionTarget[] {
  return candidates.map(({ candidate, frame, snapshot }) => {
    const registered = registry.register(candidate.identity, {
      marker: candidate.marker,
      frameIndex: frame.index,
      frameUrl: frame.url,
      ...(frame.instance === undefined ? {} : { frame: frame.instance }),
      ...(snapshot === undefined ? {} : { snapshot }),
      ...(candidate.semanticRole === undefined
        ? {}
        : { semanticRole: candidate.semanticRole }),
    });

    return {
      candidate,
      registered,
    };
  });
}
