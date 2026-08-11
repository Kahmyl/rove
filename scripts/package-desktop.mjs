import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = join(repositoryRoot, "release");
const stagingRoot = join(releaseRoot, "staging");
const desktopRoot = join(stagingRoot, "desktop");
const servicesRoot = join(stagingRoot, "services");
const runtimeRoot = join(servicesRoot, "runtime");
const mcpRoot = join(servicesRoot, "mcp");
const browsersRoot = join(stagingRoot, "browsers");
const pnpmExecutable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed ${
            signal === null ? `with code ${code}` : `with signal ${signal}`
          }.`,
        ),
      );
    });
  });
}

async function assertFile(path) {
  const details = await stat(path);

  if (!details.isFile()) {
    throw new Error(`Expected packaged file is missing: ${path}`);
  }
}

async function pruneService(serviceRoot) {
  await Promise.all(
    ["src", "test", "tsconfig.json", "tsconfig.tsbuildinfo"].map((entry) =>
      rm(join(serviceRoot, entry), { recursive: true, force: true }),
    ),
  );
}

async function prepare() {
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(servicesRoot, { recursive: true });

  await run(pnpmExecutable, ["-w", "build"]);

  await run(pnpmExecutable, [
    "--filter",
    "@rove/companion",
    "deploy",
    "--prod",
    "--legacy",
    desktopRoot,
  ]);

  await run(pnpmExecutable, [
    "--filter",
    "@rove/runtime",
    "deploy",
    "--prod",
    "--legacy",
    runtimeRoot,
  ]);

  await run(pnpmExecutable, [
    "--filter",
    "@rove/mcp",
    "deploy",
    "--prod",
    "--legacy",
    mcpRoot,
  ]);

  await Promise.all([pruneService(runtimeRoot), pruneService(mcpRoot)]);

  await run(
    pnpmExecutable,
    ["--filter", "@rove/browser", "exec", "playwright", "install", "chromium"],
    {
      env: {
        PLAYWRIGHT_BROWSERS_PATH: browsersRoot,
      },
    },
  );

  const electronPackage = JSON.parse(
    await readFile(
      join(
        repositoryRoot,
        "apps",
        "companion",
        "node_modules",
        "electron",
        "package.json",
      ),
      "utf8",
    ),
  );

  const desktopPackagePath = join(desktopRoot, "package.json");
  const desktopPackage = JSON.parse(await readFile(desktopPackagePath, "utf8"));

  desktopPackage.build = {
    ...desktopPackage.build,
    electronVersion: electronPackage.version,
  };

  await writeFile(
    desktopPackagePath,
    `${JSON.stringify(desktopPackage, null, 2)}\n`,
  );

  await Promise.all([
    assertFile(join(desktopRoot, "dist", "main", "main", "main.js")),
    assertFile(join(desktopRoot, "dist", "renderer", "index.html")),
    assertFile(join(runtimeRoot, "dist", "main.js")),
    assertFile(join(runtimeRoot, "node_modules", "playwright", "package.json")),
    assertFile(join(mcpRoot, "dist", "main.js")),
    assertFile(
      join(
        mcpRoot,
        "node_modules",
        "@modelcontextprotocol",
        "sdk",
        "package.json",
      ),
    ),
  ]);
}

async function packageDesktop() {
  await prepare();

  if (process.argv.includes("--prepare-only")) {
    return;
  }

  const builderArguments = [
    "--filter",
    "@rove/companion",
    "exec",
    "electron-builder",
    `--projectDir=${desktopRoot}`,
    "--publish=never",
  ];

  if (process.argv.includes("--dir")) {
    builderArguments.push("--dir");
  }

  await run(pnpmExecutable, builderArguments, {
    env: {
      CSC_IDENTITY_AUTO_DISCOVERY:
        process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? "false",
    },
  });
}

await packageDesktop();
