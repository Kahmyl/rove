import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = await mkdtemp(join(tmpdir(), "rove-browser-control-"));
const pnpmScript = process.env.npm_execpath;
const command = pnpmScript ? process.execPath : "pnpm";
const args = pnpmScript
  ? [pnpmScript, "--filter", "@rove/runtime", "control-demo"]
  : ["--filter", "@rove/runtime", "control-demo"];

try {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ROVE_HOME: home },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal)
        reject(new Error(`Control qualification ended by ${signal}.`));
      else resolve(code ?? 1);
    });
  });
  if (exitCode !== 0)
    throw new Error(`Control qualification exited with code ${exitCode}.`);
} finally {
  await rm(home, { recursive: true, force: true });
}
