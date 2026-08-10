import console from "node:console";
import process from "node:process";
import { chmod, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const profileName = process.argv
  .slice(2)
  .find((argument) => argument !== "--");

if (
  !profileName ||
  !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(profileName)
) {
  console.error(
    "Usage: pnpm auth:profile -- <profile-name>",
  );
  process.exit(1);
}

if (process.platform !== "darwin") {
  console.error(
    "The lean authentication bootstrap currently supports macOS only.",
  );
  process.exit(1);
}

const home = resolve(
  process.cwd(),
  process.env.ROVE_HOME ?? ".rove",
);

const userDataDir = resolve(
  home,
  "profiles",
  profileName,
);

await mkdir(userDataDir, {
  recursive: true,
  mode: 0o700,
});

await chmod(userDataDir, 0o700);

console.log("");
console.log(`Rove profile: ${profileName}`);
console.log(`Profile directory: ${userDataDir}`);
console.log("");
console.log(
  "Chrome will open without Playwright control.",
);
console.log(
  "Sign in normally, then quit that Chrome instance completely.",
);
console.log(
  "This command will finish when the authentication browser closes.",
);
console.log("");

const child = spawn(
  "open",
  [
    "-W",
    "-na",
    "Google Chrome",
    "--args",
    `--user-data-dir=${userDataDir}`,
    "https://wellfound.com",
  ],
  {
    stdio: "inherit",
  },
);

child.once("error", (error) => {
  console.error(
    `Could not start Google Chrome: ${error.message}`,
  );
  process.exit(1);
});

child.once("exit", (code) => {
  if (code !== 0) {
    console.error(
      `Google Chrome exited with code ${code ?? "unknown"}.`,
    );
    process.exit(code ?? 1);
  }

  console.log("");
  console.log(
    `Authentication bootstrap complete for "${profileName}".`,
  );
});
