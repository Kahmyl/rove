import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  componentPaths,
  defaultManagedCodexRoot,
  readCompiledSchemaBindings,
  readComponentManifest,
  selectedComponent,
  verifyCompiledSchemaBinding,
  verifyComponentDirectory,
} from "./codex-component-lib.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = join(repositoryRoot, "release");
const stagingRoot = join(releaseRoot, "staging");
const desktopRoot = join(stagingRoot, "desktop");
const servicesRoot = join(stagingRoot, "services");
const runtimeRoot = join(servicesRoot, "runtime");
const mcpRoot = join(servicesRoot, "mcp");
const browsersRoot = join(stagingRoot, "browsers");
const codexRoot = join(servicesRoot, "codex");
const pnpmExecutable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const componentManifest = await readComponentManifest();
const compiledSchemaBindings = await readCompiledSchemaBindings();
export const PACKAGED_CODEX_COMPONENT = selectedComponent(componentManifest);

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

async function assertModuleResolvable(packageRoot, specifier) {
  const canonicalRoot = await realpath(packageRoot);
  const require = createRequire(join(canonicalRoot, "package.json"));

  await assertFile(require.resolve(specifier));
}

async function pruneService(serviceRoot) {
  await Promise.all(
    ["src", "test", "tsconfig.json", "tsconfig.tsbuildinfo"].map((entry) =>
      rm(join(serviceRoot, entry), { recursive: true, force: true }),
    ),
  );
}

export async function verifyCodexCodeModeHost(
  source,
  expected = PACKAGED_CODEX_COMPONENT.codeModeHost,
  componentId = PACKAGED_CODEX_COMPONENT.id,
) {
  const bytes = await readFile(source).catch(() => {
    throw new Error(`Supported Codex code-mode host is unavailable: ${source}`);
  });
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expected.sha256) {
    throw new Error(
      `Codex code-mode host digest does not match packaged component ${componentId}.`,
    );
  }
  if (bytes.byteLength !== expected.bytes) {
    throw new Error(
      `Codex code-mode host size does not match packaged component ${componentId}.`,
    );
  }
  return { source, bytes, digest, size: bytes.byteLength };
}

export async function verifyCodexComponentSet({
  root = defaultManagedCodexRoot(),
  component = PACKAGED_CODEX_COMPONENT,
  schemaBindings = compiledSchemaBindings,
  schemaRoot,
} = {}) {
  await verifyCompiledSchemaBinding(component, schemaBindings, schemaRoot);
  const managed = componentPaths(root, component);
  await verifyComponentDirectory(managed.directory, component);
  const executableSource = managed.executable;
  const codeModeHostSource = managed.codeModeHost;
  const executableBytes = await readFile(executableSource).catch(() => {
    throw new Error(
      `Supported Codex executable is unavailable: ${executableSource}`,
    );
  });
  const executableDigest = createHash("sha256")
    .update(executableBytes)
    .digest("hex");
  if (executableDigest !== component.executable.sha256) {
    throw new Error(
      `Codex executable digest does not match packaged component ${component.id}.`,
    );
  }
  const codeModeHost = await verifyCodexCodeModeHost(
    codeModeHostSource,
    component.codeModeHost,
    component.id,
  );
  return {
    executable: {
      source: executableSource,
      bytes: executableBytes,
      digest: executableDigest,
    },
    codeModeHost,
  };
}

export async function stageCodexComponentSet(
  { executable, codeModeHost },
  { component = PACKAGED_CODEX_COMPONENT, destinationRoot = codexRoot } = {},
) {
  await mkdir(destinationRoot, { recursive: true });
  const executableDestination = join(destinationRoot, "codex");
  const codeModeHostDestination = join(
    destinationRoot,
    component.codeModeHost.filename,
  );
  await Promise.all([
    writeFile(executableDestination, executable.bytes),
    writeFile(codeModeHostDestination, codeModeHost.bytes),
  ]);
  await Promise.all([
    chmod(executableDestination, 0o755),
    chmod(codeModeHostDestination, 0o755),
  ]);
  await writeFile(
    join(destinationRoot, "compatibility.json"),
    `${JSON.stringify(
      {
        componentId: component.id,
        version: component.cliVersion,
        platform: component.platformOs,
        architecture: component.architecture,
        historyMode: component.historyMode,
        sha256: executable.digest,
        schema: component.schema,
        codeModeHost: {
          filename: component.codeModeHost.filename,
          sha256: codeModeHost.digest,
          bytes: codeModeHost.size,
          platform: component.platformOs,
          architecture: component.architecture,
        },
      },
      null,
      2,
    )}\n`,
  );
}

async function prepare(verifiedCodex) {
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

  // The deterministic picker is a source-build qualification composition and
  // must never be present in desktop staging or a packaged artifact.
  await Promise.all([
    rm(join(desktopRoot, "src", "main", "qualification"), {
      recursive: true,
      force: true,
    }),
    rm(join(desktopRoot, "dist", "main", "main", "qualification"), {
      recursive: true,
      force: true,
    }),
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

  await stageCodexComponentSet(verifiedCodex);

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
    // pnpm's isolated deploy layout keeps transitive dependencies beside the
    // deployed workspace package rather than hoisting them to the service root.
    assertModuleResolvable(
      join(runtimeRoot, "node_modules", "@rove", "browser"),
      "playwright/package.json",
    ),
    assertFile(join(mcpRoot, "dist", "main.js")),
    assertFile(join(codexRoot, "codex")),
    assertFile(join(codexRoot, "codex-code-mode-host")),
    assertFile(join(codexRoot, "compatibility.json")),
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
  // Compatibility is established before clearing or otherwise mutating staging.
  const verifiedCodex = await verifyCodexComponentSet();
  if (process.argv.includes("--verify-codex-only")) return;

  await prepare(verifiedCodex);

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

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await packageDesktop();
