import { describe, expect, it } from "vitest";

import { authoritativePreHandoffObservationSeq } from "./handoff-observation.js";

describe("authoritativePreHandoffObservationSeq", () => {
  it("uses Runtime observation truth when request-human result omits observationSeq", () => {
    expect(
      authoritativePreHandoffObservationSeq({
        result: {
          handoffId: "handoff_live",
          generation: 2,
        },
        runtime: {
          activeHandoffId: "handoff_live",
          activeHandoffGeneration: 2,
          observationSeq: 4,
        },
      }),
    ).toBe(4);
  });

  it("accepts a matching MCP observation sequence only as corroboration", () => {
    expect(
      authoritativePreHandoffObservationSeq({
        result: {
          handoffId: "handoff_live",
          generation: 2,
          observationSeq: 4,
        },
        runtime: {
          activeHandoffId: "handoff_live",
          activeHandoffGeneration: 2,
          observationSeq: 4,
        },
      }),
    ).toBe(4);
  });

  it("keeps the request-time sequence when Runtime has advanced during human takeover", () => {
    expect(
      authoritativePreHandoffObservationSeq({
        result: {
          handoffId: "handoff_live",
          generation: 2,
          observationSeq: 4,
        },
        runtime: {
          activeHandoffId: "handoff_live",
          activeHandoffGeneration: 2,
          observationSeq: 5,
        },
      }),
    ).toBe(4);
  });

  it("rejects an MCP sequence that contradicts Runtime", () => {
    expect(() =>
      authoritativePreHandoffObservationSeq({
        result: {
          handoffId: "handoff_live",
          generation: 2,
          observationSeq: 5,
        },
        runtime: {
          activeHandoffId: "handoff_live",
          activeHandoffGeneration: 2,
          observationSeq: 4,
        },
      }),
    ).toThrow(
      "Completed handoff observation sequence disagrees with authoritative Runtime control truth.",
    );
  });

  it("rejects an active handoff generation mismatch", () => {
    expect(() =>
      authoritativePreHandoffObservationSeq({
        result: {
          handoffId: "handoff_live",
          generation: 2,
        },
        runtime: {
          activeHandoffId: "handoff_live",
          activeHandoffGeneration: 3,
          observationSeq: 4,
        },
      }),
    ).toThrow(
      "Completed handoff generation disagrees with authoritative Runtime control truth.",
    );
  });

  it("rejects missing Runtime observation authority", () => {
    expect(() =>
      authoritativePreHandoffObservationSeq({
        result: {
          handoffId: "handoff_live",
          generation: 2,
        },
        runtime: {
          activeHandoffId: "handoff_live",
          activeHandoffGeneration: 2,
        },
      }),
    ).toThrow(
      "Completed handoff lacks an authoritative Runtime observation sequence.",
    );
  });

  it("accepts the exact returned handoff identity when Runtime still carries sequence truth", () => {
    expect(
      authoritativePreHandoffObservationSeq({
        result: {
          handoffId: "handoff_returned",
          generation: 7,
          observationSeq: 12,
        },
        runtime: {
          lastReturnedHandoffId: "handoff_returned",
          observationSeq: 12,
        },
      }),
    ).toBe(12);
  });
});
