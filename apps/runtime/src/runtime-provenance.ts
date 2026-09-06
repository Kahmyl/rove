import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import process from "node:process";

import packageJson from "../package.json" with { type: "json" };
import {
  ROVE_HUB_PROTOCOL_VERSION,
  ROVE_PROTOCOL_VERSION,
  type ComponentInstanceIdentity,
} from "@rove/protocol";

export interface RuntimeProvenance extends ComponentInstanceIdentity {
  runtimeInstanceId: string;
}

function validRuntimeInstanceId(value: string | undefined): string | undefined {
  return value !== undefined && /^runtime_[a-f0-9]{32}$/.test(value)
    ? value
    : undefined;
}

function validCommit(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized !== undefined && /^[a-f0-9]{40}$/.test(normalized)
    ? normalized
    : undefined;
}

function developmentGitCommit(): string | undefined {
  const injected = validCommit(process.env.ROVE_BUILD_GIT_COMMIT);
  if (injected !== undefined) return injected;

  try {
    return validCommit(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2_000,
      }),
    );
  } catch {
    return undefined;
  }
}

const gitCommit = developmentGitCommit();
const runtimeInstanceId =
  validRuntimeInstanceId(process.env.ROVE_RUNTIME_INSTANCE_ID) ??
  `runtime_${randomUUID().replaceAll("-", "")}`;

export const RUNTIME_PROVENANCE: RuntimeProvenance = {
  component: "runtime",
  instanceId: runtimeInstanceId,
  runtimeInstanceId,
  version: packageJson.version,
  startedAt:
    process.env.ROVE_RUNTIME_STARTED_AT !== undefined &&
    !Number.isNaN(Date.parse(process.env.ROVE_RUNTIME_STARTED_AT))
      ? new Date(process.env.ROVE_RUNTIME_STARTED_AT).toISOString()
      : new Date().toISOString(),
  processId: process.pid,
  buildIdentity:
    process.env.ROVE_BUILD_ID?.trim() || `rove@${packageJson.version}`,
  protocols: {
    runtimeApi: ROVE_PROTOCOL_VERSION,
    hub: ROVE_HUB_PROTOCOL_VERSION,
  },
  ...(gitCommit === undefined ? {} : { developmentGitCommit: gitCommit }),
};
