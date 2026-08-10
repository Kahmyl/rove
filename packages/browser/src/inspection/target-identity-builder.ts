import {
  isSensitiveTarget,
  type TargetIdentity,
} from "../targets/target-identity.js";
import type { SemanticCandidate } from "./dom-types.js";

export interface IdentifiedTargetCandidate extends SemanticCandidate {
  identity: TargetIdentity;
  sensitive: boolean;
}

export function buildTargetIdentity(
  candidate: SemanticCandidate,
): TargetIdentity {
  return {
    ...(candidate.role === undefined
      ? {}
      : { role: candidate.role }),

    ...(candidate.name === undefined
      ? {}
      : { name: candidate.name }),

    tag: candidate.tag,

    ...(candidate.type === undefined
      ? {}
      : { type: candidate.type }),

    ...(candidate.text === ""
      ? {}
      : { text: candidate.text }),

    ...(candidate.id === undefined
      ? {}
      : { id: candidate.id }),

    ...(candidate.testId === undefined
      ? {}
      : { testId: candidate.testId }),

    ...(candidate.attributes === undefined
      ? {}
      : { attributes: { ...candidate.attributes } }),

    ...(candidate.domPathHint === undefined
      ? {}
      : { domPathHint: candidate.domPathHint }),
  };
}

export function identifyTargetCandidate(
  candidate: SemanticCandidate,
): IdentifiedTargetCandidate {
  const identity = buildTargetIdentity(candidate);

  return {
    ...candidate,
    identity,
    sensitive: isSensitiveTarget(identity),
  };
}

export function identifyTargetCandidates(
  candidates: SemanticCandidate[],
): IdentifiedTargetCandidate[] {
  return candidates.map(identifyTargetCandidate);
}
