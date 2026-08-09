import { RoveError, type TargetReference } from "@rove/protocol";
import type { TargetIdentity } from "./target-identity.js";

export interface RegisteredTarget<THandle = unknown> {
  reference: TargetReference;
  identity: TargetIdentity;
  handle: THandle;
}

export class TargetRegistry<THandle = unknown> {
  private readonly targets = new Map<string, RegisteredTarget<THandle>>();
  private counter = 0;

  constructor(
    readonly pageId: string,
    private revision: number,
  ) {}

  register(identity: TargetIdentity, handle: THandle): RegisteredTarget<THandle> {
    this.counter += 1;
    const ref = `t${this.counter}`;
    const target = {
      reference: { pageId: this.pageId, revision: this.revision, ref },
      identity,
      handle,
    };
    this.targets.set(ref, target);
    return target;
  }

  resolve(reference: TargetReference): RegisteredTarget<THandle> {
    if (reference.pageId !== this.pageId) {
      throw new RoveError({ code: "PAGE_NOT_FOUND", message: "Target belongs to another page." });
    }
    if (reference.revision !== this.revision) {
      throw new RoveError({
        code: "TARGET_STALE",
        message: "Target belongs to an older page revision.",
        retryable: true,
        details: { expectedRevision: this.revision, receivedRevision: reference.revision },
      });
    }
    const target = this.targets.get(reference.ref);
    if (!target) throw new RoveError({ code: "TARGET_NOT_FOUND", message: "Target was not found." });
    return target;
  }

  invalidate(nextRevision: number): void {
    this.revision = nextRevision;
    this.targets.clear();
    this.counter = 0;
  }
}
