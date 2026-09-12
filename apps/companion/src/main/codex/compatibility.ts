import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { arch, platform } from "node:process";

import { CODEX_SCHEMA_SHA256 } from "./protocol.js";

export interface CodexCompatibilityBaseline {
  cliVersion: string;
  platformOs: "macos" | "linux" | "windows";
  architecture: string;
  executableSha256: string;
  generatedSchemaSha256: string;
}

export const REVIEWED_CODEX_BASELINES: readonly CodexCompatibilityBaseline[] = [
  {
    cliVersion: "0.153.4",
    platformOs: "macos",
    architecture: "arm64",
    executableSha256:
      "87a08119b8effa519f0ecb552dc98043f58a8200bf2ec5da60f76890c33e9c3a",
    generatedSchemaSha256: CODEX_SCHEMA_SHA256,
  },
  {
    cliVersion: "0.153.4",
    platformOs: "macos",
    architecture: "arm64",
    executableSha256:
      "c147aa90d34139599711fb568102ceefc6319ca1ac5cb6f4056ca46a1834edd9",
    generatedSchemaSha256: CODEX_SCHEMA_SHA256,
  },
];

export type CodexResolutionFailure =
  | "unresolved_executable"
  | "unsupported_platform"
  | "unsupported_version"
  | "executable_digest_mismatch"
  | "schema_digest_mismatch";

export class CodexCompatibilityError extends Error {
  constructor(
    readonly code: CodexResolutionFailure,
    message: string,
  ) {
    super(message);
  }
}

export interface ResolvedCodexExecutable {
  executablePath: string;
  baseline: CodexCompatibilityBaseline;
  source: "development" | "packaged";
}

export interface CodexExecutableResolverOptions {
  isPackaged: boolean;
  packagedExecutablePath?: string;
  developmentExecutablePath?: string;
  schemaSha256?: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  readVersion?: (path: string) => Promise<string>;
  hashFile?: (path: string) => Promise<string>;
}

function osName(value: NodeJS.Platform): "macos" | "linux" | "windows" {
  if (value === "darwin") return "macos";
  if (value === "linux") return "linux";
  if (value === "win32") return "windows";
  throw new CodexCompatibilityError(
    "unsupported_platform",
    `Codex App Server is not qualified on ${value}.`,
  );
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export class CodexExecutableResolver {
  constructor(private readonly options: CodexExecutableResolverOptions) {}

  async resolve(): Promise<ResolvedCodexExecutable> {
    const source = this.options.isPackaged ? "packaged" : "development";
    const executablePath = this.options.isPackaged
      ? this.options.packagedExecutablePath
      : this.options.developmentExecutablePath;
    if (executablePath === undefined || executablePath.trim().length === 0) {
      throw new CodexCompatibilityError(
        "unresolved_executable",
        `${source} Codex executable path is not explicitly configured.`,
      );
    }
    await access(executablePath, constants.X_OK).catch(() => {
      throw new CodexCompatibilityError(
        "unresolved_executable",
        `Codex executable is not readable and executable: ${executablePath}`,
      );
    });
    const targetOs = osName(this.options.platform ?? platform);
    const targetArch = this.options.architecture ?? arch;
    const schemaSha256 = this.options.schemaSha256 ?? CODEX_SCHEMA_SHA256;
    const candidates = REVIEWED_CODEX_BASELINES.filter(
      (entry) =>
        entry.platformOs === targetOs && entry.architecture === targetArch,
    );
    if (candidates.length === 0) {
      throw new CodexCompatibilityError(
        "unsupported_platform",
        `No reviewed Codex baseline exists for ${targetOs}/${targetArch}.`,
      );
    }
    if (
      !candidates.some((entry) => entry.generatedSchemaSha256 === schemaSha256)
    ) {
      throw new CodexCompatibilityError(
        "schema_digest_mismatch",
        "Compiled Codex protocol schema is not a reviewed baseline.",
      );
    }
    const version = await this.options.readVersion?.(executablePath);
    if (version === undefined) {
      throw new CodexCompatibilityError(
        "unsupported_version",
        "A trusted Codex version probe is required.",
      );
    }
    const versionCandidates = candidates.filter(
      (entry) => entry.cliVersion === version,
    );
    if (versionCandidates.length === 0) {
      throw new CodexCompatibilityError(
        "unsupported_version",
        `Codex ${version} is not a reviewed baseline.`,
      );
    }
    const digest = await (this.options.hashFile ?? sha256)(executablePath);
    const baseline = versionCandidates.find(
      (entry) => entry.executableSha256 === digest,
    );
    if (baseline === undefined) {
      throw new CodexCompatibilityError(
        "executable_digest_mismatch",
        "Codex executable digest does not match its reviewed baseline.",
      );
    }
    return { executablePath, baseline, source };
  }
}
