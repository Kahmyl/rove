import { spawn } from "node:child_process";

export function shouldDetachManagedChild(
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform !== "win32";
}

export async function terminateProcessTree(
  pid: number,
  signal: NodeJS.Signals,
): Promise<void> {
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const args = [
        "/PID",
        String(pid),
        "/T",
        ...(signal === "SIGKILL" ? ["/F"] : []),
      ];

      const killer = spawn("taskkill", args, {
        stdio: "ignore",
        windowsHide: true,
      });

      let settled = false;

      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        resolve();
      };

      killer.once("error", finish);
      killer.once("exit", finish);
    });

    return;
  }

  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}
