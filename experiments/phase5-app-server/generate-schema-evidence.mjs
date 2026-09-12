import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import console from "node:console";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const output = resolve(
  root,
  "experiments/phase5-app-server/fixtures/schema-manifest.json",
);
const update = process.argv.includes("--update");
const executable = process.env.ROVE_CODEX_EXECUTABLE ?? "codex";

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0)
        resolvePromise({ stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error(`${command} exited ${code}: ${stderr}`));
    });
  });
}

async function filesBelow(directory) {
  const found = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) found.push(path);
    }
  }
  await visit(directory);
  return found.sort();
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const temporary = await mkdtemp(join(tmpdir(), "rove-p50-schema-"));
try {
  const versionResult = await run(executable, ["--version"]);
  const versionMatch = versionResult.stdout.match(/codex-cli\s+(\S+)/);
  if (!versionMatch)
    throw new Error(`Unrecognized Codex version: ${versionResult.stdout}`);
  const resolvedExecutable = await realpath(
    executable.includes("/")
      ? executable
      : (await run("/usr/bin/which", [executable])).stdout,
  );
  const executableSha256 = digest(await readFile(resolvedExecutable));
  await run(executable, [
    "app-server",
    "generate-ts",
    "--experimental",
    "--out",
    join(temporary, "ts"),
  ]);
  await run(executable, [
    "app-server",
    "generate-json-schema",
    "--experimental",
    "--out",
    join(temporary, "json"),
  ]);
  const paths = await filesBelow(temporary);
  const runtimeValidatorCatalog = join(temporary, "runtime-validators.json");
  await run(process.execPath, [
    join(root, "experiments/phase5-app-server/generate-runtime-validators.mjs"),
    "--source",
    join(temporary, "ts"),
    "--output",
    runtimeValidatorCatalog,
  ]);
  const generatedRuntimeValidators = await readFile(runtimeValidatorCatalog);
  const checkedInRuntimeValidators = await readFile(
    join(
      root,
      "apps/companion/src/main/codex/app-server-0.153.4.schemas.generated.json",
    ),
  );
  if (
    JSON.stringify(JSON.parse(generatedRuntimeValidators)) !==
    JSON.stringify(JSON.parse(checkedInRuntimeValidators))
  )
    throw new Error(
      "Checked-in App Server runtime validator catalog has drifted from generate-ts 0.153.4.",
    );
  const entries = [];
  for (const path of paths) {
    const bytes = await readFile(path);
    entries.push({
      path: relative(temporary, path),
      bytes: bytes.length,
      sha256: digest(bytes),
    });
  }
  const aggregateSha256 = digest(
    entries.map((entry) => `${entry.path}\0${entry.sha256}\n`).join(""),
  );
  const pick = (path) => entries.find((entry) => entry.path === path);
  const manifest = {
    schemaVersion: 1,
    generatedAt: "2026-09-07",
    command: [
      "codex app-server generate-ts --experimental --out <temporary>/ts",
      "codex app-server generate-json-schema --experimental --out <temporary>/json",
    ],
    cliVersion: versionMatch[1],
    executable: {
      configured: executable,
      resolved: resolvedExecutable,
      sha256: executableSha256,
    },
    files: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    aggregateSha256,
    runtimeValidatorCatalogSha256: digest(generatedRuntimeValidators),
    canonicalBundles: {
      legacyJson: pick("json/codex_app_server_protocol.schemas.json"),
      v2Json: pick("json/codex_app_server_protocol.v2.schemas.json"),
      clientRequestTs: pick("ts/ClientRequest.ts"),
      serverRequestTs: pick("ts/ServerRequest.ts"),
    },
  };

  if (update) {
    await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(
      JSON.stringify({ status: "updated", output, manifest }, null, 2),
    );
  } else {
    const expected = JSON.parse(await readFile(output, "utf8"));
    const comparable = (value) => ({
      cliVersion: value.cliVersion,
      executableSha256: value.executable.sha256,
      files: value.files,
      bytes: value.bytes,
      aggregateSha256: value.aggregateSha256,
      runtimeValidatorCatalogSha256: value.runtimeValidatorCatalogSha256,
      canonicalBundles: value.canonicalBundles,
    });
    const matches =
      JSON.stringify(comparable(manifest)) ===
      JSON.stringify(comparable(expected));
    console.log(
      JSON.stringify(
        {
          status: matches ? "pass" : "drift",
          expected: comparable(expected),
          actual: comparable(manifest),
        },
        null,
        2,
      ),
    );
    if (!matches) process.exitCode = 1;
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
