import {
  describe,
  expect,
  it,
} from "vitest";

import {
  toolSuccessWithImage,
} from "./tool-result.js";

describe(
  "screenshot MCP presentation",
  () => {
    it("separates metadata and image content", () => {
      const result =
        toolSuccessWithImage({
          id: "ev_test",
          type: "screenshot",
          image: {
            mimeType:
              "image/png",
            data:
              Buffer.from(
                "png",
              ).toString(
                "base64",
              ),
            byteLength: 3,
          },
        });

      expect(
        result.content,
      ).toHaveLength(2);

      expect(
        result.content[1],
      ).toMatchObject({
        type: "image",
        mimeType:
          "image/png",
      });

      const first =
        result.content[0];

      if (
        first?.type !== "text"
      ) {
        throw new Error(
          "Expected text metadata.",
        );
      }

      expect(
        JSON.parse(first.text),
      ).not.toHaveProperty(
        "image",
      );
    });
  },
);
