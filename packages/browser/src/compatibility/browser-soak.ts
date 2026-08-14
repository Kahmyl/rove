import process from "node:process";

import { PlaywrightBrowserEngine } from "../playwright-browser-engine.js";
import {
  startFixtureServer,
  type FixtureServer,
} from "../fixtures/fixture-server.js";
import type { BrowserSession } from "../engine.js";

interface SoakOptions {
  durationMs: number;
  intervalMs: number;
  headless: boolean;
}

interface SoakReport {
  title: "Rove Browser Soak";
  durationMs: number;
  intervalMs: number;
  iterations: number;
  memory: {
    startRss: number;
    endRss: number;
    maxRss: number;
  };
  cleanup: {
    sessionClosed: boolean;
    fixtureClosed: boolean;
  };
}

const DEFAULT_DURATION_MS = 30 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 5_000;

function optionsFromArgs(args: string[]): SoakOptions {
  let durationMs =
    Number(process.env.ROVE_BROWSER_SOAK_MS ?? "") ||
    DEFAULT_DURATION_MS;
  let intervalMs =
    Number(process.env.ROVE_BROWSER_SOAK_INTERVAL_MS ?? "") ||
    DEFAULT_INTERVAL_MS;
  let headless = true;

  for (const arg of args) {
    if (arg === "--") {
      continue;
    }

    if (arg.startsWith("--duration-ms=")) {
      durationMs = Number(arg.slice("--duration-ms=".length));
      continue;
    }

    if (arg.startsWith("--interval-ms=")) {
      intervalMs = Number(arg.slice("--interval-ms=".length));
      continue;
    }

    if (arg === "--headed") {
      headless = false;
      continue;
    }

    if (arg === "--headless") {
      headless = true;
      continue;
    }

    throw new Error(`Unknown browser:soak argument: ${arg}`);
  }

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("Soak duration must be a positive number of milliseconds.");
  }

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("Soak interval must be a positive number of milliseconds.");
  }

  return { durationMs, intervalMs, headless };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runIteration(
  session: BrowserSession,
  fixture: FixtureServer,
  iteration: number,
): Promise<void> {
  await session.navigate(
    `${fixture.url}${iteration % 2 === 0 ? "/" : "/actions"}`,
  );
  const inspection = await session.inspect();

  if (inspection.pageId.length === 0 || inspection.revision < 0) {
    throw new Error("Inspection returned an invalid page identity.");
  }

  if (iteration % 3 === 0) {
    await session.pages();
  }
}

export async function runBrowserSoak(
  options: SoakOptions,
): Promise<SoakReport> {
  const fixture = await startFixtureServer();
  let fixtureClosed = false;
  let sessionClosed = false;
  const session = await new PlaywrightBrowserEngine().start({
    browser: "chromium",
    headless: options.headless,
    profile: { mode: "temporary" },
  });

  const start = process.memoryUsage().rss;
  let maxRss = start;
  let iterations = 0;
  const deadline = Date.now() + options.durationMs;

  try {
    while (Date.now() < deadline) {
      iterations += 1;
      await runIteration(session, fixture, iterations);
      maxRss = Math.max(maxRss, process.memoryUsage().rss);
      await delay(Math.min(options.intervalMs, Math.max(0, deadline - Date.now())));
    }
  } finally {
    await session.close().finally(() => {
      sessionClosed = true;
    });
    await fixture.close().finally(() => {
      fixtureClosed = true;
    });
  }

  return {
    title: "Rove Browser Soak",
    durationMs: options.durationMs,
    intervalMs: options.intervalMs,
    iterations,
    memory: {
      startRss: start,
      endRss: process.memoryUsage().rss,
      maxRss,
    },
    cleanup: {
      sessionClosed,
      fixtureClosed,
    },
  };
}

if (process.argv[1]?.endsWith("browser-soak.ts") ?? false) {
  runBrowserSoak(optionsFromArgs(process.argv.slice(2)))
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
