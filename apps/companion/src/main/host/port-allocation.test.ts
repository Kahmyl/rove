import { createServer } from "node:net";

import { describe, expect, it } from "vitest";

import { allocateLoopbackPort } from "./port-allocation.js";

describe("allocateLoopbackPort", () => {
  it("returns a bindable loopback port", async () => {
    const port = await allocateLoopbackPort();

    expect(port).toBeGreaterThan(0);

    const server = createServer();

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);

      server.listen(
        {
          host: "127.0.0.1",
          port,
        },
        () => resolve(),
      );
    });

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });
});
