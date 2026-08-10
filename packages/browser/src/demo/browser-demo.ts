import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { startFixtureServer } from "../fixtures/fixture-server.js";
import { PlaywrightBrowserEngine } from "../playwright-browser-engine.js";

const server = await startFixtureServer();
const engine = new PlaywrightBrowserEngine();

try {
  const session = await engine.start({
    headless: false,
    browser: "chrome",
    profile: { mode: "temporary" },
  });

  try {
    console.log("\nRove browser session started");
    console.log("session:", session.id);

    console.log("\nInitial pages:");
    console.log(await session.pages());

    const navigation = await session.navigate(server.url);

    console.log("\nNavigation result:");
    console.log(navigation);

    console.log("\nPages after navigation:");
    console.log(await session.pages());

    console.log(`\nFixture URL: ${server.url}`);

    const readline = createInterface({ input, output });

    try {
      await readline.question("\nPress Enter to close the browser...");
    } finally {
      readline.close();
    }
  } finally {
    await session.close();
  }
} finally {
  await server.close();
}
