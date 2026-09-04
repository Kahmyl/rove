import type {
  ActionOutcome,
  ActionResult,
  BrowserInteractionRequest,
  BrowserObservation,
  EffectVerification,
  ExpectedEffect,
  PageSummary,
  PageTarget,
  TargetReference,
} from "@rove/protocol";

function normalize(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function matchingTargets(
  observation: BrowserObservation,
  expected: {
    name: string;
    kind?: PageTarget["kind"] | undefined;
  },
): PageTarget[] {
  return (observation.targets ?? []).filter(
    (candidate) =>
      normalize(candidate.name) === normalize(expected.name) &&
      (expected.kind === undefined || candidate.kind === expected.kind),
  );
}

function targetsTruncated(observation: BrowserObservation): boolean {
  return observation.metadata?.targetsTruncated === true;
}

function textTruncated(observation: BrowserObservation): boolean {
  return observation.metadata?.textTruncated === true;
}

function verifyPageLifecycleEffect(
  effect: Extract<ExpectedEffect, { kind: "page_opened" | "page_closed" }>,
  result: ActionResult | undefined,
  beforePages: PageSummary[],
  afterPages: PageSummary[] | undefined,
): EffectVerification {
  if (effect.kind === "page_opened") {
    if ((result?.openedPages?.length ?? 0) > 0) {
      return {
        effect,
        state: "observed",
      };
    }

    if (afterPages === undefined) {
      return {
        effect,
        state: "unresolved",
      };
    }

    const before = new Set(beforePages.map((page) => page.id));

    return {
      effect,
      state: afterPages.some((page) => !before.has(page.id))
        ? "observed"
        : "contradicted",
    };
  }

  if (afterPages === undefined) {
    return {
      effect,
      state: "unresolved",
    };
  }

  const after = new Set(afterPages.map((page) => page.id));

  return {
    effect,
    state: beforePages.some((page) => !after.has(page.id))
      ? "observed"
      : "contradicted",
  };
}

function verifyEffect(
  effect: ExpectedEffect,
  predecessor: BrowserObservation,
  successor: BrowserObservation | undefined,
  result: ActionResult | undefined,
  beforePages: PageSummary[],
  afterPages: PageSummary[] | undefined,
): EffectVerification {
  if (effect.kind === "page_opened" || effect.kind === "page_closed") {
    return verifyPageLifecycleEffect(effect, result, beforePages, afterPages);
  }

  if (successor === undefined) {
    return {
      effect,
      state: "unresolved",
    };
  }

  switch (effect.kind) {
    case "url_equals":
      return {
        effect,
        state: successor.url === effect.url ? "observed" : "contradicted",
      };

    case "url_changed":
      return {
        effect,
        state: successor.url !== predecessor.url ? "observed" : "contradicted",
      };

    case "text_present": {
      const present = successor.text?.includes(effect.text) === true;

      return {
        effect,
        state: present
          ? "observed"
          : textTruncated(successor)
            ? "unresolved"
            : "contradicted",
      };
    }

    case "text_absent": {
      const present = successor.text?.includes(effect.text) === true;

      return {
        effect,
        state: present
          ? "contradicted"
          : textTruncated(successor)
            ? "unresolved"
            : "observed",
      };
    }

    case "target_present":
    case "target_absent":
    case "target_enabled":
    case "target_disabled":
    case "target_checked":
    case "target_unchecked":
    case "selected_value": {
      const matches = matchingTargets(successor, effect.target);

      if (effect.kind === "target_present") {
        return {
          effect,
          state:
            matches.length > 0
              ? "observed"
              : targetsTruncated(successor)
                ? "unresolved"
                : "contradicted",
        };
      }

      if (effect.kind === "target_absent") {
        return {
          effect,
          state:
            matches.length > 0
              ? "contradicted"
              : targetsTruncated(successor)
                ? "unresolved"
                : "observed",
        };
      }

      if (matches.length !== 1) {
        return {
          effect,
          state:
            matches.length === 0 && !targetsTruncated(successor)
              ? "contradicted"
              : "unresolved",
        };
      }

      const target = matches[0]!;

      if (effect.kind === "target_enabled") {
        return {
          effect,
          state: target.enabled ? "observed" : "contradicted",
        };
      }

      if (effect.kind === "target_disabled") {
        return {
          effect,
          state: !target.enabled ? "observed" : "contradicted",
        };
      }

      if (
        effect.kind === "target_checked" ||
        effect.kind === "target_unchecked"
      ) {
        const checked = target.state?.checked;

        if (typeof checked !== "boolean") {
          return {
            effect,
            state: "unresolved",
          };
        }

        const wanted = effect.kind === "target_checked";

        return {
          effect,
          state: checked === wanted ? "observed" : "contradicted",
        };
      }

      if (target.sensitive === true) {
        return {
          effect,
          state: "unresolved",
        };
      }

      const selected = target.state?.selectedValues;

      if (!Array.isArray(selected)) {
        return {
          effect,
          state: "unresolved",
        };
      }

      return {
        effect,
        state: selected.includes(effect.value) ? "observed" : "contradicted",
      };
    }
  }
}

export function verifyExpectedEffects(
  expectedEffects: ExpectedEffect[],
  predecessor: BrowserObservation,
  successor: BrowserObservation | undefined,
  result: ActionResult | undefined,
  beforePages: PageSummary[],
  afterPages: PageSummary[] | undefined,
): EffectVerification[] {
  return expectedEffects.map((effect) =>
    verifyEffect(
      effect,
      predecessor,
      successor,
      result,
      beforePages,
      afterPages,
    ),
  );
}

export function classifyActionOutcome(
  effects: EffectVerification[],
): ActionOutcome {
  if (effects.length === 0) {
    return "unknown";
  }

  if (effects.every((effect) => effect.state === "observed")) {
    return "applied";
  }

  if (effects.some((effect) => effect.state === "unresolved")) {
    return "unknown";
  }

  return "not_applied";
}

export function interactionTarget(
  action: BrowserInteractionRequest,
): TargetReference | undefined {
  return "target" in action ? action.target : undefined;
}

export function interactionSignature(
  action: BrowserInteractionRequest,
): string {
  const target = interactionTarget(action);

  const destination =
    action.kind === "drag" ? action.destination.ref : undefined;

  return ["interact", action.kind, target?.ref ?? "page", destination]
    .filter((value) => value !== undefined)
    .join(":");
}
