import type {
  BrowserObservation,
  PageTarget,
  StructuralScope,
  TargetCapability,
  TargetIntent,
  TargetReference,
  TargetResolution,
  TargetResolutionAlternative,
} from "@rove/protocol";

interface RankedTarget {
  target: PageTarget;
  reference: TargetReference;
  actionable: boolean;
  evidence: string[];
  rank: readonly number[];
}

function normalize(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function textClass(
  requested: string | undefined,
  actual: string | undefined,
): number {
  const left = normalize(requested);
  const right = normalize(actual);

  if (left.length === 0) {
    return 0;
  }

  if (right.length === 0) {
    return 0;
  }

  if (left === right) {
    return 3;
  }

  if (left.includes(right) || right.includes(left)) {
    return 2;
  }

  return 0;
}

function scopeClass(
  requested: StructuralScope | undefined,
  scopes: StructuralScope[] | undefined,
): readonly [number, number] {
  if (requested === undefined) {
    return [0, 0];
  }

  const candidates = scopes ?? [];

  let kind = 0;
  let label = 0;

  for (const scope of candidates) {
    if (scope.kind === requested.kind) {
      kind = 1;
    }

    if (
      scope.kind === requested.kind &&
      normalize(scope.label) !== "" &&
      normalize(scope.label) === normalize(requested.label)
    ) {
      label = 1;
    }
  }

  return [label, kind];
}

function capabilityClass(
  requested: TargetCapability | undefined,
  actual: TargetCapability[] | undefined,
): number {
  if (requested === undefined) {
    return 0;
  }

  return actual?.includes(requested) ? 2 : 0;
}

function frameClass(requested: string | undefined, target: PageTarget): number {
  if (requested === undefined) {
    return 0;
  }

  const expected = normalize(requested);

  const frameValues = [
    target.frame?.name,
    target.frame?.url,
    target.frame?.main ? "main" : undefined,
  ].map(normalize);

  return frameValues.includes(expected) ? 2 : 0;
}

function actionable(target: PageTarget): boolean {
  if (!target.visible || !target.enabled) {
    return false;
  }

  const geometry = target.geometry;

  if (geometry === undefined) {
    return true;
  }

  return geometry.bounds !== null && geometry.inViewport && !geometry.occluded;
}

function compareRank(
  left: readonly number[],
  right: readonly number[],
): number {
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0;

    const r = right[index] ?? 0;

    if (l !== r) {
      return r - l;
    }
  }

  return 0;
}

function sameRank(left: readonly number[], right: readonly number[]): boolean {
  return compareRank(left, right) === 0 && compareRank(right, left) === 0;
}

function rankTarget(
  observation: BrowserObservation,
  intent: TargetIntent,
  target: PageTarget,
): RankedTarget {
  const [exactScopeLabel, scopeKind] = scopeClass(
    intent.scope,
    target.perceived?.scopes,
  );

  const text = textClass(intent.text, target.name);

  const capability = capabilityClass(
    intent.capability,
    target.perceived?.capabilities,
  );

  const frame = frameClass(intent.frameLabel, target);

  const isActionable = actionable(target);

  const evidence: string[] = [];

  if (capability === 2) {
    evidence.push("capability_match");
  }

  if (exactScopeLabel === 1) {
    evidence.push("scope_label_match");
  } else if (scopeKind === 1) {
    evidence.push("scope_kind_match");
  }

  if (text === 3) {
    evidence.push("exact_name_match");
  } else if (text === 2) {
    evidence.push("partial_name_match");
  }

  if (frame === 2) {
    evidence.push("frame_match");
  }

  if (isActionable) {
    evidence.push("actionable");
  } else {
    evidence.push("not_actionable");
  }

  return {
    target,
    reference: {
      pageId: observation.pageId,
      revision: observation.revision,
      ref: target.ref,
    },
    actionable: isActionable,
    evidence,
    // Ordinal evidence only.
    //
    // Safety ordering:
    // 1. requested capability
    // 2. exact requested scope label
    // 3. requested scope kind
    // 4. exact/partial accessible name
    // 5. requested frame
    //
    // Actionability is intentionally NOT
    // part of candidate promotion. A
    // non-actionable strongest candidate
    // blocks fallback to a weaker target.
    rank: [capability, exactScopeLabel, scopeKind, text, frame],
  };
}

export function groundTarget(
  observation: BrowserObservation,
  intent: TargetIntent,
): TargetResolution {
  const targets = observation.targets ?? [];

  const hasConstraint =
    intent.capability !== undefined ||
    normalize(intent.text) !== "" ||
    intent.scope !== undefined ||
    normalize(intent.frameLabel) !== "";

  if (!hasConstraint) {
    return {
      observationId: observation.observationId,
      status: "unresolved",
      alternatives: [],
      reason: "no_candidate",
    };
  }

  if (targets.length === 0) {
    return {
      observationId: observation.observationId,
      status: "unresolved",
      alternatives: [],
      reason: "semantic_gap",
    };
  }

  if (
    intent.capability !== undefined &&
    !targets.some(
      (target) =>
        target.perceived?.capabilities.includes(intent.capability!) === true,
    )
  ) {
    return {
      observationId: observation.observationId,
      status: "unresolved",
      alternatives: targets.slice(0, 10).map((target) => ({
        target: {
          pageId: observation.pageId,
          revision: observation.revision,
          ref: target.ref,
        },
        actionable: actionable(target),
        evidence: ["capability_mismatch"],
      })),
      reason: "no_candidate",
    };
  }

  const ranked = targets
    .map((target) => rankTarget(observation, intent, target))
    .sort((left, right) => compareRank(left.rank, right.rank));

  const alternatives: TargetResolutionAlternative[] = ranked
    .slice(0, 10)
    .map((item) => ({
      target: item.reference,
      actionable: item.actionable,
      evidence: item.evidence,
    }));

  const best = ranked[0];

  if (best === undefined) {
    return {
      observationId: observation.observationId,
      status: "unresolved",
      alternatives,
      reason: "no_candidate",
    };
  }

  const usefulEvidence = best.rank.some((value) => value > 0);

  if (!usefulEvidence) {
    return {
      observationId: observation.observationId,
      status: "unresolved",
      alternatives,
      reason: "no_candidate",
    };
  }

  if (!best.actionable) {
    return {
      observationId: observation.observationId,
      status: "ambiguous",
      alternatives,
      reason: "best_candidate_not_actionable",
    };
  }

  const runnerUp = ranked[1];

  if (runnerUp !== undefined && sameRank(best.rank, runnerUp.rank)) {
    return {
      observationId: observation.observationId,
      status: "ambiguous",
      alternatives,
      reason: "insufficient_separation",
    };
  }

  return {
    observationId: observation.observationId,
    status: "selected",
    target: best.reference,
    alternatives,
    reason: "grounded",
  };
}
