import type {
  ActionOutcome,
  ActionResult,
  BrowserActionEffect,
  BrowserActionProposal,
  BrowserInteractionRequest,
  BrowserObservation,
  EffectVerification,
  ExpectedEffect,
  PageSummary,
  PageTarget,
  TargetReference,
  VerifiedInteractionRequest,
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

function targetEvidenceIncomplete(observation: BrowserObservation): boolean {
  if (observation.targetEvidence !== undefined) {
    return observation.targetEvidence.completeness !== "complete";
  }
  return targetsTruncated(observation);
}

function textTruncated(observation: BrowserObservation): boolean {
  return observation.metadata?.textTruncated === true;
}

function causalTransition(
  predecessorDesired: boolean | undefined,
  successorDesired: boolean | undefined,
): EffectVerification["state"] {
  if (predecessorDesired === undefined || successorDesired === undefined)
    return "unresolved";
  if (!successorDesired) return "contradicted";
  return predecessorDesired ? "unresolved" : "observed";
}

function targetWithinScope(
  target: PageTarget,
  expected: { kind: string; label?: string | undefined },
): boolean {
  return (target.perceived?.scopes ?? []).some(
    (scope) =>
      scope.kind === expected.kind &&
      (expected.label === undefined ||
        normalize(scope.label) === normalize(expected.label)),
  );
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
  if (effect.kind === "download_completed") {
    return { effect, state: "unresolved" };
  }

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
        state: causalTransition(
          predecessor.url === effect.url,
          successor.url === effect.url,
        ),
      };

    case "url_changed":
      return {
        effect,
        state: successor.url !== predecessor.url ? "observed" : "contradicted",
      };

    case "text_present": {
      const beforePresent = predecessor.text?.includes(effect.text) === true;
      const present = successor.text?.includes(effect.text) === true;

      return {
        effect,
        state:
          textTruncated(predecessor) || textTruncated(successor)
            ? "unresolved"
            : causalTransition(beforePresent, present),
      };
    }

    case "text_absent": {
      const beforePresent = predecessor.text?.includes(effect.text) === true;
      const present = successor.text?.includes(effect.text) === true;

      return {
        effect,
        state:
          textTruncated(predecessor) || textTruncated(successor)
            ? "unresolved"
            : causalTransition(!beforePresent, !present),
      };
    }

    case "target_present":
    case "target_absent":
    case "target_enabled":
    case "target_disabled":
    case "target_checked":
    case "target_unchecked":
    case "target_focused":
    case "target_blurred":
    case "target_expanded":
    case "target_collapsed":
    case "target_pressed":
    case "target_unpressed":
    case "target_selected":
    case "target_unselected":
    case "target_open":
    case "target_closed":
    case "target_value":
    case "target_files":
    case "target_numeric_value":
    case "target_within_scope":
    case "target_outside_scope":
    case "selected_value": {
      if (
        targetEvidenceIncomplete(predecessor) ||
        targetEvidenceIncomplete(successor)
      ) {
        return { effect, state: "unresolved" };
      }

      const beforeMatches = matchingTargets(predecessor, effect.target);
      const matches = matchingTargets(successor, effect.target);

      if (
        effect.kind === "target_within_scope" ||
        effect.kind === "target_outside_scope"
      ) {
        const within = matches.some((target) =>
          targetWithinScope(target, effect.scope),
        );
        const beforeWithin = beforeMatches.some((target) =>
          targetWithinScope(target, effect.scope),
        );
        const predecessorKnown =
          beforeMatches.length > 0 || !targetEvidenceIncomplete(predecessor);
        if (effect.kind === "target_within_scope") {
          return {
            effect,
            state:
              !predecessorKnown || targetEvidenceIncomplete(successor)
                ? "unresolved"
                : causalTransition(beforeWithin, within),
          };
        }
        return {
          effect,
          state:
            !predecessorKnown || targetEvidenceIncomplete(successor)
              ? "unresolved"
              : causalTransition(!beforeWithin, !within),
        };
      }

      if (effect.kind === "target_present") {
        return {
          effect,
          state:
            targetEvidenceIncomplete(predecessor) ||
            targetEvidenceIncomplete(successor)
              ? "unresolved"
              : causalTransition(beforeMatches.length > 0, matches.length > 0),
        };
      }

      if (effect.kind === "target_absent") {
        return {
          effect,
          state:
            targetEvidenceIncomplete(predecessor) ||
            targetEvidenceIncomplete(successor)
              ? "unresolved"
              : causalTransition(
                  beforeMatches.length === 0,
                  matches.length === 0,
                ),
        };
      }

      if (matches.length !== 1) {
        return {
          effect,
          state:
            matches.length === 0 && !targetEvidenceIncomplete(successor)
              ? "contradicted"
              : "unresolved",
        };
      }

      const target = matches[0]!;
      if (beforeMatches.length !== 1) return { effect, state: "unresolved" };
      const beforeTarget = beforeMatches[0]!;

      if (effect.kind === "target_enabled") {
        return {
          effect,
          state: causalTransition(beforeTarget.enabled, target.enabled),
        };
      }

      if (effect.kind === "target_disabled") {
        return {
          effect,
          state: causalTransition(!beforeTarget.enabled, !target.enabled),
        };
      }

      if (
        effect.kind === "target_checked" ||
        effect.kind === "target_unchecked"
      ) {
        const checked = target.state?.checked;
        const beforeChecked = beforeTarget.state?.checked;

        if (
          typeof checked !== "boolean" ||
          typeof beforeChecked !== "boolean"
        ) {
          return {
            effect,
            state: "unresolved",
          };
        }

        const wanted = effect.kind === "target_checked";

        return {
          effect,
          state: causalTransition(beforeChecked === wanted, checked === wanted),
        };
      }

      const booleanState =
        effect.kind === "target_focused" || effect.kind === "target_blurred"
          ? target.state?.focused
          : effect.kind === "target_expanded" ||
              effect.kind === "target_collapsed"
            ? target.state?.expanded
            : effect.kind === "target_pressed" ||
                effect.kind === "target_unpressed"
              ? target.state?.pressed
              : effect.kind === "target_selected" ||
                  effect.kind === "target_unselected"
                ? target.state?.selected
                : effect.kind === "target_open" ||
                    effect.kind === "target_closed"
                  ? target.state?.open
                  : undefined;
      const beforeBooleanState =
        effect.kind === "target_focused" || effect.kind === "target_blurred"
          ? beforeTarget.state?.focused
          : effect.kind === "target_expanded" ||
              effect.kind === "target_collapsed"
            ? beforeTarget.state?.expanded
            : effect.kind === "target_pressed" ||
                effect.kind === "target_unpressed"
              ? beforeTarget.state?.pressed
              : effect.kind === "target_selected" ||
                  effect.kind === "target_unselected"
                ? beforeTarget.state?.selected
                : effect.kind === "target_open" ||
                    effect.kind === "target_closed"
                  ? beforeTarget.state?.open
                  : undefined;

      if (
        effect.kind === "target_focused" ||
        effect.kind === "target_blurred" ||
        effect.kind === "target_expanded" ||
        effect.kind === "target_collapsed" ||
        effect.kind === "target_pressed" ||
        effect.kind === "target_unpressed" ||
        effect.kind === "target_selected" ||
        effect.kind === "target_unselected" ||
        effect.kind === "target_open" ||
        effect.kind === "target_closed"
      ) {
        if (
          typeof booleanState !== "boolean" ||
          typeof beforeBooleanState !== "boolean"
        ) {
          return { effect, state: "unresolved" };
        }
        const wanted =
          effect.kind === "target_focused" ||
          effect.kind === "target_expanded" ||
          effect.kind === "target_pressed" ||
          effect.kind === "target_selected" ||
          effect.kind === "target_open";
        return {
          effect,
          state: causalTransition(
            beforeBooleanState === wanted,
            booleanState === wanted,
          ),
        };
      }

      if (effect.kind === "target_value") {
        if (
          target.sensitive === true ||
          beforeTarget.sensitive === true ||
          target.state?.value === undefined ||
          beforeTarget.state?.value === undefined
        ) {
          return { effect, state: "unresolved" };
        }
        return {
          effect,
          state: causalTransition(
            beforeTarget.state.value === effect.value,
            target.state.value === effect.value,
          ),
        };
      }

      if (effect.kind === "target_files") {
        if (
          target.sensitive === true ||
          beforeTarget.sensitive === true ||
          target.state?.files === undefined ||
          beforeTarget.state?.files === undefined
        ) {
          return { effect, state: "unresolved" };
        }
        const matches = (
          files: Array<{ name: string; size: number; sha256: string }>,
        ) =>
          files.length === effect.files.length &&
          effect.files.every((expected) =>
            files.some(
              (file) =>
                file.name === expected.name && file.sha256 === expected.sha256,
            ),
          );
        return {
          effect,
          state: causalTransition(
            matches(beforeTarget.state.files),
            matches(target.state.files),
          ),
        };
      }

      if (effect.kind === "target_numeric_value") {
        if (
          target.state?.valueNow === undefined ||
          beforeTarget.state?.valueNow === undefined
        ) {
          return { effect, state: "unresolved" };
        }
        return {
          effect,
          state: causalTransition(
            beforeTarget.state.valueNow === effect.value,
            target.state.valueNow === effect.value,
          ),
        };
      }

      if (target.sensitive === true || beforeTarget.sensitive === true) {
        return {
          effect,
          state: "unresolved",
        };
      }

      const selected = target.state?.selectedValues;
      const beforeSelected = beforeTarget.state?.selectedValues;

      if (!Array.isArray(selected) || !Array.isArray(beforeSelected)) {
        return {
          effect,
          state: "unresolved",
        };
      }

      return {
        effect,
        state: causalTransition(
          beforeSelected.includes(effect.value),
          selected.includes(effect.value),
        ),
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

export function verifyExpectedTargetPresentState(
  effect: Extract<ExpectedEffect, { kind: "target_present" }>,
  observation: BrowserObservation,
): EffectVerification {
  const matches = matchingTargets(observation, effect.target);
  return {
    effect,
    state: targetEvidenceIncomplete(observation)
      ? "unresolved"
      : matches.length > 0
        ? "observed"
        : "contradicted",
  };
}

export function verifyExpectedCurrentStates(
  expectedEffects: ExpectedEffect[],
  observation: BrowserObservation,
): EffectVerification[] {
  return expectedEffects.map((effect) => {
    if (effect.kind === "target_present")
      return verifyExpectedTargetPresentState(effect, observation);
    if (effect.kind === "text_present" || effect.kind === "text_absent") {
      const present = observation.text?.includes(effect.text) === true;
      return {
        effect,
        state: textTruncated(observation)
          ? "unresolved"
          : effect.kind === "text_present"
            ? present
              ? "observed"
              : "contradicted"
            : present
              ? "contradicted"
              : "observed",
      };
    }
    if (
      effect.kind === "target_within_scope" ||
      effect.kind === "target_outside_scope"
    ) {
      const matches = matchingTargets(observation, effect.target);
      const within = matches.some((target) =>
        targetWithinScope(target, effect.scope),
      );
      return {
        effect,
        state: targetEvidenceIncomplete(observation)
          ? "unresolved"
          : effect.kind === "target_within_scope"
            ? within
              ? "observed"
              : "contradicted"
            : matches.length > 0 && !within
              ? "observed"
              : "contradicted",
      };
    }
    if (effect.kind === "url_equals")
      return {
        effect,
        state: observation.url === effect.url ? "observed" : "contradicted",
      };
    return { effect, state: "unresolved" };
  });
}

export interface ExpectedEffectEvidenceIssue {
  effectIndex: number;
  effect: ExpectedEffect;
  evidenceSurface: "page_text";
  reason: "predecessor_text_truncated";
}

export function assessExpectedEffectEvidenceSuitability(
  expectedEffects: ExpectedEffect[],
  predecessor: BrowserObservation,
): ExpectedEffectEvidenceIssue[] {
  if (!textTruncated(predecessor)) return [];

  return expectedEffects.flatMap((effect, effectIndex) =>
    effect.kind === "text_present" || effect.kind === "text_absent"
      ? [
          {
            effectIndex,
            effect,
            evidenceSurface: "page_text" as const,
            reason: "predecessor_text_truncated" as const,
          },
        ]
      : [],
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

  const operation =
    action.kind === "clipboard"
      ? action.operation
      : action.kind === "modified_click"
        ? action.modifiers.join("+")
        : undefined;

  return [
    "interact",
    action.kind,
    target?.ref ?? "page",
    destination,
    operation,
  ]
    .filter((value) => value !== undefined)
    .join(":");
}

const EFFECT_RANK: Record<BrowserActionEffect, number> = {
  observe: 0,
  recover: 1,
  navigate: 1,
  reversible_ui: 2,
  edit_content: 3,
  external_commit: 4,
  irreversible: 5,
  credential_entry: 6,
};

function stricterEffect(
  derived: BrowserActionEffect,
  declared: BrowserActionEffect | undefined,
): BrowserActionEffect {
  if (declared === undefined) return derived;
  return EFFECT_RANK[declared] > EFFECT_RANK[derived] ? declared : derived;
}

/** Runtime-derived lower bound combined with the caller's declaration. */
export function interactionActionProposal(
  request: VerifiedInteractionRequest,
  predecessor: BrowserObservation,
): BrowserActionProposal {
  const target = interactionTarget(request.action);
  const targetState =
    target === undefined
      ? undefined
      : predecessor.targets?.find((candidate) => candidate.ref === target.ref);

  let derived: BrowserActionEffect;
  if (
    (request.action.kind === "fill" ||
      request.action.kind === "type_sequential" ||
      (request.action.kind === "clipboard" &&
        request.action.operation === "paste")) &&
    targetState?.sensitive === true
  ) {
    derived = "credential_entry";
  } else if (request.consequential || request.action.kind === "upload") {
    derived = "external_commit";
  } else if (
    request.action.kind === "fill" ||
    request.action.kind === "type_sequential" ||
    request.action.kind === "clear" ||
    request.action.kind === "select" ||
    request.action.kind === "check" ||
    request.action.kind === "uncheck" ||
    request.action.kind === "drag" ||
    (request.action.kind === "clipboard" && request.action.operation !== "copy")
  ) {
    derived = "edit_content";
  } else {
    derived = "reversible_ui";
  }

  const effect = stricterEffect(derived, request.effect);
  return {
    action: request.action.kind,
    effect,
    explicitlyAuthorized:
      effect !== "external_commit" && effect !== "irreversible"
        ? true
        : request.consequential,
    freshlyGrounded: true,
    outcomeCanBeVerified:
      effect !== "external_commit" || request.expectedEffects.length > 0,
  };
}
