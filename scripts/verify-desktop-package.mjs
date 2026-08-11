import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactsRoot = join(repositoryRoot, "release", "artifacts");
const runtimeToken = "rove-packaged-runtime-smoke-token";
const mcpToken = "rove-packaged-mcp-smoke-token";

async function firstExisting(paths) {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // Try the next platform layout.
    }
  }

  throw new Error(
    `Packaged Rove executable was not found in ${artifactsRoot}.`,
  );
}

async function resolvePackageLayout() {
  if (process.env.ROVE_PACKAGED_EXECUTABLE !== undefined) {
    const executable = resolve(process.env.ROVE_PACKAGED_EXECUTABLE);
    const resourcesPath = resolve(
      process.env.ROVE_PACKAGED_RESOURCES ??
        join(dirname(executable), "..", "Resources"),
    );

    return { executable, resourcesPath };
  }

  if (process.platform === "darwin") {
    const appRoot = join(
      artifactsRoot,
      `mac-${process.arch}`,
      "Rove.app",
      "Contents",
    );

    return {
      executable: join(appRoot, "MacOS", "Rove"),
      resourcesPath: join(appRoot, "Resources"),
    };
  }

  const unpackedDirectory =
    process.platform === "win32" ? "win-unpacked" : "linux-unpacked";
  const unpackedRoot = join(artifactsRoot, unpackedDirectory);

  return {
    executable: await firstExisting([
      join(unpackedRoot, "Rove.exe"),
      join(unpackedRoot, "Rove"),
      join(unpackedRoot, "rove"),
    ]),
    resourcesPath: join(unpackedRoot, "resources"),
  };
}

async function allocatePort() {
  const server = createServer();

  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Could not allocate a packaged-service smoke-test port.");
  }

  await new Promise((resolveClose) => server.close(resolveClose));
  return address.port;
}

function launch(executable, entrypoint, environment) {
  const child = spawn(executable, [entrypoint], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ...environment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  return { child, output: () => output };
}

async function waitForHealth(url, service, child) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 15_000) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`${service} exited before becoming healthy.`);
    }

    try {
      const response = await globalThis.fetch(url);

      if (response.ok) {
        return;
      }
    } catch {
      // The packaged service is still starting.
    }

    await delay(100);
  }

  throw new Error(`${service} did not become healthy within 15 seconds.`);
}

async function stop(child) {
  if (
    child === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return;
  }

  const gracefulExit = once(child, "exit");

  child.kill("SIGTERM");

  await Promise.race([gracefulExit, delay(5_000)]);

  if (child.exitCode === null && child.signalCode === null) {
    const forcedExit = once(child, "exit");

    child.kill("SIGKILL");
    await forcedExit;
  }
}

const { executable, resourcesPath } = await resolvePackageLayout();
const runtimePort = await allocatePort();
const mcpPort = await allocatePort();
const temporaryHome = await mkdtemp(join(tmpdir(), "rove-packaged-smoke-"));
const runtimeBaseUrl = `http://127.0.0.1:${runtimePort}`;
const mcpBaseUrl = `http://127.0.0.1:${mcpPort}`;

let runtime;
let mcp;

try {
  await Promise.all([
    access(executable),
    access(join(resourcesPath, "services", "runtime", "dist", "main.js")),
    access(join(resourcesPath, "services", "mcp", "dist", "main.js")),
    access(join(resourcesPath, "browsers")),
  ]);

  runtime = launch(
    executable,
    join(resourcesPath, "services", "runtime", "dist", "main.js"),
    {
      ROVE_HOME: temporaryHome,
      ROVE_RUNTIME_HOST: "127.0.0.1",
      ROVE_RUNTIME_PORT: String(runtimePort),
      ROVE_RUNTIME_URL: runtimeBaseUrl,
      ROVE_RUNTIME_TOKEN: runtimeToken,
      ROVE_BROWSER_HEADLESS: "true",
      ROVE_BROWSER: "chromium",
      PLAYWRIGHT_BROWSERS_PATH: join(resourcesPath, "browsers"),
    },
  );

  await waitForHealth(`${runtimeBaseUrl}/health`, "Runtime", runtime.child);

  const sessionResponse = await globalThis.fetch(`${runtimeBaseUrl}/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${runtimeToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ mode: "agent" }),
  });

  if (!sessionResponse.ok) {
    throw new Error(
      `Packaged Runtime session failed: HTTP ${sessionResponse.status}.`,
    );
  }

  const session = await sessionResponse.json();

  const endResponse = await globalThis.fetch(
    `${runtimeBaseUrl}/sessions/${session.id}/end`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${runtimeToken}`,
      },
    },
  );

  if (!endResponse.ok) {
    throw new Error(
      `Packaged Runtime cleanup failed: HTTP ${endResponse.status}.`,
    );
  }

  mcp = launch(
    executable,
    join(resourcesPath, "services", "mcp", "dist", "main.js"),
    {
      ROVE_RUNTIME_URL: runtimeBaseUrl,
      ROVE_RUNTIME_TOKEN: runtimeToken,
      ROVE_MCP_TRANSPORT: "http",
      ROVE_MCP_HOST: "127.0.0.1",
      ROVE_MCP_PORT: String(mcpPort),
      ROVE_MCP_PATH: "/mcp",
      ROVE_MCP_TOKEN: mcpToken,
      ROVE_MCP_ALLOWED_HOSTS: `127.0.0.1:${mcpPort},localhost:${mcpPort}`,
    },
  );

  await waitForHealth(`${mcpBaseUrl}/health`, "MCP", mcp.child);

  process.stdout.write(
    `Packaged Rove smoke test passed (${process.platform}/${process.arch}).\n`,
  );
} catch (error) {
  const serviceOutput = [runtime?.output(), mcp?.output()]
    .filter(Boolean)
    .join("\n")
    .slice(-8_000);

  if (serviceOutput.length > 0) {
    process.stderr.write(`${serviceOutput}\n`);
  }

  throw error;
} finally {
  await stop(mcp?.child);
  await stop(runtime?.child);
  await rm(temporaryHome, { recursive: true, force: true });
}
