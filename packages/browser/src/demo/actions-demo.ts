import { createInterface } from "node:readline/promises";

import type { PageInspection, TargetReference } from "@rove/protocol";
import { startFixtureServer } from "../fixtures/fixture-server.js";
import { PlaywrightBrowserEngine } from "../playwright-browser-engine.js";

function target(inspection: PageInspection, name: string): TargetReference {
  const found = inspection.targets?.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Demo target not found: ${name}`);
  return { pageId: inspection.pageId, revision: inspection.revision, ref: found.ref };
}

const server = await startFixtureServer();
const session = await new PlaywrightBrowserEngine().start({
  headless: false,
  browser: "chromium",
  profile: { mode: "temporary" },
});

try {
  await session.navigate(`${server.url}/actions`);
  let inspection = await session.inspect();
  const search = target(inspection, "Search");
  console.log(`page: ${inspection.pageId}`);
  console.log(`target: ${search.ref}`);
  await session.type(search, "backend");
  inspection = await session.inspect();
  await session.click(target(inspection, "Submit search"));
  console.log(`result: ${(await session.inspect()).text?.includes("submitted:backend") ? "submitted" : "missing"}`);
  await session.back();
  await session.scroll({ direction: "down" });
  const screenshot = await session.screenshot();
  console.log(`screenshot: ${screenshot.bytes.length} PNG bytes`);

  await session.navigate(`${server.url}/dynamic-target#replace-later`);
  inspection = await session.inspect();
  const oldTarget = target(inspection, "Replace me");
  await new Promise((resolve) => setTimeout(resolve, 250));
  try {
    await session.click(oldTarget);
  } catch (error) {
    console.log(`stale target: ${error instanceof Error && "code" in error ? String(error.code) : "unexpected error"}`);
  }

  if (process.env.ROVE_DEMO_WAIT === "1") {
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    await readline.question("Press Enter to close the browser...");
    readline.close();
  }
} finally {
  await session.close();
  await server.close();
}
