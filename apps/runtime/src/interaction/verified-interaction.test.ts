import { describe, expect, it } from "vitest";

import type { BrowserObservation } from "@rove/protocol";

import {
  classifyActionOutcome,
  verifyExpectedEffects,
} from "./verified-interaction.js";

function observation(
  id: string,
  url: string,
  text: string,
): BrowserObservation {
  return {
    observationId: id,
    observedAt: new Date(0).toISOString(),
    mutationVersion: 0,
    pageId: "page_01",
    revision: 1,
    url,
    title: "Fixture",
    document: {
      url,
      revision: 1,
    },
    text,
    targets: [],
  };
}

describe("Phase 2 verified interaction semantics", () => {
  it("requires positive successor evidence for applied", () => {
    const predecessor = observation(
      "before",
      "https://example.test/a",
      "before",
    );

    const successor = observation("after", "https://example.test/b", "done");

    const effects = verifyExpectedEffects(
      [
        {
          kind: "url_changed",
        },
        {
          kind: "text_present",
          text: "done",
        },
      ],
      predecessor,
      successor,
      undefined,
      [],
      [],
    );

    expect(classifyActionOutcome(effects)).toBe("applied");
  });

  it("keeps outcome unknown when successor evidence is unavailable", () => {
    const effects = verifyExpectedEffects(
      [
        {
          kind: "url_changed",
        },
      ],
      observation("before", "https://example.test/a", "before"),
      undefined,
      undefined,
      [],
      [],
    );

    expect(classifyActionOutcome(effects)).toBe("unknown");
  });

  it("does not treat dispatch without expected effects as factual success", () => {
    expect(classifyActionOutcome([])).toBe("unknown");
  });

  it("verifies page lifecycle effects without requiring a successor observation", () => {
    const predecessor = observation(
      "before",
      "https://example.test/a",
      "before",
    );

    const pageOne = {
      id: "page_01",
      url: "https://example.test/a",
      active: true,
      revision: 1,
    };

    const pageTwo = {
      id: "page_02",
      url: "https://example.test/popup",
      active: false,
      revision: 1,
    };

    const openedByPageDelta = verifyExpectedEffects(
      [
        {
          kind: "page_opened",
        },
      ],
      predecessor,
      undefined,
      undefined,
      [pageOne],
      [pageOne, pageTwo],
    );

    expect(classifyActionOutcome(openedByPageDelta)).toBe("applied");

    const openedByActionResult = verifyExpectedEffects(
      [
        {
          kind: "page_opened",
        },
      ],
      predecessor,
      undefined,
      {
        ok: true,
        action: "click",
        sessionId: "session_01",
        pageChanged: true,
        openedPages: [pageTwo],
      },
      [pageOne],
      undefined,
    );

    expect(classifyActionOutcome(openedByActionResult)).toBe("applied");

    const closedByPageDelta = verifyExpectedEffects(
      [
        {
          kind: "page_closed",
        },
      ],
      predecessor,
      undefined,
      undefined,
      [pageOne, pageTwo],
      [pageOne],
    );

    expect(classifyActionOutcome(closedByPageDelta)).toBe("applied");
  });

  it("keeps page lifecycle outcome unknown when the post-action page snapshot is unavailable", () => {
    const predecessor = observation(
      "before",
      "https://example.test/a",
      "before",
    );

    const pageOne = {
      id: "page_01",
      url: "https://example.test/a",
      active: true,
      revision: 1,
    };

    const opened = verifyExpectedEffects(
      [
        {
          kind: "page_opened",
        },
      ],
      predecessor,
      undefined,
      undefined,
      [pageOne],
      undefined,
    );

    const closed = verifyExpectedEffects(
      [
        {
          kind: "page_closed",
        },
      ],
      predecessor,
      undefined,
      undefined,
      [pageOne],
      undefined,
    );

    expect(classifyActionOutcome(opened)).toBe("unknown");

    expect(classifyActionOutcome(closed)).toBe("unknown");
  });
});
