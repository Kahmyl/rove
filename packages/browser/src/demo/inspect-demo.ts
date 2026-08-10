import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { startFixtureServer } from "../fixtures/fixture-server.js";
import { PlaywrightBrowserEngine } from "../playwright-browser-engine.js";

const server = await startFixtureServer();
const engine = new PlaywrightBrowserEngine();

try {
  const session = await engine.start({
    headless: false,
    browser: "chrome",
    profile: {
      mode: "temporary",
    },
  });

  try {
    await session.navigate(server.url);

    const inspection = await session.inspect();

    console.log("\nRove inspection result:\n");
    console.log(JSON.stringify(inspection, null, 2));

    console.log("\nFixture URL:");
    console.log(server.url);

    console.log("\nCompare the visible browser page with the inspection JSON.");

    const readline = createInterface({
      input,
      output,
    });

    try {
      await readline.question(
        "\nPress Enter to close the browser...",
      );
    } finally {
      readline.close();
    }
  } finally {
    await session.close();
  }
} finally {
  await server.close();
}
