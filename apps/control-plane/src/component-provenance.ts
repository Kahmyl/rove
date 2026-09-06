import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  ROVE_HUB_PROTOCOL_VERSION,
  ROVE_PROTOCOL_VERSION,
  type ComponentInstanceIdentity,
} from "@rove/protocol";
import packageJson from "../package.json" with { type: "json" };

function validCommit(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized !== undefined && /^[a-f0-9]{40}$/.test(normalized)
    ? normalized
    : undefined;
}

function developmentCommit(): string | undefined {
  const injected = validCommit(process.env.ROVE_BUILD_GIT_COMMIT);
  if (injected !== undefined) return injected;
  try {
    return validCommit(execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    }));
  } catch {
    return undefined;
  }
}

const developmentGitCommit = developmentCommit();

export const CONTROL_PLANE_PROVENANCE: ComponentInstanceIdentity = {
  component: "control_plane",
  instanceId: `control_${randomUUID().replaceAll("-", "")}`,
  version: packageJson.version,
  startedAt: new Date().toISOString(),
  processId: process.pid,
  buildIdentity:
    process.env.ROVE_BUILD_ID?.trim() || `rove@${packageJson.version}`,
  protocols: {
    runtimeApi: ROVE_PROTOCOL_VERSION,
    hub: ROVE_HUB_PROTOCOL_VERSION,
  },
  ...(developmentGitCommit === undefined ? {} : { developmentGitCommit }),
};
